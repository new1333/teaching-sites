---
title: 事件系统：从原始事件到语义事件
---

# 事件系统：从原始事件到语义事件

一个周四下午的排障：有人在生产环境页面上开着调试面板挂了一整天，傍晚反馈「页面越来越卡」。抓性能录像一看，事件处理的火焰图密密麻麻——组件每秒更新几十次，而面板里有一个模块还订阅着「组件更新」事件，每次都做一遍无用的重算。面板早就切到别的页签了，但它注册的监听还在事件洪流里泡着。另一类麻烦更早就会撞上：库作者给自己的内部组件标了「别在面板里显示我」，可这些组件还是成群结队地混进组件树，用户展开一看全是没见过的名字。

这两个现象指向同一个缺口：钩子发来的原始事件，不能直接当内部事件用。中间缺一层转发——转发时要做两件事，**守门**（不合格的事件拦下）与**可解绑**（不听了就真的不听了）。这一章我们把这一层做出来。

## 为什么需要两层事件

第 2 章的钩子解决的是「两个 bundle 怎么相遇」，它的 `emit` 发出的是应用侧的原始事件：载荷长什么样、全不全、有没有私货，都由应用说了算。直接让内核各模块去 `hook.on`，会出三个问题：

1. 每个模块都要自己写一遍「载荷全不全」的校验——重复且容易漏。
2. 应用标记「我不想被调试」的意图无人执行——这个意图写在组件定义上，只有统一转发时才检查得到。
3. 监听散落在各模块手里，谁忘了解绑，谁就是那个泄漏点。

所以架构上分成两层：钩子层管「相遇与传输」，事件层管「内部语义」。中间一座桥，就是 `subscribeHook`。

## 事件总线：内核的语义事件

先看内核这一侧的事件总线，它比钩子更简单——没有 `once`、没有应用列表，只保留最纯粹的两件事：

```ts
// src/events.ts · createEvents
export function createEvents<T extends EventPayloads = EventPayloads>(): Events<T> {
  const handlers = new Map<string, Array<(...args: any[]) => void>>()
  return {
    on(name, fn) {
      if (!handlers.has(name))
        handlers.set(name, [])
      handlers.get(name)!.push(fn)
      return () => {
        const list = handlers.get(name)
        if (!list)
          return
        const index = list.indexOf(fn)
        if (index !== -1)
          list.splice(index, 1)
      }
    },
    emit(name, ...payload) {
      const list = [...(handlers.get(name) ?? [])]
      list.forEach(fn => fn(...payload))
    },
  }
}
```

和钩子一样，`on` 返回解绑函数，`emit` 触发前复制一份监听列表。泛型 `T` 让调用方可以带一份事件名到载荷类型的映射表，编译期就能查出「监听的事件名写错了」这类低级事故——调试器自己得先没有低级事故。

## 桥：转发与守门

桥是这个章的主角。它订阅钩子的原始事件，逐个判断要不要放行，放行的转发进事件系统：

```ts
// src/events.ts · subscribeHook
export function subscribeHook(hook: Hook, events: Events): () => void {
  const offs = FORWARDED_EVENTS.map((eventName) => {
    return hook.on(eventName, (...args: any[]) => {
      if (isGuarded(eventName, args))
        return
      events.emit(eventName, ...args as any[])
    })
  })
  return () => offs.forEach(off => off())
}
```

结构本身平淡：转发名单逐个 `hook.on`，收齐所有解绑函数，最后打包返回一个总解绑。值得说的是守门的判据：

```ts
// src/events.ts · isGuarded
function isGuarded(eventName: string, args: any[]): boolean {
  if (eventName === 'app:init' || eventName === 'app:unmount') {
    const [app] = args
    return !app || (app as AppLike)._instance?.type?.devtools?.hide === true
  }
  if (eventName.startsWith('component:')) {
    const [app, uid, , instance] = args
    return !app || typeof uid !== 'number' || !instance || instance?.type?.devtools?.hide === true
  }
  return false
}
```

三类守门对应三类真实麻烦。载荷不全的拦下——应用世界什么怪状态都可能出现，`undefined` 载荷灌进内核，崩的是调试器，用户看到的却是「页面坏了」。标记 `devtools.hide` 的拦下——「我不想被调试」是应用方的公开约定，转发层是执行它的唯一合理位置：检查一次，全内核受益；散到各模块去检查，迟早有模块忘掉。应用级 hide 走根实例检查，组件级 hide 走实例自身——两条路都从组件定义上读同一个标记。

守门还有一层经济账。组件事件是全书中流量最大的事件源：一次路由切换就是几十个组件 added/removed，一次列表刷新就是上百个 updated。在桥上拦掉一个不合格事件，比让它流进内核再被每个消费者各自丢弃便宜一个数量级。守门放在离信源最近的地方，是事件系统的通用设计直觉。

解绑那侧同样有讲究。`subscribeHook` 返回的函数把所有 `hook.on` 的解绑串在一起——桥自己也是钩子的一个订阅者，桥要能被整体拆掉。什么时候拆？用户关闭面板、切换宿主、测试结束清理现场，都是拆桥的时机。拆了桥，钩子还在、应用还在发事件，但内核一个字节都不会再处理——「不听了就真的不听了」由机制保证，不靠每个消费者自觉。

## 验证

测试围绕三个行为钉死：转发到达、守门拦截、解绑静默。

```ts
// tests/event-system.test.ts · 节选
it('守门：标记 devtools.hide 的组件事件不转发', () => {
  const hook = createHook()
  const events = createEvents()
  subscribeHook(hook, events)
  const fn = vi.fn()
  events.on('component:added', fn)

  const hidden = createInstance('InternalSlot', { type: { name: 'InternalSlot', devtools: { hide: true } } })
  hook.emit('component:added', createApp('main'), 7, 1, hidden)
  expect(fn).not.toHaveBeenCalled()          // 拦下

  const visible = createInstance('Card')
  hook.emit('component:added', createApp('main'), 8, 1, visible)
  expect(fn).toHaveBeenCalledTimes(1)          // 放行
})

it('解绑后停止转发', () => {
  const hook = createHook()
  const events = createEvents()
  const off = subscribeHook(hook, events)
  const fn = vi.fn()
  events.on('component:updated', fn)

  const payload = [createApp('main'), 7, 1, createInstance('Card')] as const
  hook.emit('component:updated', ...payload)
  off()
  hook.emit('component:updated', ...payload)
  expect(fn).toHaveBeenCalledTimes(1)          // 第二次被桥拦在门外
})
```

加上载荷不全的守门、应用级 hide、事件总线自身的 on/emit 与解绑，共七条断言。跑 `npm test`，连同前一章的八条共十五条全绿；`npm run typecheck` 干净。

## 小结

钩子层与事件层分家之后，职责终于清爽：钩子层负责与应用世界打交道，容忍一切怪载荷；事件层只发干净的语义事件，内核模块可以放心消费。守门在桥上做一次，解绑在桥上收口。回头看，第 2 章的会合点与重放队列解决了「相遇」，这一章的桥解决了「相遇之后说什么话」。

下一个问题紧随而来：应用 init 事件流进来之后，内核拿什么「记住」页面上有哪些应用？组件被登记之后，又拿什么给每个组件一个查得到的身份？这正是应用记录与实例表要回答的——它是后面遍历器、状态快照、回写共同的寻址基础。再往远处望一眼全书的版图：快照要出页面得靠编码传输，第三方库挂面板靠插件缓冲与检查器，UI 与内核互调靠双向 RPC 与通道，扩展宿主里还有中继在等着接力——每一站都会回头借用本章这层干净的事件。
