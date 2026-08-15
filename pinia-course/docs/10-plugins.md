---
title: 插件系统：pinia.use 与 store 扩展
---

# 插件系统：pinia.use 与 store 扩展

一个闷声亏钱的 bug。团队决定给所有 store 加「持久化到 localStorage」：每个 store 手工抄一遍「订阅变化 → 序列化 → 写存储」的三行逻辑。第一个 store 抄对了，第二个抄对了，第三个抄漏了一行反序列化——用户的购物车在刷新后**悄悄变空**，没有任何报错，直到客服截图过来才发现。这类「N 个地方抄同一段逻辑」的方案，抄漏只是时间问题；而且就算全抄对了，想再加一个「时间旅行调试」，难道再抄 N 遍？

正确答案是把「对每个 store 做一次的事」抽成一个**钩子**：store 创建的那一刻，库替你回调。这就是插件系统——pinia 的生态位（持久化、重置路由、数据抓取、测试 mock 全靠它）。

## use 的契约与一个反直觉的时序

第 3 章建容器时我们就把登记处建好了：`pinia.use(plugin)` 把函数推进 `_p` 数组。本章补上**消费端**：每个 store 创建时跑一遍全部插件。

有个反直觉的时序先钉死：**`use` 要在 install 之后调用**——install 之前 `use` 的插件不会立刻生效，只进 `toBeInstalled` 缓冲（第 3 章 install 的五个动作里，最后一个就是把缓冲转正）。为什么？插件拿得到的 context 里有 `app`——app 在 install 之前根本不存在。官方测试里那句注释写得直白："must call use after installing the plugin"。这不是缺陷是契约：**插件的生命周期从应用就绪那一刻开始**。

## 实现：管线五步

插件管线装在 `createSetupStore` 的末尾——store 血肉齐了、`$patch`/`$subscribe` 都能用了，才轮到插件来扩展：

```ts
// 应用插件：每个 store 创建时跑一遍全部已注册插件，返回值合并进 store
const optionsForPlugin = assign({ actions: {} }, options, { id: $id })
pinia._p.forEach((extender) => {
  const extensions = scope.run(() =>
    extender({
      store,
      app: pinia._a as MinimalApp,
      pinia,
      options: optionsForPlugin as DefineStoreOptionsInPlugin,
    })
  )!
  assign(store, extensions ?? {})
})
```

五行管线，五个决策：

**位置在最后**。插件拿到的 store 必须是「完全体」——状态挂好了、getter 能算、订阅能注册。放在中间任何一步，持久化插件想 `$subscribe` 都没门。

**context 四件套**。`{ store, app, pinia, options }`——当前 store（扩展对象）、应用实例（注册全局资源）、容器（再取别的 store）、定义选项（读 store 的元配置，比如持久化插件读 `options.persist` 决定要不要持久化）。**给扩展者的视野，决定了生态的上限**。

**`optionsForPlugin` 补齐 id 和 actions**。插件拿到的 options 是「插件视角」的规范化形态——不管选项式还是组合式，`id` 一定在，`actions` 一定有（组合式的 actions 在分类循环时已归进 optionsForPlugin 的语义里）。

**`scope.run` 包住插件执行**。插件里创建的任何响应式效果（`$subscribe` 的 watcher）都被收进 store 的 scope——`$dispose` 时统一清场，第 8 章的收容所纪律对插件同样生效。

**返回值 `assign` 进 store**。插件返回 `{ router: {...} }`，store 上从此有 `router` 属性。只有「创建时」这一枪：已存在的 store 不回补（我们的测试专门验证了这点）——回补会让「插件何时生效」变得不可推理。

## 完整示例：持久化插件

管线五步是死板的，插件能做什么才是活的。开章那个亏钱 bug 的正确解法，二十行：

```ts
function persistPlugin({ store }: any) {
  const key = `pinia-${store.$id}`
  const saved = localStorage.getItem(key)
  if (saved) store.$patch(JSON.parse(saved))   // 水合：旧数据赢

  store.$subscribe(
    (_mutation, state) => {
      localStorage.setItem(key, JSON.stringify(state))  // 落盘
    },
    { detached: true }   // 活过 scope：store 销毁订阅也不撤
  )
}

const pinia = createPinia()
app.use(pinia)
pinia.use(persistPlugin)
```

三行逻辑各就各位：创建时**水合**（storage 有旧值就 `$patch` 灌回——第 6 章「旧数据赢」的纪律，第 7 章「一次事件」的通道，全是白拿的）；变更时**落盘**（`$subscribe` 一行，所有 action、所有 `$patch`、所有直接赋值全覆盖——第 8 章观测体系的红利）；`detached: true` 让订阅不被作用域自动回收。**前面七章搭的每一块砖，插件都在踩**——这也是为什么插件系统排在倒数第二章：它是前九章能力的总集成测试。

伴生实现的测试里用 `Map` 当 localStorage 桩（不碰真 DOM），并验证了最关键的一步：`$dispose()` 销毁 store 后重新 `useCart()`，`count` 从存储恢复为 3——「新会话不丢状态」完整成立。

## 验证

```text
✓ 插件返回值合并进之后创建的每个 store，已存在的 store 不回补
✓ install 之前 use 的插件在 install 时补挂，对之后新建的 store 生效
✓ context 携带 store / pinia / options
✓ 持久化插件：$patch 后写入存储桩，重建 store 时水合
```

`tsc --noEmit` 与 `vitest run` 双门槛通过，累计 40 个测试全绿。

与真源码对照：真 pinia 的插件应用点还有两道保险——开发模式下检查插件返回值里有没有「裸对象」（没 markRaw/ref 包装的对象会在 reactive 化后失去身份，给一条诊断警告 PINIA_R1006），以及 `app.runWithContext` 包裹（保证插件里 `inject` 能找到正确的应用——第 11 章的主角）。管线主干与上面五行一致。

## 小结

插件系统 = 登记处（第 3 章的 `use`/`_p`/缓冲）+ 消费点（store 创建末尾的五行管线）+ context 四件套。位置在最后、返回值 assign、scope 收容、创建时一次性——每个决策都在保护「可推理」。持久化插件三行逻辑白拿前九章全部基建：水合、一次事件、观测、作用域。pinia-mini 到此功能完备。下一章暂别代码，推演一个事故：SSR 串号——活动容器这把双刃剑的安全纪律。
