---
title: 组装 mini-Electron
---

# 组装 mini-Electron

零件全都会造了，还是有可能写不出一个 App——这是工程学习里最常见的「乐高困境」：会捏每一块积木，拼不出一辆车。症状具体是这样的：你知道怎么开窗口（第 5 章）、知道怎么桥调用（第 4 章）、知道怎么收事件（第 9 章），但当需求是「写一段 JS，界面上有个按钮，点了数字加一」时，不知道这些零件该在哪儿初始化、谁先谁后、用户脚本从哪儿拿到这些能力。缺的不是新原理，是一个把生命周期缝起来的**壳**。这一章写这个壳，`createApp`——也是 Electron `app.whenReady()` 背后那个结构的微缩版。

## 先看终态：用户脚本的模样

倒着设计——先写你希望用户（也就是写桌面端应用的 JS 开发者）面对什么，再实现它：

```ts
// 用法示例：一个完整的计数器 App
const app = createApp({
  main(desktop) {
    const win = desktop.createWindow({ title: 'Counter' })
    win.show()
    let count = 0
    const render = () =>
      desktop.renderUI(win, {
        tag: 'column',
        children: [
          { tag: 'text', text: String(count) },
          { tag: 'button', text: '+1', onClick: 'inc' },
        ],
      })
    render()
    desktop.onAction('inc', () => {
      count++
      render()
    })
  },
})
```

用学过的眼光审这段代码，每一行都该能落到前十章：`createWindow` 返回句柄（第 5 章）；`renderUI` 里 UI 树是纯数据、按钮带的是动作名字符串而不是函数——因为树要过序列化边界（第 4 章）；点击从原生世界回流、`onAction` 收到的是动作名对应的 JS 回调（第 9 章）；`count++` 后整棵重渲染，因为树本体替换是原生侧的事（第 5 章的 setUI）。**一段看似普通的业务代码，每一步都在跨边界**——这就是「JS 接入 GUI」的成品形态。

## 壳的实现：一次性把五个零件接上

`createApp` 做的事，本质是把第 2 到第 9 章的构造函数按依赖顺序各调一次，再补一段事件回流的接线：

```ts
// src/app/miniElectron.ts · createApp（装配部分）
export function createApp(options: { main(app: AppContext): void }): App {
  const manager = createWindowManager()   // 原生世界：窗口资源表
  const loop = createRunLoop()            // 原生世界：消息循环
  const bridge = createBridge()           // binding：注册表 + 序列化
  const runtime = createRuntime('main')   // 嵌入：一个 JS 世界
  const asyncBridge = createAsyncBridge(bridge)  // 异步桥：耗时调用排队
  const dispatch = createEventDispatch(loop)     // 事件回流：订阅分发
  installWindowApi(runtime, bridge, manager)     // 把窗口能力注册上桥、注入 JS
  // …renderUI/onAction 的接线（见下文）…
  runtime.run(() => options.main(ctx))    // 用户脚本在这里跑起来
  return { runtime, bridge, asyncBridge, manager, loop, dispatch, elIdByPath }
}
```

顺序不是随意的：runtime 要先于 installWindowApi 存在（往哪注入），bridge 要先于 dispatch（事件回流最终也依赖桥之上的抽象）。真实 Electron 的启动序列同构：起主进程 → 装原生模块 → 建 binding → 才轮到你的 main.js。`runtime.run(...)` 是用户代码的入口——壳的全部意义就是保证脚本执行的那一刻，世界已经装好了。

真正的新代码只有一段：**renderUI 的接线**，它解决「按钮点击怎么知道该调哪个 JS 函数」：

```ts
// src/app/miniElectron.ts · renderUI（核心接线）
const renderUI = (win: WindowHandle, ui: UiNode): void => {
  const walk = (node: UiNode, path: string): void => {
    const elId = elIdFor(win.id, path)        // 元素 id 稳定于「窗口 + 树位置」
    if (node.onClick) {
      actionByEl.set(elId, node.onClick)
      if (!hookedEls.has(elId)) {
        hookedEls.add(elId)
        dispatch.onWindowEvent(elId, 'click', (payload) => {
          const action = actionByEl.get(elId)
          if (action) actionFns.get(action)?.(payload)
        })
      }
    } else {
      actionByEl.delete(elId)
    }
    node.children?.forEach((child, i) => walk(child, path === '' ? String(i) : `${path}/${i}`))
  }
  walk(ui, '')
  win.setUI(ui) // 树本体走桥进原生世界，整棵替换
}
```

三个接线决定。其一，**元素 id 绑定树位置而不是绑定节点**：第 N 次渲染的「窗口 1 第二个子节点」永远拿到同一个元素 id——重渲染换掉了整棵树，但位置稳定的按钮 id 不变，事件订阅不用反复解绑重挂（`hookedEls` 保证每个 id 只挂一次）。其二，**两段式路由**：树里只能写字符串动作名（序列化边界），JS 侧再用 `onAction` 把名字接回函数——这正是第 4 章「函数过不了边界，用 id 反查」预言的标准解法，也是真实框架里 `onclick="字符串"` 与事件委托的合流点。其三，**渲染与订阅同走一遍 walk**：改了树（按钮没了）就顺路清掉 `actionByEl` 的旧映射，幽灵动作不留。

还有个测试辅助值得一看，它演示「用户点击」在这套体系里的真实身份：

```ts
// src/app/miniElectron.ts · simulateClick
export function simulateClick(app: App, winId: number, path: string): void {
  const id = app.elIdByPath.get(`${winId}::${path}`)
  if (id === undefined) throw new Error(`[miniElectron] no element at ${winId}::${path}`)
  emitNative(app.loop, { type: 'click', targetId: id, payload: {} })
  app.loop.pumpOnce()
}
```

一次点击 = 一条 `{ type: 'click', targetId }` 消息进队列 + 泵转动一次。没有任何「上帝视角」直接调你的回调——模拟用户和真用户走的是同一条路。

## 验证：完整回路

`pnpm test` 六条断言，拼出一条完整回路：

- main 跑起来后，原生侧快照 `{ title: 'Counter', visible: true }`；
- `renderUI` 落进原生：快照的 `ui` 树里文本是 `'0'`、按钮动作名是 `'inc'`；
- `simulateClick(app, 1, '1')`（窗口 1 树位置 1 的按钮）之后：动作执行、重渲染、**原生快照文本变 `'1'`**——一次点击穿越了：OS 消息 → 队列 → 泵 → 订阅表 → 动作名反查 → JS 回调 → 重渲染 → 桥 → 原生树替换；
- 连点三次文本到 `'3'`，事件按序处理；
- 点文本节点（没有动作名）无事发生；
- 整棵替换结构的重渲染，快照同步变化。

回路的每一环都是前面某章亲手造的零件，这一章只是把它们拧在一起——**没有新原理，只有装配**，这正是「理解了原理，框架就不再是黑盒」的含义。

## 小结

`createApp` 是生命周期之壳：按依赖顺序装配五个零件（管理器、循环、桥、运行时、分发器），用 renderUI 把「纯数据 UI 树 + 字符串动作名 + onAction 注册」接成双向回路。用户脚本与原生世界的全部交往被收进三个注入函数。至此这门课的主线闭环：从 OS 的一条消息，到 JS 的一段回调，再回到屏幕上（结构快照里的）一个新数字。最后一章站在这个自制内核上，回望 Electron、Tauri、Qt 绑定这些真实方案——它们都是这套零件的不同取舍。
