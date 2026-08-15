---
title: 订阅系统：$subscribe 与 $onAction
---

# 订阅系统：$subscribe 与 $onAction

两个各自都在真实项目里发生过的泄漏。第一个：团队规范要求「所有 action 统一埋点 + 错误上报」，但 store 没有 action 钩子，于是有人写了个 `withLogging(fn)` 高阶函数手工包装——20 个 action 包了 20 遍，新同事入职忘了包，线上少了一半埋点。第二个：购物车页 `$subscribe` 了 state 变化来做价格联动，路由切走时忘了调解绑函数——回调还在跑，闭包里攥着已销毁组件的引用，内存曲线随每次导航缓步爬升。一个是「没有观测点」，一个是「观测点收不回来」。这一章的 `$onAction` 治第一个，`$subscribe` 的作用域自动清理治第二个。

第 7 章末埋的管线（订阅集合 + `triggerSubscriptions`）本章装上公共 API，另外要解决一个上一章亲手埋下的雷：watcher 与手动触发的双份通知。

## $onAction：把 action 装进外壳

先看最精妙的部分——action 包装器。$onAction 之所以能知道每个 action 的「名字、参数、何时成功、何时失败」，是因为 store 上的 action 早就不**是用户写的原函数了。它住在 `createSetupStore` 内部，本章起在分类循环的 action 通道里上岗：

```ts
// src/store.ts · createSetupStore 内部 · action 包装器（完整）
function action(fn: _Method, name: string = ''): _Method {
  const wrappedAction = function (this: any, ...args: unknown[]) {
    setActivePinia(pinia)
    const afterCallbackSet = new Set<(resolvedReturn: unknown) => unknown>()
    const onErrorCallbackSet = new Set<(error: unknown) => unknown>()
    function after(callback: (resolvedReturn: unknown) => unknown) {
      afterCallbackSet.add(callback)
    }
    function onError(callback: (error: unknown) => unknown) {
      onErrorCallbackSet.add(callback)
    }

    triggerSubscriptions(actionSubscriptions as Set<_Method>, {
      args, name, store, after, onError,
    } as unknown as Parameters<_Method>)

    let ret: unknown
    try {
      ret = fn.apply(store, args)
    } catch (error) {
      triggerSubscriptions(onErrorCallbackSet as Set<_Method>, error)
      throw error
    }

    if (ret instanceof Promise) {
      return ret
        .then((value) => {
          triggerSubscriptions(afterCallbackSet as Set<_Method>, value)
          return value
        })
        .catch((error) => {
          triggerSubscriptions(onErrorCallbackSet as Set<_Method>, error)
          return Promise.reject(error)
        })
    }

    triggerSubscriptions(afterCallbackSet as Set<_Method>, ret)
    return ret
  } as _Method

  return wrappedAction
}
```

第 6 章分类循环的 action 通道，现在挂载的是 `action(prop, key)` 的返回值（`setupStore[key] = action(prop, key)`）。这个外壳做了四件事，次序即语义：

**入口 `setActivePinia`**。action 内部可能 use 别的 store（跨 store 调用），那个 `useStore()` 找家走 activePinia——不设的话，在组件外调用 action 时它可能找到上一个请求的容器（SSR 串号的近亲）。每个 action 入口设置一次，正是后面 SSR 一章要反复强调的纪律的执行点。

**before 时刻广播**。`triggerSubscriptions(actionSubscriptions, {...})` 在原函数执行前触发——所以订阅方看到的是「这个 action 开始了」，不是「结束了」。广播体里带的是 `after`/`onError` 这两个回调收集器——订阅方在 before 时刻声明「我关心结果」，pinia 替它登记，结果出来再回放。这个「先声明、后回放」的形状，让一个广播同时覆盖前置埋点和后置埋点，而订阅方不需要轮询。

**同步错误的独立通道**。`try/catch` 捕获同步抛错：先触发 onError 集合，再 `throw` 继续向上抛——观测不吞错误，调用方的 `expect(() => s.boom()).toThrow()` 依然成立。

**异步的两栖处理**。返回值是 Promise 时，after/onError 挂到 then/catch 上——同一份代码同时支持同步与异步 action，订阅方完全无感。`return value`/`Promise.reject(error)` 保证链式调用不断。

而 `$onAction` 本身只有一行——`addSubscription(actionSubscriptions, callback, detached)`——复杂度全在外壳里，公共 API 薄得像纸。这是好品味：**把复杂度留在发生一次的地方，把简单留给被用一千次的地方**。

## $subscribe：watcher 与手动触发的和解

`$subscribe` 的难点不是「监听」（一个 `watch(state, cb, { deep: true })` 就够），是与 $patch 的手动触发不打架。$patch 会改根状态里的响应式状态——watcher 会被触发；第 7 章又手动 triggerSubscriptions 了一次。不加处理，一次 `$patch` 订阅方收到两条通知。

解法是静音标志。下面这段是拼版视图：左边来自 `$patch` 内部（第 7 章的函数，本章加了两行），右边是 `$subscribe` 注册的 watcher：

```ts
// src/store.ts · 拼版：$patch 内部（左）+ $subscribe 注册的 watcher（右）
let isListening = true

// $patch 内部：
isListening = false          // 静音 watcher 通道
// ...应用变更...
nextTick().then(() => {      // 批量窗口结束后恢复
  isListening = true
})
triggerSubscriptions(subscriptions, mutation, state)  // 手动触发独家负责

// $subscribe 注册的 watcher：
const stopWatcher = scope.run(() =>
  watch(
    () => pinia.state.value[$id],
    (state) => {
      if (isListening) {
        callback({ storeId: $id, type: MutationType.direct, events: undefined }, state)
      }
    },
    { deep: true, flush: options.flush ?? 'pre' }
  )
)!
```

分工：watcher 通道只管「直接改字段」（`s.count++`），手动触发只管 `$patch`/`$reset`/`$state` 赋值。静音的时长是「本次 patch 到 nextTick」——这正是 Vue 批量更新的窗口，patch 期间的所有物理变更都会在这个窗口内折进 watcher 的一次求值，静音恰恰把它挡在门外。恢复放在 nextTick 之后，直接改字段的通知不受影响。

两个订阅入口还有一个共同的设计：**生命周期自动托管**。`addSubscription`（第 7 章的 subscriptions.ts）里，默认（非 `detached`）订阅会 `onScopeDispose(removeSubscription)`——订阅注册进了哪个 effectScope，scope 停的时候自动解绑。组件里订阅：组件 scope 停（卸载）→ 自动解绑，开篇第二个泄漏绝迹。测试里用 `effectScope()` 圈住订阅、`scope.stop()` 验证的正是这条。`detached: true` 则是逃生舱：订阅活过 scope，自己管解绑（持久化插件要的就是这个——store 重建了，订阅还在）。

## $dispose：一键清场

```ts
// src/store.ts · createSetupStore 内部 · $dispose（完整）
function $dispose() {
  scope.stop()          // watcher、computed 的 effect 全部一起停止
  subscriptions.clear()
  actionSubscriptions.clear()
  pinia._s.delete($id)  // 从注册表除名：下次 useStore 重建新实例
}
```

第 3 章说过的「效应作用域是效果的收容所」在此兑现：`scope.stop()` 一句，store 的 scope 里创建的所有效果（每个 $subscribe 的 watcher、getter 的 computed）集体停止——不用记账哪个要清理。这就是 pinia 敢把 scope 设计进骨架的原因：生命周期管理的成本从「逐个记账」降到「一个开关」。

## 验证

```text
✓ $patch 无论改多少键，恰好触发一次订阅        ← 第 7 章承诺的回归
✓ 直接改字段触发订阅（type: direct）
✓ 解绑后不再触发
✓ 订阅默认随 effectScope 自动清理
✓ 同步/异步 action 的 after；同步/异步抛错的 onError；错误继续上抛
✓ $dispose 停作用域、清订阅、从注册表除名
```

十个测试全绿，「恰好一次」的两条通道（手动/watcher）互不越界。`tsc --noEmit` 与 `vitest run` 双门槛通过，累计 32 个测试。

与真源码对照：真 pinia 有两个标志（`isListening` 与 `isSyncListening`）——因为它的 watcher 支持 `flush: 'sync'`，同步 watcher 在 patch 结束的瞬间（而非 nextTick）就要恢复收听，单一标志会漏掉那个窗口。mini 的静音恢复统一走 nextTick，`flush: 'sync'` 的订阅在 patch 后紧接着的直接变更通知会晚一个 tick——边角差异，主行为一致。另外真 pinia 的 action 外壳还处理 `this` 重绑（HMR 场景）与 action 标记 Symbol（跨包装识别），mini 砍掉。

## 小结

$onAction 的全部时序来自 action 外壳：入口 setActivePinia、before 广播带回调收集器、同步错误独立通道、异步两栖。$subscribe 与手动触发的和解靠静音标志划界：watcher 管 direct、手动管 patch。生命周期自动托管让订阅不再泄漏，$dispose 靠 effectScope 把清场成本降到一个开关。观测体系齐了——但订阅方拿到的 state 是快照，想在 setup 里解构使用还得再解决「断连」。下一章：storeToRefs。
