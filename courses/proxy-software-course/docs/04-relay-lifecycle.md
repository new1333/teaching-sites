---
title: 双向搬运：背压、半关闭与清理
---

# 双向搬运：背压、半关闭与清理

## 前情：两个入口，同一个黑盒

第 2 章和第 3 章分别实现了 HTTP 和 SOCKS5 两种入口协议。它们的最后一步都调用了同一个函数：`relay(clientSocket, targetSocket)`，然后就不再过问这条连接接下来发生了什么。这一章要打开这个黑盒——把两个已经建立好的 TCP 连接接起来，双向搬运字节，这件事看起来简单，实际有两个陷阱等着没写过裸 TCP 代码的人。

## 客户端说完了，服务器还没说完

设想一个场景：客户端通过隧道向目标服务器上传一段数据，上传完之后立刻发送 FIN（调用 `socket.end()`，也就是 TCP 层面的结束信号）。但目标服务器收到完整数据后，还需要处理一会儿，仍要回一段结果给客户端。这时候如果代理看到客户端这一侧发来了 FIN，就立刻把两个 socket 都 `destroy()` 掉，会发生什么？

答案是：服务器还没写出的响应会被截断，客户端永远收不到。这不是理论上的边界情况。只要客户端和服务器的读写节奏不完全同步，现实中几乎总是如此，这种情况就可能发生。要避免这个问题，得先搞清楚 TCP 连接的"结束"到底是怎么回事。

## 字节流没有消息边界，FIN 只关一个方向

TCP 提供的是**字节流**（byte stream）：发送端调用 `write` 写入的数据，到达接收端时不保证还保留原来的分段方式——可能几次 `write` 被合并成一次收到，也可能一次 `write` 被拆成好几次收到。这种在传输过程中被打散、合并的现象叫 **TCP 分片**。上一章的 `SocketReader` 之所以要"攒够字节数才继续"，根源就在这里：协议帧的边界只能靠应用层自己按约定好的长度或分隔符去切，TCP 本身不负责保留它。

TCP 连接还有一个容易忽略的性质：它其实是两条独立的方向,一条从客户端到服务器,一条从服务器到客户端。调用 `socket.end()` 发送的 FIN，只是关闭"我这一侧不再发送数据"这个方向，不代表另一个方向也要停。这种一个方向已关闭、另一个方向仍可以继续传输的状态，叫**半关闭**（half-close）。回到开头的场景：客户端发 FIN 只是说"我不会再发数据了"，完全没有说"你也不许回话了"，服务器当然可以继续把处理结果写回来。这正好戳穿了第一个误解。**收到对端的 `end` 事件，不应该立刻把两端都 `destroy()`**。那样等于强行切断了本该还能继续的另一个方向。

TCP 的关闭流程见 [RFC 9293 第 3.6 节](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.6)。半关闭专门写在 [RFC 9293 第 3.6.1 节](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.6.1)。Node.js 里要让 `net.Socket` 支持半关闭，需要在创建时传 `allowHalfOpen: true`。否则收到对端 FIN 时，Node 会自动把本侧写端也关闭，半关闭这件事根本没有发生的机会（细节见 [Node.js net 文档](https://nodejs.org/api/net.html)）。

## 背压：写得慢的一方，不该被写得快的一方压垮内存

再看另一个陷阱。假设目标服务器返回一个几百 MB 的大文件，客户端的网络很慢，读取速度远跟不上服务器发送的速度。如果代理收到数据就立刻转手写给客户端，完全不管客户端到底有没有跟上，会发生什么？还没写出去的数据只能先堆在代理进程的内存缓冲区里。如果读端一直慢、写端却一直在收数据，这个缓冲区会无限增长，直到耗尽进程内存。

这种“写入方跟不上时应该暂停读取，而不是无限缓冲”的机制叫**背压**（backpressure）。目标流不能继续消费时，`readable.pipe()` 会暂停源流，排空后再恢复。这一行为见 [Node.js stream 文档](https://nodejs.org/api/stream.html#readablepipedestination-options)。`stream.pipe()` 因此能避免代理继续无界读取。这也戳穿了第三个误解：**手写 `data` 监听器再调用目标 socket 的 `write`，不一定等价于 `stream.pipe()`**。手写版本若忽略 `write()` 返回值和 `drain` 事件，就没有背压协调；`pipe()` 会替你完成这层工作。

## companion 里的 relay：一个函数处理两件事

把背压和半关闭放到一起看，`relay` 函数其实只需要做两件事：用 `pipe()` 建立双向搬运（顺带处理背压），再单独监听 `end` 事件把 FIN 转发给另一端（处理半关闭）。

```ts
// src/relay.ts · relay
export function relay(a: Socket, b: Socket, sink?: EventSink): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    function finish(message: string, detail?: Record<string, unknown>): void {
      if (settled) return
      settled = true
      a.destroy()
      b.destroy()
      sink?.({ type: 'relay-close', message, detail })
      resolve()
    }
```

`settled` 这个标记保证不管错误还是正常关闭触发了多少次事件，清理逻辑只真正执行一次——这是为了应付下一段要说的"错误和关闭可能同时来"的情况。接下来是事件监听部分：

先分清四个容易混在一起的词：`'end'` 是读端收到对端 FIN；`'finish'` 是本侧调用 `end()` 后，写缓冲中的数据已经全部交给底层；`'close'` 表示 socket 句柄真正关闭；`destroy()` 则是主动强制拆掉连接。下面源码里的 `finish()` 只是课程为“一次性清理”起的函数名，与 Node stream 的 `'finish'` 事件同名但不是同一件事。

```ts
// src/relay.ts · relay（续，事件监听）
    a.on('error', (err) => finish('relay-error', { side: 'a', error: err.message }))
    b.on('error', (err) => finish('relay-error', { side: 'b', error: err.message }))
    a.on('close', () => finish('relay-close', { side: 'a' }))
    b.on('close', () => finish('relay-close', { side: 'b' }))

    a.on('end', () => {
      if (!b.destroyed) b.end()
    })
    b.on('end', () => {
      if (!a.destroyed) a.end()
    })

    a.pipe(b, { end: false })
    b.pipe(a, { end: false })
  })
}
```

`a.pipe(b, { end: false })` 里的 `{ end: false }` 是这段代码里最容易漏掉、也最关键的一个选项。`pipe()` 默认在源结束时自动调用目标的 `end()`，但这里不能用默认行为。半关闭要求"A 结束不该自动结束 B"，真正决定 B 什么时候结束的是上面那段专门写的 `a.on('end', ...)` 逻辑,而不是 `pipe` 自带的默认联动。而 `error` 和 `close` 都会调用同一个 `finish`：任何一端出问题，`finish` 都会销毁两端,不会出现"一端连接残留、进程收不了尾"的情况。

## 动手验证：先猜半关闭之后会发生什么，再核对

`tests/04-bidirectional-relay.test.ts` 搭了两对独立的 socket，用 `relay` 把它们接起来。运行前先猜三件事：

1. A 端调用 `end()` 之后，B 端会不会收到 TCP 层面的结束信号？
2. B 端在收到 A 的结束信号之后，还能不能继续往 A 发数据？
3. 一端如果被强制 `destroy()` 触发错误，`relay()` 返回的 `Promise` 会不会正常收尾，还是永远挂起？

运行命令：

```bash
cd courses/proxy-software-course/companion
pnpm vitest run tests/04-bidirectional-relay.test.ts
```

预期 4 个用例全部通过。"半关闭"这条用例会先让 A 发一段数据、确认 B 收到，然后 A 调用 `end()`，断言 B 会收到 `end` 事件；紧接着让 B（此时读端并没有被关闭）继续往 A 写一段数据，断言 A 依然能收到——这直接验证了第二个问题的答案是"能"。"一端出错时两端都被清理"这条用例会主动 `destroy` 一端并附带一个模拟错误，断言 `relay()` 的 `Promise` 确实会 resolve，两端 socket 的 `destroyed` 都变成 `true`。

再看一个能感知到的变体：那条验证背压的用例会先让接收端 `pause()`（模拟读得慢），再发送 4MB 随机二进制数据，之后才让接收端恢复读取。如果 `relay` 没有正确利用 `pipe()` 的背压机制，而是采用了前面提到的"手写 data 监听器直接转发"这种写法，这个用例仍然会通过，因为 Node 进程内存足够放下 4MB。但如果把这里的数据量换成几百 MB 反复发送，没有背压保护的手写版本会在这一步开始出现内存占用持续上涨的现象，而使用 `pipe()` 的版本不会。这正是背压这一机制存在的意义。

## 自查：换个角度再想一遍

<details>
<summary>两端几乎同时出错，会不会重复清理</summary>

假设 A 端和 B 端几乎在同一时刻都触发了 `error` 事件，比如两边的网络同时断开。`finish` 函数会不会执行两次，导致 `a.destroy()`、`b.destroy()` 重复运行，或者 `sink` 收到两条 `relay-close` 事件？

<details>
<summary>参考答案</summary>

不会重复产生副作用。`finish` 函数第一行就检查 `if (settled) return`，第一次调用时把 `settled` 置为 `true`；即使 A 和 B 的 `error` 事件几乎同时触发，第二次调用 `finish` 会在检查 `settled` 后立刻返回，不会重复 `destroy` 或重复通知 `sink`。这个标记正是为了应付"多个事件源都可能触发同一个清理逻辑"这种情况而设计的。
</details>
</details>

<details>
<summary>去掉 `{ end: false }` 会发生什么</summary>

如果把 `a.pipe(b, { end: false })` 改成默认选项的 `a.pipe(b)`，再重新跑一遍半关闭那条测试用例，预期会出现什么现象？

<details>
<summary>参考答案</summary>

`pipe()` 默认在源端触发 `end` 时自动调用目标端的 `end()`。这本身不会让测试立刻报错，因为这一步和后面手写的 `a.on('end', () => b.end())` 做的是同一件事，只是路径重复了一次。但更根本的问题是：这种默认行为把"什么时候关闭对端"的决定权交给了 `pipe()` 内部逻辑。如果同一个 socket 后续用在更复杂的场景，比如一端需要在半关闭状态下继续处理一段时间，默认联动会比这里手写的显式 `end` 转发更难控制，也更容易在需求变化时出现意外的提前关闭。
</details>
</details>

## 回到开头的场景

现在可以回答开头的问题了：客户端发完数据调用 `end()`，这只是关闭了"客户端到服务器"这一个方向，服务器完全可以继续往回写数据。`relay` 会把这个单向的结束信号转发给目标端，而不是立即销毁整条连接。只有当某一端真正 `close` 或出错时，`finish` 才会清理两端。这也是为什么本章开头设想的"响应截断"不会在这套实现里发生。

字节流没有消息边界、背压避免内存无限增长、半关闭不等于连接结束——这三件事共同构成了这一章要交给入口复用的转发能力。HTTP 与 SOCKS5 两个入口最终会共享这一个 `relay`，不会各自维护一套关闭规则。入口、路由、出站三段模型里，入口这一段到这里已经补齐了两种协议加上转发细节。下一步要回到路由，把第 1 章里那句“由规则引擎判断”，第一次变成一个可以运行、可以测试的函数。
