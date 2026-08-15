---
title: 反方向：native 事件进 JS
---

# 反方向：native 事件进 JS

一个所有人都写过的「没反应」bug：界面上有个按钮，JS 里写了点击处理逻辑，点了没反应。打开 DevTools 没有报错、断点没进——因为处理函数压根没被调用。四处检查：函数名对、绑定语句执行了、按钮显示正常。问题出在哪儿？出在**两个世界的事件系统互不相识**：点击是原生世界的消息，落在第 2 章那条队列里；你的回调是 JS 世界的函数，挂在某个对象上。没有一段代码负责「把队列里的消息翻译给 JS」，两者就永远擦肩而过。这一章补上这座桥的最后一段：**反方向的桥——native 事件 → JS 回调**。

回顾一下方向感。第 4 到第 6 章的桥是「JS 说话，原生干活」；第 8 章的通道是「两个 runtime 互相说话」；而事件回流是「原生世界主动通知 JS」——OS 不会调用你的 JS 函数，它只会往队列里塞消息，等泵来取。所以反方向的桥不是「调用」，是「订阅 + 分发」。

## 该接到哪条队列上

先定架构问题：分发器站在哪里？候选一：站在消息源头，每来一条事件就同步调 JS 回调——不可行，等于让原生世界随时打断 JS 线程，第 6 章的单线程教训重演。候选二：**站在 JS 世界的泵上**——native 事件照常进 runLoop 队列排队，泵转动时分发，回调作为一次普通的分发执行。这是所有真实框架的选择：浏览器里点击事件进了事件队列，渲染循环取出来后才执行你的 onclick；Electron 里原生输入事件也是先进队列、由 Chromium 的消息循环择机转发给 V8。**回调永远在被泵到的那一刻执行，而不是事件发生的那一刻**——这句话顺便解释了「为什么界面卡的时候点击会排队生效而不是丢掉」。

## 实现：一张精确订阅表 + 每类型一钩子

```ts
// src/events/dispatch.ts · createEventDispatch（核心）
export function createEventDispatch(loop: RunLoop): EventDispatch {
  const subscribers = new Map<string, JSCallback[]>()   // key = `${targetId}::${type}`
  const hookedTypes = new Set<string>()

  const hook = (type: string) => {
    if (hookedTypes.has(type)) return
    hookedTypes.add(type)
    loop.on(type, (e) => {
      if (e.targetId === undefined) return
      for (const cb of subscribers.get(`${e.targetId}::${type}`) ?? []) cb(e.payload, e)
    })
  }

  return {
    onWindowEvent(targetId, type, cb) {
      hook(type)                       // 第一个订阅者到来时才在 runLoop 上挂钩子
      const key = `${targetId}::${type}`
      const list = subscribers.get(key) ?? []
      list.push(cb)
      subscribers.set(key, list)
      return () => {                   // 解绑：订阅必须可取消
        subscribers.set(key, (subscribers.get(key) ?? []).filter((f) => f !== cb))
      }
    },
  }
}
```

三处设计值得说清。其一，**两级路由**：runLoop 那层按 `type` 分发（复用第 2 章的注册表，不重复造），订阅表这层再按 `targetId` 精确匹配——「click」消息可能属于任何窗口任何控件，`targetId` 过滤保证 A 窗口的订阅者永远收不到 B 窗口的点击，第 5 章的句柄编号在这里第二次上岗。其二，**hook 惰性挂钩**：某种事件类型只在第一个订阅者出现时才向 runLoop 注册一次，一百个按钮的 click 订阅也只占 runLoop 一个钩子——真实工具包的事件委托本质就是这个结构。其三，**解绑返回函数**：与第 8 章 `on` 的设计一致，订阅（subscription）生命周期必须交还调用方，否则窗口销毁了回调还挂在表里，下次同编号的新窗口复用 id，就会收到幽灵事件——句柄编号会被复用，这是第 5 章埋的另一个伏笔。

配套还有一个测试辅助，模拟「OS 又投了一条消息」：

```ts
// src/events/dispatch.ts · emitNative
export function emitNative(loop: RunLoop, e: NativeEvent): void {
  loop.queue.push(e)
}
```

真实世界里这个动作由 OS 完成（用户按下鼠标 → 输入子系统 → 队列）；测试里我们代劳。注意事件体是 `{ type, targetId, payload }` 纯数据——第 1 章说过，消息从出生那一刻起就只能装纯数据，所以反方向不需要再过序列化：**不是数据选择了这条路，是这条路只收纯数据**。

## 验证

`pnpm test` 新增五条断言，每条对应一个行为承诺：

```ts
// tests/native-events-to-js.test.ts · 订阅-投递-解绑
d.onWindowEvent(1, 'click', (p) => got.push(p))
emitNative(loop, { type: 'click', targetId: 1, payload: { x: 10, y: 20 } })
loop.pumpOnce()
expect(got).toEqual([{ x: 10, y: 20 }])
```

- 订阅 1 号窗口的 click，投一条带坐标的消息，泵一次，回调收到 payload；
- 同样的 click 消息但 `targetId: 99`，订阅者收不到——归属过滤生效；
- 解绑后再投递，静默；
- 同一目标同一类型挂两个回调，按注册顺序触发；
- 投两条消息只泵一次，只触发一次回调——「排队等泵」不是修辞，是可断言的行为。

## 小结

反方向的桥 = 精确订阅表 + runLoop 上的惰性钩子：native 事件进队列、泵转动、按 (targetId, type) 分发到 JS 回调，解绑随时可退。开篇的「点击没反应」现在可以完整诊断：要么消息根本没进队列（控件没注册），要么队列没人泵（循环卡了），要么订阅 key 对不上（targetId 或 type 拼错），要么解绑早于点击——四种可能各有各的检查点，不再是一团黑盒。零件至此全部到齐：窗口、双向调用、异步、通道、事件。下一章把它们组装成 createApp——写一段 JS，屏幕上真的长出一个能点能动的界面。
