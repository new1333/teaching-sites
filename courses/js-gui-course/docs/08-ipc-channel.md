---
title: IPC：invoke/handle 与 send/on
---

# IPC：invoke/handle 与 send/on

Electron 新手最密集的撞墙点，几乎全在两个进程之间：渲染进程里 `require('fs')` 直接报错「没有这个模块」；想从渲染进程读个配置文件，搜到的答案是主进程写 `ipcMain.handle`、渲染进程 `await ipcRenderer.invoke`——照抄能跑，但为什么一个函数调用要拆成两半、写在不同文件里？更深的坑在后面：往 `invoke` 的参数里塞了个带方法的对象，对端拿到手只剩纯数据，方法全没了；塞个函数直接报 `object is not serializable`。把 API 抄熟也躲不开这些坑，因为**IPC 不是函数调用的语法糖，是一条只能过纯数据的消息通道**。这一章把这条通道亲手造出来，两种语义——请求-响应（request-response）与事件推送（event push）——各造一半。

先明确我们在造什么。第 7 章说渲染进程要「外借」能力：借的方式是发消息给主进程，主进程办完再把结果发回来。所以通道的最小原料是：两个互不可见的端点（`main` / `renderer`，各自模拟一个进程里的 runtime），中间只允许传消息对象。

## 消息的形状：一切先序列化

通道上跑的只有三种消息，全是纯数据：

```ts
// src/ipc/channel.ts · 消息类型
type Message =
  | { kind: 'event'; channel: string; payload: unknown }
  | { kind: 'request'; channel: string; payload: unknown; id: number }
  | { kind: 'response'; channel: string; id: number; ok: true; result: unknown }
  | { kind: 'response'; channel: string; id: number; ok: false; error: string }
```

`event` 撑起 send/on；`request`/`response` 靠 `id` 配对撑起 invoke/handle。payload 在入口就走第 4 章造的 `serialize`——进程边界比语言边界更彻底（连共享内存都没有），函数、class 实例照旧拒收，报错冠上 `[ipc]` 前缀。**为什么函数过不了 IPC？函数是「代码 + 闭包」，闭包里锁着这个进程的内存——把函数传过去等于要求对端进程访问这边的内存，进程隔离直接作废**。真实需求「传回调」的替代解，是把「能力」换成「请求」：想让对端干完通知你？发完 invoke 你本来就在等它的 response；想持续订阅？那是 send/on 的活。

## 请求-响应：id 配对是全部魔法

`invoke(channel, payload)` 返回 Promise，这一侧发生了什么？

```ts
// src/ipc/channel.ts · invoke（端点方法，节选）
invoke(channel, payload) {
  const safe = serializePayload(payload, `ipc invoke ${channel}`)
  const id = nextRequestId()
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })                     // 记下「谁在等这个 id」
    sendTo({ kind: 'request', channel, payload: safe, id })  // 消息出门
  })
},
```

对端 `handle(channel, fn)` 注册处理者。request 到达收件箱后的处理：

```ts
// src/ipc/channel.ts · receive 处理 request（节选）
if (m.kind === 'request') {
  const fn = handlers.get(m.channel)
  if (!fn) {
    sendTo({ kind: 'response', ..., ok: false, error: `[ipc] no handler for: ${m.channel}` })
    return
  }
  Promise.resolve()
    .then(() => fn(m.payload))                                // 处理者异步执行
    .then(
      (result) => sendTo({ kind: 'response', ..., id: m.id, ok: true, result: serialize(result, 'ipc result') }),
      (err) => sendTo({ kind: 'response', ..., id: m.id, ok: false, error: err.message }),
    )
  return
}
```

response 回到发起方，`waiting.get(m.id)` 找回那个 Promise，`ok` 则 resolve、否则 reject。**invoke/handle 的本质：把「函数调用」拆成「带编号的信件往来」，编号让并发的请求各回各的家**。三个细节值得停留：没人 handle 就回一封「查无此人」的错误信，而不是石沉大海；处理者的活排成微任务——通道天然异步，发起方从不被对端卡住（第 6 章的教训在通道上自动生效）；结果也过序列化，所以主进程返回的对象到了渲染进程就是副本，两边 `===` 永远 false。

收件箱的投递用 `Promise.resolve().then(() => receive(m))` 落地——微任务模拟跨进程时延，消息永不当场送达。

## 事件推送：没有回执的单向信

send/on 砍掉了 id 和响应，只剩单向通知：`send(channel, payload)` 把 event 消息扔进对端收件箱，对端 `on(channel, cb)` 的订阅者依次收到。`on` 返回解绑函数——订阅（subscription）必须可以取消，否则主进程往渲染进程推生命周期事件时，一个已经卸载的页面还挂在订阅表里，就是内存泄漏加幽灵回调。真实 Electron 的 `ipcRenderer.on` 同样要配 `removeListener`，同一个道理。

两种语义怎么选？要结果、要错误、要确定性——invoke/handle；只要通知（菜单点了、下载完了、窗口关了）——send/on。用 invoke 也能凑合做通知（回个 null），但那会制造一堆空等结果的 Promise，语义噪音。

## 验证

`pnpm test` 后本章九条断言全绿，覆盖四个关键行为：渲染进程 invoke 主进程 handle、返回值跨通道回来（`'content-of-a.txt'`）；**反方向也通**——主进程 invoke 渲染进程，通道是对称的双车道；并发三个 `math:double` 各拿各的结果（id 配对）；处理方抛错，发起方 `rejects.toThrowError(/disk full/` ——错误串过通道变成可捕获的拒绝，而不是崩掉哪一边。

```ts
// tests/ipc-channel.test.ts · 并发配对
main.handle('math:double', (n) => (n as number) * 2)
const [a, b, c] = await Promise.all([
  renderer.invoke('math:double', 1),
  renderer.invoke('math:double', 10),
  renderer.invoke('math:double', 100),
])
expect([a, b, c]).toEqual([2, 20, 200])
```

## 小结

一条 IPC 通道 = 两个收件箱 + 三种纯数据消息：event 走 send/on，request/response 靠 id 配对走 invoke/handle，payload 与结果全过序列化、错误以字符串过通道。渲染进程没有 fs 的问题至此有了完整答案：不是缺个模块，是能力在墙另一边，invoke 是「递申请」。通道有了，但还差最后一个方向——用户在窗口上的点击，怎么走完「OS 消息 → 通道 → JS 回调」这最后一公里。下一章把事件系统接上。
