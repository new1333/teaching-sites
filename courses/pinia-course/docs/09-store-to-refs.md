---
title: storeToRefs：解构不丢响应性的秘密
---

# storeToRefs：解构不丢响应性的秘密

你大概写过这样的代码：

```ts
// 用法示例：会翻车的解构
const store = useCounterStore()
const { count, increment } = store   // 😈
```

模板里 `{{ count }}`，点 `increment`，接口数据回来了，页面纹丝不动。控制台没有报错，没有警告——因为根本没出 bug，是你把「活的」东西拿成了「死的」快照。更诡异的是不对称：`increment` 好使，每次点都真的在改 store（DevTools 里数字在涨），唯独页面显示的 `count` 不动。**同一行解构，函数活着、数据死了**——这个不对称正是本章解法的全部线索。

## 一解构就断连

`store` 是 `reactive(...)` 返回的 Proxy。Proxy 的魔法只属于这个代理对象本身——你通过它读属性，它才会帮你建立依赖、通知更新。`const { count } = store` 是一次普通的属性读取：把当时的数字取出来，装进一个普通变量。从此这个变量与 store 再无关系。

`increment` 倒是能用，因为它只是读了个函数引用——函数引用本来就稳定，解构不解构都是同一个函数对象。**丢响应性的从来只有数据，函数天然免疫**。

那解法是什么？既然普通变量存不住「连接」，就别给普通变量——给每个数据字段发一个 `ref`：一个永远指向 store 内部字段的活引用。解构拿到的不是值，是「取值的把手」。这就是 `storeToRefs`：

```ts
// 用法示例：正确的解构姿势
const store = useCounterStore()
const { count, double } = storeToRefs(store)   // ✅ 活的
const { increment } = store                    // ✅ 函数本来就安全
```

## 实现

整个函数二十行，把 store 的状态与 getter 全部 refs 化（转成活引用），第 5 章埋的伏笔在此兑现：

```ts
// src/storeToRefs.ts · storeToRefs（完整，类型从简）
export function storeToRefs<SS extends StoreGeneric>(store: SS): Record<string, any> {
  // 读 raw：reactive 代理会把 ref 解包，raw 里才看得出谁是 ref/computed
  const rawStore = toRaw(store)

  const refs: Record<string, any> = {}
  for (const key in rawStore) {
    const value = rawStore[key]
    if ((value as any)?.effect) {
      // getter：包一层可写 computed（写直通 store）
      refs[key] = computed({
        get: () => store[key],
        set(value: unknown) {
          store[key] = value as never
        },
      })
    } else if (isRef(value) || isReactive(value)) {
      // 状态：toRef 活引用——.value 直通 store[key]
      refs[key] = toRef(store, key)
    }
    // 函数（action）与非响应式属性：跳过
  }
  return refs
}
```

逐行拆三个决策。

**为什么必须 `toRaw`**。这是全章最微妙的一步。第 5 章挂载时我们做了两份：`assign(store, setupStore)`（经 reactive 外壳）和 `assign(toRaw(store), setupStore)`（原始形态）。原因现在揭晓：reactive 代理在读取属性时会把 ref 解包成裸值——你从 `store` 上看，`store.count` 是数字 0，`isRef(store.count)` 是 false，永远分不出谁是状态、谁是普通属性。而 raw 对象（`toRaw(store)`）里，ref 还是 ref、computed 还是 computed——分类信息只活在 raw 里。没有第 5 章那行双份挂载，这里就一筹莫展。两章之间的这种「先埋雷、后排雷」正是渐进式实现的味道。

**状态走 `toRef`**。`toRef(store, 'count')` 返回一个新的 ref，它的 get/set 穿过 store 代理：读 `count.value` 等于读 `store.count`（代理解包、建立依赖），写 `count.value = 10` 等于写 `store.count = 10`（代理通知更新）。连接建立了——而且双向：store 变，`.value` 跟着变；`.value` 变，store 跟着变。

**getter 不走 toRef，包一层可写 computed**。computed 也是一种 ref，但它没有 setter（直接 toRef 一个 computed 属性，写它会炸）。pinia 的选择是包一层带 setter 的 computed：get 读 `store.double`（建立依赖），set 写 `store.double`——虽然选项式 getter 大多只读，这个直通通道保证了「可写 getter」（组合式 store 里 `computed({ get, set })` 定义的）行为正确。判定哪个是 getter 用的还是那个老朋友：`value?.effect`——computed 独有的标记（第 2 章验证、第 5 章分类时用过、这里第三次登场）。

**函数跳过**。不是「忘了转」，是不该转：函数解构不断连，包成 ref 反而多此一举——调用还得 `.value()`。`storeToRefs` 的返回值里干脆没有 action，配合 TypeScript 类型（真 pinia 的返回类型把 action 排除在外），想从 refs 里解构函数会在编译期就被拦住。

## 验证

```text
✓ 状态解构后仍是活引用：双向同步
✓ getter 变成可写 computed，随状态联动
✓ action 与内部属性不出现在结果里
✓ 嵌套状态对象也拿到活引用
```

第一条双向验证：`s.count = 5` 则 `count.value === 5`；`count.value = 10` 则 `s.count === 10`——连接是双向的，不是单向镜像。第三条验证 `Object.keys(refs)` 恰好是 `['count', 'double', 'user']`——`$patch`、`_p` 这些内部属性（非响应式）也被天然过滤。`tsc --noEmit` 与 `vitest run` 双门槛通过，累计 36 个测试全绿。

与真源码对照：`packages/pinia/src/storeToRefs.ts` 共 116 行，其中九十多行是类型——`_ToComputedRefs`、`_ToStateRefs` 那套泛型负责把「getter → ComputedRef、状态 → Ref」的区分表达到类型层，让 `const { count } = storeToRefs(s)` 拿到的 `count` 自动是 `Ref<number>`。运行时逻辑与上面二十行一致。多出来的边角只有一个：真 pinia 处理 `PiniaCustomStateProperties`（插件塞进 state 的自定义属性）。

## 小结

解构断连的机理：Proxy 的魔法属于代理本身，普通变量存不住连接；数据会断、函数免疫的不对称指向解法——发活引用。实现三决策：toRaw 看穿分类信息（第 5 章双份挂载的回报）、状态 toRef 直通、getter 包可写 computed。至此 store 的「读」面完整了：模板里用 store 本体、setup 里解构用 storeToRefs。还剩最后一块拼图：不改源码地给所有 store 加能力——插件系统。
