---
title: 选项式 store：state、getters、actions 三件套
---

# 选项式 store：state、getters、actions 三件套

一个经典翻车：订单页要显示「总价」，你写了 `total() { return items.reduce((s, i) => s + i.price, 0) }` 这样一个普通方法挂进 store。页面渲染出来 0——不对，改一下数量，接口数据回来了，`items` 明明变了，总价纹丝不动。没有报错，没有警告，就是不动。你开始在组件里手动调 `total()` 强刷，越改越乱。病根：那次计算没有发生在任何被追踪的上下文里——Vue 不知道 `total` 依赖 `items`，`items` 变了它凭什么要重新算？派生值必须用 `computed` 建立依赖，这一章我们把这件事做对，并且做进 store 的骨头里。

上一章结束时注册表里住的是个只有 `$id` 的空壳。这一章实现选项式 store（Option Store）——`state`、`getters`、`actions` 三件套，用户最熟悉的 API 形态。

## 三件套各自要变成什么

先想清楚每个选项在响应式世界里对应什么，实现就剩拼装：

- **`state` 是一个工厂函数**（`() => ({ count: 0 })`）而不是对象。为什么？同一个 store 定义可能被多个容器实例化（测试、SSR），每次都要新鲜的初始状态——工厂保证不共享、可重跑（`$reset` 靠它）。
- **`getters` 要编译成 `computed`**。这是本章开篇痛点的直接解法：`double` 不是「一个函数」，是「一个带缓存的派生 ref」，依赖变了自动重算、模板里读它自动追踪。
- **`actions` 原样挂载**。函数不需要响应式加工，它要的只是调用时 `this` 指向 store 本身——挂到 store 对象上，`store.increment()` 的 `this` 自然就是 store。

而拼装的目标形态是一个统一的结构：一个对象，属性是 ref（状态）、computed（getter）、函数（action）。为什么执着于这个形态？因为它是「组合式 store」的返回值形态——选项式只是组合式的语法糖，这是 pinia 的核心设计决策，也是下一章的伏笔。

## 实现：createOptionsStore，把三件套归一

`src/store.ts` 新增两个函数。先看选项式的归一过程（完整，类型标注从简）：

```ts
// src/store.ts · createOptionsStore（完整，类型从简）
function createOptionsStore(
  id: string,
  options: DefineStoreOptions,
  pinia: Pinia
): StoreGeneric {
  const { state, actions, getters } = options

  // 状态进容器根状态：pinia.state.value[id]
  // 已有值（hydration/测试预置）时不覆盖
  if (!(id in pinia.state.value)) {
    pinia.state.value[id] = state ? state() : {}
  }
  const localState = toRefs(pinia.state.value[id])

  function setup() {
    return assign(
      localState,
      actions,
      Object.keys(getters || {}).reduce(
        (computedGetters: Record<string, ComputedRef>, name) => {
          computedGetters[name] = computed(() => {
            setActivePinia(pinia)
            // 可能跨 store 引用：从注册表现取最新的 store
            const store = pinia._s.get(id)!
            return getters![name].call(store, store)
          })
          return computedGetters
        },
        {}
      )
    )
  }

  return createSetupStore(id, setup, options, pinia, true)
}
```

四个关键动作。

**状态进容器根状态**。`pinia.state.value[id] = state()` 把整棵状态树放进容器的根 state——不是存在 store 自己身上。第 3 章讲过理由：SSR 序列化一把抓、devtools 一屏看全。注意守卫 `if (!(id in pinia.state.value))`：如果根 state 里已经有这个 id 的状态（hydration 场景：SSR 直出后客户端接管），不能覆盖——覆盖就是「刷新后登录态丢失」那个 bug。这个守卫下一章还会长大。

**`toRefs` 摊平**。根 state 里的 `pinia.state.value[id]` 是个普通对象（装在 ref 里的 plain object），`toRefs` 把它摊平成 `{ count: Ref, items: Ref }`——每个字段一个活引用。摊平之后，这些 ref 被挂到 store 上：`store.count` 读的是 ref 的解包值，`store.count = 5` 写穿 ref 直达根状态。store 的字段与状态树的字段从此是同一份数据的两个视图，改哪个都改的是同一个格子。

**getters 逐个编译成 computed**。`computed(() => getters[name].call(store, store))`——getter 函数以 store 为 `this`、以 store 为第一个参数执行。于是两种写法都工作：`double: (state) => state.count * 2`（用参数）和 `quad() { return this.double * 2 }`（用 this 互引）。computed 内部还埋了一句 `setActivePinia(pinia)`：如果 getter 里调用了别的 store 的 action（跨 store 引用），那个 action 找家时要能找到正确的容器——这是全书后段 SSR 纪律的前哨。

**归一**。`setup()` 返回 `assign(localState, actions, computedGetters)`——一个「ref + 函数 + computed」的混合对象，交给 `createSetupStore`。选项式到此功德圆满，剩下的事都在组合式的管线里。

## createSetupStore：全书最重要的函数

选项式把三件套归一成混合对象后，分类挂载的活全在 `createSetupStore` 里。它是全书最重要的函数——后面几章的功能（hydration、`$patch`、订阅、插件管线）全都长在它内部。先看它在本书这一步的完整形态：

```ts
// src/store.ts · createSetupStore（第 5 章末的形态；后面四章在标注处继续生长）
export function createSetupStore(
  $id: string,
  setup: () => Record<string, unknown>,
  options: DefineStoreOptions,
  pinia: Pinia,
  isOptionsStore?: boolean
): StoreGeneric {
  // store 自己的 scope，挂在容器 scope 下：将来 $dispose 靠它一键清场
  const scope = pinia._e.run(() => effectScope())!

  // 选项式已把 state 写进容器根状态；组合式先占位，分类时再搬
  if (!isOptionsStore && !($id in pinia.state.value)) {
    pinia.state.value[$id] = {}
  }

  // 先立外壳再登记：让 setup 里就能 use 别的 store（互相引用不成环死锁）
  const store = reactive({ _p: pinia, $id }) as unknown as StoreGeneric
  pinia._s.set($id, store)

  const setupStore = scope.run(() => setup())!

  for (const key in setupStore) {
    const prop = setupStore[key]

    if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
      // 状态通道：组合式的 ref/reactive 搬进容器根状态
      if (!isOptionsStore) {
        pinia.state.value[$id][key] = prop as Ref
      }
    } else if (isComputed(prop)) {
      // getter 通道：computed 原样挂载
    } else if (typeof prop === 'function') {
      // action 通道：函数原样挂载（订阅一章会包上 $onAction 的外壳）
    }
  }

  // 挂载：经过 reactive 外壳（读取时 ref 自动解包），同时把原始形态（含 ref）存进 raw
  assign(store, setupStore)
  assign(toRaw(store), setupStore)

  return store
}
```

用一句话说清它的流程：建 scope → 占状态位 → 立 reactive 外壳并登记进注册表 → 在 scope 里执行 setup → 逐属性分类 → 双份挂载。其中两处眼下要盯住。

三条通道，一眼望穿：是 ref 但不是 computed → 状态；是 computed → getter；是函数 → action。`isComputed` 的探测方式是 `isRef(o) && o.effect`——Vue 没有官方的 `isComputed`，但 computed 的 ref 内部有个 effect 属性，普通 ref 没有（我们在第 2 章验证过这个事实）。真 pinia 也用这一招。

**为什么先立外壳再跑 setup**。`pinia._s.set($id, store)` 发生在 `setup()` 执行之前——setup 里若 use 了别的 store、而那个 store 又反过来 use 本 store，双方都能从注册表拿到对方的外壳，不会无限递归。

挂载做了两次。`assign(store, setupStore)` 经 reactive 外壳（读取时 ref 自动解包，用户看到的是裸值）；`assign(toRaw(store), setupStore)` 把含 ref 的原始形态同时存进 raw 对象——不解包的备份。为什么要两份？第 9 章 `storeToRefs` 要遍历 raw 里的 ref 来识别状态字段，没有这份备份，挂到 reactive 上的 ref 就「溶」进去了、再也分不出哪个是状态。两行代码，为四章之后埋的雷先排掉。

## 验证

```text
✓ state 可读写
✓ getter 随 state 联动，getter 之间可以互引
✓ action 修改状态，this 指向 store
✓ $state 反映整棵状态树
```

第二条就是开篇痛点的回归测试：`s.count = 5` 之后 `s.double` 立刻是 10、`s.quad`（引用了另一个 getter）是 20——派生链路 `state → double → quad` 全部活着。`tsc --noEmit` 与 `vitest run` 双门槛通过，前三章的 7 个旧测试保持全绿。

与真源码对照：真 pinia 的 `createOptionsStore` 还处理 getter 与 state 同名的开发警告、HMR 热替换分支；`createSetupStore` 里分类循环之后还有 `$patch`/`$subscribe`/`$onAction` 的安装（后面两章我们会补上）。主干思想一致：选项式编译成组合式，组合式按运行时类型分类挂载。

## 小结

state 是工厂（可重跑、不共享），getter 编译成 computed（依赖追踪），action 原样挂载（this 即 store）；`toRefs` 把根状态摊平成 store 的字段视图；分类循环用三个运行时判断把一切归位。选项式已经完整可用——但它是编译成组合式才可用的。下一章直接写组合式 store：setup 函数想返回什么就返回什么，hydration 的语义也会在那时真正登场。
