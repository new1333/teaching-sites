---
title: createPinia：一个挂在 app 上的容器
---

# createPinia：一个挂在 app 上的容器

先复现本章要治的病。两个测试用例，各自 `import` 同一个模块级 store，第一个用例把 `count` 改成 10，第二个用例断言 `count === 0`——单独跑全绿，一起跑必红。CI 里用例顺序一变，红绿跟着变，没人敢动测试文件顺序的那天，这个项目就开始烂了。病根我们在第 1 章诊断过：**状态没有「应用」的边界**。模块级单例挂在模块上，而模块是全进程共享的；它应该挂在一个「随应用创建、随应用销毁」的东西上。

这个东西就是容器（Pinia instance）。这一章实现 `createPinia()`——全书最小的一块砖，后面九章都垒在它上面。

## 容器要管哪几件事

回看第 1 章的四问，「归谁」这一问落到数据结构上，就是容器身上要挂的五样东西：

1. **根状态** `state`：一个 ref，装着 `Record<storeId, 状态树>`——所有 store 的状态的集中营。集中放而不是散在各个 store 里有三个理由：SSR 序列化时一把抓、devtools 一屏看全、`$reset`/hydration 有权威数据源。
2. **store 注册表** `_s`：`Map<id, store>`——单例身份的物理基础，第 4 章的主角。
3. **效应作用域** `_e`：容器级 effectScope，容器里创建的所有响应式效果都归它收容；`disposePinia` 一个 `stop()` 全部清场。
4. **插件列表** `_p` 与 `use()`：扩展点，第 10 章的主角，本章先把登记处建好。
5. **install**：一个函数，`app.use(pinia)` 时被调用——容器与应用的握手仪式。

## 实现

伴生实现新增 `src/rootStore.ts`（容器接口与活动容器）和 `src/createPinia.ts`（容器工厂）。先看核心的工厂函数：

```ts
export function createPinia(): Pinia {
  const scope = effectScope(true)
  const state = scope.run<Ref<Record<string, StateTree>>>(() =>
    ref<Record<string, StateTree>>({})
  )!

  let _p: PiniaPlugin[] = []
  // install 之前 use 的插件先缓冲，install 时补挂
  let toBeInstalled: PiniaPlugin[] = []

  const pinia: Pinia = markRaw({
    install(app: MinimalApp) {
      setActivePinia(pinia)
      pinia._a = app
      app.provide(piniaSymbol, pinia)
      app.config.globalProperties.$pinia = pinia
      toBeInstalled.forEach((plugin) => _p.push(plugin))
      toBeInstalled = []
    },

    use(plugin: PiniaPlugin) {
      if (!this._a) {
        toBeInstalled.push(plugin)
      } else {
        this._p.push(plugin)
      }
      return this
    },

    _p,
    // @ts-expect-error
    _a: null,
    _e: scope,
    _s: new Map<string, StoreGeneric>(),
    state,
  })

  return pinia
}
```

三十行不到，但每一行都有讲究。逐个拆。

**为什么 `effectScope(true)`**。参数 `true` 表示「可分离」（detached）——这个 scope 不挂到任何外层 scope 上。容器是顶层住户，它若挂进了调用方恰好所在的 scope，调用方 scope 一停，容器陪着死。`scope.run(() => ref({}))` 把根 state 的创建收进 scope，这样未来任何在容器 scope 里创建的效果与它是同一家。

**install 的五个动作，次序有意**。`setActivePinia(pinia)` 打头：install 完成的那一刻，模块级的活动容器（activePinia）就指向它——组件外调用 `useStore()` 时靠它找到家。然后 `app.provide(piniaSymbol, pinia)` 把容器登记进应用：组件树里的 `inject(piniaSymbol)` 从此取得到。`$pinia` 挂上全局属性是给 devtools 与调试留的后门。最后补挂缓冲的插件——为什么插件要缓冲？因为 `pinia.use(persistPlugin)` 这行代码可能出现在 `app.use(pinia)` **之前**（比如在创建 pinia 的同一个文件里连续配置），此刻 `install` 还没跑、`_a` 还是空，插件挂了也没有 app 可用；先存进 `toBeInstalled`，install 时一次性转正。

**markRaw 包住整个容器**。防止用户把容器塞进某个 reactive 对象时，Vue 把容器本身代理掉——代理容器没有任何好处，还会让 `pinia === proxy` 判定失效、依赖追踪平白多出一堆。markRaw 是「别动我」的正式声明。

## MinimalApp：测试不需要真的 Vue 应用

真 pinia 的 `install(app: App)` 接收完整 Vue 应用。但 install 实际只用到三个口：`provide`、`runWithContext`、`config.globalProperties`。pinia-mini 把它声明成结构类型：

```ts
export interface MinimalApp {
  provide: (key: unknown, value: unknown) => void
  runWithContext?: <T>(fn: () => T) => T
  config: { globalProperties: Record<string, any> }
}
```

真的 Vue App 结构上满足它（鸭子类型），测试里则用一个二十行的桩对象代替——不需要 `createApp`、不需要 DOM。这个决定让全书测试跑得飞快，也逼我们把「install 到底依赖什么」想清楚。顺带一提，真 pinia 官方测试用的是 `@vue/test-utils` 挂真应用，那是另一个极端，各有取舍。

## 活动容器：rootStore.ts 的三行

```ts
export let activePinia: Pinia | undefined

export const setActivePinia = (pinia: Pinia | undefined) => (activePinia = pinia)

export const getActivePinia = (): Pinia | undefined =>
  (hasInjectionContext() && inject(piniaSymbol)) || activePinia
```

一个模块级变量、一对读写函数。就这么简单？是，也不全是——这个变量是第 11 章 SSR 串号事故的案发现场，「谁在什么时候 setActivePinia」的纪律是那章的核心。现在先记住结论：**容器内有两条找到家的路：组件内走 inject（随应用隔离，天然安全），组件外走 activePinia（模块级，全进程共享——危险但必要）**。

`getActivePinia` 里 `hasInjectionContext() && inject(...)` 的短路写法不是炫技：`inject()` 在 setup 之外调用会抛警告，`hasInjectionContext()` 先探一眼「我在不在组件里」，不在就直接短路，连 inject 都不碰。

## 验证

伴生实现的门槛这次是三个断言组：

```text
✓ install 后成为活动容器，并可经 piniaSymbol 注入
✓ 每个容器拥有各自独立的 state
✓ 新容器自带空注册表与活跃的效应作用域
```

第二个断言组就是本章痛点的那对测试用例的解药示范：两个 `createPinia()` 的 state 互不相干——下个用例想要干净环境，`createPinia()` 一个就好。`tsc --noEmit` 与 `vitest run` 双门槛通过。

与真源码对照：`packages/pinia/src/createPinia.ts` 共 79 行，多出来的是 devtools 注册（`registerPiniaDevtools`）与 `disposePinia`（mini 也实现了，五行）。思想与上面三十行完全一致。

## 小结

容器五件套：根 state（集中营）、注册表（单例的物理基础）、效应作用域（效果的收容所）、插件列表（扩展点）、install（与应用握手）。install 时 `setActivePinia` + `provide` 双通道铺好了「找到家」的两条路。但容器本身还是空的——`_s` 注册表里一个 store 都没有。下一章实现 `defineStore`：往注册表里放第一个住户，并回答「为什么两次调用拿到的是同一个」。
