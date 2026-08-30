---
title: 两跳链路：本地代理与远端中继
---

# 两跳链路：本地代理与远端中继

## 4.1 前情：零件有了，远方还没有

三个问题，把前两章的线头接起来：

- 入口收到 CONNECT 之后干的第一件事是什么？——`openConnect` 里那句 `connectTo`：每条连接都从本机直连目标。
- 第 1 章全景图里的三个角色，你已经造出哪个？——入口有了，还听得懂两种话（HTTP 报文的 absolute-form 与 CONNECT 隧道、SOCKS5 的字节暗号）；分流决策和远端服务器都还没影。
- 第 3 章末尾留的那招「先读长度、再定边界」，去哪兑现？——就在这一章。这次不是读别人的协议，是给字节流画自己的边界。

## 4.2 能用的入口，缺一跳的链路

上一章收官时你手里有一台能用的 SOCKS5 入口：curl 经它访问回环目标，一路绿灯。但把它对回第 1 章那张全景图，缺口感立刻显出来：图里写的是「入口 → 加密隧道 → 远端服务器 → 代访」，而你的入口收到 CONNECT 后干的事是——自己拨目标。每条连接都从本机直连目标，远端服务器这个角色根本不存在。

具体到现象：目标站的连接日志里，敲门人就是你本机；那些「经直连不可达、经由远端才可达」的站点，经你的 mini 版一律不可达——因为它没有那一跳。**「装在本机的它」与「站在目标可达位置的它」之间，还差一跳**。这一章就把这一跳接起来：写一台远端中继，再给入口换上「经远端去目标」的接法。

接完你还会亲眼看到另一件事：这条链路完全裸奔——目标域名、每一段内容，在线路上全是明文。先别急着难受，那是下一部分的入口。

## 4.3 原理：把「远端」请回来

### 4.3.1 两跳链路：谁站在哪

先立本章的主角词。两跳链路（two-hop chain）——浏览器到本地代理是第一跳，本地代理到远端服务器是第二跳，目标站只见远端服务器，不见你的机器。锚点接着第 1 章的前台用：前台不止替你跑腿，还把包裹整批交给目标城市的转运仓，由转运仓完成当地派送——收件方只见转运仓。

画成图（第 1 章全景图的本章特写）：

```text
浏览器 ──① 交出（SOCKS5 报目标）──▶ 入口（住在本机回环）
                                        │
                                        │ ② CONNECT 帧递上目标，明文帧搬运
                                        ▼
                            远端中继（站在目标可达的位置）
                                        │
                                        │ ③ 代连：以自己的名义拨目标
                                        ▼
                                     目标站
```

有两个事实值得钉死。第一，这条链路是三条独立的 TCP 连接在接力：浏览器↔入口、入口↔远端、远端↔目标——第 1 章自查题里你亲手数过，代理链路从来不是一根管子穿到底。第二，**目标站看到的敲门人是远端，不是你的机器**——这正是「经由远端可达」的全部含义：可达性来自位置，远端站在目标可达的位置上，替你完成最后一程。

（第 1 章留过一句账：「教学版把远端也搬进本机——链路的形状一点不变，第 4 章展开」。本章兑现：教学版里远端中继也住你的回环地址，与入口同机不同进程。形状一点不变，只是三段线都短得看不见。）

### 4.3.2 中继：给这个动作一个名字

第二跳要干的活，其实你已经写过两遍：第 2 章 CONNECT 应答之后的隧道、第 3 章成功应答之后的 `openRelay`。现在给它一个正式的名字。中继（relay）——把两条 socket 对接起来、双向搬运字节的操作：一条腿上收到的字节原样写到另一条腿，两头都不解读。它是真正搬字节的那部分（行话叫数据面，与做决策的控制面相对），入口和远端各有一个。

为什么必须双向、各搬一边？反事实摆一下：假如只搬「去」的方向，请求确实能到目标，目标的应答却永远回不到浏览器——对话有去无回，等于没通。所以中继是两条方向相反的 pipe：`remote.on('data', b => client.write(b))` 一条、`client.on('data', b => remote.write(b))` 一条。你写过的那两处，就是这个形状的两次预演。

### 4.3.3 帧：自己当一次协议设计者

第二跳和前两跳有个本质区别：浏览器→入口、远端→目标这两段，走的都是现成协议（SOCKS5、HTTP）；入口→远端这一段，没有任何现成协议——它俩怎么说话，由你来定。

先立词。帧（frame）——自定义链路上的一段数据单元：头部写清长度，后面跟载荷，字节流因此有了边界。锚点一句话：集装箱的箱门上贴着箱单写明内装多少件，卸货的人不开箱就知道这箱到哪结束。

这条链路一共两种帧加一个定长回执，全部结构如下。

CONNECT 帧（入口→远端，每条连接开局一条，作用是「带我去 host:port」）：

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0 | ATYP | `01` = IPv4（地址段定长 4 字节）；`03` = 域名（1 字节长度 + 名字原文） |
| 1 起 | DST.ADDR | 目标地址，长度看 ATYP |
| 末 2 字节 | DST.PORT | 目标端口，大端序 |

回执（远端→入口，定长 1 字节）：`00` = 目标接通，中继开始；`01` = 接不通，链路收摊。

数据帧（回执之后，双向都是它）：

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0–1 | LEN | 载荷字节数，大端序；合法范围 1..0x3fff |
| 2 起 | PAYLOAD | 任意字节，长度就是 LEN |

三张表里每格都是老朋友。ATYP 沿用 SOCKS5 的目标地址类型编号——那张三形态字典你已经会读，双方不必再学新暗号；端口照旧大端序两字节。跟读一遍线上字节（目标 `127.0.0.1:4569`，十六进制 `4569 = 0x11D9`）：

```text
01 7f 00 00 01 11 d9                CONNECT 帧：ATYP=01 + 7f 00 00 01 + 端口
00                                   回执：接通
00 02 68 69                          数据帧：LEN=2 + 'hi'
00 0b 48 65 6c 6c 6f 20 57 6f 72 6c 64  数据帧：LEN=11 + 'Hello World'
```

反向出题：`03 09 6c 6f 63 61 6c 68 6f 73 74 1f 90` 在请求去哪？——ATYP=03 域名形态，长度 9，中间九个字节逐字翻回 `localhost`，收尾 `1f 90` 是 8080。

两个设计决定要交待成因，不能只当规矩背。

其一，为什么用长度前缀画边界？载荷是任意字节——你在第 3 章亲手验证过字节流没有边界，而载荷里任何字节值都可能出现，靠「找某个特殊字节当分隔符」早晚撞车，撞上了就得引入转义规则，读和写两侧都得维护那张转义表。长度前缀把问题变成一句机械口令：先读 2 字节长度、再数够那么多字节——第 3 章末尾预告的那一招，原样落地。

其二，明文阶段为什么就急着分帧？诚实说：第二跳就算裸管道也能跑通，回执之后两边原样搬字节就行。分帧是为下一步留的接缝——下一部分要把载荷换成密文，而加密以块为单位（一块一块加密、一块一块验），到时候只需要把「帧里装的内容」从明文换成密文，链路的形状、两端的代码一点不用动。上限 `0x3fff` 同理是道防线：长度头先验，越界即坏帧，不等载荷到齐就拒收——不给自己制造「按 64KB 去等」的惊喜。

还有一条藏在 ATYP=03 里的决定：域名照原文过境，解析留给远端。入口不把名字换成 IP，因为换的成本发生在「谁可达」上——名字在远端那台机器上解析，目标才拿得到远端的可达性。这正是 `--socks5-hostname` 那个 curl 参数的本意：名字交给代理端解析。

把三张表拼成一场完整对话的时序。

```text
入口                                    远端中继                          目标站
  │ ① CONNECT 帧 [01 addr port]           │                                │
  │ ────────────────────────────────────▶ │ ② 以自己的名义拨号              │
  │                                      │ ──────────────────────────────▶│
  │ ◀────── ③ 回执 [00] ─────────────────│ ◀───────── 接通 ──────────────│
  │ ══ ④ 双向只有数据帧 [LEN][载荷] ══════│ ══ 裸字节：拆帧进 / 装帧出 ════▶│
```

## 4.4 演练：把两跳写成代码

实验场开工。`src/relay.ts` 是本章主件，`tests/two-hop-relay.test.ts` 是裁判——照旧测试先写、先跑出红（模块不存在，加载即失败），再写实现转绿。门槛命令照旧：`cd companion && npm run typecheck && npm test`，本章 7 条全绿、旧 14 条不动（全书完成后总数更多，后续章节还会加）。

对外开两个口：`startRelayServer({ port })` 立一台远端，`connectViaRelay(relayAddr, target)` 请远端代连（给这条链路上锁时，两者都会多一个可选的 password 参数，那是对表真实协议那一章的事）。入口那侧的接线只动 `src/socks5.ts` 两处，后面细说。

### 4.4.1 先还一笔债：connectTo 提取

写远端之前先处理滚动摘要里挂了整整一章的债。`connectTo` 在第 2 章首写、第 3 章抄了一份，本章远端要第三次用它——三份一模一样的拨号代码，改一处漏两处。提取时机到了：搬进共用模块 `src/dial.ts`，两个旧文件改一行 import。

```ts
// src/dial.ts · connectTo
import net from 'node:net'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// net.connect 的 Promise 包装。HTTP 入口、SOCKS5 入口与远端中继都用它拨号：
// 接通即 resolve；连不上 reject，之后怎么回话（502 / REP=01 / 回执 01）由调用方决定
export function connectTo(t: ProxyTarget): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(t.port, t.host)
    s.once('connect', () => resolve(s))
    s.once('error', (e) => {
      s.destroy()
      reject(e)
    })
    s.on('error', () => s.destroy()) // 接通之后的事故只收尾，不让进程崩
  })
}
```

`ProxyTarget` 的家留在 `http-proxy.ts`（第 2 章立的门牌），dial 只借形状——与第 3 章 socks5 的做法同款。旧章正文里逐字引用过旧拷贝的段落已同步改写到现行形态（第 2 章那块代码的出处标注随之换成 `src/dial.ts`）：正文引用的代码必须始终等于验证物终态，这是全书的回写纪律。旧测试一字未动、照常全绿——提取没有破坏任何行为。

### 4.4.2 帧编解码：给字节流画边界

`src/relay.ts` 从两种帧加回执的固定编号起手，然后是两端共用的编解码小工具。

```ts
// src/relay.ts · 编号常量
// 帧里的固定编号：ATYP 沿用 SOCKS5 的字典（01 IPv4 / 03 域名），双方不必再学新暗号
const ATYP_IPV4 = 0x01 // 地址形态：1 = IPv4，地址段定长 4 字节
const ATYP_DOMAIN = 0x03 // 地址形态：3 = 域名，地址段 = 1 字节长度 + 名字原文（解析留在远端做）
const STATUS_OK = 0x00 // 回执：目标接通，中继开始
const STATUS_FAIL = 0x01 // 回执：目标接不通，链路就此收摊
const MAX_PAYLOAD = 0x3fff // 一帧载荷的上限：长度头先验，越界即坏帧——不等载荷到齐就拒收
```

```ts
// src/relay.ts · encodeFrame 与 createFrameReader
// 编码：2 字节大端长度 + 载荷。长度头就是边界——读的人数完这几个字节，就知道这条帧到哪结束
function encodeFrame(payload: Buffer): Buffer {
  const head = Buffer.alloc(2)
  head.writeUInt16BE(payload.length, 0)
  return Buffer.concat([head, payload])
}

// 帧读取器：一条连接一个。字节喂进来，凑齐一帧交一帧，凑不齐的留在肚里等下文
// ——与第 3 章的累积缓冲同一件手艺，只是这回按我们自己定的长度规矩切
function createFrameReader(onFrame: (payload: Buffer) => void) {
  let buffered = Buffer.alloc(0)
  return {
    push(chunk: Buffer) {
      buffered = Buffer.concat([buffered, chunk])
      for (;;) {
        if (buffered.length < 2) return // 长度头还没到齐
        const len = buffered.readUInt16BE(0)
        if (len === 0 || len > MAX_PAYLOAD)
          throw new Error(`帧长越界：${len}（合法范围 1..${MAX_PAYLOAD}）`) // 零长与超限都不认
        if (buffered.length < 2 + len) return // 载荷还没到齐
        onFrame(buffered.subarray(2, 2 + len))
        buffered = buffered.subarray(2 + len)
      }
    },
  }
}
```

`createFrameReader` 的骨架你在 `parseConnectRequest` 里见过：攒字节、够长才消费、三种「不够长」各自按兵不动。两处新意。`for (;;)` 循环是因为一次 push 可能带进来好几帧——一箱字节里装三只集装箱，拆完一只接着拆下一只。越界就 throw，是把「坏帧」从返回值升级成异常：调用方拿到异常只做一件事，收线。

### 4.4.3 CONNECT 帧：目标上链

```ts
// src/relay.ts · encodeConnectFrame 与 parseConnectFrame
// 目标装进 CONNECT 帧：数字 IP 走 IPv4 形态；域名走 ATYP=03 原文过境——名字的解析交给远端
function encodeConnectFrame(t: ProxyTarget): Buffer {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t.host)) {
    const ip = t.host.split('.').map(Number)
    return Buffer.from([ATYP_IPV4, ...ip, t.port >> 8, t.port & 0xff])
  }
  const name = Buffer.from(t.host, 'latin1')
  return Buffer.from([ATYP_DOMAIN, name.length, ...name, t.port >> 8, t.port & 0xff])
}

// 解析 CONNECT 帧。三种结局与第 3 章的解析器同款：短（等下文）/ 坏（收线）/ 全（拿到目标）
type ParsedConnect =
  | { kind: 'short' }
  | { kind: 'bad' }
  | { kind: 'ok'; target: ProxyTarget; consumed: number }

function parseConnectFrame(buf: Buffer): ParsedConnect {
  if (buf.length < 1) return { kind: 'short' }
  const atyp = buf[0]
  let addrEnd: number // 地址段的终点：走到哪儿，端口那 2 字节才从哪儿开始
  if (atyp === ATYP_IPV4) {
    addrEnd = 5 // 1（ATYP）+ 4（四个数字各占一字节）
  } else if (atyp === ATYP_DOMAIN) {
    if (buf.length < 2) return { kind: 'short' } // 名字长度那一格自己还没到
    addrEnd = 2 + buf[1] // 1（ATYP）+ 1（长度）+ N（名字原文，没有结尾符）
  } else {
    return { kind: 'bad' }
  }
  const total = addrEnd + 2 // 尾上还有 2 字节端口
  if (buf.length < total) return { kind: 'short' }
  const host =
    atyp === ATYP_IPV4
      ? Array.from(buf.subarray(1, 5)).join('.')
      : buf.subarray(2, addrEnd).toString('latin1')
  const port = buf.readUInt16BE(addrEnd) // 大端序读回：高位字节在前
  return { kind: 'ok', target: { host, port }, consumed: total }
}
```

与第 3 章那台解析器逐行对看，差异只有两处：没有 VER/CMD/RSV 三格检查（自家协议，开门见山），地址从第 0 字节起算而不是第 4 字节。`consumed` 照旧记下吃掉几个字节——CONNECT 帧后面可能紧跟着首帧数据，吃剩的原地留给下一段。

### 4.4.4 远端侧：一台代连机器

`handleRelayClient` 承包一条入口连接，状态机与第 3 章同款：request（攒 CONNECT 帧）→ dialing（代连中）→ relay（搬运）。

```ts
// src/relay.ts · handleRelayClient：状态与代连
// 一条入口连接的一生：request（攒 CONNECT 帧）→ dialing（代连中）→ relay（帧↔字节双向搬运）；dead = 已收摊
// （第 6 章起 client 也可能是 aeadPipe 交回的加密管道：函数只当它是双工管，锁的事不归这里管）
function handleRelayClient(client: Duplex): void {
  let buffered = Buffer.alloc(0) // 累积缓冲：CONNECT 帧可能拆着到、也可能与首帧同包到
  let phase: 'request' | 'dialing' | 'relay' | 'dead' = 'request'
  let target: net.Socket | null = null
  let reader: ReturnType<typeof createFrameReader> | null = null

  const fail = (msg: string) => {
    console.error(`[relay] ${msg}`)
    client.destroy()
    target?.destroy()
    phase = 'dead'
  }

  const openConnect = async (t: ProxyTarget): Promise<void> => {
    try {
      const remote = await connectTo(t) // 「站在目标可达的位置」说的就是这一行：目标由远端拨
      client.write(Buffer.from([STATUS_OK])) // 回执：接通了
      target = remote
      reader = createFrameReader((payload) => target?.write(payload)) // 帧 → 裸字节 → 目标
      remote.on('data', (b) => {
        // 裸字节 → 切块装帧 → 入口（超一帧上限的先切开）
        for (let i = 0; i < b.length; i += MAX_PAYLOAD) client.write(encodeFrame(b.subarray(i, i + MAX_PAYLOAD)))
      })
      remote.on('error', (e) => fail(`目标连接出错：${e.message}`))
      remote.on('close', () => client.end())
      phase = 'relay'
      if (buffered.length > 0) {
        reader.push(buffered) // CONNECT 帧后紧跟的首帧：一并解，一个字节不丢
        buffered = Buffer.alloc(0)
      }
    } catch (e) {
      client.end(Buffer.from([STATUS_FAIL])) // 回执：接不通，这场代连到此为止
      phase = 'dead'
      console.error(`[relay] 接不通目标：${(e as Error).message}`)
    }
  }
```

两处读点。`openConnect` 第一行就是「代连」二字的全部实现：目标由远端拨，可达性来自远端的位置。中继段是 4.3.2 那两条 pipe 的帧版：入口方向拆帧写目标、目标方向切块装帧写入口——两头的协议不同（一头帧、一头裸字节），中继就是那个翻译兼搬运工。

泵与数据入口，和第 3 章一个模子。

```ts
// src/relay.ts · handleRelayClient：泵与数据入口
  // 状态机泵：来一批字节问一次「以手头的缓冲能走到哪儿」——走不动就回来等下文
  const pump = () => {
    if (phase !== 'request') return
    const parsed = parseConnectFrame(buffered)
    if (parsed.kind === 'short') return // 半个 CONNECT 帧：留在缓冲里等下文
    if (parsed.kind === 'bad') return fail('CONNECT 帧看不懂')
    buffered = buffered.subarray(parsed.consumed) // 剩余字节可能是紧跟的首帧，代连后一并解
    phase = 'dialing'
    void openConnect(parsed.target)
  }

  client.on('data', (chunk) => {
    if (phase === 'relay') {
      try {
        reader?.push(chunk)
      } catch (e) {
        fail(`坏帧：${(e as Error).message}`)
      }
      return
    }
    if (phase === 'dead') return
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
  client.on('error', (e) => fail(`入口连接出错：${e.message}`))
  client.on('close', () => target?.destroy())
}
```

开机件与第 3 章同款骨架：`net.createServer` 每连接一个 `handleRelayClient`，`sockets` 集合管收摊。

```ts
// src/relay.ts · startRelayServer
export function startRelayServer(opts: RelayServerOptions): Promise<RelayServerHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      // 有密码：这条连接整段先套上加密管道，帧世界照旧骑在上面；没收线记录的仍是裸 socket
      handleRelayClient(opts.password === undefined ? client : aeadPipe(client, opts.password))
    })
    server.once('error', reject)
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const s of sockets) s.destroy() // 先拆连接，close 才不必等它们自然结束
          return new Promise((res) => server.close(() => res()))
        },
      })
    })
  })
}
```

### 4.4.5 入口侧：connectViaRelay 与转接头

入口这头的活分两层：先接通远端、递上目标、等回执；然后要把「帧住的第二跳」装成一根普通管道交给入口——不然 `openRelay` 往里写的裸字节会直接漏到帧链路上，双方对不上话。

```ts
// src/relay.ts · attachFrameStream
// 双工转接头：外侧（入口）当它是普通管道——写进裸字节、读出裸字节；
// 内侧（中继线）跑的是帧。装帧拆帧都藏在里面，入口与中继的既有代码因此一字不改
// （第 6 章起内侧可能是 aeadPipe 交回的加密管道，参数随之从 net.Socket 加宽为 Duplex）
function attachFrameStream(relay: Duplex, early: Buffer): Duplex {
  const outer = new Duplex({
    read(_size) {
      // 数据是被推着来的（push），读侧不用主动拉——但这个钩子必须存在，缺了流一开工就报错
    },
    write(chunk, _enc, cb) {
      const buf = chunk as Buffer
      // 裸字节切块装帧：一块最多 MAX_PAYLOAD，超长的先切开再装
      for (let i = 0; i < buf.length; i += MAX_PAYLOAD) relay.write(encodeFrame(buf.subarray(i, i + MAX_PAYLOAD)))
      cb()
    },
  })
  const reader = createFrameReader((payload) => outer.push(payload)) // 帧 → 裸字节 → 外侧
  if (early.length > 0) reader.push(early) // 与回执同包到达的首帧
  relay.on('data', (b) => {
    try {
      reader.push(b)
    } catch (e) {
      outer.destroy(e as Error) // 坏帧：转接头整体收摊
    }
  })
  relay.on('close', () => outer.destroy()) // 中继线收线：外侧跟着收
  relay.on('error', (e) => outer.destroy(e))
  outer.on('close', () => relay.destroy()) // 外侧收线：中继线跟着收
  return outer
}
```

一个新面孔：Duplex——Node 里对「一根能读也能写的管道」的统称，读和写两个方向并存。`net.Socket` 就是它的子类：socket 本来就能读能写。转接头 `outer` 装作一根普通管道——外侧写进裸字节、读出裸字节；帧的全部规矩（切块、装头、拆头、拼回）都藏在它与中继线之间。收线也接成了一对：任何一头收摊，另一头跟着收。（第 6 章上锁时正是从这道接缝下手：内侧允许换成加密管道交回的双工管，`attachFrameStream` 的参数因此从 `net.Socket` 加宽为 `Duplex`——都是能读能写的管子，锁的事转接头不必知道。）

外层函数把「拨远端、递目标、等回执」串成一步。

```ts
// src/relay.ts · connectViaRelay
// 两跳的接法：先拨远端（第一跳的终点），再请它代连目标（第二跳的另一半）。
// 回执 00 才算成；返回的管子直连语义与 net.Socket 无异。
// 给了 password，第一跳整段先套上加密管道：CONNECT 帧起一切明文都被逐块封缄——「去哪儿」也上锁
export async function connectViaRelay(relayAddr: ProxyTarget, target: ProxyTarget, password?: string): Promise<Duplex> {
  const raw = await connectTo(relayAddr) // 第一跳：先把线接到远端
  const relay: Duplex = password === undefined ? raw : aeadPipe(raw, password)
  relay.write(encodeConnectFrame(target)) // 目标装进 CONNECT 帧，请远端代连
  return new Promise((resolve, reject) => {
    const onFirst = (b: Buffer) => {
      relay.off('error', onErr)
      relay.off('close', onClose)
      if (b[0] !== STATUS_OK) {
        relay.destroy()
        return reject(new Error('远端回执：目标接不通'))
      }
      resolve(attachFrameStream(relay, b.subarray(1))) // 回执字节后面可能紧跟首帧
    }
    const onErr = (e: Error) => {
      relay.off('data', onFirst)
      relay.off('close', onClose)
      reject(e)
    }
    const onClose = () => {
      relay.off('data', onFirst)
      relay.off('error', onErr)
      reject(new Error('远端在回执前收线'))
    }
    relay.once('data', onFirst)
    relay.once('error', onErr)
    relay.once('close', onClose)
  })
}
```

三步之外全是防守：回执不是 `00` 就 reject；远端没回话就收线也 reject；回执字节后面可能粘着首帧，切下来喂给转接头——第 3 章那句「提前到的字节不丢」，换了个位置再说一遍。

### 4.4.6 接入：把钩子加宽一格

最后一步接线在 `src/socks5.ts`。第 3 章的 `onConnect` 钩子只会翻译「实际连谁」（回一个地址）；两跳需要的是「怎么连」也能改写——钩子直接交回一条已接通的流。契约加宽，不破旧：回地址仍是直连，老用法一个不用改。

```ts
// src/socks5.ts · 加宽后的钩子
// 「客户端想去哪」→「实际连谁」的翻译钩子，与第 2 章的 connectTarget 同构；
// 规则引擎接管分流时，在这里按目标判决改写出口。
// 第 4 章起还允许交回一条已接通的流（两跳的中继转接头）：回地址 = 直连（旧语义不变），
// 交回流 = 入口直接拿它当上游线——「怎么连」也归钩子管。
export type SocksConnectHook = (requested: ProxyTarget) => ProxyTarget | Duplex | Promise<ProxyTarget | Duplex>
```

消费钩子的 `openConnect` 改成三岔：没装钩子直连；回地址照它直连；交回流就直接当中继线——`openRelay` 与中继代码因此一字未改。

```ts
// src/socks5.ts · openConnect
  const openConnect = async (target: ProxyTarget): Promise<void> => {
    try {
      // 钩子的回话三选一：没装钩子（直连）/ 回一个地址（照它直连）/ 交回一条已接通的流（直接当上游线）
      const use = await hook?.(target)
      const remote =
        use === undefined
          ? await connectTo(target)
          : 'host' in use
            ? await connectTo(use)
            : use
      openRelay(remote)
    } catch (e) {
      client.end(reply(REP_GENERAL)) // 接不通：回「一般性失败」，不开中继
      phase = 'dead'
      console.error(`[socks5] 接不通目标：${(e as Error).message}`)
    }
  }
```

`'host' in use` 是那道分岔口：地址是有 `host` 字段的普通对象，流没有——有 `host` 的是门牌，会订阅事件的是管道。兼容性的证据是机械的：第 2、3 章的 14 条旧用例一字未动，全绿。

端到端用例把两跳钉死在断言里。测试起两个目标站——A 是浏览器点名的目标，B 是钩子实际经远端代连的目标——然后数连接。

```ts
// tests/two-hop-relay.test.ts · 端到端用例的核心段
    // A：浏览器点名要去的站——若入口偷懒直连，会在这里留下连接
    const a = await startEchoTarget()
    // B：钩子实际经远端代连的站
    const b = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const seen: Array<{ host: string; port: number }> = []
    const entry = await startSocks5Server({
      port: 0,
      onConnect: (t) => {
        seen.push(t) // 拿到的应是浏览器点名的目标（A），一字不改
        return connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: b.port })
      },
    })
```

```ts
// tests/two-hop-relay.test.ts · 路径断言
    expect(seen).toEqual([{ host: '127.0.0.1', port: a.port }]) // 入口拿到的是点名的目标
    expect(a.connections()).toBe(0) // A 一次也没被拨：入口没有直连
    expect(b.connections()).toBe(1) // B 恰好被拨一次：这一下发生在远端侧
```

「目标连接发生在远端侧」就这样落成可数的断言：A 的计数是 0，证明入口没有偷懒直连；B 的计数是 1，证明代连发生了、且只发生一次。数据能通不等于走了两跳——路径才算数。

其余六条用例各守一段：CONNECT 帧与回执的往返、超上限载荷的切块、手拼字节的同包与半帧、域名形态过境、目标接不通的回执 `01`、坏帧（长度头越界）不等载荷到齐就收线。

教学简化声明（登记进差异清单附录）：中继链路协议是自造的教学协议，真实世界的对应物（Shadowsocks 一类）第 6 章对表；远端不设任何认证，谁连上都可请它代连；两个方向的 write 都不检查返回值，不做背压；每条浏览器连接对应一条入口↔远端连接，不复用。

## 4.5 验证：亲手开机

**开机。** 进 `companion/` 跑 `npm run demo:two-hop`。应看到三行监听信息（目标站、远端中继、SOCKS5 入口）、一条拼好的 curl 命令，外加一张三个角色按端口排好的路径见证图。三个角色照旧全住回环地址。另开终端照跑那条命令，形如 `curl --socks5-hostname 127.0.0.1:{入口端口} http://127.0.0.1:{目标端口}/`，应看到：

```text
<html><body><h1>hello via two hops</h1></body></html>
```

这行字走了三段路：curl→入口（SOCKS5）、入口→远端（CONNECT 帧加数据帧）、远端→目标（裸字节）。顺手跑 `npm test`，本章时点全绿 21 条（全书完成后总数更多，后续章节还会加用例）——门槛两侧都亮着。

**先猜后跑（亲口对远端说话）。** 跑之前先写下预言：直接向远端中继递上一条 CONNECT 帧加一条数据帧，回来的头三个字节是什么？然后把下面几行存成 `probe.mjs`（三个端口换成 demo 打印的），在 companion 目录跑 `node probe.mjs`。

```js
// 用法示例：probe.mjs —— 亲手向远端中继说第一句（三个端口都换成 demo 打印的）
import net from 'node:net'
const tport = 4923 // 换成 demo 的目标站端口
let seen = Buffer.alloc(0)
const relay = net.connect({ port: 4924, host: '127.0.0.1' }) // 换成 demo 的远端中继端口
relay.on('connect', () => {
  // CONNECT 帧：ATYP=01 + 四字节 IPv4 + 大端端口；紧跟一条数据帧：一个完整的 GET 头
  const req = Buffer.from(`GET / HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\nConnection: close\r\n\r\n`)
  const head = Buffer.from([0x01, 127, 0, 0, 1, tport >> 8, tport & 0xff])
  relay.write(Buffer.concat([head, Buffer.from([req.length >> 8, req.length & 0xff]), req]))
})
relay.on('data', (b) => {
  seen = Buffer.concat([seen, b]) // 回执与首帧常分两次到达：先攒着
})
relay.on('close', () => {
  console.log(seen.toString('hex')) // 对照 4.3.3 的表读：回执、长度头、载荷
})
```

应看到打头一个 `00`（回执：接通），接着两字节长度头，随后载荷开头逐字翻回 `48 54 54 50 2f 31 2e 31 20 32 30 30 20 4f 4b`——`HTTP/1.1 200 OK`，目标站的应答装在帧里回来了。你刚才对「远端」说的每个字，它都听得懂。

**先猜后跑（指认破坏）。** 打开 `src/relay.ts`，把 `MAX_PAYLOAD` 改成 `0xffff`。先猜：7 条新用例哪条会红？写下答案再跑 `npm test` 验证。预期变红的只有「坏帧」一条：谎报的 `0x4000` 不再越界，远端开始等 16384 字节的载荷、永远等不齐，收线等不来，用例超时变红；切块用例的阈值也变了，但照样切得动，照常绿。改完记得改回来，应全绿。

### 这条链路现在谁都能看

probe 刚打印的那串十六进制，就是本章收尾要正视的事实：入口与远端之间的线路上，一切都是明文。按位置盘点一遍，谁能看到、能改动什么。

- 浏览器↔入口（第一跳）：教学环境里两者同在本机回环，不出机器；真实部署里它也在你自己的机器内部。
- 入口↔远端（第二跳，帧住的这段）：真实部署中这条线穿过你与远端之间的网络路径。**路径上的任何一方都能读到 CONNECT 帧里的目标域名与端口、每一帧的完整内容；也能改动任何字节——现在的协议没有任何发现改动的手段**。教学版同机回环，只是把这段线缩短到看不见，明文本性一样。
- 远端中继进程：它替你连目标，因此看得到、也改得动全部往返内容；目标站看到的来源是它，不是你。

明文帧给字节流画边界，不给内容上锁——这两件事一句真相：边界是排版，加密是上锁，本章只做了排版。这笔账下一部分开头就算。

## 4.6 收束：三段线接成一条路

回到开头的缺口。现在你能亲口讲完它怎么补上的：入口收到 CONNECT 后不再自己拨目标，钩子把目标装进 CONNECT 帧递给远端；远端以自己的名义拨通目标、回一个 `00`，从此入口侧拆帧、远端侧装帧，两个方向各自一条 pipe。第 1 章全景图里的③④两步——「加密隧道 → 远端服务器 → 代访」的骨架——真正发生了；目标看到的连接来自远端。「教学版把它也搬进本机」的账也清了：三段线全住回环，形状一点不变。

你手里现在有了第三块零件：`startRelayServer` 与 `connectViaRelay`——两跳两端，外加加宽的 `onConnect` 钩子（回地址直连、交流当上级线，向后兼容）。可迁移的解法又多两件：先读长度再定边界的帧设计、把协议差异藏进转接头的接法——下一部分把它们直接接上加密。

概念去向地图：

- 这条链路裸奔的账——谁加密、防的是谁，下一章算；
- 明文帧换成密文帧——第 6 章，接缝本章已留好；
- 「怎么连」的钩子交给谁——第三部分的规则引擎按判决在这里选路：直连，或这条两跳线。

### 自查

1. 预测：浏览器以 ATYP=03 报来域名 `a.example`，入口照原文装进 CONNECT 帧发远端。这个名字最终在哪台机器上被换成 IP？教学版与真实部署的差别是什么？
2. 计算：载荷 `'hello via relay'`（15 字节）装进一条数据帧，头两个字节是什么？目标端口 4569 装进 CONNECT 帧，最后两个字节是什么？
3. 迁移：把端到端用例的钩子改成 `onConnect: (t) => t`（回到直连）。七条断言里哪几条会红、哪几条反而照常绿？这说明路径断言与数据断言各管什么？

::: details 参考答案与锚点
1. 在远端那台机器上：远端进程调 `connectTo` 时由它所在的系统解析名字（回查 4.3.3「域名照原文过境」与 4.4.4 的 `openConnect`）。教学版里远端与入口同机，解析仍发生「在远端进程里」，位置语义不变——差别只是地理距离（回查 4.3.1 的兑现段）。
2. 15 = 0x000F，数据帧头是 `00 0f`；4569 = 0x11D9，端口两字节是 `11 d9`（回查 4.3.3 的跟读示例与大端序乘加）。
3. 红：`a.connections()` —— 直连让 A 被拨一次，断言 0 失败；`b.connections()` —— B 不再被拨，断言 1 失败。照常绿：`seen`（钩子照样拿到点名目标）、REP 成功应答、`readUntil('TWO-HOP')` —— A 是大写回声，数据照样能通。数据断言证明「通了」，路径断言才证明「走了哪条线」（回查 4.4.6 的路径断言与 4.5 的开机）。
:::
