---
title: 插件 API：第三方库的面板
---

# 插件 API：第三方库的面板

一个真实生态里反复上演的剧情：路由库的用户在工单里问「为什么调试器里看不到当前路由？」路由库作者一看，官方调试器只有组件树和状态两块面板，路由信息根本没地方放。于是作者给库加了调试集成，发布。三天后又来一批工单：「升级后面板时有时无」。排查发现是时序：库的初始化跑在应用登记之前——注册面板的时候，调试器那边还没有「活动应用」，注册请求不知道该挂在谁名下，石沉大海。更微妙的是这个 bug 只在特定加载顺序下出现：库先加载就丢，应用先加载就好，完美复刻了第 2 章开篇那个「网络快数据在、网络慢数据丢」的监测脚本事故。

这一章做插件 API：让第三方库能挂自己的面板（检查器），并且无论谁先初始化都不丢注册。你会看到重放队列的思想在这里原样复用——**同一个时序问题，同一套老兵解法**。

## 插件的注册面

第三方库能拿到什么？一个受控的 API 对象：

```ts
// src/plugin.ts · PluginApi
export interface PluginApi {
  on(name: string, fn: (...args: any[]) => void): () => void
  addCustomInspector(descriptor: InspectorDescriptor): void
}
```

`on` 挂在事件系统上——插件能收到组件更新这类语义事件，但收不到原始钩子的怪载荷（第 3 章的守门对插件同样生效）。`addCustomInspector` 注册一块面板。检查器的描述符把「拉树」与「拉状态」声明成两个函数：

```ts
// src/plugin.ts · InspectorDescriptor
export interface InspectorDescriptor {
  id: string
  label: string
  /** 拉树：每次调用重新执行（按需，不缓存） */
  tree: () => InspectorTreeNode[]
  /** 拉状态：每次调用重新执行 */
  state: () => InspectorStateItem[]
}
```

函数即接口，这是整个插件 API 最重要的设计决策。调试器不问「你的面板数据长什么样」，只问「我问你要的时候你给什么」。路由面板的树是路由表的结构，状态管理面板的树是 store 列表——调试器统统不知道，也不需要知道。拉取按需执行、不缓存，意味着面板每次刷新看到的都是当下最新值——第 5 章「按需拉取」的哲学原封不动地传给了插件。

状态项复用第 6 章的 `InspectorStateItem`——插件面板里的值与组件面板里的值走同一套分类、清洗、editable 约定，UI 渲染组件只需写一份。

## 缓冲与重放：老兵新传

注册入口的骨架：

```ts
// src/plugin.ts · setupDevToolsPlugin
export function setupDevToolsPlugin(descriptor: PluginDescriptor, setupFn: (api: PluginApi) => void): void {
  const active = getCurrentRegistry().activeAppRecord?.app as AppLike | undefined
  if (active && matchesApp(descriptor, active)) {
    setupFn(createPluginApi())
    return
  }
  pluginBuffer.push({ descriptor, setupFn })
}
```

对照第 2 章的 `queueUntilHookInstalled`，结构一模一样：就位就执行，没就位就排队。变化的只有「就位」的定义——那边是钩子挂上了没有，这边是有没有活动应用。应用登记后，重放发生：

```ts
// src/plugin.ts · registerPluginsForApp
export function registerPluginsForApp(app: AppLike): void {
  getCurrentRegistry().registerApp(app)

  const remaining: typeof pluginBuffer = []
  for (const entry of pluginBuffer) {
    if (matchesApp(entry.descriptor, app))
      entry.setupFn(createPluginApi())
    else
      remaining.push(entry)          // 不属于这个应用的：继续等
  }
  pluginBuffer.length = 0
  pluginBuffer.push(...remaining)
}
```

三处细节各有一场戏。`matchesApp` 按 `descriptor.app` 过滤：未指定 app 的插件跟随任何应用登记；指定了的，只在该应用登记时重放——微前端里「子应用的库只挂子应用的面板」靠它成立。重放过的条目从缓冲移除，绝不二次执行——插件执行两次，面板就注册两次，事件就监听两份，这类事故在插件系统里是常客。不匹配的条目留在缓冲里继续等——多应用逐个登记时，每个插件都会等到属于自己的那一刻。

`registerPluginsForApp` 顺手把应用登记进登记处（幂等）。真实链路里「应用 init」与「重放插件」本来就同时发生——第 2 章的钩子送来 init，登记处建记录，插件缓冲接着重放，一棒接一棒。

## 拉取：注册表的另一半

检查器注册表是个普通的 `Map`，拉取是薄薄一层：

```ts
// src/plugin.ts · getInspectorTree
export function getInspectorTree(inspectorId: string): InspectorTreeNode[] {
  try {
    return inspectors.get(inspectorId)?.tree() ?? []
  }
  catch {
    return []
  }
}
```

查无此检查器返回空数组，插件给的函数抛错也返回空数组——第 6 章立下的纪律（失败降级为数据）第三次出场：这次要防的是第三方代码的任意失败。`getInspectorState` 同构。UI 侧的体验因此非常稳：面板要么有内容，要么空着，永远不会因为某个库的 bug 整体崩掉。

## 验证

把开篇剧情的三种时序各钉一条：

```ts
// tests/plugin-and-inspector.test.ts · 节选
it('无活动应用时进缓冲，registerPluginsForApp 后执行恰好一次', () => {
  const setupFn = vi.fn()
  setupDevToolsPlugin({ id: 'router', label: 'Router' }, setupFn)

  expect(setupFn).not.toHaveBeenCalled()          // 库先加载：进缓冲，不丢

  const app = createApp('main', 1)
  registerPluginsForApp(app)
  expect(setupFn).toHaveBeenCalledTimes(1)

  registerPluginsForApp(app)                       // 重放过的不再重放
  expect(setupFn).toHaveBeenCalledTimes(1)
})

it('descriptor 指定了 app 时只在该应用登记后重放', () => {
  const setupFn = vi.fn()
  const subApp = createApp('sub', 2)
  setupDevToolsPlugin({ id: 'scoped', label: 'Scoped', app: subApp }, setupFn)

  registerPluginsForApp(createApp('main', 1))
  expect(setupFn).not.toHaveBeenCalled()          // 不属于 main：继续等

  registerPluginsForApp(subApp)
  expect(setupFn).toHaveBeenCalledTimes(1)
})
```

插件面板的端到端也各钉一条：注册检查器后 `getInspectorTree` / `getInspectorState` 拉到插件给的树与状态；树函数每次调用重新执行（用自增版本号证明不是缓存）；`api.on` 从钩子事件一路到达插件（把 `subscribeHook` 接上 `pluginEvents`，钩子 emit、插件收货）。加查无此检查器的空返回，本章八条断言，全书累计六十四条全绿。

## 小结

插件 API 是全书前半部分的一次总演习：缓冲重放是第 2 章会合点边的老招式，事件挂载走第 3 章的桥，app 过滤靠第 4 章的应用记录与实例表，状态项复用第 6 章的状态快照形态，按需拉取沿袭第 5 章遍历器的哲学，将来这些数据出页面仍要靠第 7 章的编码传输。第三方库由此获得一块自留地，调试器从「官方功能集」长成了「生态平台」。

还剩最后一块硬骨头：UI 客户端与页面内核分处两个世界，插件面板的树与状态、组件树、快照、回写指令，都要在这两个世界之间来回跑。双向 RPC 与通道就是这条双向车道的轨枕，下一章把它铺出来；终章再由宿主与中继把整条路架进 iframe、开发服务器与扩展面板。
