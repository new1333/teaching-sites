---
title: 单线程遇多线程：异步桥
---

# 单线程遇多线程：异步桥

一个能亲身复现的实验：在 Electron 渲染进程里同步调一个耗时 300ms 的原生接口（比如老式同步截屏、同步读大文件），期间整页面的 CSS 动画一帧不跳、按钮点了没反馈、滚动条僵住——300ms 后一切恢复，仿佛集体断电。更迷惑的是同一段代码在主进程里跑，窗口照样拖不动。有人归结为「原生就是慢」，错了，慢不是问题，**同步才是问题**：JS 只有一条线程，你让它站在原地等原生干活，这条线程上排队的所有事（渲染、输入响应、其他回调）全部陪绑。

这一章的解法你在调包时代天天用——`await` 一个原生异步 API——但这次我们把它造出来：异步桥。核心就一句话：**调用立刻返回 Promise，活儿扔进任务队列（task queue），结果由「泵」在稍后投回 JS**。

## 为什么不能同步等：两个世界的节奏

先把矛盾说透。JS 的执行模型是单线程 + 事件循环：一条线程，同一时刻只跑一段代码，跑完这段才能跑下一段——渲染刷新、事件响应都排在队列里等。原生世界（C++/Rust 的 GUI 工具包）是另一副模样：它有自己的线程池，截屏 300ms、读文件 50ms，各干各的。如果 binding 是同步的（第 4 章那种 `invoke` 等结果），JS 线程就在 `invoke` 里原地干等——**两边的节奏不同步，同步调用等于把快的那边锁死在慢的这边**。

解法分三步，对应代码里的三个角色：

1. `runAsync(name, args)` 立刻返回一个 Promise——JS 线程马上自由，继续跑后面的代码；
2. 真正的活儿打包成任务，进 `nativeQueue`——原生世界按自己的节奏消化；
3. 任务完成时把 `resolve` 投回 JS——Promise 兑现，`.then` 里的代码执行。

## 实现：一个队列加一个泵

```ts
// src/runtime/asyncBridge.ts · createAsyncBridge（全文不到 50 行）
export function createAsyncBridge(bridge: Bridge): AsyncBridge {
  const nativeQueue: Array<() => void> = []
  let inFlight = 0

  const pump = () => {
    while (nativeQueue.length > 0) nativeQueue.shift()!()
  }

  return {
    runAsync(name, ...args) {
      inFlight++
      const p = new Promise((resolve, reject) => {
        nativeQueue.push(() => {
          inFlight--
          try {
            resolve(bridge.invoke(name, ...args))   // 干活仍在桥上（序列化照旧）
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      })
      Promise.resolve().then(pump)  // 事件循环总会转：没人显式泵，也得兑现
      return p
    },
    async flush() { pump() },
    pending() { return inFlight },
  }
}
```

逐个看设计决定。`runAsync` 里 `new Promise` 只做一件事：把「干活 + resolve」打包进队列，立刻把 Promise 交出去——注意此刻什么活都没干，这正是「不阻塞」的全部秘密。`pump` 是任务队列的消费者：把排队的任务依次执行，每个任务的 `resolve` 让对应 Promise 兑现，顺序天然等于完成顺序。最后那行 `Promise.resolve().then(pump)` 是本实验场的模拟手段：真实 App 里原生线程完成后会往 JS 宿主的事件队列投递消息、循环自动转动；测试里没有常驻循环，所以每次 `runAsync` 自动安排一次泵——微任务近似「循环总会转」这件事。要精确控制时序（比如断言「泵转之前 Promise 挂起」）就显式 `await flush()`。

两个容易漏掉的细节。其一，`bridge.invoke` 仍在队伍里干活——序列化边界没有因为异步而消失，参数照旧拷贝过去、结果照旧拷贝回来。其二，原生抛错走 `reject` 而不是炸线程：异步世界的错误只能沿 Promise 链走，`await` 处 `try/catch` 接住——这也是为什么真实 Electron 的异步 API 全是错误优先回调或 reject，你从没见过它们把渲染进程 throw 崩。

## 验证

`pnpm test` 新增六条断言，最有教学价值的三条：

```ts
// tests/async-bridge.test.ts · 同步代码先跑完
const p = async.runAsync('slow.add', 1, 2)
order.push('after-call')            // 同步代码在 resolve 之前执行
await p
order.push('resolved')
expect(order).toEqual(['after-call', 'resolved'])
```

其一，`runAsync` 之后那行同步代码先于 `resolved` 执行——「立刻返回」不是修辞，是可断言的顺序。其二，三个并发调用 `1、2、3` 按发起顺序兑现——队列 FIFO，谁先排队谁先完成（原生真线程会乱序完成，那只需把「完成」而非「发起」入队，模型不变）。其三，`boom` 任务抛错，`await expect(...).rejects.toThrowError(/native crashed/` ——错误被驯化成可捕获的拒绝，JS 线程安然无恙。

## 小结

异步桥把「跨世界的耗时调用」从阻塞改成排队回投：runAsync 立刻返回、任务进队列、泵转动时兑现。开头的 300ms 断电事故，答案就是「那个 API 不该有同步版本」——不是原生慢，是你的调用方式让 JS 单线程替原生蹲监狱。至此单进程世界的零件齐了大半：窗口有了、同步/异步调用都有了。但真实 Electron 还有一道大分裂：为什么要把界面和系统能力拆进两个进程？下一章讲这道墙是怎么砌起来的。
