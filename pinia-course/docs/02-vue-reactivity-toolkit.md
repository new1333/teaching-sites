---
title: Vue 响应式工具箱：pinia 的六块地基
---

# Vue 响应式工具箱：pinia 的六块地基

先看一个会咬人的坑。你在组件外写了一段全局逻辑：

```ts
import { reactive, watch } from 'vue'

const state = reactive({ token: '' })
watch(() => state.token, (t) => analytics.report(t))
```

组件里用得好好的。某天这段代码跑进了测试：第一个用例触发了一次回调，第二个用例又触发了一次——而你的断言写的是「恰好一次」。测试红了，你盯着 `watch` 看了半天没看出问题。真相是：**这个 watcher 从创建起就没人负责停掉它**，它不属于任何组件，没有销毁时机，于是一直活着、一直听。这类「创建了的响应式效果没人收拾」的泄漏，就是 pinia 要用 effectScope 解决的第一个问题。

pinia 没有自己的响应式系统——它整个建在 Vue 的六个原语上。这一章把这六块地基过一遍，重点讲它们的**非显然用法**：pinia 用到的方式和你在组件里用的不太一样。读完这章，后面十章里出现的每一行 `toRefs`、`effectScope` 你都不会陌生。

## 第一块：ref——装值的盒子

`ref(0)` 返回一个带 `.value` 的盒子。要点在于：**对 `.value` 的读写是建立依赖的时机**。

```ts
import { ref } from 'vue'

const count = ref(0)
count.value++        // 触发依赖它的效果重新执行
```

pinia 的容器上挂着 `state: Ref<Record<string, StateTree>>`——一个 ref，里面装着「所有 store 的所有状态」这棵大对象。为什么用 ref 包而不是直接 reactive？因为 ref 可以**整体替换**（`pinia.state.value = {}`），而 reactive 对象换不得引用。销毁容器时这一手就用了。

## 第二块：reactive——代理整个对象

`reactive(obj)` 返回 obj 的 Proxy：任何属性的读取都会被追踪，写入都会通知依赖。两个坑：

**解构即断连**。`const { n } = reactive({ n: 1 })` 拿走的是当时的数字快照，从此与代理无关。这是第 9 章 storeToRefs 要正面解决的问题。

**深层代理**。嵌套对象读出来时也被自动代理了——`state.nested.x = 1` 依然触发更新。pinia 的 `$subscribe` 能监听到任意深度的修改，靠的就是它。

还有一对搭档：`isRef(x)` / `isReactive(x)` 运行时判断。第 6 章的「运行时分类」——判断 setup 返回的每个属性是状态、getter 还是 action——完全建立在这两个函数加上 `typeof x === 'function'` 上。**pinia 对 store 属性的分类不是声明式的，是检查出来的**。

## 第三块：computed——带缓存的派生值

`computed(() => a.value * 2)` 缓存结果，依赖不变就不重算。pinia 的 getter 就是它。

非显然的部分：怎么识别「一个值是 computed」？Vue 没有官方的 `isComputed`。pinia 的做法很刁：`isRef(x) && x.effect`——computed 内部是个带 effect 的特殊 ref，`x.effect` 存在即 computed。第 6 章分类时「getter 通道」与「状态通道」的分界线就是这一句。另一个非显然点：**computed 可以带 setter**（`computed({ get, set })`），第 9 章的 getter refs 化会用到。

## 第四块：watch——观察与时机

`watch(source, cb)` 观察 ref/reactive/getter。pinia 的 `$subscribe` 内部是一个 `watch(store.$state, cb, { deep: true })`。

要害是**时机**：默认 `flush: 'pre'`，回调在组件渲染前批处理；`flush: 'sync'` 则同步执行——同一秒内改三次状态，两种模式回调次数不同。pinia 里 `$subscribe(cb, { flush: 'sync' })` 与默认行为的差异就来自这里。第 8 章会看到 pinia 用两个布尔量（`isListening` / `isSyncListening`）精细控制这条通道，避免 `$patch` 把回调触发多次。

## 第五块：effectScope——效果的收容所

六块里最陌生的一块，也是 pinia 骨架级的依赖。它解决的问题就是开篇那个 watcher 泄漏：

```ts
import { effectScope, computed, watch } from 'vue'

const scope = effectScope()
scope.run(() => {
  // 这里创建的一切 computed/watch 都被 scope 收容
  const doubled = computed(() => count.value * 2)
  watch(doubled, save)
})
scope.stop()   // 一次性全部停掉，不漏一个
```

**收集**：scope.run 里创建的效果归 scope 管。**停止**：scope.stop() 一锅端。

pinia 用它两次：容器有一个 `_e` 大 scope，每个 store 又有自己的 scope。`$dispose()` 停掉 store 的 scope，watcher、getter 的 effect 全部陪葬——不用自己记账哪个效果要清理。第 3 章建容器、第 8 章订阅清理，都踩在这块地基上。

配套的还有 `getCurrentScope()` 和 `onScopeDispose(fn)`：在 scope 里注册「scope 停止时」的回调。pinia 的订阅默认随 scope 自动解绑，靠的就是它。

## 第六块：provide/inject——树上的登记处

```ts
// 祖先
app.provide(key, pinia)
// 后代组件 setup 里
const pinia = inject(key)
```

要点：**key 用 Symbol**（`piniaSymbol`），避免任何字符串撞名；inject 只能在 setup 上下文里调用，组件外调用会抛错——所以 pinia 的 `useStore()` 在组件外有一条备用通道：模块级的「活动容器」（activePinia）。这条备用通道是第 4 章的主角之一，也是第 11 章 SSR 串号事故的案发现场。

## 六块拼起来

一张地图收束本章，也预告后文每一块的去处：

```text
ref ───────────── 容器的根 state（第 3 章）
reactive ──────── store 本体的外壳（第 5 章）
computed ──────── getter 的本体（第 5 章）+ refs 化 getter（第 9 章）
watch ─────────── $subscribe 的本体（第 8 章）
effectScope ───── 容器与 store 的生命周期骨架（第 3、8 章）
provide/inject ── 容器的登记与取用（第 3、4 章）
```

另外三件小工具顺带记下，后文随用随讲：`toRefs`/`toRef`（对象摊平成 refs——第 5、9 章的核心）、`markRaw`（告诉响应式系统「别代理这个」——插件章节见）、`nextTick`（等批量更新落地——订阅章节见）。

## 小结

ref 装值、reactive 代理、computed 缓存派生、watch 观察时机、effectScope 收容一切效果、provide/inject 做登记。pinia 没有发明任何响应式机制，它做的是**用这六块原语搭出一个有边界、有身份、可观测的状态容器**。下一章开工：先搭容器 createPinia，你会看到 `effectScope(true)` 和 `app.provide(piniaSymbol, ...)` 在三行内各就各位。
