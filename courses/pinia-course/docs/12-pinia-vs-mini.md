---
title: pinia-mini vs pinia：差异地图
---

# pinia-mini vs pinia：差异地图

你刚用十二章从零写出了一个功能完备的 pinia-mini——但打开真仓库的 `packages/pinia/src/store.ts`，970 行，比你整个伴生实现还多一半，而且里面近一半的东西你没见过：`_hmrPayload`、`hotUpdate`、`ACTION_MARKER`、`diagnostics`、`__DEV__` 分支……读源码迷路的根源不是难度，是**没有地图**：不知道多出来的每一块各自保卫什么、为什么可以不在。这一章就是那张地图——逐 API 对照 mini 与真 pinia，给每块「多出来的代码」标注存在理由，最后给出啃真源码的推荐入口顺序。

## 总量对照

先看数字。mini 的 `src/` 共 678 行；真 pinia 的 `src/`（不含 devtools 目录与测试）2933 行：

| 模块 | mini | 真 pinia | 差距主要来自 |
|---|---|---|---|
| store.ts | 404 | 970 | HMR、开发警告、this 重绑、runWithContext |
| types.ts | 102 | 723 | 四层泛型的完整类型推导 |
| mapHelpers.ts | — | 554 | Vuex 兼容层（mini 整个不做） |
| rootStore.ts | 33 | 172 | getActivePinia 的 SSR 警告、接口文档 |
| storeToRefs.ts | 30 | 116 | 类型层（运行时逻辑几乎等价） |
| createPinia.ts | 55 | 79 | devtools 注册 |
| subscriptions.ts | 38 | 33 | 几乎一致 |

两个立刻能读出的事实：**运行时逻辑的差距远小于行数差距**（storeToRefs 30 vs 116，多出的 90 行是类型）；**三块真源码 mini 整体不做**（mapHelpers、hmr、devtools），它们是「生态与开发体验」而不是「内核」。

## 逐 API 差异对照

### createPinia / disposePinia

mini 55 行 vs 真 79 行。差异几乎只有一处：`registerPiniaDevtools(app, pinia)`——浏览器里按装 Vue Devtools 才走的注册分支（`__USE_DEVTOOLS__ && IS_CLIENT` 双守卫）。存在理由：devtools 的时间旅行依赖 pinia 主动上报 store 树。为什么可以不在：它是纯消费者，不改变任何运行时语义。你的 mini 装不上 devtools，但行为完全一致。

### defineStore / useStore

mini 的 useStore 与真 pinia 主干逐字对应（三级回退、查表、登记）。多出的三块：

- `__TEST__` 分支：测试模式下忽略传入的 pinia 参数，强制走活动容器——让 `createTestingPinia` 能劫持一切取用。测试基建，非内核。
- `useStore._pinia = pinia`（DEV）：给 devtools 从组件实例反查 pinia 用的注记。
- HMR 分支：`hot._hotUpdate(newStore)`——开发时改了 store 定义文件，Vite 热更新不刷新页面、现场状态原样迁移到新定义。`_hmrPayload`（actions/getters/state 的登记册）就是为它准备的。存在理由：没有它，开发时每次改 store 都丢状态重走流程。为什么可以不在：它只影响开发时的刷新体验，生产构建里整块被 tree-shake。

### createSetupStore（分类循环）

mini 404 行 store.ts 的主干与真 pinia 相同，但四个细节被 mini 刻意简化：

1. `ACTION_MARKER` / `ACTION_NAME` 两个 Symbol——真 pinia 给 action 外壳打的标记，`hotUpdate` 时识别「这个函数已经是包装过的」防止套两层壳。mini 没有 HMR，不需要。
2. `this` 重绑：真 pinia 的外壳用 `fn.apply(this && this.$id === $id ? this : store, args)`——HMR 期间新 store 调旧 action 时绑回新 store。mini 恒绑 `store`。
3. 两个静音标志 vs 一个：第 8 章末尾说过——真 pinia 有 `isListening` 与 `isSyncListening` 双标志，因为它的 sync watcher 在 patch 结束瞬间就要恢复收听；mini 统一 nextTick 恢复，边角时序略钝，主行为一致。
4. hydration 的守卫差异：真 pinia 用 `shouldHydrate`（配合 `skipHydrate()` 逃生舱，允许 setup 返回「响应式但不是状态」的东西跳过水合）；mini 用 `key in initialState`——语义更直白，边角少一层可配置性。

### $patch / $reset / $state

mini 与真 pinia 的 `mergeReactiveObjects` 逻辑一致（含 Map/Set 分支的「服务 hydration」定位——第 7 章我们顺着官方测试还原了这个语义）。真 pinia 多出的是 `$patch` 里对 `debuggerEvents` 的收集——把每次变更的底层事件（哪个 key、新旧值）打包进订阅事件，devtools 时间旅行的数据源。又是纯消费者。

### $subscribe / $onAction / $dispose

subscriptions.ts 两边几乎逐行相同（38 vs 33，mini 注释多）。真 pinia 多两处：`$subscribe` 对同一回调重复订阅返回 noop 并在 DEV 报警（mini 返回空函数但不报警）；订阅事件里的 `events` 字段（同上，devtools 数据源）。

### storeToRefs

运行时逻辑等价（第 9 章引过：真 pinia 的 `value?.effect` 判定与 `toRef`/`computed` 包装与 mini 相同）。多出的 90 行全是类型：`_ToStateRefs`/`_ToComputedRefs` 把「state→Ref、getter→ComputedRef、可写 getter→WritableComputedRef」表达到类型层。**类型即文档**——mini 用 `Record<string, any>` 换掉了这层表达，代价是 `count.value` 没有自动补全的 `number` 类型。

### 插件

管线五行一致。真 pinia 多两道 DEV 保险：插件返回「裸对象」的诊断警告（PINIA_R1006——裸对象被 reactive 化后失去身份）、`app.runWithContext` 包裹（第 11 章第三道防线）。mini 都没做——前者是开发体验，后者是 SSR 边角加固。

### mini 完全不做的三块

- mapHelpers.ts（554 行）：`mapState`/`mapActions`/`mapStores`——Vue 2 选项式组件的 Vuex 风格语法。Vue 3 组合式 API 下的新代码基本不用，纯兼容层。
- hmr.ts（122 行）：热更新的状态迁移（`patchObject` 按 option/setup 两种语法的差异化迁移，本章开头那批 `_hotUpdate` 细节的实现所在）。
- devtools/（7 个文件）：与 Vue Devtools 面板的协议对接。

三块的共同点：都挂在内核已有的钩子上，不碰内核路径。这就是「内核与生态分层」的价值——你写的 mini 少了它们依然是一个正确的 pinia。

## 类型层的差距（最大也最值得看）

723 行的 types.ts 是真 pinia 最大的单文件，也是 mini 刻意绕开的山：`defineStore` 的四层泛型 `Id/S/G/A`、`Store<Id, S, G, A>` 的交叉类型、Setup Store 的 `_ExtractXxxFromSetupStore` 条件类型——全为了一个目标：`const { count, double, increment } = store` 每个都有精确类型，`store.typo` 编译期报错。mini 的测试里那些 `this: any` 标注，就是绕开这座山付的学费。想进阶类型体操，这个文件是比任何教程都好的教材——但建议啃完运行时再回来。

## 啃真源码的推荐入口

按依赖方向、由短到长：

1. `subscriptions.ts`（33 行）——与你的版本并排读，热身。
2. `createPinia.ts`（79 行）——看 devtools 注册挂在哪。
3. `rootStore.ts`（172 行）——看 getActivePinia 的 SSR 警告与你的第 11 章对照。
4. `storeToRefs.ts`（116 行）——运行时部分你会秒懂，然后顺着类型往下读。
5. `store.ts`（970 行）——**跳着读**：先读 `defineStore`→`createSetupStore` 主干（与你的一一对应），再挑一块外围（建议 HMR：`_hmrPayload` 与 `hotUpdate`，用第 5、6 章的「分类」与「hydration」概念去读，会发现它就是「把分类登记册拿来重放」）。
6. 最后才是 `types.ts`——把它当类型体操教材，不当必读物。

## 小结

真 pinia = 你的 mini + 三类增量：**开发体验**（HMR、devtools、诊断警告）、**生态兼容**（mapHelpers）、**类型表达**（723 行 types）。三类都挂在内核已有钩子上，不碰内核路径——所以 mini 才能以 678 行达到行为等价。这张地图的用法不是「背差异」，是带着它进真源码：每读一块，先问「它挂在哪个钩子上、保卫什么」——问得出来，你就没迷路。
