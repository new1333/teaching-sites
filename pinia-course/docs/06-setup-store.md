---
title: 组合式 store 与运行时分类
---

# 组合式 store 与运行时分类

两个相隔半年的 bug，病根是同一个。第一个：你想在 store 里用 `vue-router` 的 `useRouter()` 和一个团队内部的 `usePermission()` composable——选项式语法的三个固定选项装不下这些「函数调用」，只好在组件里绕一层，store 的封装形同虚设。第二个：换成组合式语法后一切好使，直到某次刷新页面，已登录用户的界面跳回了登录页——SSR 直出的登录态（服务端写进容器状态树的数据）被 setup 里 `ref(false)` 的默认值**覆盖**了回去。用户明明登录着，客户端一接管，状态被打回原形。这就是 hydration（水合）：**新世界（客户端新建的 store）必须继承旧世界（服务端留下的状态）的记忆，而不是抹掉它**。

上一章我们留了伏笔：选项式编译成组合式，「一切 store 都是 setup store」。这一章写组合式本体，并补上它独有的 hydration 语义。

## 组合式：语法自由，类型失明

```ts
const useCounter = defineStore('counter', () => {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  function increment() {
    count.value++
  }
  return { count, double, increment }
})
```

setup 函数想返回什么就返回什么：ref、computed、函数、甚至组合别的 composable 的产物。表达力拉满的代价是——**返回值上没有任何标记**告诉你哪个是状态、哪个是 getter、哪个是 action。选项式里「写在 state 里的是状态」这种声明式信息，在组合式里不存在了。

pinia 的回答是第 5 章那个分类循环：不看来处，只看运行时类型。

```text
isRef(prop) && !isComputed(prop)   →   状态（state）
isReactive(prop)                   →   状态（state）
isComputed(prop)                   →   getter
typeof prop === 'function'         →   action
```

我管它叫**海关安检**：setup 的返回值排成一队过检，X 光机（isRef/isComputed/typeof）照出每个属性的真实形态，分三条通道放行——状态通道要「报关」（搬进容器集中营），getter 和 action 通道「免检放行」（原样挂载）。判定依据是值的运行时形态，不是名字、不是声明位置、不是任何约定俗成——所以组合式语法再自由，安检口永远认得它们。

## 实现：hydration 分支

上一章的分类循环里，状态通道只有一句「搬进集中营」。本章给它加上 hydration 的完整语义：

```ts
// 占位之后读：可能是 {}（新建）也可能是预置的状态树（hydration）
const initialState = pinia.state.value[$id]

for (const key in setupStore) {
  const prop = setupStore[key]

  if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
    // 状态通道：组合式的 ref/reactive 搬进集中营
    if (!isOptionsStore) {
      // hydration：集中营里已有预置值（SSR 直出 / 测试预置），
      // 把它写回 setup 刚创建的默认 ref——而不是让默认值覆盖它
      if (key in initialState) {
        if (isRef(prop)) {
          ;(prop as Ref).value = initialState[key]
        } else {
          // reactive 对象：浅合并（第 7 章的深合并上岗后会换掉这行）
          assign(prop as Record<string, unknown>, initialState[key])
        }
      }
      pinia.state.value[$id][key] = prop as Ref
    }
  } else if (isComputed(prop)) {
    // getter 通道：computed 原样挂载
  } else if (typeof prop === 'function') {
    // action 通道：函数原样挂载（第 8 章会包上 $onAction 的外壳）
  }
}
```

细读 hydration 分支的**方向**：是 `prop.value = initialState[key]`——把集中营的旧值写进 setup 新建的 ref，**方向绝不能反**。写反了（`initialState[key] = prop.value`）就是开章第二个 bug：默认值 `false` 覆盖登录态 `true`。hydration 的铁律只有一句：**旧数据赢**。

为什么旧数据该赢？因为 setup 每次执行返回的都是「出厂设置」——`ref(0)` 的 0 不是数据，是占位符。而集中营里的值来自真实世界：服务端渲染时用户的真实状态、测试预置的现场。真实世界的记忆优先于出厂设置。

还有个容易漏掉的时序细节：`initialState` 的读取时机在占位判断**之后**——新建时它读到的可能是刚占位的 `{}`（空对象，没有 key，hydration 分支自然跳过），预置时读到的才是旧状态树。而「搬进集中营」那句 `pinia.state.value[$id][key] = prop` 把 setup 的 ref **本体**放进状态树（不是值的拷贝）——从此 `$state.count`、`store.count`、setup 闭包里的 `count` 是同一个 ref 的三个名字，改哪个全都同步。这也是「同一份数据的多个视图」在组合式语法下的延续。

选项式为什么不需要这个分支？回看第 5 章：`createOptionsStore` 在调 setup 之前就守卫了 `if (!(id in pinia.state.value))` 才写入 `state()` 的产物——预置值天生就赢，根本轮不到覆盖。两条语法路径，同一条铁律，两种实现时机。

## 验证

```text
✓ setup 语法与选项式行为等价
✓ ref 状态搬进容器集中营（$state 与 store 是同一份数据）
✓ hydration：容器已有状态时不被 setup 默认值覆盖
✓ setup 里可以组装第三方 composable
```

第三个就是开章第二个 bug 的回归测试：预置 `{ count: 42 }` 后再 `useSetupCounter()`，读到的是 42 不是 0。第四个是第一个痛点的验收：`useUserSession()` 这种外部 composable 直接在 setup 里组合，分类循环照单全收。`tsc --noEmit` 与 `vitest run` 双门槛通过，15 个测试全绿。

与真源码对照：真 pinia 在同样的位置还有 `shouldHydrate(prop)` 判断——配合 `skipHydrate()` 标记，让「返回了响应式对象但它不是状态」的边角（比如 setup 里返回一个 router 实例）可以跳过水合。mini 砍掉了这个逃生舱，主干 hydration 语义与上面逐字对应。另外真 pinia 对 reactive 状态的水合走 `mergeReactiveObjects` 递归合并——我们的浅合并占位会在下一章原位替换成它。

## 小结

组合式语法自由但类型失明，运行时分类用三个判定把一切归位；hydration 的铁律是旧数据赢——方向是集中营写进新 ref，绝不是反过来；ref 本体入住集中营，让三个名字共享同一个格子。至此两种 store 语法全部可用且归一。但改状态还是只能一个字段一个字段地改——下一章实现 `$patch`：批量变更、深合并、恰好一次事件。
