---
title: DNS 与 fake-ip：先把名字这一关接管
---

# DNS 与 fake-ip：先把名字这一关接管

## 8.1 前情：IP 行失明的病根在名字上

先从第 7 章留下的那个缺口问起——它一问套出三笔账：

- 规则引擎立了「有域名先不做 DNS 解析」的规矩——可浏览器默认会先自己查电话簿、再拿查到的 IP 来连接。入口收到的 CONNECT 里只有一串数字，三种域名行全体失明。名字怎么才能活着到达入口？
- DNS（Domain Name System，域名系统）——把域名翻译成 IP 的电话簿系统，应用连网前通常先查它。这一查在你机器外面走了哪些路、路上能出什么事，我们还一笔未算。
- 第 7 章末尾留的账正在这：解析这一关被动手脚的账，本章算清。

这一章把「名字→IP」这一关整个搬进本地接管：自己开一台假电话簿，自己记账，连接到达时按账还原。

## 8.2 开章：假门牌连不上

你大概见过这样的现象。直连访问一个站点，浏览器转了很久，最后报「连接超时」——查一下会发现 DNS 给的答案本身就有问题：查询发出去，半路有人抢答，塞回一个假 IP。这一招的通称是 DNS 污染——查询在途中被截胡，答案在到达真电话簿之前就被掉了包。浏览器不知道，拿着假门牌老老实实去连，门牌后面没有主人，永远连不上。

Clash 在这里做了件出人意料的事：它干脆不真查。本机的 DNS 查询由它应答，答案是一个编出来的假 IP——从保留网段里现取一个号，把真域名记在小本本上。浏览器拿到假 IP 来连接时，入口翻账本换回真域名，送去规则引擎判决。这一招叫 fake-ip——先发假号应付客户端、账上记真名、连接时还原。

听起来像污染的手法？同一个「发假答案」，方向反了：污染用它把你引去错的门牌，fake-ip 用它把名字留在你手里。本章把这台假电话簿写出来，也把「为什么这样是安全的」讲清。

## 8.3 原理：查询、截胡与泄露

### 8.3.1 DNS 查询：一封明文信

先把地基铺平。A 记录——DNS 电话簿里「域名→IPv4 地址」的那一行；查询 www.example.com 的 A 记录，就是在问「这个名字的 IPv4 门牌是多少」。你的机器通常只问一台递归解析器（运营商配的，或某个公共 DNS 服务），它替你从根一路问到掌管这个域名的权威服务器——你托它跑腿，它层层问路。递归与迭代的分别到此一句带过，够用了。

不进实验场也能亲眼看一次这一查。

```js
// 用法示例：存成 dns-peek.mjs，node dns-peek.mjs —— 亲眼看一次「名字→号码」
import dns from 'node:dns'
const r = await dns.lookup('localhost')
console.log(r) // { address: '127.0.0.1', family: 4 }——名字进，号码出
// 把 'localhost' 换成任何真实域名，就是同一次查询（localhost 由本机账本应答，不出机器）。
// 注：lookup 走系统解析器（含本机 hosts 文件），要裸看 DNS 报文往返用 dns.resolve 一族
```

名字进、号码出，看起来像翻一页通讯录。但这次查询在网络上是一封报文，形状由 RFC 1035 规定，全世界的 DNS 都说这一种字节。

```text
偏移   0        2        4         6        8        10
      ┌────────┬────────┬─────────┬────────┬────────┬────────┐
      │   ID   │ FLAGS  │ QDCOUNT │ANCOUNT │ NSCOUNT│ ARCOUNT│   头：定长 12 字节
      └────────┴────────┴─────────┴────────┴────────┴────────┘
偏移 12 起，问题区（QDCOUNT 个）：
      ┌────────────────────────────────┬───────┬────────┐
      │ QNAME（1 字节长度 + 名字字节…以 0 收尾）│ QTYPE  │ QCLASS │
      └────────────────────────────────┴───────┴────────┘
应答在问题区后面再跟答案区（ANCOUNT 个）：
      ┌────────┬──────┬───────┬─────┬──────────┬────────┐
      │  NAME  │ TYPE │ CLASS │ TTL │ RDLENGTH │ RDATA  │
      └────────┴──────┴───────┴─────┴──────────┴────────┘
```

FLAGS 那 16 位里本章用到五个：QR（这是查询还是应答）、RD（客户端请求「替我问到底」）、RA（服务器宣称「我可以递归」）、AA（宣称「这答案出自权威」）、RCODE（错误码，0 = 一切正常）。记住这五个词，8.4 的应答器全靠它们撑门面。

### 8.3.2 「只是查表」的证伪

你可能带着这样一个直觉：DNS 只是把名字换成号码的查表——翻开、找到、抄下，跟顺序、路径、信任都没关系。这个直觉有来路：绝大多数时候它表现得确实又快又稳。但「查表」是幻觉，这一查是**一封明文信在网络上跑一趟**，三个环节各自能出事。

- 查谁：问题本身就是明文。你要访问哪个域名，查询链路上的每个中转都看得见——哪怕后续连接全走加密隧道，去哪这件事也先一步说出去了。这叫 DNS 泄露——查询本身暴露了你要去哪。
- 走哪条线：查询从你的机器出发，经递归解析器层层转交，才到权威服务器。路上任何一环都能抢先塞回一个假答案。截胡就发生在这一环——污染者碰不到真电话簿，它在查询还在路上时抢答。
- 答案可不可信：DNS 的答案不带签名，客户端先到先得，谁先答谁说了算。（后来有 DNSSEC 给答案补签的扩展，部署并不普遍——本课按普通 DNS 算账。）

证伪不需要复杂的实验——本章的实验场本身就是证据。8.4 写的假电话簿总共几十行：它没问过任何真服务器，答案全是编的，可任何 DNS 客户端都深信不疑（8.5 你会亲眼看到）。如果 DNS 真是一次查表，假表不可能骗到人；能骗到，恰恰因为它信的是「先到的明文应答」。

### 8.3.3 fake-ip：把名字这一关搬进前台

现在可以完整讲 fake-ip 了。锚点用第 1 章那家前台：你要找的人没登记分机，前台先发你一个假分机号应付着，把你要找谁记在登记表上；等你拨这个假号，前台按登记表换回真名字转接。fake-ip 模式——DNS 查询不真去查，当场发一个保留网段里的假 IP，把真名字记账；连接到达入口时按账还原成域名。

为什么值得这么绕？三笔收益，第一笔直接还第 7 章的账：

- 名字活着到达入口。浏览器自己查 DNS 的默认流程，会把域名提前折算成 IP，入口只见数字。接管 DNS 之后，浏览器拿到的永远是假门牌，真名字在账上；连接进到正向代理入口的 `onConnect` 钩子时一翻账，判决手里永远握着域名——三种域名行不再失明。
- 查询不出门。假应答在本地发生；真解析推迟到出站点做（教学实验里就是隧道另一头的远端中继）。明文查询不再跑向默认链路，泄露那一环被整个绕开。
- 免掉「先解析再连」的竞态。先在本机解析、拿着结果去连，有个隐藏前提：解析结果在连接时还有效。可解析结果有保质期——TTL（Time To Live，答案允许被缓存的秒数），会过期；负载均衡会轮换地址；不同出口看到的门牌也可能不同。fake-ip 把解析推迟到出口当下——判决与连接用的都是同一个名字，不存在折旧。

代价也有两笔，都要记在明处。其一是映射的生命周期：账本不是无限的，池满了要让位（8.4.1 见 FIFO 的取舍），应答的 TTL 也得压短——假答案不配被久缓存，缓存一旦比账本活得久，还原就对不上号。其二是兜不住直连应用：一个不经过入口的程序拿到假门牌，没人替它还原，连接永远找不到主人——假门牌连不上这件事，在 fake-ip 模式下从「攻击的后果」变成了「接管的前提」。系统级的根治法是 TUN 虚拟网卡，第 9 章展开。

### 8.3.4 为什么是 198.18.0.0/15

假门牌从哪个网段里取，不是随手挑的。取 127.0.0.1 这类回环段，系统会特殊处理，包根本不出协议栈；取 203.0.113.0/24 这类文档示例段，那是留给教程里写例子用的，撞上的概率不小。fake-ip 要的是一段「几乎不可能有真实主机」的地址。

业界通用答案是 198.18.0.0/15。出处是 RFC 2544《网络互联设备的基准测试方法》：它向 IANA 申请了 198.18.0.0 ～ 198.19.255.255 共 131,072 个地址，专用于设备性能测试。这段地址列入 IANA 的特殊用途地址登记（现行汇总见 RFC 6890），不会分配给任何真实主机。假门牌从这段里取，永不撞真门牌；入口只要认这个网段，就知道该翻账本。真实 Clash 默认的 fake-ip 网段 198.18.0.1/16 也在这条 /15 里，可配置。

## 8.4 演练：假电话簿与还原接线

实验场开工。`src/fakeip.ts` 是本章主件：上半是取号池，下半是 DNS 应答器。测试 `tests/fake-ip.test.ts` 照旧先写、先跑出红（模块不存在，加载即失败），再写实现转绿，9 条用例；门槛命令照旧 `cd companion && npm run typecheck && npm test`，全绿 50 条（旧 41 + 本章 9）——旧用例一字未动还全绿，就是「假电话簿不碰既有链路」的机械证据。

### 8.4.1 FakeIpPool：取号、登记、还原、让位

账本先立。名字和假门牌双向登记：`allocate` 取号（在册的名字直接回旧号），`restore` 还原（号换回名字）。

```ts
// src/fakeip.ts · FAKE_IP_CIDR / FakeIpPool / ipAt
// RFC 2544 划给网络设备基准测试的保留网段：IANA 不会把它分给真实主机——假门牌永不撞真门牌
export const FAKE_IP_CIDR = '198.18.0.0/15'

// —— 取号池 ——

export interface FakeIpPoolOptions {
  capacity?: number // 在册映射的上限；默认 131071 = 198.18.0.1 ～ 198.19.255.255（/15 全段，越过 .0 起点）
}

// 名字 ↔ 假门牌的双向账本。同名同号（问几遍答案一致）；池满让位用 FIFO——最老的映射交出号码。
// 让位若选 LRU（最久没用的先让），「还在用的映射不被拆」更贴切，但每次查询都要记账；
// 教学版取简单，取舍登记差异清单
export class FakeIpPool {
  private readonly capacity: number
  private nextIndex = 0 // 下一张新号的偏移（相对 198.18.0.1）
  private readonly domainOf = new Map<string, string>() // 名字 → 假门牌（取号走这张）
  private readonly ipOf = new Map<string, string>() // 假门牌 → 名字（还原走这张）
  private readonly order: string[] = [] // 在册名字的到达顺序：FIFO 让位的队

  constructor(opts: FakeIpPoolOptions = {}) {
    this.capacity = opts.capacity ?? 131071
    if (this.capacity < 1) throw new Error('池容量至少得是 1')
  }

  // 名字来取号：在册的直接回旧号；池满则队首让位，腾出的号给新名字
  allocate(domain: string): string {
    const key = domain.toLowerCase() // 域名大小写不敏感，与规则引擎同一纪律
    const known = this.domainOf.get(key)
    if (known !== undefined) return known
    let ip: string
    if (this.domainOf.size >= this.capacity) {
      const evicted = this.order.shift()
      if (evicted === undefined) throw new Error('池容量至少得是 1') // capacity ≥ 1 时不可能走到这
      ip = this.domainOf.get(evicted) as string // 队首的号腾出来——旧号易主，旧映射就此消失
      this.domainOf.delete(evicted)
      this.ipOf.delete(ip)
    } else {
      ip = ipAt(this.nextIndex++)
    }
    this.domainOf.set(key, ip)
    this.ipOf.set(ip, key)
    this.order.push(key)
    return ip
  }

  // 假门牌还原回名字：不是本池在册的号（含已让位的旧号）→ null，调用方按普通目标处理
  restore(ip: string): string | null {
    return this.ipOf.get(ip) ?? null
  }

  get size(): number {
    return this.domainOf.size // 在册映射数——demo 打印池况用
  }
}

// 198.18.0.1 起的第 i 个号：0xC6120000 正是 198.18.0.0，+1 越过「.0」这个像网络号的起点
function ipAt(i: number): string {
  const n = (0xc6120000 + i + 1) >>> 0
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}
```

**同名同号**是账本的第一纪律：浏览器问两遍同一个名字，答案必须一致，客户端缓存才不会乱。池满是第二纪律：131,071 个号对教学绰绰有余，但账本语义总得定义满那一刻——FIFO 让最老的映射交出号码，旧号易主。LRU（最久没用的先让）更贴「还在用的别拆」，代价是每次查询都要记账；教学版取简单，取舍登记差异清单。注意让位的后果：被让位的名字若回访，会拿到别的号——映射的生命周期就这么短，8.3.3 的第一笔代价在此落了地。

### 8.4.2 读一份真实的 DNS 报文

写应答器之前，先照着 RFC 1035 跟读一份真实报文。下面两行是实验场实测的字节：查询 `localhost` 的 A 记录，以及假电话簿的应答（0x1234 是测试选的 ID）。

```text
# companion 实测字节：startFakeDns 一问一答的原始报文（测试与 demo 同款往返）
查询（27 字节）
12 34                       ID：这一问的编号，应答原样带回（客户端靠它对号）
01 00                       FLAGS：0000 0001 0000 0000——RD=1「请替我问到底」，QR=0（这是查询）
00 01 00 00 00 00 00 00     问题 1 个；答案/权威/附加区都还没有
09 6c 6f 63 61 6c 68 6f 73 74 00   QNAME：长度 9 +「localhost」+ 00 收尾（名字就这样一段段拼）
00 01 00 01                 QTYPE=1（A）、QCLASS=1（IN）

应答（43 字节）
12 34                       同一个 ID
85 80                       FLAGS：1000 0101 1000 0000——QR=1（应答）AA=1 RD=1（抄回）RA=1
00 01 00 01 00 00 00 00     问题 1 个（原样抄回）、答案 1 个
09 6c 6f 63 61 6c 68 6f 73 74 00 00 01 00 01   问题区 15 字节，与查询一字不差
c0 0c                       答案 NAME：压缩指针——最高两 bits 是 11，余下 0x00C=12，指回偏移 12 的问题名
00 01 00 01                 TYPE=A、CLASS=IN
00 00 00 01                 TTL=1：这份答案只许缓存一秒
00 04                       RDLENGTH=4：后面 4 字节是地址
c6 12 00 01                 RDATA：198.18.0.1——假门牌
```

三个读点。ID 与问题区原样抄回，客户端才认得出这是自己那一问的答案。FLAGS 里 AA/RA 两位是应答器的戏服：假电话簿既不权威也不递归，但客户端期待一台正经解析器的样子，穿上戏服它才照单全收（差异登记附录）。答案的 NAME 不重写名字，用压缩指针指回问题区——RFC 1035 的 4.1.4 节定义的省字节技巧，教学版只用这一处指针。

### 8.4.3 parseQuery 与 answerQuery：逐字段拆装

拆装用的固定编号先立起来——每个都是 8.4.2 跟读里出现过的格子。

```ts
// src/fakeip.ts · 报文小件（裁判是 RFC 1035）
const QTYPE_A = 0x0001 // 问题类型：A = 「这个名的 IPv4 地址是多少」
const CLASS_IN = 0x0001 // 类别：IN（互联网）——教科书世界只有这一类
const FLAGS_QR = 0x8000 // QR 位：1 = 这是应答，0 = 这是查询
const FLAGS_AA = 0x0400 // AA 位：宣称「权威答案」——我们并不真权威，戏服而已（差异登记附录）
const FLAGS_RD = 0x0100 // RD 位：查询里的「请递归」——应答原样抄回
const FLAGS_RA = 0x0080 // RA 位：宣称「可递归」——我们其实压根不递归，fake-ip 不真查（差异登记附录）
const PTR_MASK = 0xc000 // 压缩指针：最高两 bits 为 11，余下 14 bits 是「指回消息开头数起的偏移」

// 解析一份查询。三样结局：太短（残缺）/ 解不开（不是教学版认的形状）/ 拿到问题
type ParsedQuery =
  | { kind: 'short' }
  | { kind: 'bad'; why: string }
  | { kind: 'ask'; id: number; rd: boolean; name: string; qtype: number; questionEnd: number }
```

拆查询的函数，返回三样结局：太短（残缺，不回话）、解不开（记日志丢弃）、拿到问题。

```ts
// src/fakeip.ts · parseQuery
function parseQuery(buf: Buffer): ParsedQuery {
  if (buf.length < 12) return { kind: 'short' } // 头都不齐
  const flags = buf.readUInt16BE(2)
  if (flags & FLAGS_QR) return { kind: 'bad', why: 'QR 位是 1：这是应答不是查询' }
  if (buf.readUInt16BE(4) !== 1) return { kind: 'bad', why: '问题数不是 1（教学版只回单个问题）' }
  let o = 12
  const labels: string[] = []
  for (;;) {
    if (o >= buf.length) return { kind: 'short' }
    const len = buf[o]
    if (len === 0) {
      o += 1 // 0 长度标签 = 名字写完了
      break
    }
    if (len & 0xc0) return { kind: 'bad', why: '问题名里出现压缩指针/超长标签（正常查询不该有）' }
    if (o + 1 + len > buf.length) return { kind: 'short' }
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('latin1'))
    o += 1 + len
  }
  if (buf.length < o + 4) return { kind: 'short' } // 名字后还有 QTYPE/QCLASS 四字节
  const qtype = buf.readUInt16BE(o)
  const qclass = buf.readUInt16BE(o + 2)
  if (qclass !== CLASS_IN) return { kind: 'bad', why: 'QCLASS 不是 IN' }
  return { kind: 'ask', id: buf.readUInt16BE(0), rd: (flags & FLAGS_RD) !== 0, name: labels.join('.').toLowerCase(), qtype, questionEnd: o + 4 }
}
```

QNAME 的读法值得看两眼：名字不是定长字段，是「1 字节长度 + 那么长的字节」一段段拼、以 0 收尾——所以解析器必须一段段走，走完才知道问题区到哪结束（`questionEnd` 顺手记下，应答抄问题区要用）。标签长度最多 63，最高两 bits 是 11 即压缩指针，问题名里出现一律按坏处理。

装应答的函数是 8.4.2 那份跟读的代码形态。

```ts
// src/fakeip.ts · answerQuery
function answerQuery(msg: Buffer, pool: FakeIpPool): Buffer | null {
  const parsed = parseQuery(msg)
  if (parsed.kind === 'short') return null
  if (parsed.kind === 'bad') {
    console.error(`[fake-dns] 丢弃一份看不懂的查询：${parsed.why}`)
    return null
  }
  const question = msg.subarray(12, parsed.questionEnd) // 问题段原样抄回——客户端靠它对上号
  const head = Buffer.alloc(12)
  head.writeUInt16BE(parsed.id, 0)
  head.writeUInt16BE(FLAGS_QR | FLAGS_AA | FLAGS_RA | (parsed.rd ? FLAGS_RD : 0), 2)
  head.writeUInt16BE(1, 4) // 问题数 1
  head.writeUInt16BE(0, 8) // 权威区 0
  head.writeUInt16BE(0, 10) // 附加区 0
  if (parsed.qtype !== QTYPE_A) {
    head.writeUInt16BE(0, 6) // 答案数 0：AAAA 等非 A 查询回「查无此录」的空答案，别让客户端干等
    return Buffer.concat([head, question])
  }
  const ip = pool.allocate(parsed.name) // A 查询才取号——应答里的假门牌从此有了主人
  head.writeUInt16BE(1, 6) // 答案数 1
  const answer = Buffer.alloc(16) // NAME(2 指针) + TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2) + RDATA(4)
  answer.writeUInt16BE(PTR_MASK | 12, 0) // 指回偏移 12：答案的名字就是问题里那个名字，一字不重写
  answer.writeUInt16BE(QTYPE_A, 2)
  answer.writeUInt16BE(CLASS_IN, 4)
  answer.writeUInt32BE(1, 6) // TTL=1 秒：假答案不配被久缓存，过期了就再来问（差异登记附录）
  answer.writeUInt16BE(4, 10) // RDLENGTH：IPv4 地址四字节
  ip.split('.').forEach((seg, i) => answer.writeUInt8(Number(seg), 12 + i))
  return Buffer.concat([head, question, answer])
}
```

两个分支两句话。非 A 查询（比如浏览器同时发的 AAAA，问 IPv6 门牌）回「查无此录」的空答案：教学版只发 IPv4 假门牌，但至少回个话，客户端不用干等。A 查询才取号——`pool.allocate` 一行，就是「假电话簿」与「账本」的接缝：应答里的假门牌从此有了主人。

### 8.4.4 startFakeDns：UDP 应答器

应答器本体用 `node:dgram`：DNS 查询一问一答、报文小，UDP（用户数据报协议——只管把一小包字节丢给对方，不建连接不保证送达）正合适，省一次握手。真 DNS 住 53 端口——Unix 系上占它要管理员权限（Windows 不强制，教学版照样不占），教学版用临时端口。

```ts
// src/fakeip.ts · startFakeDns
export interface FakeDnsOptions {
  port: number // 0 = 请系统随手分一个空闲端口（真 DNS 的 53 在 Unix 系要管理员权限；教学版不占）
  pool: FakeIpPool // 查到的名字在这里登记与取号
  host?: string
}

export interface FakeDnsHandle {
  port: number
  close(): Promise<void>
}

export function startFakeDns(opts: FakeDnsOptions): Promise<FakeDnsHandle> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    sock.once('error', reject)
    sock.on('error', (e) => console.error(`[fake-dns] socket 出错：${e.message}`)) // 绑定后的事故只记日志，不让进程崩
    sock.on('message', (msg, rinfo) => {
      try {
        const reply = answerQuery(msg, opts.pool)
        if (reply !== null) sock.send(reply, rinfo.port, rinfo.address) // UDP 无连接：从哪来，回哪去
      } catch (e) {
        console.error(`[fake-dns] 应答失败：${(e as Error).message}`)
      }
    })
    sock.bind(opts.port, opts.host ?? '127.0.0.1', () => {
      resolve({
        port: sock.address().port,
        close: () =>
          new Promise((res) => {
            sock.close(() => res())
          }),
      })
    })
  })
}
```

与 `net` 模块那份 socket 的差别只有一处：UDP 无连接，没有「每客一条 socket」的结构——一个 socket 收所有来包，`rinfo` 里带着来路，回话照来路发回。主循环纪律不变：单包错误只记日志，进程不退出。

### 8.4.5 接线：onConnect 先还原，再判决

最后一步把三块零件接起来：假电话簿应答查询、账本登记，`onConnect` 钩子先按账还原、再交规则引擎。接线长在测试里（第 7 章 `routeByRules` 的 fake-ip 版）。

```ts
// tests/fake-ip.test.ts · restoreThenRoute —— 入口接线：假门牌先还原，再交规则引擎判决
function restoreThenRoute(pool: FakeIpPool, rules: Rule[], relayPort: number, password = PASSWORD) {
  return (t: ProxyTarget): ProxyTarget | Duplex | Promise<ProxyTarget | Duplex> => {
    const domain = pool.restore(t.host) // 还原不出名字的是普通目标（真 IP 直报），原样放行
    const target: ProxyTarget = domain === null ? t : { host: domain, port: t.port }
    const hit = matchTarget(rules, target)
    return hit !== null && hit.rule.outbound === 'PROXY'
      ? connectViaRelay({ host: '127.0.0.1', port: relayPort }, target, password)
      : target
  }
}
```

集成的剧本值得一句句对。测试先当浏览器：用 dgram 客户端向假电话簿发原始查询字节，拿回假门牌；再向 SOCKS5 入口发 CONNECT，目标填假门牌（ATYP=1）。钩子里 `pool.restore` 翻账，假门牌换回 `localhost`，判决握着域名走——规则表 `DOMAIN,localhost,PROXY` 命中，连接进加密隧道，由远端中继解析 `localhost` 并代连目标站。对照组直接报真 IP `127.0.0.1`：还原不出名字，落 MATCH 兜底直连。远端门前的计数探针作证——假门牌那条计数 1，真门牌那条不涨。第二条集成用例把规则表倒过来（DOMAIN 行判 DIRECT、MATCH 兜底 PROXY），判决跟着翻面。同一个假门牌这回按域名直连，真 IP 反而走了隧道——**判的是还原出来的名字，不是手里那串数字**。

9 条用例的分布：池 3 条（同名同号、还原只认在册、FIFO 让位），应答器 4 条（A 应答逐字节断言、同名两问同号、AAAA 空答案、残缺查询不垮），集成 2 条。A 应答那条把 8.4.2 的跟读全部写进了断言：ID 回显、FLAGS 0x8580、问题区抄回、指针 `c0 0c`、TTL=1、RDATA 四字节——应答器有没有按 RFC 1035 说话，字节说了算。

## 8.5 验证：亲手开机，看假电话簿

**开机。** 进 `companion/` 跑 `npm run demo:fake-ip`。它拉起五个角色：假电话簿、双栈目标站、上锁的远端中继、计数探针、接了还原接线与规则引擎的 SOCKS5 入口——照旧全住回环地址，不出机器。三幕应看到（端口每次随机）。

```text
# companion 的 demo:fake-ip 输出节录
—— 第一幕：把 DNS 指向 mini-clash，A 查询当场拿假门牌 ——
  查询 www.site.example   → 198.18.0.1
  查询 api.site.example   → 198.18.0.2
  查询 www.site.example   → 198.18.0.1
  （同名两问同一号——www.site.example 没拿第二个门牌；账本在册 2 条。）
  有 dig 的读者可亲手再查：dig @127.0.0.1 -p 54060 www.site.example A
  Windows 自带 nslookup 的读者：nslookup -port=54060 www.site.example 127.0.0.1

—— 第二幕：拿假门牌去连接，入口换回真名字再判决 ——
  假门牌 198.18.0.3:3374  还原成 localhost → 判 PROXY  命中第 0 行 DOMAIN,localhost,PROXY
  拿假门牌连接 收到回声 BY-FAKE（货送到了）→ 此刻远端侧连接数: 1
  真门牌 127.0.0.1:3374  还原不出名字（非本池门牌） → 判 DIRECT 命中第 1 行 MATCH,DIRECT
  拿真门牌连接 收到回声 BY-REAL（货送到了）→ 此刻远端侧连接数: 1

—— 第三幕：容量 3 的小池发到第 4 个名字——最老的让位，旧号易主 ——
  a.example    → 198.18.0.1
  b.example    → 198.18.0.2
  c.example    → 198.18.0.3
  d.example    → 198.18.0.1
  d.example 进场时池已满：最老的 a.example 让位，旧号 198.18.0.1 现在还原出 d.example
```

第一幕就是 8.3.2 那场证伪的可感知版：demo 打印的 dig 命令在你机器上一样能跑，ANSWER 段的 A 记录就是假门牌——假表骗过了真客户端。第二幕两条对照是本章里程碑的判决见证：同一个入口、同一台目标站，假门牌还原成域名走了加密隧道（域名过隧道、远端解析），真门牌落兜底直连。第三幕演账本的一生：容量 3 的池发到第 4 个名字，最老的让位、旧号易主。顺手跑 `npm test`，50 条全绿。

**先猜后跑（指认破坏）。** 打开 `src/fakeip.ts`，把 `allocate` 里让位那行的 `this.order.shift()` 改成 `this.order.pop()`——FIFO 变 LIFO，改成队尾让位。跑之前写下预言：9 条用例哪几条红？demo 第三幕的输出哪几行变？跑 `npm test` 与 `npm run demo:fake-ip` 验证。答案：红的只有池满让位那一条用例，且一红红一片——容量 2 的池里 a、b 取号后队是 [a, b]，`pop()` 弹的是队尾的 `b.example`，于是 `c.example` 拿到的是 `198.18.0.2` 而非 `.1`；`restore('198.18.0.1')` 还原出的仍是没让位的 `a.example`；`restore('198.18.0.2')` 还原出的是 `c.example`；`allocate('a.example')` 回访也错了——LIFO 下 a 没让位、直接命中「同名旧号」分支拿回 `198.18.0.1`，而 FIFO 语义里它该让位后重排。同一用例里四处断言全对不上。其余 8 条不红：默认池 131,071 个号在测试里装不满，让位分支压根不触发。demo 第三幕（容量 3）里 `d.example` 拿到的是队尾 `c.example` 让出的 `198.18.0.3`，最后一行变成「旧号 198.18.0.1 现在还原出 a.example」——a 根本没让位。改回原样，50 条应全绿。

**自包含复算。** 8.3.1 的 `dns-peek.mjs` 拿 node 一个文件就能跑；有 dig 的机器再用第一幕打印的命令查一遍——不进实验场，也能亲眼看到「查询→假门牌」这一跳。

## 8.6 收束：名字这一关归你了

回到开篇那个连不上的假门牌。现在你能讲清两层：污染发的假门牌为什么连不上——答案本身就是编的，门牌后面没有主人；Clash 的应对为什么高明——**既然客户端信先到的答案，那就让先到的答案出自我手**，假门牌从攻击的后果变成接管的记号。8.1 的三笔账也清了：名字活着到达入口（还原接线），解析被动手脚的账（截胡在查询路径上、泄露在明文的问题里），以及 fake-ip 如何绕开这两环（查询不出门、真解析推迟到出口）。

你手里多了第六块零件：`src/fakeip.ts` 的 `FakeIpPool`（同名同号、还原、FIFO 让位）与 `startFakeDns`（按 RFC 1035 形状应答的假电话簿），加上 `onConnect` 的还原接线。可迁移的解法一件：「发代号、记账本、到关口还原」——NAT 把内网地址换成公网端口、服务注册表用名字换实例地址，都是同一形状；它换来的自由也同一味：把「名字怎么变地址」这件事，从不可控的链路上收回到自己手里。

概念去向地图：

- 不经入口的应用拿到假门牌无人还原，连接找不到主人——第 9 章的 TUN 虚拟网卡把全机流量收进代理进程，那是「人人可还」的根治；
- 假电话簿、账本与还原接线此刻长在测试与 demo 里——第 11 章总装把 DNS 也拉进一条命令可跑的整机。

### 自查

1. 判断：一个不经过 mini-clash 入口的程序（回想第 1 章那个不理会系统代理的命令行工具）从假电话簿查到了假门牌，接下来会发生什么？为什么？
2. 计算：容量 1000 的池依次取号，第 999 个、第 1000 个、第 1001 个名字各拿到什么号？
3. 预测：把 demo 第二幕的规则表改成 `['MATCH,PROXY', 'DOMAIN,localhost,DIRECT']`，两条连接各走哪条线？远端侧连接数分别是多少？

::: details 参考答案与锚点
1. 它拿假门牌发起连接，永远连不上：假门牌只在 198.18.0.0/15 里、只有接管入口的账本认得，没人替它还原成真域名；TUN 之前，这是 fake-ip 模式的已知代价（回查 8.3.3 的第二笔代价与 8.3.4 的网段选型）。
2. 第 999 个 = 198.18.3.231，第 1000 个 = 198.18.3.232——起点 198.18.0.1 自带一个 +1（`ipAt(0)` 就是它），再顺次加偏移：第 999 个偏移 998，198.18.0.1 + 998 = 198.18.3.231（998 = 3×256 + 230，加在起点 0.1 上进位到第三段）。第 1001 个时池满：最老的第 1 个名字让位，它拿到的正是让出来的 198.18.0.1（回查 8.4.1 的 `ipAt` 与让位语义）。
3. 两条都判 PROXY 走加密隧道：MATCH 在前永远先中即停，DOMAIN 行轮不到——假门牌那条远端侧计数 1，真门牌那条计数 2。判决翻面的钥匙在顺序，不在目标形态（回查第 7 章的顺序语义与 8.4.5 的对照用例）。
:::
