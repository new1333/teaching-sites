---
title: SOCKS5：一个字节级的入口协议
---

# SOCKS5：一个字节级的入口协议

## 3.1 前情：一个只会一种话的入口

上一章末尾留了一句账：HTTP 入口只听得懂 HTTP 的两种说法——absolute-form 的信与 CONNECT 的隧道，别的协议一概不认。这一章就来清这笔账，写一个通用的入口。三个问题把线头接起来：

- HTTP 入口靠什么知道「去哪」？——请求行里的绝对地址形式，或 CONNECT 那一行。两处都是 HTTP 报文的一部分：它必须读懂数据本身。
- CONNECT 应答 200 之后，你的代理在干什么？——闭眼搬运，一个字节都不看。这个「只搬不看」的形态本章会原样再见。
- 浏览器为什么肯找它？——因为浏览器读了系统代理的告示牌，而且恰好说的是 HTTP。命令行里那些不说 HTTP 的工具，它就无能为力了。

第三问正是上一章的边界：入口会的话太单一。SOCKS5 就是补上这门通用语的那块砖。

## 3.2 半截乱码：一次 data 事件的误会

先看你写第一版时的样子。你按「收到一条消息处理一条」的直觉写 SOCKS5 服务器——`on('data')` 来一次就解析一次，处理完把手头的缓冲清空。逻辑干净，跑起来却翻车。

翻车现场是这样的。你写了个联调小客户端（本章测试正是这么拼的），把握手和 CONNECT 两步接连 write 出去——两次 write 在路上并成一段字节到达，`on('data')` 只触发一次。你的代码处理完第一步，把剩下的半截当成垃圾清掉了。于是握手谈完，CONNECT 永远等不到。入口手里那几个字节成了没人认领的缓冲区乱码，连接挂到超时才断。

（真实的 curl 会老老实实等每一步的回话再走下一步，3.5 你会亲眼看到这个锁步节奏；但那是客户端的自觉，不是 TCP 的承诺——你自己的客户端、或网络中转的合并与拆分，随时可能不按自觉出牌。）

死因一句话：TCP 给你的是字节流，不是消息队列。「消息」这一层，TCP 从来没答应过你——两次 write 可能并成一个包到，一条消息也可能被切成两半到。这一章就从这半个消息写起：先学会 SOCKS5 的字节暗号，再写一台不怕拆包的机器。

## 3.3 原理：一门只有十六个字节常用语的语言

### 3.3.1 为什么需要 SOCKS5

HTTP 入口的两个死穴。其一，它只听得懂 HTTP：想走代理的 SSH 客户端、邮件客户端、数据库驱动，说的都不是 HTTP，进门就露馅。其二，明文路径上它是当事人：改写请求行、重建 Host，一个字都错不得。通用入口需要一门小得多的语言——客户端只说「带我去 host:port」，说定之后这条 TCP 连接上就只剩任意字节。

SOCKS5（SOCKS Protocol Version 5）——一个字节级的代理协议：先握手谈认证方式，再报目标地址，成功之后透传任意字节。它 1996 年由 RFC 1928 定稿，是这门课里最老的标准之一。Clash 配置里那个 `mixed-port`（一个端口同时听 HTTP 代理与 SOCKS5）的后一半，本章写完就有了。

锚点一句话：字节协议像按固定暗号表拍电报——每个位置的字节是什么意思，双方提前约定，电报员不需要读懂内容。HTTP 报文是写给人的信，SOCKS5 是发给机器的暗号。

### 3.3.2 字节协议：没有分隔符，只有位置

第 2 章的 HTTP 头是文本协议——可以按 `\r\n` 拆行、按冒号拆字段，因为它的设计目标之一是人类可读。字节协议（binary protocol）——报文里没有「行」，没有分隔符，只有位置：第 0 个字节是什么、第 1 个字节是什么，全靠双方约定的一张表。

为什么放弃可读性？反事实算一下：文本形式里，任何字节的值都可能撞上分隔符，于是需要一套转义规则；暗号形式里，位置就是意义，任何字节值都合法出现，永远不需要转义。解析也因此便宜——数到第几个字节，就知道它在哪个字段里。代价是肉眼没法直接读，所以这一章的载体全是结构表。

### 3.3.3 三幕对话与字节布局

一场 SOCKS5 对话共三幕：握手谈方法，CONNECT 报目标，应答之后透传。先挂两个新词的号，再看表。目标地址类型（ATYP）——CONNECT 请求第 3 个字节，声明目标写的是 IPv4、域名还是 IPv6，地址段怎么读全看它。锚点：同一张门牌的三种写法——四字节数字编号、带长度的名字、十六字节数字编号。大端序（big-endian）——多字节数字的排法：高位字节在前，端口 80 写成 `00 50`，与书写数字的习惯一致（最高位写在左边）。这是全网统一的「网络字节序」，3.3.4 细算。

第一幕，握手。客户端报会哪些认证方法，服务端挑一个。

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0 | VER | 固定 `05`，也是服务器的第一道关卡 |
| 1 | NMETHODS | 我会的方法有几种 |
| 2 起，共 N | METHODS | 每种一字节：`00` 无认证，`01` GSSAPI（企业内网一类认证办法），`02` 用户名密码 |

服务端回两个字节：VER 加选中的方法编号。教学版只会无认证，于是回 `05 00`；一个都谈不成时回 `05 ff` 并收线。

第二幕，CONNECT 请求。

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0 | VER | `05` |
| 1 | CMD | `01` CONNECT；`02` BIND（接收服务端反连，FTP 老用法）；`03` UDP ASSOCIATE（UDP 转发）。教学版只做 `01` |
| 2 | RSV | 保留位，必须 `00` |
| 3 | ATYP | `01` IPv4；`03` 域名；`04` IPv6。教学版不做 `04` |
| 4 起 | DST.ADDR | 目标地址，长度看 ATYP |
| 末 2 字节 | DST.PORT | 目标端口，大端序 |

DST.ADDR 的三种装法，是整张表的心脏。

- ATYP=01，IPv4：定长 4 字节，四个数字各占一字节。
- ATYP=03，域名：1 字节长度加域名原文，没有结尾符——多长，读那 1 字节才知道。
- ATYP=04，IPv6：定长 16 字节，教学版不实现。

第三幕，服务端应答，定长 10 字节。

| 字节位 | 字段 | 值与含义 |
| --- | --- | --- |
| 0 | VER | `05` |
| 1 | REP | `00` 成功；`01` 一般性失败；`07` 命令不支持；`08` 地址类型不支持 |
| 2 | RSV | `00` |
| 3 | ATYP | 固定 `01` |
| 4–7 | BND.ADDR | 约定上应回报实际接驳门牌；教学版固定 `0.0.0.0`（差异清单见附录） |
| 8–9 | BND.PORT | 同上，教学版固定 `00 00` |

REP 是 `00` 时，从这一刻起这条连接对入口只剩一件事——与第 2 章 CONNECT 隧道开通后的那一态一模一样。

把三幕拼成一次完整对话。以测试里那条 CONNECT（域名 `mini.example`、端口 80）为例，线上字节一字排开是这样。

```text
05 01 00                        客户端握手：版本 5；会 1 种方法；00 = 无认证
05 00                           服务端选定：无认证
05 01 00 03 0c 6d 69 6e 69 2e 65 78 61 6d 70 6c 65 00 50    CONNECT：by 域名
```

跟着读第三行：`05` 版本、`01` CONNECT、`00` 保留位、`03` 域名形态、`0c` 名字长 12、中间十二个字节逐字翻回就是 `mini.example`（`2e` 是句点）、收尾 `00 50` 是端口 80 的大端序。反向出题：`05 01 00 01 7f 00 00 01 1f 90` 在请求去哪？——IPv4 形态的 127.0.0.1:8080，`7f` 就是 127，`1f 90` 就是 8080。

### 3.3.4 大端序：8080 怎么拆成两个字节

端口最大 65535，一个字节装不下（0–255），所以要拆成两个。拆法本身没悬念，悬念在顺序：先发高位还是先发低位？

大端序（big-endian，网络字节序）——多字节数字高位字节在前的排法，也就是 TCP/IP 全家统一采用的约定。端口 8080 十六进制写作 0x1F90，按大端序上线就是 `1f 90`。跟着算一遍，两端各读一次：

- 入口读回：`0x1f × 256 + 0x90` = 31 × 256 + 144 = 8080。对。
- 若有人按低位在前读：`0x90 × 256 + 0x1f` = 144 × 256 + 31 = 36895。门牌全错。

为什么是大端不是小端？诚实说，这是 TCP/IP 早期实现定下、后来由互联网编号总册（RFC 1700）追认的约定，「网络字节序即大端」是成文的标准。它的价值不在大端本身，而在统一：反事实如上——两边各按各的读，同一个 `1f 90` 会读出两个门牌。RFC 1928 明文规定 DST.PORT 与 BND.PORT 都用这个字节序，所以结构表里那 2 字节没有第二种读法。

### 3.3.5 半个消息：字节协议怎么画边界

现在回头看 3.2 的乱码，病根找到了。CONNECT 请求的长度不固定：固定头 4 字节之后，地址多长要看 ATYP；ATYP=03 时还得先读到第 5 个字节，才知道整条消息到哪儿结束。换句话说，**这条消息的总长度，要读到半路才揭晓**。

这里藏着本章要证伪的误区。你可能以为 TCP 收到的是「一条条消息」——write 一次是一条，recv 一次也是一条，像从信箱取信。持有这个直觉的人会这样写解析器：来一次 data 事件，处理一条消息，清空缓冲。3.2 的乱码就是这么来的。

证伪只需要两台实验，全在本章测试里。其一，把握手、CONNECT、首批载荷挤在同一次 write 里发出——三段并成一个 TCP 段（TCP 一次运送的一箱字节）到达，入口照样得把三段各归各位。其二，把一条 CONNECT 切在 ATYP 那格后面——前 4 字节先到，服务器此时连「这条消息多长」都算不出来，只能按兵不动。TCP 的承诺只有一条：字节按序、不丢不重地到达。切分，是协议自己的事；HTTP 用空行加 Content-Length，SOCKS5 用位置加长度字节——「先读长度、再定边界」这一招，第 4 章写帧时还会当主角。

### 3.3.6 解法：累积缓冲加状态机

教科书答案两件套，缺一不可。**累积缓冲**——到达的字节全部先拼进一段缓冲，够消费一段就消费一段，剩下的原地等待下文。**状态机**——记录这条连接此刻进行到哪一步（握手？等请求？拨号中？中继？），同一个字节在不同步骤里意义不同：握手期的第 2 个字节是方法表开头，请求期的第 2 个字节是 CMD。

反事实检验状态机为什么不可省。假如没有状态、只按「缓冲开头是什么」解析，同一串开头就会出现两套读法：握手应答刚发完、CONNECT 头 4 字节刚到时，缓冲开头是 `05 01`——按握手规则它是「版本 5、1 种方法」，按请求规则它是「版本 5、CONNECT」。同一段字节两种读法，必须有人记住现在该按哪种读。那个记住的东西，就是状态。3.4 把这两件套落成代码。

## 3.4 演练：把暗号表写成代码

实验场开工。`src/socks5.ts` 是实现，`tests/socks5-server.test.ts` 是裁判——照旧测试先写、先跑出红（模块不存在，加载即失败），再写实现转绿。门槛命令照旧：`cd companion && npm run typecheck && npm test`，本章共 8 条用例。

对外只开一个口：`startSocks5Server({ port, onConnect })`。`onConnect` 与第 2 章的 `connectTarget` 同构——把「想去哪」翻译成「实际连谁」，缺省直连，规则引擎接管分流时在这里改写出口。目标的形状直接沿用 `ProxyTarget`（host 加 port），文件里那行 `import type` 只借形状、不带运行时依赖。

```ts
// src/socks5.ts · 对外形状
// 「客户端想去哪」→「实际连谁」的翻译钩子，与第 2 章的 connectTarget 同构；
// 规则引擎接管分流时，在这里按目标判决改写出口。
// 第 4 章起还允许交回一条已接通的流（两跳的中继转接头）：回地址 = 直连（旧语义不变），
// 交回流 = 入口直接拿它当上游线——「怎么连」也归钩子管。
export type SocksConnectHook = (requested: ProxyTarget) => ProxyTarget | Duplex | Promise<ProxyTarget | Duplex>

export interface Socks5ServerOptions {
  port: number // 0 = 请系统随手分一个空闲端口
  host?: string
  onConnect?: SocksConnectHook
}

export interface Socks5ServerHandle {
  port: number
  close(): Promise<void>
}
```

类型里那个 `Duplex` 是后来两跳一章加宽进来的一格——Node 对「一根能读能写的管道」的统称，`net.Socket` 就是它的子类。加宽后钩子还可以交回一条已接通的流（两跳的中继转接头），回地址的老用法一字不变；本章读完你自然会用得上它。

### 3.4.1 暗号表与应答骨架

协议里的固定编号先集中列队——这张代码里的表，就是 3.3.3 那两张结构表的另一半。

```ts
// src/socks5.ts · 编号常量与 reply 骨架
// 报文里的固定编号（裁判是 RFC 1928）
const VER = 0x05 // 版本号：每段报文的第一个字节，也是服务器的第一道关卡
const METHOD_NOAUTH = 0x00 // 认证方法编号：0 = 无认证（教学版只会这一种）
const CMD_CONNECT = 0x01 // 命令编号：1 = CONNECT（替我接通目标）
const ATYP_IPV4 = 0x01 // 目标地址类型：1 = IPv4，地址段定长 4 字节
const ATYP_DOMAIN = 0x03 // 目标地址类型：3 = 域名，地址段 = 1 字节长度 + 域名原文
const REP_SUCCESS = 0x00 // 回执：成功
const REP_GENERAL = 0x01 // 回执：一般性失败（目标接不通之类的统称）
const REP_COMMAND = 0x07 // 回执：命令不支持（BIND / UDP ASSOCIATE 教学版不做）
const REP_ATYP = 0x08 // 回执：地址类型不支持（IPv6 教学版不做）

// 应答骨架：VER REP RSV ATYP=IPv4 + BND.ADDR(0.0.0.0) + BND.PORT(0)，定长 10 字节。
// RFC 语义上 BND 两格应回报「实际接驳的门牌」，教学版固定回 0——主流客户端不检查（差异清单见附录）
function reply(rep: number): Buffer {
  return Buffer.from([VER, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
}
```

### 3.4.2 解析 CONNECT：一张三岔的判定

解析器只做一件事：看缓冲里够不够长、对不对暗号，然后给出三种判决之一。这正是 3.3.5 那道边界难题的全部代码形态。

```ts
// src/socks5.ts · parseConnectRequest
// 解析 CONNECT 请求。三种结局：还不够长（等下一批字节）/ 协议错误（带回执码）/ 完整（拿到目标）
type ParsedRequest =
  | { kind: 'short' }
  | { kind: 'rep'; rep: number }
  | { kind: 'ok'; target: ProxyTarget; consumed: number }

function parseConnectRequest(buf: Buffer): ParsedRequest {
  if (buf.length < 4) return { kind: 'short' } // 连 ATYP 那格都没到，地址多长无从谈起
  if (buf[0] !== VER || buf[2] !== 0x00) return { kind: 'rep', rep: REP_GENERAL } // RSV 必须为 0
  if (buf[1] !== CMD_CONNECT) return { kind: 'rep', rep: REP_COMMAND }
  const atyp = buf[3]
  let addrEnd: number // 地址段的终点：走到哪儿，端口那 2 字节才从哪儿开始
  if (atyp === ATYP_IPV4) {
    addrEnd = 8 // 4（固定头）+ 4（四个数字各占一字节）
  } else if (atyp === ATYP_DOMAIN) {
    if (buf.length < 5) return { kind: 'short' } // 域名长度那一格自己还没到
    addrEnd = 5 + buf[4] // 4（固定头）+ 1（长度）+ N（域名原文，没有结尾符）
  } else {
    return { kind: 'rep', rep: REP_ATYP } // 含 IPv6（4）：教学版不做
  }
  const total = addrEnd + 2 // 尾上还有 2 字节端口
  if (buf.length < total) return { kind: 'short' }
  const host =
    atyp === ATYP_IPV4
      ? Array.from(buf.subarray(4, 8)).join('.') // 四个字节就是四个数字，拼回点分形式
      : buf.subarray(5, addrEnd).toString('latin1')
  const port = buf.readUInt16BE(addrEnd) // 大端序读回：高位字节在前
  return { kind: 'ok', target: { host, port }, consumed: total }
}
```

对照 3.3.3 的表逐行看。三处 `short` 是三道「不够长」关卡——固定头没到、域名长度那格没到、端口没到齐，一处一道，缺一不可。`readUInt16BE` 里的 BE 就是 big-endian：Node 替你做了「高位在前」那次乘加。IPv4 那行把四个字节拼回点分形式，`127.0.0.1` 上线时本来就是 `7f 00 00 01` 四个数字。`consumed` 记下整条请求吃掉了几个字节——吃剩的留给后面，一字节不丢。

### 3.4.3 一条连接的一生：四态加收摊

`handleClient` 承包一条连接。先看它的状态与家当。

```ts
// src/socks5.ts · handleClient 的连接状态
// 一条客户端连接的一生：greeting（谈方法）→ request（读 CONNECT）→ dialing（拨号中）→ relay（中继）；dead = 已收摊
type Phase = 'greeting' | 'request' | 'dialing' | 'relay' | 'dead'

function handleClient(client: net.Socket, hook?: SocksConnectHook): void {
  let buffered = Buffer.alloc(0) // 累积缓冲：还没认领的字节全在这，到齐一段消费一段
  let phase: Phase = 'greeting'
  let upstream: Duplex | null = null // 接通后的上游线：直连的 socket 或两跳的中继转接头，对入口都是一根管子

  const fail = (msg: string) => {
    console.error(`[socks5] ${msg}`)
    client.destroy()
    upstream?.destroy()
  }
```

`buffered` 就是 3.3.6 说的累积缓冲。`phase` 是状态机：前四个工作态顺着连接的一生走，`dead` 是回完最后一句收摊话之后的坟场。拨号是异步的，`dialing` 这一态就是为了在等目标接通时管住嘴——新到的字节只进缓冲、不再解析。

接通之后是中继，加上拨号的两种结局。

```ts
// src/socks5.ts · openRelay 与 openConnect
  // 中继：两侧对接，双向只搬字节——与第 2 章 CONNECT 应答之后的隧道同一形态
  const openRelay = (remote: Duplex) => {
    upstream = remote
    remote.on('data', (b) => client.write(b))
    remote.on('error', (e) => fail(`目标连接出错：${e.message}`))
    remote.on('close', () => client.end())
    client.write(reply(REP_SUCCESS))
    if (buffered.length > 0) remote.write(buffered) // 拨号期间提前到的载荷：一并送去，一个不丢
    buffered = Buffer.alloc(0)
    phase = 'relay'
  }

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

`openRelay` 里那句「拨号期间提前到的载荷一并送去」，正是 3.2 那半截乱码的解药之一：字节提前到了不丢、不误读，攒着，等该它们出场的一刻。`openConnect` 里那道三岔是后来两跳一章加宽的：回地址照旧直连，交回已接通的流就直接当上游线。拨号走 `connectTo`——net.connect 的 Promise 包装，第 2 章首见；本章与第 2 章各自那份一模一样的重复，后来在两跳一章合并进共用模块 `src/dial.ts`，本文件现在从那里 import。

最后是泵——每来一批字节，问一次「以手头的缓冲能走到哪儿」。

```ts
// src/socks5.ts · pump 与数据入口
  // 状态机泵：每来一批字节问一次「以手头的缓冲，能往前走到哪儿」——走不动就回来等下文
  const pump = () => {
    if (phase === 'dead') return
    if (phase === 'greeting') {
      if (buffered.length < 2) return // 方法个数那一格还没到
      if (buffered[0] !== VER) return fail('不是 SOCKS5（版本号不是 5）')
      const n = buffered[1]
      if (buffered.length < 2 + n) return // 方法列表还没到齐
      const methods = buffered.subarray(2, 2 + n)
      buffered = buffered.subarray(2 + n)
      if (!methods.includes(METHOD_NOAUTH)) {
        client.end(Buffer.from([VER, 0xff])) // 谈不拢：FF = 没有可接受的方法
        phase = 'dead'
        return
      }
      client.write(Buffer.from([VER, METHOD_NOAUTH])) // 选定无认证
      phase = 'request'
    }
    if (phase === 'request') {
      const parsed = parseConnectRequest(buffered)
      if (parsed.kind === 'short') return // 半个请求：留在缓冲里等下文
      if (parsed.kind === 'rep') {
        client.end(reply(parsed.rep)) // 回执之后这场对话就结束了
        phase = 'dead'
        return
      }
      buffered = buffered.subarray(parsed.consumed) // 剩余字节可能是提前到的载荷，拨通后一并送
      phase = 'dialing'
      void openConnect(parsed.target)
    }
  }

  client.on('data', (chunk) => {
    if (phase === 'relay') {
      upstream?.write(chunk) // 中继态：一个字节都不看
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
  client.on('error', (e) => fail(`客户端连接出错：${e.message}`))
  client.on('close', () => upstream?.destroy())
```

两个结构决定读它。其一，`pump` 里是两个顺序的 `if`，不是 `else if`——握手刚好消费完、缓冲里还压着 CONNECT 时，同一次调用要接着往下走，两个半消息同包到达就靠这一点接住。其二，所有「不够长」的分支都只是 `return`，字节留在缓冲里原封不动——状态机不着急，字节流早到晚到都认。

开机件与第 2 章同款：`net.createServer` 每连接一个 `handleClient`，`sockets` 集合管收摊，`close()` 先拆连接再关监听。

```ts
// src/socks5.ts · startSocks5Server
export function startSocks5Server(opts: Socks5ServerOptions): Promise<Socks5ServerHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      handleClient(client, opts.onConnect)
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

测试一侧值得看的是「测试自己当客户端」——拼装函数按 RFC 的字节布局手写报文，大端序那两笔 `port >> 8` 与 `port & 0xff` 就是 3.3.4 的乘加拆解。

```ts
// tests/socks5-server.test.ts · 报文拼装
// CONNECT + IPv4 目标：地址段就是四个数字各占一字节，端口按大端序拆两字节
function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([VER, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

// CONNECT + 域名目标：1 字节长度 + 域名原文，没有结尾符
function connectDomain(host: string, port: number): Buffer {
  const name = Buffer.from(host, 'latin1')
  return Buffer.from([VER, 0x01, 0x00, 0x03, name.length, ...name, port >> 8, port & 0xff])
}
```

8 条用例各守一个行为：成功路径十字节应答一字不差、域名分支（`connectDomain`）、三段同包、半截请求按兵不动、方法谈不拢回 FF、目标接不通回 01、BIND 回 07、版本不对直接收线。全部通过后，整机两百行上下。

教学简化声明（登记进差异清单附录）：只实现 CONNECT，BIND 与 UDP ASSOCIATE 一律回 07；认证只谈无认证，其余回 FF；ATYP 不做 IPv6，一律回 08；成功应答的 BND.ADDR 与 BND.PORT 固定回 0；目标接通失败不区分原因，统一回 01。

## 3.5 验证：亲手开机

**开机。** 进 `companion/` 跑 `npm run demo:socks5`。应看到两行监听信息——目标站端口与 SOCKS5 入口端口——加一条拼好的 curl 命令。全部角色照旧住在回环地址上，实验不出你这台机器。

另开一个终端照跑那条命令，形如 `curl --socks5-hostname 127.0.0.1:{入口端口} http://127.0.0.1:{目标端口}/`。`--socks5-hostname` 是 curl 的说法——名字交给入口去解析；换成 `--socks5`，则是 curl 自己在本机解析好、只把 IP 发过去。两种写法都应看到响应正文。

```text
<html><body><h1>hello via socks5</h1></body></html>
```

一个容易猜错的细节：URL 里写的是数字 IP，curl 一看便知没有名字要解析——即便你加了 `--socks5-hostname`，发的也是 ATYP=01 的 IPv4 形态。域名分支要用真正的名字才触发：把命令里的主机换成 `localhost` 再跑一次，页面照样出来，这次入口收到的就是 ATYP=03、host 为 `localhost`，由入口在本机把名字换成回环地址再拨号。

**先猜后跑（亲眼看见字节）。** 想亲眼看 curl 发出的原始字节，就立一个「只听不接」的假入口。先猜两个数：握手里 curl 报几种方法？CONNECT 的 ATYP 是 01 还是 03？然后把下面几行存成 `tap.mjs`，在 companion 目录跑 `node tap.mjs`。

```js
// 用法示例：tap.mjs —— 假入口：应答握手后打印收到的 CONNECT，随即收摊
import net from 'node:net'
const srv = net.createServer((s) => {
  let greeted = false
  s.on('data', (b) => {
    if (!greeted) {
      greeted = true
      console.log('握手:', b.subarray(0, 2 + b[1]).toString('hex'))
      s.write(Buffer.from([0x05, 0x00]))
      return
    }
    console.log('CONNECT:', b.toString('hex')) // 对照 3.3.3 的表逐字节读
    s.destroy()
    process.exit(0)
  })
})
srv.listen(0, '127.0.0.1', () => console.log('假入口端口:', srv.address().port))
```

另开一个终端让 curl 找它（端口用 tap 打印的那个，`--max-time 1` 让 curl 别苦等）。

```text
curl --socks5-hostname 127.0.0.1:{假入口端口} http://localhost:9/ --max-time 1
```

应看到握手是 `05020001`——curl 报了两种方法（00 无认证、01 GSSAPI），比结构表里的示例阔气（你的 curl 若只报一种方法，输出是 `050100`——一样按表读）；CONNECT 是 `05010003096c6f63616c686f73740009`——ATYP=03、长度 9、那串 `6c 6f …` 逐字翻回正是 `localhost`，端口 9 写作 `00 09`。再把 URL 换回数字 IP 跑一遍，对照看 ATYP 变回 01。

**先猜后跑（握手回话）。** 跑之前先写下预言：入口对握手那句 `05 01 00`，回哪两个字节？十六进制写出来。然后把下面几行存成 `probe.mjs`（端口换成 demo 打印的入口端口），在 companion 目录跑 `node probe.mjs`。

```js
// 用法示例：probe.mjs —— 亲手向入口说第一句暗号
import net from 'node:net'
const s = net.connect({ port: 4083, host: '127.0.0.1' }) // 换成 demo 打印的入口端口
s.on('connect', () => s.write(Buffer.from([0x05, 0x01, 0x00]))) // 版本 5，会 1 种方法：无认证
s.on('data', (b) => {
  console.log(b.toString('hex')) // 对照 3.3.3 的表读这两个字节
  s.destroy()
})
```

应看到 `0500`——版本 5，选定无认证。这正是测试里 `readExact(client, 2)` 抓到的那两字节。

**先猜后跑（指认破坏）。** 打开 `src/socks5.ts`，把 `addrEnd = 5 + buf[4]` 改成 `addrEnd = 4 + buf[4]`——域名长度少读一格。先猜：8 条用例里哪几条会红、哪几条照常绿？写下答案再跑 `npm test` 验证。预期变红的是「ATYP=3 域名」与「半个请求」两条：少读一格，域名少一个字、端口读错一位，钩子拿到的 host 对不上原串；IPv4 用例根本不经过这行，照常绿。改完记得改回来，8 条应全绿。

## 3.6 收束：暗号、缓冲、状态

回到开头那半截乱码。现在你能亲口讲清它的身份：那不是乱码，是 CONNECT 的前几个字节，提前到了。第一版的错不在「读了垃圾」，而在它假设「一次 data 事件等于一条完整消息」——处理完就清缓冲，把下一状态的全部输入丢了。累积缓冲把没人认领的字节留住，状态机知道它们是谁；握手与 CONNECT 同包到达时 `pump` 接着往下走，请求被切两半时它按兵不动。半个消息，两种长相，一台机器全接住了。

你手里现在有了第二块零件：`startSocks5Server`——握手、CONNECT、ATYP 两分支、成功应答、双向中继，`onConnect` 钩子给将来的分流决策留了口。更值钱的是那套可迁移的解法：结构表读字节协议、累积缓冲加状态机切消息、大端序乘加读多字节数字——写帧那一章会原样复用。

概念去向地图：

- 中继与帧：现在入口对每条连接都直连目标，「两跳链路」把这一跳搬到目标可达的位置——第 4 章当主角；
- 这条链路眼下完全明文，谁加密、防的是谁——第 5 章算账。

### 自查

1. 预测：3.5 的 tap 实验里，把 URL 的 host 从 `localhost` 换成数字 IP `127.0.0.1`，CONNECT 那行字节会怎么变？换到一台把 localhost 解析成 `::1` 的机器上，又会发生什么？
2. 计算：端口 443 按大端序写成哪两个字节？若接收方按低位在前读，读出多少？
3. 迁移：客户端把 greeting、CONNECT、一段载荷拼在一次 write 里发出。从 `client.on('data')` 进入开始，按顺序说出这段字节被谁、在哪几步消费掉。

::: details 参考答案与锚点
1. 换成 `127.0.0.1`：无名可解析，ATYP 直接是 `01`，地址是四字节 `7f 00 00 01`（3.5 正文正是这么对照的）。若 localhost 被本机解析成 `::1`，curl 会发 ATYP=04（IPv6 十六字节地址）。教学版不支持、回 REP=08 拒之门外——差异清单里那格「不做 IPv6」，在这台机器上真的会撞上（回查 3.5 与差异清单附录）。
2. 443 = 0x01BB，大端序写 `01 bb`；读反了变成 0xBB01 = 187 × 256 + 1 = 47873（回查 3.3.4 的乘加）。
3. 三段先一起进 `buffered`；第一次 `pump` 走完 greeting 消费掉 3 字节、phase 变 request，同一次调用继续解析 CONNECT 消费 4+N+2 字节、phase 变 dialing；剩下的载荷留在缓冲，`openRelay` 接通后 `remote.write(buffered)` 一并送出（回查 3.4.3 的 `pump` 与 `openRelay`）。
:::
