---
title: 连接注册表：把连接当成一等公民管理
---

# 连接注册表：把连接当成一等公民管理

你的服务挂着上万个连接，跑得好好的。周五下午，产品经理提了个听起来人畜无害的需求：「那些空闲超过 30 秒的连接，先发个警告日志，然后关掉，别让它们白占着资源。」

你满口答应，回到工位翻代码，然后愣住了。要实现这个需求，你得先回答三个问题：现在到底挂着多少个连接？每个连接最后一次活跃是什么时候？想关掉某一批连接时，去哪里找到它们？

这三个问题，一个都答不上来。连接在代码里只是一次回调的参数——`server.on('connection', (socket) => { ... })`，你在这个回调里挂上事件处理，然后这个连接对象就散落在闭包里，再也没有人统一见过它。没有名册、没有账本、没有任何地方能回答「我的服务器此刻替谁保持着连接」。需求估了一天，实际光找连接在哪就找了两天。

这不是你一个人的遭遇。事件驱动架构把「叫醒」这件事解决了——第 1 章的大爷会告诉你谁有动静——但叫醒之后的管理，它不管。这一章我们给 tinysrv 打第一块地基：**连接注册表**，一本所有连接的账。nginx 里同样的东西叫连接表，它的高效运维（限连接数、空闲超时、优雅关闭）全部建立在这本账上。

## 先认识主角：程序里的电话机

写业务代码时你从没碰过它，因为 `fetch` 把它包得太好了。现在要自己管连接，得先认识它。

**套接字**（socket）——程序世界里的一部电话机。你的程序不能直接伸手进网卡抓数据，网卡归操作系统管；操作系统把它包装成一套统一的门：想通过网络跟别人收发数据，先领一部这样的「电话机」，拨通之后对它读和写，剩下的路由、重传、排队全由操作系统替你跑腿。一部拨通中的电话机，对应一条 **TCP 连接**（TCP 是网络上最常用的传输协议，保证数据按序、完整地到达）——两个人之间的通话线路。

在 Node 的 `net` 模块里，这部电话机的类型叫 `net.Socket`。连接建立后，它对我们有用的部分少得惊人：

```ts
// 用法示例：一部 net.Socket 的可用面
socket.on('data', (chunk) => { /* 对方说话了，chunk 是这段话的字节 */ })
socket.on('close', () => { /* 挂断了，这条线路结束了 */ })
socket.write(bytes)   // 对着话筒说话
socket.destroy()      // 强行挂断
socket.remoteAddress  // 对方的号码（IP）
socket.remotePort     // 对方的分机号（端口）
```

就这些。事件驱动服务器的一切文章，都做在这几个成员上。

## 账本要记哪几栏

回头看那三个答不上来的问题，账本该记什么就自然浮现了。「挂着多少连接」——账本要能数行数；「谁最后活跃在何时」——每行要有一个「最后活跃时刻」栏，而且必须在每次数据到达时刷新（续命）；「去哪找到一批连接」——账本得能按条件筛选。再加一条第 1 章埋下的伏笔：文件描述符是有限资源，账本要在人数满时拒绝新客。

于是账本的一行长这样：

- `id`：连接的登记号，从 1 递增；
- `remote`：对方号码，出事时能定位到人；
- `lastActiveAt`：最后活跃时刻——注意它不是「创建时刻」，每次对端有数据到达都要刷新；
- `destroy()`：挂断这条线路的动作。

跟着算一遍它的寿命：连接在时刻 1000 建立，`lastActiveAt = 1000`；对端在时刻 4000 发来一段数据，账本把它续命到 4000；空闲阈值设 3000，那么在时刻 8000 查账（8000 − 4000 > 3000 不成立，还差着）它还活着；时刻 8000 之后只要有数据就继续续命，直到某次查账时距最后活跃超过 3000——收割，挂断，销账。

## 动手：createConnRegistry

先定接口。注册表只依赖电话机上真正会用到的那几个能力，不直接依赖 `net.Socket`。形状上满足这几条的任何对象都能入账。这个套路在业界叫「依赖接口而非实现」——插座只规定形状，不规定插头是哪家产的：

```ts
// src/conn.ts · SocketLike 与账本行
export interface SocketLike {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'close', listener: () => void): unknown
  write(chunk: Uint8Array): boolean
  destroy(): void
  readonly remoteAddress?: string
  readonly remotePort?: number
}

export interface ManagedConn {
  readonly id: number
  readonly remote: string
  lastActiveAt: number
  destroy(): void
}
```

这一步的立即回报是可测试性：测试里塞一个假电话机进来（一个手写的小对象，同样有 `on`/`write`/`destroy`），注册表的全部行为就能在毫秒级验证，不必为每个用例真开一条 TCP 连接。

再看实现全貌。三个细节值得停留：

```ts
// src/conn.ts · createConnRegistry
export function createConnRegistry(opts: RegistryOptions = {}): ConnRegistry {
  const maxConns = opts.maxConns ?? 1024 // 呼应第 1 章：文件描述符的 1024 墙
  const idleTimeoutMs = opts.idleTimeoutMs ?? Number.POSITIVE_INFINITY
  const now = opts.now ?? Date.now

  const conns = new Map<number, ManagedConn>()
  let nextId = 1

  const dataCbs: ConnCb<[Uint8Array]>[] = []
  const idleCbs: ConnCb<[]>[] = []
  const closeCbs: ConnCb<[]>[] = []

  return {
    add(socket) {
      if (conns.size >= maxConns) return { ok: false, reason: 'max-conns' }

      const id = nextId++
      const conn: ManagedConn = {
        id,
        remote: `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`,
        lastActiveAt: now(),
        destroy: () => socket.destroy(),
      }
      conns.set(id, conn)

      // 事件经过账本：data 到达即续命，再转发给订阅者
      socket.on('data', (chunk) => {
        conn.lastActiveAt = now()
        for (const cb of dataCbs) cb(conn, chunk)
      })
      socket.on('close', () => {
        conns.delete(conn.id)
        for (const cb of closeCbs) cb(conn)
      })

      return { ok: true, conn }
    },

    size() {
      return conns.size
    },

    sweepIdle(t) {
      const reaped: ManagedConn[] = []
      for (const conn of conns.values()) {
        if (t - conn.lastActiveAt > idleTimeoutMs) reaped.push(conn)
      }
      for (const conn of reaped) {
        conn.destroy() // 真 socket 会随后触发 close 事件，delete 是幂等的
        conns.delete(conn.id)
        for (const cb of idleCbs) cb(conn)
      }
      return reaped
    },

    onData(cb) { dataCbs.push(cb) },
    onIdle(cb) { idleCbs.push(cb) },
    onClose(cb) { closeCbs.push(cb) },
  }
}
```

**细节一：拒绝入账不是异常。** `add` 满员时返回 `{ ok: false, reason: 'max-conns' }` 而不是 throw——「服务器满了」对服务器来说就像「客满了」对餐厅一样，是正常业务结果，不是事故。调用方拿到结构化的理由，自己决定怎么响应（回个 503？直接挂断？）。这是 tinysrv 的全局约定：可预期的失败走判别联合，异常只留给真正的编程错误。

**细节二：时间是输入，不是环境。** 构造参数里的 `now` 允许注入一个假时钟。没有它，测试「空闲 30 秒被收割」就真的要睡 30 秒——一个测试套件跑下来一分多钟，没人会再跑测试。注入之后，测试里 `clock = 9000` 一行就是「时间来到 9 秒」，瞬时完成。

**细节三：续命藏在 data 转发里。** 注意 `socket.on('data', ...)` 里那行 `conn.lastActiveAt = now()`——所有经过账本的事件都顺手记账。「最后活跃时刻」由此永远不用人操心，这正是把连接当一等公民管理之后换来的东西：记账自动化了。

`sweepIdle`（扫账收割）就是照着账本行事的示范：遍历、比较、收割，三步，没有任何对电话机内部的窥探——只调 `conn.destroy()`，这个动作是账本行自带的方法。

## 验证

进 `companion/` 目录跑 `pnpm test`：

```text
✓ tests/connection-registry.test.ts (7 tests) 249ms
Test Files  1 passed (1)
     Tests  7 passed (7)
```

七个断言覆盖了账本的全部承诺：登记与计数、满员拒绝、data 到达续命并转发、只收割真正空闲的连接、收割时销毁并通知、对端挂断自动销账。最后一条是真刀真枪的集成测试——在 127.0.0.1 上起真服务器，两个真客户端连上入账、一个断开出账。假时钟让「空闲 30 秒」的验证只花了 249 毫秒。

回到开头那个周五下午的需求：「空闲超过 30 秒的连接发个警告再关掉。」现在它是一行调用：`createConnRegistry({ idleTimeoutMs: 30_000 })`，定时调 `sweepIdle(Date.now())`，再在 `onIdle` 里打警告日志。需求估一天？五分钟。

## 读完本章，你该能回答

- 为什么事件循环解决了「叫醒」却没解决「管理」？没有账本时，哪三个问题答不上来？
- socket 和 TCP 连接是什么关系？`net.Socket` 的可用面有哪几个成员？
- `lastActiveAt` 为什么必须在 data 事件里刷新，而不是记录创建时刻就够了？
- 满员拒绝为什么返回判别联合而不是抛异常？注入假时钟换来了什么？

账本有了，但账本里的连接发来的还是一段段原始字节。这些字节怎么变成「一个请求」？下一章我们给 tinysrv 装上真正认字的器官：HTTP 解析状态机。
