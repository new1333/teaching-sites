---
title: keep-alive：说完别挂电话
---

# keep-alive：说完别挂电话

压测报告很不体面：QPS 死活上不去，p99 延迟剧烈抖动。你盯着监控找了一圈，嫌疑最后落在一条不起眼的曲线上——服务器上处于 TIME_WAIT（挂断后的等待状态，下一节细说）的连接数，几秒钟内堆到了六万多。随后客户端开始集体报错「无法分配请求地址」（EADDRNOTAVAIL）。复盘原因更尴尬：测试客户端每一轮请求都新建 TCP 连接、用完立刻关，而服务端响应完也主动关——双方都在疯狂拨号、疯狂挂断，最后把本机的端口号用光了。

这笔账值得每个后端工程师亲手算一次，这一章我们就来算，然后给 tinysrv 装上 HTTP/1.1 的默认行为：**keep-alive**——说完一件事不挂电话，接着说下一件。你配过的 nginx.conf 里那行 `keepalive_timeout 65;`，管的就是这件事。

## 每次拨号多少钱

TCP 连接的建立要过三道手续，业界叫**三次握手**：客户端喊「我想通话」（SYN），服务器回「可以，我也准备好了」（SYN+ACK），客户端再确认「好，开始」（ACK）。一来一回一确认，三个包走完才算拨通。

关键在于这三个包要跑网络。同机房一个来回（RTT，往返时延）算 1 毫秒，跨城 30 毫秒，跨洲 200 毫秒——拨号的钱至少一个 RTT，而且这期间一个字节的业务数据都没传。你的接口本身只花 2 毫秒处理，却让客户端先花 30 毫秒拨号：十五倍的钱花在路上。此外新连接的发送速度还要从慢启动开始爬坡（TCP 怕压垮网络，新连接先小口发，确认没问题再加速），前面的请求永远在爬坡段。

算总账：一万个请求，keep-alive 是一万个请求的处理时间；不用 keep-alive 是一万个 RTT 加一万个慢启动，再加下面这笔更狠的——

## TIME_WAIT：挂电话的人要在原地多等一会儿

前面故障报告里的 TIME_WAIT 是什么？**TIME_WAIT**（等待关闭状态）——主动挂断的一方在挂断之后必须原地等待的一段时间（Linux 默认 60 秒）。为什么：万一最后的告别（最后一个 ACK）在路上丢了，对方还会重发「我要挂了」，你得还在场才能再回一句。同时这段等待让旧线路上迟到的旧包彻底死去，免得串到下一通同号码的电话里。

跟着算一遍它是怎么把端口用光的。客户端每个连接要占一个本地端口，可用端口约 6.4 万个；每个连接挂断后，它的端口要被 TIME_WAIT 扣满 60 秒才能复用。那么本机每秒新建连接的安全上限是 64000 ÷ 60 ≈ 1066 个。压测机打 2000 QPS？第一秒就把未来 30 秒的端口全预定了，第二秒的连接已经无号可用。这不是服务器不行，是拨号挂断太狠，把自己家门口的门牌号用光了。

解法顺理成章：别挂电话。HTTP/1.1 把 keep-alive 定为默认行为——响应头里那句 `Connection: keep-alive` 就是双方约定「这通电话先不挂」。但「不挂」给服务器出了两道新题：

- 总不能永远不挂。空闲多久算「这通电话已经聊完了」？——这正是第 2 章账本上 `lastActiveAt` 字段等的这一天：空闲超时，收割，挂断。
- 对方明确要挂怎么办？客户端发 `Connection: close` 就是那句「说完这句我挂了」，服务器应该痛快配合，别纠缠。

## 动手：组装层把这些拼起来

到上一章为止，tinysrv 有了账本（连接注册表）和认字的器官（解析状态机），但它们还没见过面。这一章的代码增量是新增组装层 `src/server.ts`，外加给账本行的 `ManagedConn` 长出一个 `write` 方法——接口只增不破，第 2 章的测试原样全绿就是证明。

先看连接建立与数据路由。注意那个 `parsers` Map——每条连接一个解析器，因为半包的记忆属于这条连接自己，两条连接的字节流不能混在一起：

```ts
// src/server.ts · createConnRegistry 与 createHttpParser 的会师（拼版：respond 见下一块）
export function createServer(opts: ServerOptions): TinyServer {
  const now = opts.now ?? Date.now
  const registry: ConnRegistry = createConnRegistry({
    maxConns: opts.maxConns,
    idleTimeoutMs: opts.keepAliveTimeoutMs ?? 75_000, // nginx 默认 75 秒
    now,
  })

  // 每条连接一个解析器：半包记忆属于连接，不共享
  const parsers = new Map<number, HttpParser>()
  const sockets = new Set<net.Socket>()

  let accepted = 0
  let handled = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))

    const r = registry.add(sock)
    if (!r.ok) {
      sock.destroy() // 满员：不入账，直接请回
      return
    }
    accepted++
    parsers.set(r.conn.id, createHttpParser())
  })

  registry.onClose((conn) => {
    parsers.delete(conn.id) // 销账时连解析器一起清，不留尸体
  })

  registry.onData((conn, chunk) => {
    const parser = parsers.get(conn.id)
    if (!parser) return
    for (const ev of parser.feed(chunk)) {
      if (ev.type === 'error') {
        conn.destroy() // 解析失败的连接不可信任，请回
        return
      }
      respond(conn, ev.head)
    }
  })

  // ……respond 与对外接口的实现见下
}
```

三件旧家什各就各位：连接来了入账，顺手给它配一个解析器；数据到了，解析器催熟出请求就交给 `respond`；连接没了，账本销账，解析器跟着销毁——`registry.onData` 里那行续命记账（第 2 章埋的）现在自动生效：每来一个请求，连接的空闲计时就归零一次。**keep-alive 的超时判定，一个字的新代码都不用写**，它就是账本的空闲收割换了个名字。

再看 `respond`——keep-alive 的另一半语义在这里：响应照常回，但要不要挂电话听对方的：

```ts
// src/server.ts · respond
function respond(conn: ManagedConn, head: RequestHead): void {
  handled++
  const res = opts.handler(head)
  // HTTP/1.1 默认不挂电话；对方明确说了 close 才挂
  const keepAlive = head.headers['connection'] !== 'close'
  const statusText = res.status === 200 ? 'OK' : 'STATUS'
  const headText =
    `HTTP/1.1 ${res.status} ${statusText}\r\n` +
    `Content-Length: ${Buffer.byteLength(res.body)}\r\n` +
    `Connection: ${keepAlive ? 'keep-alive' : 'close'}\r\n` +
    `\r\n`
  conn.write(new TextEncoder().encode(headText + res.body))
  if (!keepAlive) conn.destroy() // 说完这句就挂
}
```

响应头里回写 `Connection: keep-alive`，是向对方确认「我没挂，你也别挂」。对方说了 `close`，就回写 `close` 并在说完后挂断——干脆，不半推半就。

第 3 章埋的那颗种子此刻发芽：解析器解析完一个请求后状态回到起点，等同一连接上的下一个请求——它天生就是为 keep-alive 设计的。组装层只是把「解析器吐出下一个请求」接到「再调一次 handler」上而已。

## 验证

进 `companion/` 跑 `pnpm test`：

```text
✓ tests/keepalive-reuse.test.ts (4 tests) 40ms
✓ tests/http-parser-state-machine.test.ts (10 tests) 6ms
✓ tests/connection-registry.test.ts (7 tests) 241ms
Test Files  3 passed (3)
     Tests  21 passed (21)
```

本章 4 个断言里最承重的一条：同一个 TCP 客户端连发三个请求，`srv.acceptedCount()` 是 1、`srv.requestCount()` 是 3、连接在第三次响应后仍然活着——三次说话，一次拨号。TIME_WAIT 那笔账在测试里直接消失：根本没有产生新的挂断。空闲超时用例验证了另一头：注入假时钟，时间前进十秒，`tick()` 收割一条空闲连接，客户端侧如约等到挂断（close 事件）；`Connection: close` 用例验证配合挂断——响应头回写 close，说完就挂。

第一部分到此收束：单线程怎么同时管住一万个连接（账本）、怎么从字节流里认出请求（状态机）、怎么让一条连接说很多句话（keep-alive）。第二部分转向三根工程支柱——内存怎么拿怎么还最省事、你写过的配置文件怎么变成行为、一群进程怎么协作不添乱。

## 读完本章，你该能回答

- 三次握手的花费为什么和接口处理时间无关？慢启动为什么对短连接格外亏？
- TIME_WAIT 是谁在等？等多久？为什么这笔账最终变成了「端口耗尽」？
- keep-alive 的超时判定为什么不用写新代码？它复用了账本的哪个机制？
- 对方发 `Connection: close` 时服务器应该做什么？
