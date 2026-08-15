---
title: 手写最小消息循环
---

# 手写最小消息循环

上一章的事故还欠着一个交代：「消息队列」到底长什么样？「循环取—分发」写出来是什么？如果这两个问题只能背定义，那你对 GUI 主线程的理解仍然是一团雾。这一章我们动手把原生世界最小化：一个事件队列、一个 runLoop，加起来不到七十行——但它是后续所有章节的地基——native 事件进 JS、App 心跳，都跑在这条循环上。

先交代实验场的约定：我们无法在测试里造一个真 OS，也不需要。原生世界用纯 TS 模拟——`src/native/` 目录下的模块代表「OS/原生那一侧」，它们不知道 JS 的存在。每一章给这个世界添一块零件，到第 10 章拼成 mini-Electron。测试对结构断言，不对像素断言，原理照样是真的。

## 没有队列和分发会怎样

想象最原始的写法：程序想知道用户点了按钮，就死盯着某个变量看它变没变（轮询）。两个直接后果：一是 CPU 空转烧满一个核，事件越密丢得越多；二是「谁在改这个变量」没有任何约束，十个模块都能写它，事件处理的顺序完全失控。队列解决第一个问题——事件到齐排队，处理者按序取；分发解决第二个——按 type 路由到注册过的处理函数，没人注册的消息安静地路过。OS 的选择与此完全同构：每个窗口一条队列，消息带类型，循环按类型投递。

## 事件队列：先入先出，别无魔法

```ts
// src/native/eventQueue.ts · createEventQueue
export interface NativeEvent {
  type: string
  targetId?: number
  payload?: unknown
}

export function createEventQueue(): EventQueue {
  const items: NativeEvent[] = []
  return {
    push(e) { items.push(e) },
    next() { return items.length ? items.shift()! : null },
    size() { return items.length },
  }
}
```

`NativeEvent` 的三个字段值得停一下：`type` 是路由依据（`click`、`paint`、`quit`……）；`targetId` 是消息归属的句柄 ID——OS 投递点击时不知道「按钮对象」，只知道「3 号窗口里的 7 号控件」这种编号，句柄思想从消息结构里就开始了；`payload` 装纯数据。注意整个结构里没有任何函数、任何引用——上一章说的序列化边界，在消息的形状上落了地。

队列本身是数组，`push` 入队 `shift` 出队，严格 FIFO。真实 OS 的队列有优先级、有合并（连续的 paint 消息会合并成一条），这些优化先不做——先让「顺序」这个最关键的语义立起来。

## runLoop：取一条，分发给谁

```ts
// src/native/runLoop.ts · createRunLoop
export function createRunLoop(queue: EventQueue = createEventQueue()): RunLoop {
  const handlers = new Map<string, NativeHandler[]>()
  const dispatch = (e: NativeEvent) => {
    for (const h of handlers.get(e.type) ?? []) h(e)
  }
  return {
    queue,
    on(type, handler) {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    run() {
      for (;;) {
        const e = queue.next()
        if (!e) return
        dispatch(e)
        if (e.type === 'quit') return
      }
    },
    pumpOnce() {
      const e = queue.next()
      if (e) dispatch(e)
    },
  }
}
```

四件事。`handlers` 是「type → 处理函数列表」的注册表——分发的心脏，注意它和第 4 章的 binding 注册表是同构的：一边是「消息找处理者」，一边是「调用找实现」。`on` 允许同一个 type 挂多个处理者，后挂的排在后面。`run` 就是上一章那段伪码的真身：无限循环取消息，队列空了返回（测试环境等价于「休眠等待」），`quit` 先分发给观察者再终止循环——真实 OS 的退出消息同样允许被拦截，应用常借此弹「确定退出吗」。`pumpOnce` 是按帧驱动的入口，后面讲异步桥和事件分发的章节会一个一个地泵，而不是一口气跑完。

有一个刻意的不设防：`dispatch` 对没有注册者的消息静默放行。OS 每秒投递的系统消息（光标闪烁、电源状态、输入法切换……）远多于你关心的，处理者缺席是常态而非异常，这里不抛错。

## 验证

跑 `pnpm test`，六条断言全绿。值得盯着看的两条：其一，push 进 `paint → click → quit → click`，断言 `seen` 是 `['paint', 'click:3', 'quit']` 且队列里还剩 1 条——quit 之后的消息不再分发，这就是「循环退出，程序结束」的可测形态；其二，push 一条谁都没注册的 `system-tray-blink`，`run` 不抛错——分发与订阅解耦。测试文件在 `tests/message-loop.test.ts`，断言的全是行为（顺序、剩余量、不抛错），没有一条窥探内部数组。

```ts
// tests/message-loop.test.ts · 断言 quit 语义
loop.queue.push({ type: 'click' })
loop.queue.push({ type: 'quit' })
loop.queue.push({ type: 'click' }) // quit 之后，不该被处理
loop.run()
expect(seen).toEqual(['click', 'quit'])
expect(loop.queue.size()).toBe(1)
```

## 小结

至此原生世界有了心跳：事件队列负责「发生的事排队」，runLoop 负责「按序取、按 type 分、quit 即止」。回头看开头的两个事故：死循环版相当于 dispatch 里卡了三秒，后面的消息全堵在 `items` 数组里；秒退版相当于 run 没跑过。下一章离开原生世界，去看 JS 那一侧——一个引擎怎么被塞进宿主程序里，`window` 又是从哪儿冒出来的。
