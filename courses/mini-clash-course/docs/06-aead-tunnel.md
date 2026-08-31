---
title: 加密隧道：Shadowsocks 风格 AEAD 帧
---

# 加密隧道：Shadowsocks 风格 AEAD 帧

## 6.1 前情：锁买好了，还没装上车

三个问题，把前两章的线头接起来：

- 第 5 章末尾那句工程做法——「每条连接现生成一个新随机 nonce，随首帧发给对端」——具体怎么落进两跳链路？
- 第 4 章分帧时说的「为下一步留的接缝」——载荷按块切好了，锁从哪一天套上去？
- 第 5 章自查题里那个只封数据帧、CONNECT 帧照旧明文的假想方案——真做的时候该不该照抄？

本章把这三个问题一并落地：给第二跳换上「盐 + 密钥派生 + 长度前缀 AEAD 块」的密文流，再与 Shadowsocks 的公开规范对一次表。装完之后，你会亲手站在中间人的位置上，看这条链路还剩下什么可看。

## 6.2 省事的自作聪明

合上第 5 章笔记，你动手给这台正向代理的第二跳套锁。最容易写出的版本是这样的：算法选 AES-GCM，钥匙从密码直接来，nonce 嫌每帧现生成麻烦——全场写死一个。锁本身是真的：第 5 章的实验证明过，改密文一个字节，对端整封拒收。上线第二天，同网络里的旁观者攒下了你两条连接的密文。两段明文只差几个字母，他什么钥匙都没有，只把两段密文逐字节异或——猜猜他能看到什么？

先写下预言，再跑这个自包含实验。

```js
// 用法示例：存成 reuse-gcm.mjs，node reuse-gcm.mjs —— AEAD 也逃不掉的同 nonce 复用
import { randomBytes, createCipheriv } from 'node:crypto'

const key = randomBytes(32)
const nonce = randomBytes(12) // GCM 惯例长度；灾难不在长度，在「全场只此一个」
const seal = (msg) => {
  const c = createCipheriv('aes-256-gcm', key, nonce)
  return Buffer.concat([c.update(msg), c.final()]) // 旁观者不看火漆，只看密文
}
const a = seal(Buffer.from('GET / HTTP/1.1\r\nHost: news.example\r\n\r\n'))
const b = seal(Buffer.from('GET / HTTP/1.1\r\nHost: mail.example\r\n\r\n')) // 只差四个字母

const xored = Buffer.alloc(a.length)
for (let i = 0; i < a.length; i++) xored[i] = a[i] ^ b[i] // 旁观者的全部功课
console.log('密文异或：', xored.toString('hex'))
```

应看到 76 个十六进制字符：开头 22 个字节全是 `00`，中间 `03 04 1e 1f` 四个非零字节，剩下的又全是 `00`。这张图你在第 5 章见过——那次是只加密的 CTR，这次换成了 AEAD，一字不差地重现。原因第 5 章说过：GCM 的加密内核就是 CTR 密码流，同一把钥匙配同一个 nonce，两段用的就是同一串流——**密文的差，恰好就是明文的差**。同 nonce 复用是 AEAD 的头号灾难，火漆救不了它：两封都是合法信，没人伪造、没人篡改，异或泄露是机密性层面的伤，火漆管的是完整性与真实性，管不到这里。

那句「看不出密文规律」的承诺，前提是 nonce 从不重复。本章的正规军要换掉三处省事：钥匙不能从密码直接来（6.3.2），nonce 不能全场一个（6.3.1 与 6.3.3），长度不能明着上路（6.3.3）。

## 6.3 原理：三件套各管一段

### 6.3.1 从灾难反推出设计

第 5 章立的纪律只有一句：同一把钥匙之下，nonce 绝不重复。工程上有两条路可走。

路一，每块现摇一个随机 nonce，随块发送。能用，但每块要多背 12 字节，而且随机数撞车的账要一直算着——NIST SP 800-38D 把同一把钥匙下的随机加密次数限在 `2^32` 次以内，撞车概率才小到可以忽略。

路二，按块计数：第一条块用 0，第二条用 1，第三条用 2……计数当 nonce，两个好处立刻到手。其一，不重复是白送的——计数只增不减。其二，nonce 不用上网线：双方各自数着自己发到第几块、收到第几块，位置就是编号，一个字节的传输成本都没有。

但路二藏着一个前提，正是 6.2 那场灾难的影子。计数器是一条连接一个、每条连接从 0 重新数——反事实摆出来：如果第二条连接还用同一把钥匙，它的第 0 块就与第一条连接的第 0 块撞在同一把钥匙加同一个计数 0 上，异或图当场重现。所以路二必须配一句话：**每条连接换一把新钥匙**。钥匙从哪来？密码是长期不换的，那就每条连接现掺一味随机佐料，把它与密码一起揉出一把一次性钥匙——这味佐料就是盐，揉的工序就是密钥派生。三件套的因果链至此闭合：新盐派新钥，计数器才敢归零；计数当编号，nonce 才不必上网线。

### 6.3.2 盐与密钥派生：一把主钥匙，按房间现配子钥匙

先立词。盐（salt）——每次连接随机生成的公开字节串，掺进密钥派生，让每条连接的钥匙都不同。密钥派生（key derivation）——不直接拿密码当钥匙，而是用密码加盐按标准步骤现配一把本会话钥匙；这套标准步骤叫 HKDF，裁判是 RFC 5869，分「提取-扩展」两步把输入揉成定长密钥，node:crypto 的 `hkdfSync` 一个函数包办。锚点一句话：一把主钥匙不直接开锁，而是按房间号现配子钥匙——配出去的丢了也不伤主钥匙。

为什么密码不能直接当钥匙？三笔账。其一，格式对不上：AES-256 的钥匙是定长 32 字节，密码是任意长字符串，总得有个转换，这个转换不如交给标准。其二，同一密码用到底，等于所有连接共用一把钥匙——6.3.1 的反事实刚算过，这正好撞在灾难上。其三，掺了随机盐的派生还白送一层隔离：各条连接的子密钥互不相同、也从子密钥推不回密码，将来某条连接的密文被攒下、甚至某把子密钥泄了，别的连接不受牵连。

实现先立五格固定尺寸，再是一个函数。注意盐公开上路——它跟着首块明文发过去，对端没有它反而配不出同一把钥匙；保密的只有密码。

```ts
// src/crypto.ts · 固定尺寸
export const SALT_LEN = 32 // 盐长：与规范对 aes-256-gcm 的取值相同（32 字节）
export const CHUNK_MAX = 0x3fff // 一块载荷的上限，与第 4 章帧上限同数：高两位置零，长度先验拒收
const TAG_LEN = 16 // GCM 火漆：16 字节
const NONCE_LEN = 12 // GCM 的 nonce 惯例：12 字节（96 位）
const SUBKEY_INFO = 'mini-clash/aead' // HKDF 的 info 串：把派生结果绑在本课这条链路的用途上
```

```ts
// src/crypto.ts · deriveSubkey
// 盐 + HKDF 派生本连接的子密钥（HKDF = RFC 5869 的「提取-扩展」两步，node:crypto 一函数包办）。
// 为什么每连接要新盐新钥：块的 nonce 计数器每条连接从 0 重启，钥匙若不换，
// 第二条连接的第 0 块就与第一条撞在同一把钥匙 + 同一个计数上——第 5 章的异或灾难原样重演。
// 盐公开上路（对方没有它派生不出同一把钥匙），从头到尾保密的只有密码
export function deriveSubkey(password: string, salt: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(password, 'utf8'), salt, SUBKEY_INFO, 32))
}
```

跟着算一遍。密码取 `course-password`，两个盐各 32 字节。

```text
盐 = 30313233…616263646566（"0123456789abcdef" 重复两遍） → 子密钥前 8 字节 = 7f4e4c85ec52bc1a
盐 = 66656463…3130（"fedcba9876543210" 重复两遍） → 子密钥前 8 字节 = 4ad87aca60c3237f
```

同密码、异盐，两把钥匙毫无血缘——这 16 个十六进制字符就是「每连接新钥」的眼见为实。`hkdfSync` 的第四个参数 info 串像派生时写下的用途标签，把钥匙绑在「本课这条链路」上；两侧只要写同一串，配出来就是同一把（自查题 1 会让你亲手破坏这一点）。

一句诚实的边界：真实世界把用户口令转成密钥材料要用慢哈希（scrypt 一类）做拉伸，防穷举；本课的密码是教学口令，威胁模型里的旁观者也从未见过任何派生材料，这层省略登记进差异清单。

### 6.3.3 长度前缀分块：把第 4 章的整条明文流封进块里

第三件套先立词。长度前缀分块（length-prefixed chunking）——把字节流切成小块，每块先发「加密后的长度」再发「加密后的内容」。锚点就是第 4 章那张帧结构表：数据帧本来就是「2 字节大端长度 + 载荷」，本章只把其中一格改掉——LEN 自己也进了密文。

为什么必须分块？AEAD 的火漆是「一整段密文」的检验章：验漆、拆封、放行，都以一段完整的封缄为单位。而 TCP 连接给的是无边界的字节流，中继要边收边转发，不可能把一整条连接攒齐了一次验。切成块，每块自成一体：凑齐一块、验一块、放行一块——第 4 章按块留的接缝，正好是 AEAD 要的单位。

为什么长度也要加密？反事实摆出来：若长度明文上路，中间人虽然读不懂内容，却读得出每块多长——首块十几字节是地址、后面几十字节是请求，连接的行为模式照样挂在线上；他还能按边界精确下手。长度进了密文，边界就一起藏了起来——6.5 的中间人探针数不出块来，就是这个性质。但一句诚实的边界要先说：总字节数与到达时机仍在线上，块长规律也大致可猜，这叫流量分析，本课不做长度填充，不防（登记差异清单）。

一条方向的线上语言全貌如下（入口 → 远端为例；反方向自成一条，结构相同）。

```text
[ 盐 32 字节 ][ 块 0 ][ 块 1 ][ 块 2 ]……

块 0 载荷   = 第 4 章 CONNECT 帧（目标地址——「去哪儿」一并上锁）
其后每块载荷 = 第 4 章数据帧（[LEN:2 大端][载荷]，原样搬进来）
```

每块的内部结构。

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0–1 | 加密的 LEN | 明文是 2 字节大端序长度，取值 1..0x3FFF——持钥拆开封皮才读得到 |
| 2–17 | 长度火漆 | 16 字节：封「长度」这一段的检验章 |
| 18 起 | 加密的载荷 | 明文是第 4 章的一条帧，长度即解出的 LEN |
| 末 16 字节 | 载荷火漆 | 16 字节：封「载荷」这一段的检验章 |

块内 nonce 按位置计数。第 index 块（从 0 数）内有两次 AEAD 操作——长度一次、载荷一次——计数各占一位，起点 `2 × index`。

| 块号 | 长度操作计数 | 载荷操作计数 | nonce（12 字节） |
| --- | --- | --- | --- |
| 0 | 0 | 1 | `00 00 … 00`、`01 00 … 00` |
| 1 | 2 | 3 | `02 00 … 00`、`03 00 … 00` |
| 2 | 4 | 5 | `04 00 … 00`、`05 00 … 00` |

计数按小端序落在 nonce 的低位——小端序即「低位字节在前」，与网络字节序的大端排法相反。这是 Shadowsocks 规范自己的规定（计数按小端整数递增）；GCM 自身的内部块计数器反而走大端。两种排法并存的原因只是各自跟着出处：块里的长度字段沿用第 4 章的大端，nonce 计数跟 Shadowsocks 规范走小端。这个「位置即编号」的设计还白送一件防御：读端按位置数计数，中间人把第 2 块整块搬到第 1 块前面，拆封时计数对不上位置，火漆必败——换序拒收（6.4 有用例钉死它）。

跟着算一遍真实字节。密码 `course-password`、盐取定值，派生钥匙；把目标 `127.0.0.1:4569` 的 CONNECT 帧（`01 7f 00 00 01 11 d9`，7 字节）封成第 0 块。

```text
明文 CONNECT 帧（7 字节）:      01 7f 00 00 01 11 d9
封成第 0 块（共 41 字节）:
  [0..17]  加密长度 + 长度火漆:  60 21 65 70 c0 31 e4 5f a3 5b c5 c9 98 40 23 30 03 b2
  [18..24] 加密载荷:             a2 2e 08 b9 30 6c 19
  [25..40] 载荷火漆:             c6 f3 c3 99 67 cb 63 17 0e ba b3 e0 24 7c cb c1
```

算尺核对：2 + 16 + 7 + 16 = 41，一格不多。持钥者拆开长度段读到的是 `00 07`（大端 7）——而中间人面前这 18 个字节是噪声，他连「下一块从哪开始」都数不出来。

### 6.3.4 与 Shadowsocks 公开规范对表

本章的实现是对 Shadowsocks AEAD 规范（shadowsocks.org 公开文档）的教学简化——概念逐项对表，差异如实登记（附录差异清单汇总）。

| 对照项 | Shadowsocks AEAD 规范 | 本课实现 | 关系 |
| --- | --- | --- | --- |
| 盐长度（aes-256-gcm） | 32 字节 | 32 字节 | 一致 |
| 块上限与长度字段 | 2 字节大端，≤ 0x3FFF | 同左 | 一致 |
| nonce | 12 字节小端计数，每 AEAD 操作 +1 | 同左 | 一致 |
| 首块载荷 | 目标地址（SOCKS5 地址格式），加密 | 第 4 章 CONNECT 帧，加密 | 思想一致，帧编码自造 |
| 子密钥派生 | 先 EVP_BytesToKey(MD5) 得主密钥，再 HKDF-SHA1 派子密钥，info 串 `ss-subkey` | HKDF-SHA256 从密码加盐一步派生，info 串自定 | 教学简化 |
| 连接失败反馈 | 无回执，接不通直接断线 | 保留第 4 章 1 字节回执，装进反向首块 | 保留教学协议 |
| 算法族 | 另有 chacha20-poly1305 等，含 UDP | 只 aes-256-gcm，只 TCP | 教学简化 |

两个「思想一致」值得多说一句。首块载荷装目标地址——规范与本课都把「去哪儿」放进密文，这正是第 5 章算过的账：HTTPS 那把锁管不着 CONNECT 帧里的域名，第二跳这把锁连「去哪儿」一起保护。回执那条差异则是教学取舍：规范的「沉默断线」更省一个往返，本课留回执让失败路径看得见（第 4 章的坏帧用例还指着它）。

## 6.4 演练：把锁装上两跳

实验场开工。`src/crypto.ts` 是本章主件，测试 `tests/aead-tunnel.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，9 条用例。门槛命令照旧是 `cd companion && npm run typecheck && npm test`，全绿应为 30 条（旧 21 + 本章 9）——旧用例一字未动还全绿，就是「加锁不改明面行为」的机械证据。

### 6.4.1 一次 AEAD 的最小封装

从最底下的两块积木起手：nonce 生成，与一次「封 / 拆」。

```ts
// src/crypto.ts · chunkNonce / aesSeal / aesOpen
// 第 opCounter 次 AEAD 操作的 nonce：12 字节，计数按小端落在低位（高位恒 0，块数远用不满 96 位）
function chunkNonce(opCounter: number): Buffer {
  const n = Buffer.alloc(NONCE_LEN)
  n.writeUInt32LE(opCounter, 0)
  return n
}

// 封：明文进，密文 + 火漆出（火漆殿后随行）
function aesSeal(key: Buffer, opCounter: number, plain: Buffer): Buffer {
  const c = createCipheriv('aes-256-gcm', key, chunkNonce(opCounter))
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()])
}

// 拆：先递上随行的火漆，final 验漆——漆对不上就抛错，整段作废
function aesOpen(key: Buffer, opCounter: number, wire: Buffer): Buffer {
  if (wire.length < TAG_LEN) throw new Error('密文段太短：连火漆都不齐')
  const d = createDecipheriv('aes-256-gcm', key, chunkNonce(opCounter))
  d.setAuthTag(wire.subarray(wire.length - TAG_LEN))
  return Buffer.concat([d.update(wire.subarray(0, wire.length - TAG_LEN)), d.final()])
}
```

与第 5 章 `aead.mjs` 的四条火漆语义逐条对得上：`getAuthTag()` 在 `final()` 之后、火漆明文随行、先 `setAuthTag` 再拆、抛错即拒收。唯一的增长点是 nonce 不再现场随机，而是从计数算出来——6.3.1 选的路二。第 5 章讲认证加密（AEAD）时买下的三样，从这两个函数开始逐块兑现。

### 6.4.2 块编解码：sealChunk 与 openChunk

```ts
// src/crypto.ts · sealChunk / openChunk
// 封第 index 块（从 0 数）：长度段、载荷段各一次 AEAD，计数各占一位——nonce 与位置就此绑定
export function sealChunk(key: Buffer, index: number, payload: Buffer): Buffer {
  if (payload.length === 0 || payload.length > CHUNK_MAX) throw new Error(`块长越界：${payload.length}（合法范围 1..${CHUNK_MAX}）`)
  const len = Buffer.alloc(2)
  len.writeUInt16BE(payload.length, 0)
  return Buffer.concat([aesSeal(key, 2 * index, len), aesSeal(key, 2 * index + 1, payload)])
}

// 开第 index 块：wire = [加密长度 2+16][加密载荷 len+16]。长度段先拆——边界自己也是密文，中间人数不出块来
export function openChunk(key: Buffer, index: number, wire: Buffer): Buffer {
  const len = aesOpen(key, 2 * index, wire.subarray(0, 2 + TAG_LEN)).readUInt16BE(0)
  if (len === 0 || len > CHUNK_MAX) throw new Error(`块长越界：${len}（合法范围 1..${CHUNK_MAX}）`)
  if (wire.length !== 2 + TAG_LEN + len + TAG_LEN) throw new Error('块长对不上：多一字节少一字节都不认')
  return aesOpen(key, 2 * index + 1, wire.subarray(2 + TAG_LEN))
}
```

两个读点。`sealChunk` 把 6.3.3 的表逐格翻译成代码：长度先封（计数 `2 × index`）、载荷再封（计数 `2 × index + 1`），两段火漆各自殿后。`openChunk` 的严格相等检查（`wire.length !== …`）是教学版有意为之的较真：多一个字节少一个字节都不认，与第 4 章「零长与超限都不认」同一脾气——坏消息一律尽早暴露，绝不带病运转。

流式拆封器把 openChunk 接成「喂字节、出明文」的形状——第 4 章 `createFrameReader` 的累积缓冲手艺，原样平移。

```ts
// src/crypto.ts · createChunkOpener
// 字节喂进来，凑齐一块拆一块。块号每拆完一块进一——拆封计数与封缄计数隔着网络各数各的，全靠位置对齐
function createChunkOpener(key: Buffer): { push(chunk: Buffer): Buffer[] } {
  let buffered = Buffer.alloc(0)
  let index = 0 // 已拆到第几块：下一块的 nonce 计数就从这里起
  return {
    push(chunk: Buffer): Buffer[] {
      buffered = Buffer.concat([buffered, chunk])
      const out: Buffer[] = []
      for (;;) {
        if (buffered.length < 2 + TAG_LEN) return out // 加密长度段还没到齐
        const len = aesOpen(key, 2 * index, buffered.subarray(0, 2 + TAG_LEN)).readUInt16BE(0) // 长度段也是密文
        if (len === 0 || len > CHUNK_MAX) throw new Error(`块长越界：${len}（合法范围 1..${CHUNK_MAX}）`)
        const total = 2 + TAG_LEN + len + TAG_LEN
        if (buffered.length < total) return out // 载荷还没到齐
        out.push(aesOpen(key, 2 * index + 1, buffered.subarray(2 + TAG_LEN, 2 + TAG_LEN + len + TAG_LEN))) // 载荷段连火漆一起切
        buffered = buffered.subarray(total)
        index += 1
      }
    },
  }
}
```

注意它拆的每一段密文都可能抛错——抛错就是拒收，调用方拿到异常只做一件事：收线。

### 6.4.3 aeadPipe：盐 + 密文块的整根管道

发送侧要管盐（首写时现摇、先发），接收侧要先攒盐再拆块。两个小件各管一头。

```ts
// src/crypto.ts · createChunkSealer / createSaltReader
// 封缄侧：首次封块时现摇盐、先发盐，此后逐块计数进位；超上限的明文先切开再封
function createChunkSealer(write: (b: Buffer) => void, password: string) {
  let key: Buffer | null = null // 惰性：写第一笔数据之前，盐与钥匙都还不存在
  let index = 0
  return {
    seal(plaintext: Buffer) {
      if (key === null) {
        const salt = randomBytes(SALT_LEN) // 「每连接新盐」的落点：摇盐在首写，不在建连——不写数据的方向不发盐
        write(salt)
        key = deriveSubkey(password, salt)
      }
      for (let i = 0; i < plaintext.length; i += CHUNK_MAX) write(sealChunk(key, index++, plaintext.subarray(i, i + CHUNK_MAX)))
    },
  }
}

// 拆封侧：先攒够盐、派生同一把子密钥，再交给块拆封器
function createSaltReader(password: string, onPlain: (b: Buffer) => void) {
  let opener: ReturnType<typeof createChunkOpener> | null = null
  let saltBuf = Buffer.alloc(0)
  return {
    push(chunk: Buffer) {
      let rest = chunk
      if (opener === null) {
        saltBuf = Buffer.concat([saltBuf, chunk])
        if (saltBuf.length < SALT_LEN) return // 盐还没攒齐
        opener = createChunkOpener(deriveSubkey(password, saltBuf.subarray(0, SALT_LEN)))
        rest = saltBuf.subarray(SALT_LEN) // 盐后可能粘着首块
      }
      for (const plain of opener.push(rest)) onPlain(plain)
    },
  }
}
```

`createChunkSealer` 的惰性有一层用意：盐在首写时才摇，哪个方向一句数据没写，哪个方向就不发盐——半开连接不产生密钥材料。`createSaltReader` 与第 3、4 章的「提前到的字节不丢」同一件手艺：盐后粘着首块，切下来一并喂。

管道本体把这两侧拼成一根双工管。

```ts
// src/crypto.ts · aeadPipe
// 加密管道：外侧读写明文字节（第 4 章的整套帧协议原样骑在上面），内侧（socket）跑「盐 + 密文块」。
// 两个方向各自独立：各摇各的盐、各数各的块——发盐的是发送方，拆盐的是接收方
export function aeadPipe(socket: net.Socket, password: string): Duplex {
  const sealer = createChunkSealer((b) => socket.write(b), password)
  const outer = new Duplex({
    read(_size) {
      // 数据是被推着来的（push），读侧不必主动拉——但这个钩子必须存在，缺了流一开工就报错
    },
    write(chunk, _enc, cb) {
      sealer.seal(chunk as Buffer) // 明文进 → 盐（仅首次）+ 密文块 → 内侧
      cb()
    },
  })
  const receiver = createSaltReader(password, (plain) => outer.push(plain))
  socket.on('data', (b) => {
    try {
      receiver.push(b)
    } catch (e) {
      outer.destroy(e as Error) // 验漆失败：管道整体收摊——拒收即断开，不给坏块任何落脚处
    }
  })
  socket.on('close', () => outer.destroy()) // 内侧收线：外侧跟着收
  socket.on('error', (e) => outer.destroy(e))
  outer.on('close', () => socket.destroy()) // 外侧收线：内侧跟着收
  return outer
}
```

结构与第 4 章 `attachFrameStream` 一模一样——外侧装普通管道、内侧骑在裸 socket 上说密文方言、收线成对——只是「翻译」的内容从装帧拆帧换成了封缄拆封。验漆失败的那行 `outer.destroy(e as Error)` 就是「拒收即断开」的全部实现。

### 6.4.4 接线：relay 加一个可选参数

第 4 章留的接缝在此兑现。`aeadPipe` 交回的是一根 Duplex，第 4 章的帧世界原样骑上去：入口与远端的两端各加一个可选 `password`，给了就先套管道，不给就走老路。

```ts
// src/relay.ts · connectViaRelay 开头（第 6 章的增量）
// 给了 password，第一跳整段先套上加密管道：CONNECT 帧起一切明文都被逐块封缄——「去哪儿」也上锁
export async function connectViaRelay(relayAddr: ProxyTarget, target: ProxyTarget, password?: string): Promise<Duplex> {
  const raw = await connectTo(relayAddr) // 第一跳：先把线接到远端
  const relay: Duplex = password === undefined ? raw : aeadPipe(raw, password)
  relay.write(encodeConnectFrame(target)) // 目标装进 CONNECT 帧，请远端代连
```

```ts
// src/relay.ts · startRelayServer 的连接包装（第 6 章的增量）
      // 有密码：这条连接整段先套上加密管道，帧世界照旧骑在上面；没收线记录的仍是裸 socket
      handleRelayClient(opts.password === undefined ? client : aeadPipe(client, opts.password))
```

三件事值得点名。其一，封的是「整段明文流」——CONNECT 帧是第 0 块的载荷、回执是反向第 0 块的载荷、数据帧各居其后，第 5 章自查题那个「只封数据帧」的假想方案本章直接不做。其二，`handleRelayClient` 与 `attachFrameStream` 的参数从 `net.Socket` 加宽为 `Duplex`（都是能读能写的管子），函数体一字未改——锁在管道里面，帧的世界不知道锁的存在。其三，`src/socks5.ts` 一个字符没动：入口的 `onConnect` 钩子交回流，流的内胆换了而已。

```ts
// tests/aead-tunnel.test.ts · 端到端用例的接线
    const entry = await startSocks5Server({
      port: 0,
      onConnect: (t) => connectViaRelay({ host: '127.0.0.1', port: relay.port }, t, PASSWORD),
    })
```

### 6.4.5 破坏用例：拒收断开的两张处方

九条用例里最承重的是两条破坏用例——都是「先猜后跑」的靶子，写断言之前先预言行为。

改一个密文字节的版本走真实链路。测试手拼线上字节直连远端：先发盐加第 0 块（CONNECT 帧），读回远端方向的盐与封着的回执块、拆开验证是 `00`——先证明链路本来就是通的；然后翻一个字节再放行。

```ts
// tests/aead-tunnel.test.ts · 篡改用例的第二幕
    // 第二步：中间人翻密文体一个字节，发了下去
    const broken = Buffer.from(sealChunk(key, 1, frame('tampered\n')))
    broken[2 + TAG_LEN + 3] ^= 0xff
    raw.write(broken)
    await waitClose(raw) // 先猜后跑的靶子：远端拆到坏块即收线，连接不会活下去
```

换序的版本在单元层钉死数学，在链路层重演攻击。

```ts
// tests/aead-tunnel.test.ts · 换序用例的单元断言
    // 线上把两块对调：读的人按位置数 nonce，第 0 位的计数遇上第 1 位封的块
    expect(() => openChunk(key, 0, sealedSecond)).toThrow() // nonce 对不上 → 火漆必败
    expect(() => openChunk(key, 1, sealedFirst)).toThrow() // 反方向对调同理
    expect(openChunk(key, 0, sealedFirst).equals(frame('first-block\n'))).toBe(true) // 对照：各归各位就通
```

第三张处方是中间人探针：一个透明转发的 TCP 中转，把「入口 → 远端」方向的字节全部抄录下来。密文链路与第 4 章明文链路各走一遍同样的请求，探针的抄录各查两样东西——明文载荷、CONNECT 帧里的目标。

```ts
// tests/aead-tunnel.test.ts · 探针对照的断言
    const connectBytes = connectFrameIPv4('127.0.0.1', target.port)
    const plainSeen = plainTap.seen()
    expect(plainSeen.includes(Buffer.from('secret-marker'))).toBe(true) // 明文：载荷裸奔
    expect(plainSeen.includes(connectBytes)).toBe(true) // 明文：目标域名端口裸奔
    const cipherSeen = cipherTap.seen()
    expect(cipherSeen.includes(Buffer.from('secret-marker'))).toBe(false) // 密文：载荷抓不到
    expect(cipherSeen.includes(connectBytes)).toBe(false) // 密文：目标也抓不到——「去哪儿」一并上锁
```

同一个探针、同一笔请求，两张网上的收获天差地别——「上锁了没有」从口号变成可复现的实验。教学简化声明（登记差异清单附录，与 6.3.4 的对表同账）：无长度填充，流量分析不防；每方向的盐与密文块之外无握手、无版本协商；密码直接以参数传递，未做口令拉伸。

## 6.5 验证：亲手开机，站到中间人的位置

**开机。** 进 `companion/` 跑 `npm run demo:aead-tunnel`。这个 demo 一次拉起六个角色：目标站、明文中继（对照用）、密文中继、中间人探针、SOCKS5 入口，外加 demo 自己扮演的浏览器——照旧全住回环地址，不出机器。它替你走完三幕，应看到（端口每次随机，目标地址的十六进制也随端口变）。

```text
# companion 的 demo:aead-tunnel 输出节录
—— 第一幕：一笔正常请求穿过中间人 ——
应用视角: 写入 'secret-payload'，收到回声 'SECRET-PAYLOAD' —— 链路可用
中间人视角: 共抄到 124 字节
  开头 32 字节（盐）:            4f6b25073dcee1551d905192bb993f5a……（每次运行都不同）
  在抄录里找明文载荷 'secret-payload' → 找不到
  在抄录里找目标地址 017f0000011902 → 找不到

—— 第二幕：对照——同样的请求走第 4 章明文链路 ——
  开头即是明文 CONNECT 帧:       017f0000011902（目标一目了然）
  在抄录里找明文载荷 'secret-payload' → 找得到（裸奔）

—— 第三幕：翻一个密文字节，看远端什么反应 ——
中间人翻了一个字节放行 → 远端验漆失败，连接立刻被收线，坏块一个字节也没进目标
```

第一幕与第二幕是同一笔请求、同一种探针的对照（同一套抄录程序各立在一条链路前）：明文链路上 CONNECT 帧与载荷原样可读，密文链路上 124 个字节里两样都搜不到。第三幕伴随一行 `[relay] 入口连接出错：Unsupported state or unable to authenticate data` 的错误日志——按第 2 章立的规矩，单连接出错记一行、进程不倒，这正是拆封抛错走到收线的现场。顺手跑 `npm test`，30 条全绿。

**先猜后跑（指认破坏）。** 打开 `src/crypto.ts`，把 `chunkNonce` 里那行 `n.writeUInt32LE(opCounter, 0)` 改成 `n.writeUInt32LE(0, 0)`——计数不数了，每次 AEAD 都用全零 nonce。跑之前写下预言：9 条本章用例哪几条会红？跑 `npm test` 验证。预期变红的恰好是两条换序用例：计数与位置的绑定一断，调了包的块也验漆通过，远端不再断线，`waitClose` 与 `toThrow` 双双落空。对照之下，两条篡改用例照常绿——发现位翻转是火漆的职责，计数器的职责只有位置绑定，两件事在这一改之下分道扬镳，这正是 6.3.3 那句「换序拒收」的机械注脚。改回原样，30 条应全绿。

**自包含复算。** 6.2 的 `reuse-gcm.mjs` 与 6.3.2 的派生对照，拿 node 一个文件就能跑——不进实验场也可亲手复算；实验场里的版本见 `tests/aead-tunnel.test.ts` 首组的派生用例（同密码同盐同钥、异盐异钥）。

## 6.6 收束：第二跳上锁了

回到开篇那场省事的灾难。两段只差四个字母的明文、全场一个的 nonce，异或图把 `03 04 1e 1f` 挂在线上——现在你能亲口讲清本章的设计如何让它发生不了：块内计数让同一把钥匙之下每个计数只用一次；每连接新盐让每条连接的钥匙都不同，计数器归零也不撞车；长度进了密文，中间人连接下来的块边界都数不出。三件套各挡一道，异或图需要的原料——同一把钥匙加同一个 nonce——一个都凑不齐。

你手里多了第四块零件：`src/crypto.ts` 的 `deriveSubkey`（盐 + HKDF 子密钥）、`sealChunk` / `openChunk`（长度前缀 AEAD 块）、`aeadPipe`（整根加密管道），加上 `relay` 两端的可选 `password`。可迁移的解法多两件：「位置即编号」的计数 nonce 设计（免传输、自带换序防御），与「新盐换新钥」的会话密钥套路（长期秘密不长期用）。第 4 章的账就此全清：明文帧换密文帧、与 Shadowsocks 对表、盐 + HKDF 派生、逐帧封缄——四件事都有了着落。威胁模型那一半也该复述一遍：这把锁防的是线路上的旁观者与中间人，远端进程照样看得见明文——它必须拆封才能代连，这把锁从来没打算防它。

概念去向地图：

- 第二跳有了锁，但入口现在对每个目标都走加密两跳——谁该直连、谁该走隧道，第 7 章规则引擎在 `onConnect` 钩子上接手；
- 密码目前写在调用参数里——第 10 章的声明式配置接管端口、密码与规则。

### 自查

1. 预测：把两端 `SUBKEY_INFO` 同时改成空串 `''`，链路还能通吗？只改入口一端、远端仍用 `'mini-clash/aead'` 呢？
2. 计算：载荷 `'GET /a\n'`（7 字节）装进第 3 块，两次 AEAD 的计数各是多少？这一块在线上占几个字节？
3. 判断：中间人在密文链路上仍能数出「每条连接开头 32 字节之后，先来一个 41 字节左右的块」这类长度规律。这属于三个目标里的哪一个失守？本课防不防？真实工程的缓解手段叫什么方向？

::: details 参考答案与锚点
1. 两端一致照常通——info 串不是口令，是派生配料，两侧写同一串就配出同一把钥匙；只改一端则两把钥匙不同，对端验漆全败、连接立刻断线（回查 6.3.2 的派生与 6.4.5 的拒收断开）。
2. 计数 6（长度）与 7（载荷）——第 3 块从 `2 × 3` 起；线上占 2 + 16 + 7 + 16 = 41 字节（回查 6.3.3 的计数表与算尺）。
3. 三个目标都没失守——长度规律既没泄露内容（机密性完好）、也没放行改动（完整性完好）；这是流量分析，在 6.3.3 与 6.4.5 声明的「不防」清单里；缓解手段是长度填充（padding），本课不做，登记差异清单。
:::
