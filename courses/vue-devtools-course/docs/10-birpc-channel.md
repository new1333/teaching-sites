---
title: 双向 RPC 与通道抽象
---

# 双向 RPC 与通道抽象

UI 客户端第一个迭代的样子，是一段谁都不想维护的消息分支代码。它在 iframe 里跑，与页面内核之间靠 `postMessage` 互发消息。第一周只有三种消息：拉树、拉状态、改值。代码是 `switch (msg.type)`，干净利落。第二个月需求长出来了——树变了要通知、插件面板要拉、检查器状态要推、路由要同步——`switch` 长到两百行，每个 case 手写回调；最痛的是内核要反过来调 UI 的函数，写法却完全没有先例：**对面世界里的函数，我这边没有它的引用**。每个新消息类型都要在两端同时改协议、改分发、改错误处理，一周一个 bug。

这一章把这条路修成正式轨道：消息只有「请求」与「响应」两种，请求带 id、响应按 id 认领，双方各持一个 RPC 端点互为客户端；而传输本身被压扁成只有 `post` 与 `on` 两个函数的通道抽象。

## 通道：两个函数的全部抽象

先看地基。跨世界传输的形态千差万别——iframe 的 `postMessage`、开发服务器的 WebSocket、扩展的三跳中继——但调试器真正需要的接口只有两个动作：

```ts
// src/channel.ts · Channel
export interface Channel {
  post(data: unknown): void
  on(handler: (data: unknown) => void): void
}
```

发一条数据，收一条数据。就这两个。任何传输介质只要包出这两个函数，就能接入整套 RPC——下一章会看到三种宿主各自怎么包。本章先用内存通道对做载体，它让「两个世界」在同一个进程里就能模拟：

```ts
// src/channel.ts · createMemoryChannelPair
export function createMemoryChannelPair(): [Channel, Channel] {
  let handlerA: ((data: unknown) => void) | null = null
  let handlerB: ((data: unknown) => void) | null = null

  const a: Channel = {
    post: (data) => handlerB?.(data),
    on: (handler) => {
      handlerA = handler
    },
  }
  const b: Channel = {
    post: (data) => handlerA?.(data),
    on: (handler) => {
      handlerB = handler
    },
  }
  return [a, b]
}
```

`a.post` 直达 `b` 的 handler，反之亦然。它是测试的脚手架，也是「通道语义到底是什么」的最小说明书：同步也罢、异步也罢、隔着浏览器进程也罢，语义就是「发了必达、到了必呼」。

## RPC：信封只有两种

RPC 端点的实现：

```ts
// src/rpc.ts · createRpc
export function createRpc(functions: RpcFunctions, channel: Channel): RpcClient {
  const pending = new Map<number, { resolve: (value: unknown) => void, reject: (reason: Error) => void }>()
  let seq = 0

  channel.on((data) => {
    const message = data as RpcMessage
    if (message.type === 'request') {
      const fn = functions[message.method]
      if (!fn) {
        channel.post({ type: 'response', id: message.id, error: `unknown method: ${message.method}` })
        return
      }
      Promise.resolve()
        .then(() => fn(...message.args))
        .then(result => channel.post({ type: 'response', id: message.id, result }))
        .catch(error => channel.post({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) }))
      return
    }

    if (message.type === 'response') {
      const entry = pending.get(message.id)
      if (!entry)
        return                            // 迟到的响应：无人认领，丢弃即可
      pending.delete(message.id)
      if (message.error !== undefined)
        entry.reject(new Error(message.error))
      else
        entry.resolve(message.result)
    }
  })

  return {
    call(method, ...args) {
      seq += 1
      const id = seq
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        channel.post({ type: 'request', id, method, args })
      })
    },
  }
}
```

收到的消息按信封分派。请求：在本地函数表里找方法，执行，把结果（或错误）装进响应信封发回去——注意「方法不存在」也走响应信封的 `error` 字段，而不是让请求石沉大海；对端调用一个拼错的方法名，得到的是一次明确的 reject，不是一次永远的悬挂。响应：按 `id` 在 `pending` 表里找到当初的 promise，兑现或拒绝。

发出去的调用则是三步：`id` 自增、promise 连同兑现函数存进 `pending`、请求信封过通道。**并发配对就藏在这里**：两个请求同时在途时各自持不同的 id，谁先回来谁先兑现，`pending` 按 id 精确认领，不会串线。开篇那段 `switch` 代码的所有消息类型，在这里坍缩成一张函数表——加一个「消息类型」变成加一个函数，协议再也不用动。

三个设计决定值得点破。**函数值永不过桥**：信封里装的是方法名与参数，全是纯数据，测试里专门把请求塞过一遍 `JSON.stringify` 证明这一点——第 7 章的编码传输负责让复杂数据也能满足这个约束。**没有超时**：真实调试器的对端可能在忙（遍历一个巨型组件树），一条请求等几秒是常态；本地抢跑超时，只会把「慢」误报成「错」。迟到响应的处理也由此确定：无人认领就丢弃，幂等且无害。**双向是对称的**：两侧各调一次 `createRpc`，各自暴露函数表、各自拿到 `call`——UI 调内核的 `getComponentTree`，内核调 UI 的 `refresh`，同一条轨道，方向随意。

## 把全书接上这条轨道

双向RPC（birpc 的本义就是双向）一旦铺好，前面九章造的每一个零件都找到了自己的站台。UI 面板调 `getComponentTree`，落点是遍历器；调 `getInstanceState`，落点是状态快照；调 `editState`，落点是回写；调 `getInspectorTree`，落点是检查器与它背后的插件缓冲。内核反过来调 UI 的 `refresh`，触发时机来自事件系统——钩子那边一有风吹草动，守门之后的通知顺着同一条轨道回头。每个应用的函数表挂在各自的应用记录上（实例表负责把 id 翻译回活实例），会合点与重放队列则保证这条轨道两端无论谁先就位都能接上头。协议统一之后，加功能不再动协议——这正是第 1 章那张三段式架构图中间那条线，从虚线变成了实线。

## 验证

开篇的每个痛点各钉一条：

```ts
// tests/birpc-channel.test.ts · 节选
it('双向：两侧互为客户端与服务端', async () => {
  const [kitChannel, uiChannel] = createMemoryChannelPair()
  const kit = createRpc({ getTree: () => ['root', 'list'] }, kitChannel)
  const ui = createRpc({ refresh: (reason: string) => `refreshed:${reason}` }, uiChannel)

  await expect(ui.call('getTree')).resolves.toEqual(['root', 'list'])
  await expect(kit.call('refresh', 'tree-changed')).resolves.toBe('refreshed:tree-changed')
})

it('并发请求：响应按各自 id 配对，不串线', async () => {
  const [clientChannel, serverChannel] = createMemoryChannelPair()
  createRpc({
    slow: () => new Promise(resolve => setTimeout(() => resolve('slow-result'), 30)),
    fast: () => new Promise(resolve => setTimeout(() => resolve('fast-result'), 5)),
  }, serverChannel)
  const client = createRpc({}, clientChannel)

  const [slow, fast] = await Promise.all([client.call('slow'), client.call('fast')])

  expect(slow).toBe('slow-result')        // 慢的拿到慢的结果
  expect(fast).toBe('fast-result')        // 快的先回也没串到慢的
})
```

补上基本调用与参数透传、服务端抛错走 reject、未知方法 reject（不悬挂）、120ms 迟到响应仍被接住（「永不超时」不是口号是断言）、请求载荷可 JSON 过桥、内存通道的全双工，本章十条断言，全书累计七十四条全绿。

## 小结

双向 RPC 把两个世界之间的对话收束成最小协议：两种信封、一张函数表、按 id 配对。通道抽象把传输介质压缩成两个函数，为下一章铺好了接口——同一条 RPC，跑在 iframe 的 postMessage 上是它，跑在开发服务器的 WebSocket 上是它，跑在扩展的三跳中继上还是它。

终章把三种宿主逐一装配：Vite 插件怎么把客户端页面与内核脚本注进开发服务器、怎么在中间架起 WebSocket 通道；浏览器扩展怎么用内容脚本与后台端口，在隔离世界与页面世界之间架中继；多应用与 iframe 的角落里又藏着什么。第 1 章那两张灰色图标与看不见的子应用，将在那里得到完整的答案。
