---
title: defineStore 与 store 的单例身份
---

# defineStore 与 store 的单例身份

一个真实的翻车现场：电商项目的头部组件和结算页组件都调了 `useCounterStore()` 来显示购物车数量。上线后发现两边数字对不上——头部显示 3，结算页还是 0。调试半天，发现早期某次重构里有人图省事，`useStore` 每次调用都 `new` 了一个 store：两个组件各改各的 `count`，谁也不知道对方的存在。**「到处取用的状态」必须是「同一个东西」**，这个看似显然的要求，恰恰是最容易在实现里丢掉的——而丢了它的 bug 不会报错，只会「看起来很怪」。

这一章实现 `defineStore`，让「拿到同一个 store」成为由容器担保的机制，而不是靠开发者自觉。

## API 形状：为什么返回的是一个函数

先看用法，再看实现：

```ts
const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0 }),
})

// 组件 setup 里
const store = useCounterStore()
```

`defineStore` 不返回 store，返回一个**生产 store 的函数**。这不是炫技，是三个刚性的需求逼出来的形状：

**惰性创建**。如果 defineStore 调用时就创建 store，那么 import 这个文件的瞬间 store 就存在了——不管用不用。树摇（tree-shaking）废了：一个只在某个路由用到的 store 会随 import 链进主包。返回函数，创建推迟到第一次调用。

**依赖时机**。模块加载时 `app.use(pinia)` 可能还没跑，容器还不存在；而函数被调用的时机（组件 setup）一定在 install 之后。把「需要容器存在」的代码放进函数体，就永远赶得上。

**每应用一个实例**。第 1 章的病根：模块级单例在 SSR 下串号。如果 defineStore 直接返回 store 实例，这个实例必然挂在模块上，又回到老路。返回「给我容器、我还你 store」的函数，store 挂在容器上——一个应用一个，天然隔离。

一个函数同时满足惰性、时机、隔离三个约束——这个 API 形状是问题逼出来的，不是设计出来好看的。

## 实现

伴生实现新增 `src/store.ts`，核心不到四十行：

```ts
export function defineStore(
  id: string,
  setupOrOptions?: DefineStoreOptions | ((helpers: any) => any),
  setupOptions?: DefineStoreOptions
): StoreDefinition {
  const isSetupStore = typeof setupOrOptions === 'function'
  const options = (isSetupStore ? setupOptions : setupOrOptions) ?? {}

  function useStore(pinia?: Pinia | null): StoreGeneric {
    // 找家的两条路：显式传参 > 组件内注入 > 模块级活动容器
    pinia =
      pinia ||
      (hasInjectionContext() ? inject(piniaSymbol, null) : null) ||
      activePinia ||
      null

    if (!pinia) {
      throw new Error(
        '🍍: 没有活动容器。请先 app.use(pinia)，或给 useStore 显式传入 pinia。'
      )
    }
    setActivePinia(pinia)

    if (!pinia._s.has(id)) {
      // 本章先放一个最小住户进注册表；下一章起由 createOptionsStore/createSetupStore 接管
      const store = reactive({ $id: id }) as unknown as StoreGeneric
      pinia._s.set(id, store)
    }

    return pinia._s.get(id)!
  }

  useStore.$id = id
  return useStore as StoreDefinition
}
```

逐个拆关键决策。

**单例身份的机制：注册表查询**。`if (!pinia._s.has(id)) { ... }` 这四行就是单例的全部秘密：第一次调用时创建并登记，之后所有调用走 `pinia._s.get(id)`。注意单例的**范围**是「容器 + id」——不是全局单例。换个容器，同一个 `useCounterStore` 会创建出新的实例（`useCounterStore(otherPinia)`），这正是测试隔离与 SSR 隔离的开关。

**找家的三级回退**。`pinia || inject(...) || activePinia` 这个优先级链值得背下来：显式传参（测试与多容器应用用，最可靠）> 组件内注入（随应用隔离，SSR 安全）> 模块级活动容器（兜底，组件外的唯一通道）。第三级是第 11 章 SSR 串号事故的案发地，但删掉它，「在路由守卫里取 store」这类组件外用法就全废了——兜底通道危险但必要，纪律比删功能重要。

**先查表后建人**。把 `pinia._s.set(id, store)` 放在创建分支里，而不是无条件 `set`——如果无条件覆盖，并发场景下后创建的会顶掉先创建的，两个组件短暂持有不同实例。查表-建人-登记的三步必须原子（JS 单线程里同步执行天然原子，但异步创建 store 就会破功——这也是为什么 pinia 的 store 创建是纯同步的）。

**为什么 store 是 `reactive` 的**。返回给用户的是个 Proxy：属性读写被追踪，模板里用它自动建立依赖。下一章往里面放 state/getters/actions 时，这个外壳让三者以统一的面目出现。

## 验证

```text
✓ 两次 useStore 拿到同一个实例
✓ 不同 id 是不同实例，且都登记进容器注册表
✓ 显式传入 pinia 时，store 登记进那个容器
✓ 没有活动容器时调用抛错
```

第三个断言组验证了一个微妙点：显式传了 `piniaB` 之后，无参调用返回的仍是**第一次登记进 piniaB 的那个实例**（`setActivePinia(piniaB)` 把活动容器切了过去）。第四个断言验证错误路径：没有容器时不是静默返回 undefined，而是带着 🍍 前缀抛错——**快速失败好过静默错下去**。`tsc --noEmit` 与 `vitest run` 双门槛通过。

与真源码对照：`packages/pinia/src/store.ts` 里 `defineStore` 的实现签名有完整的四层泛型（`Id/S/G/A`），mini 砍掉了泛型保留行为；真实现里还有 `__TEST__` 分支（测试模式下忽略传入的 pinia，强制走活动容器）和 HMR 分支，那些是外围，`useStore` 的主干逻辑——回退链、查表、登记——与上面逐字对应。

## 小结

defineStore 返回函数是惰性、时机、隔离三重约束的解；单例身份 = 容器注册表按 id 查表；找家的三级回退（显式 > 注入 > 活动容器）划定了可靠性与灵活性的次序。但注册表里现在住的还是个只有 `$id` 的空壳——state、getters、actions 还都没有。下一章给 store 长出血肉：选项式三件套。
