---
title: $patch 深合并与 $reset
---

# $patch 深合并与 $reset

一个表单页的三连击，击中了「没有批量变更通道」的所有痛点。「重置」按钮的 handler 手写了十几行，把每个字段一个个搬回默认值——写到第六行时你已经开始怀疑人生。产品经理要「保存草稿局部更新」，你写了 `store.user = { name: 'new' }`——上线当天收到反馈：用户资料里**只剩名字了**，头像、邮箱、地址全没了。整体替换吃掉了兄弟字段。最后 DevTools 里排查一次点击，同一个操作爆出 5 条变更记录——订阅方（持久化插件）被触发了 5 次，localStorage 写了 5 遍。

三个现象，一个病根：**变更没有「一次逻辑操作 = 一次状态变更」的通道**。这一章给 store 实现 `$patch`（两种形态、深合并、恰好一次事件）和 `$reset`（一键回初始），所有变更都落在容器的集中营里，语义由 store 统一担保。

## mergeReactiveObjects：合并，不是替换

先解决最疼的那个：局部更新吃掉兄弟字段。`$patch({ user: { name: 'b' } })` 期望的语义是「user.name 改成 b，user 底下其他键不动」——递归合并：

```ts
function mergeReactiveObjects<
  T extends Record<any, unknown> | Map<unknown, unknown> | Set<unknown>
>(target: T, patchToApply: Partial<T>): T {
  if (target instanceof Map && patchToApply instanceof Map) {
    patchToApply.forEach((value, key) => target.set(key, value))
  } else if (target instanceof Set && patchToApply instanceof Set) {
    patchToApply.forEach(target.add, target)
  }

  for (const key in patchToApply) {
    if (!Object.hasOwn(patchToApply, key)) continue
    const subPatch = patchToApply[key]
    const targetValue = target[key]
    if (
      isPlainObject(targetValue) &&
      isPlainObject(subPatch) &&
      Object.hasOwn(target, key) &&
      !isRef(subPatch) &&
      !isReactive(subPatch)
    ) {
      // 两边都是普通对象：递归合并
      ;(target as Record<any, unknown>)[key] = mergeReactiveObjects(
        targetValue as Record<any, unknown>,
        subPatch as Record<any, unknown>
      )
    } else {
      // 其余情况（含 ref/reactive/Map/Set 属性）：整体替换
      ;(target as Record<any, unknown>)[key] = subPatch
    }
  }

  return target
}
```

读这个函数盯住三个决策。

**递归的条件很挑剔**：`isPlainObject(targetValue) && isPlainObject(subPatch)`——两边都是**普通对象**才递归。数组呢？`items: [...]` 直接替换——「合并数组」没有无歧义的语义（按下标？按 id？去重？），任何选择都会在某些场景错，pinia 把决定权还给用户：想合并数组，用函数式 patch 自己写。Map/Set 作为**属性值**也是整体替换，理由相同。而函数开头的 Map/Set 分支是给「Map/Set 自己就是合并目标」的场景用的——hydration 路径会走到（下面细说），`$patch` 的顶层永远是普通对象，走不到。

**在 target 上原地改**。所有赋值都发生在 `target`（集中营里的响应式状态树）身上，从不新建对象——原地改才能保住响应式连接：组件里拿着 `store.user.address` 的引用，合并后它还是那个 Proxy，依赖不丢。`target[key] = mergeReactiveObjects(targetValue, subPatch)` 看似返回新值，实际递归返回的就是改完的 targetValue 本身。

**ref/reactive 的 subPatch 直接替换**。patch 里带了一个 ref？说明用户明确想整换，不猜。

## $patch：两种形态，恰好一次事件

```ts
function $patch(
  partialStateOrMutator: Record<string, unknown> | ((state: any) => void)
): void {
  let subscriptionMutation: { storeId: string; type: MutationType }
  if (typeof partialStateOrMutator === 'function') {
    partialStateOrMutator(pinia.state.value[$id])
    subscriptionMutation = { storeId: $id, type: MutationType.patchFunction }
  } else {
    mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator as Record<string, unknown>)
    subscriptionMutation = { storeId: $id, type: MutationType.patchObject }
  }
  // 手动触发恰好一次订阅——不靠 watcher 的触发次数（不可控），自己数
  triggerSubscriptions(
    subscriptions as Set<_Method>,
    subscriptionMutation,
    pinia.state.value[$id]
  )
}
```

两种形态服务两种场景：**对象式**（声明式，可序列化——DevTools 时间旅行、SSR 状态回放都靠它能 JSON 化）与**函数式**（命令式，拿到 state 随便改，数组怎么合并你自己说了算）。

但真正的重点是最后那三行。开章第三个痛点（一次点击 5 条记录）的解法不是「让 watcher 少触发」——watcher 的触发次数取决于你改了几个字段，控制不了。解法是**绕开 watcher 计数**：$patch 把变更全部落盘后，**手动**触发一次订阅。改 5 个字段、50 个字段，订阅方收到的事件都是一条——事件的粒度从「物理变更」升到「逻辑操作」。这也是 `$reset` 和 `$state` 整体赋值都复用 `$patch` 的原因：它们天生意为「一次操作」。

`triggerSubscriptions` 与 `subscriptions` 这个 Set 来自伴生实现新增的 `src/subscriptions.ts`——三十行的订阅原语（登记/触发/随作用域自动清理），下一章 `$subscribe`/`$onAction` 会站在它上面成为公共 API。本章先让 $patch 学会「自己数」。

## $reset：为什么选项式有、组合式没有

```ts
const $reset = isOptionsStore
  ? function $reset(this: StoreGeneric) {
      const { state } = options as DefineStoreOptions
      const newState = state ? state() : {}
      this.$patch(($state: StateTree) => {
        assign($state, newState)
      })
    }
  : function $reset() {
      throw new Error(
        `🍍: store "${$id}" 是组合式语法，没有 state 工厂，不支持 $reset。请用 $patch 重置。`
      )
    }
```

选项式 store 的 `state` 是**工厂函数**——重跑一遍就是崭新的初始状态，再借 `$patch` 灌回去（顺带白拿「恰好一次事件」）。组合式 store 为什么不行？它的「初始值」散落在 setup 闭包里（`ref(0)` 的 0 只是闭包里的字面量），没有任何可重跑的工厂——**不是不想实现，是语义上无从回收**。真 pinia 在这里抛同样的错误，组合式的重置要用户自己写 `$patch`。

顺带：hydration 的 reactive 分支也在本章升级了——上一章的浅合并占位换成了「键集合 clear 后逐项合并」的完整版，Map/Set 在水合时不丢响应式连接（替换会换掉整个 Proxy，clear+merge 保住它）。

## 验证

```text
✓ $patch 对象深合并：只动指定的键，兄弟字段保留
✓ 深层嵌套同样递归合并
✓ Map/Set 属性整体替换（合并只对普通对象递归）
✓ $patch 函数式：直接改 state
✓ $state 整体赋值走 $patch 通道
✓ $reset 一键回到初始 state
✓ setup store 调 $reset 抛错
```

第一条就是开章第二个 bug 的回归测试：`$patch({ user: { name: 'b' } })` 之后 `address.city` 仍是 `'x'`。「恰好一次事件」的断言要等 `$subscribe` 上岗才能写——管线已经埋好，下一章第一个测试就是它。`tsc --noEmit` 与 `vitest run` 双门槛通过，22 个测试全绿。

与真源码对照：真 pinia 的 `$patch` 还有 `isListening`/`isSyncListening` 两个暂停标志——$patch 期间先把内部 watcher 静音，避免 watcher 和手动触发「双份」通知订阅方。mini 没有那两个标志，因为我们第 8 章实现 `$subscribe` 时会让「patch 场景」完全走手动触发、watcher 只管「直接改字段」场景——更简单的等价设计，代价与取舍在下一章展开。

## 小结

深合并的三个决策：普通对象才递归、原地改保连接、用户带来的 ref/reactive 整体替换；$patch 的灵魂是「自己数」——物理变更任意多，逻辑事件恰好一次；$reset 的不对称（选项式 store 有、组合式 store 无）来自 state 工厂的有无，不是厚此薄彼。store 的管道里已经有订阅集合和触发原语，下一章给它们装上公共水龙头：`$subscribe` 与 `$onAction`。
