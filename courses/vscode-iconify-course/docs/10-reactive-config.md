---
title: 活的配置：最小依赖追踪
---

# 活的配置：最小依赖追踪

用户在设置里把分隔符从 `:` 改成 `-`，回到编辑器——装饰纹丝不动。补全还在按旧分隔符提示。所有识别逻辑用的还是启动那一刻组装好的正则。issue 回复清一色两个字的解决方案：「重启窗口」。这不是 bug 修不修的问题，而是结构性的：**配置在启动时被读取了一次，从此与使用它的逻辑断开了联系**。这一章给引擎装上依赖追踪（Dependency Tracking），让「读了配置的东西」在「配置变化时」自动重算——不重启，不手动刷新。

## 原理：一个全局变量的魔术

响应式系统的核心机制，说穿了只有一个变量：**当前正在收集依赖的 effect**。

`watchEffect(fn)` 立即执行一次 `fn`，执行前把自己登记到那个全局变量上。`fn` 运行途中读到的每一个响应式数据，都会在读取路径上做同一件事：把「当前 effect」记进自己名下的依赖集合。`fn` 跑完，全局变量清空。此后任何被记名的数据发生写入，写入路径就把名下的 effect 集合逐个重跑——依赖关系不是声明出来的，是**运行时读出来的**。这就是为什么 `watchEffect` 里只写了 `a.value`，改 `b` 就不会触发它：依赖集合里压根没有 b 的记录。

`computed` 在这之上加两样东西。其一是**惰性**：构造时不执行，第一次读 `.value` 才求值，结果缓存。其二是**脏标记**：依赖变更不重算，只把缓存标脏，下次被读取才真正重算——「只改不读」的场景下，昂贵的计算一次都不发生。为了链式传播（watchEffect 依赖 computed、computed 依赖 ref），computed 在被读取时也登记依赖：它自己也是个数据源。变更沿 ref → computed → effect 的链条传播，每一跳都只标脏或重跑自己名下的记录。

还有一处工程细节决定正确性：effect 重跑前要**清空旧的依赖记录再重新收集**。条件分支会让同一段代码两次运行读到不同的数据——第一次读了 a，第二次只读 b——旧记录不清掉，改 a 还会触发它，越积越冤。清理让依赖列表始终精确等于「上一次真实读取的集合」。

至于 `ref` 本身：一个带 getter/setter 的对象壳。getter 里登记依赖，setter 里派发重算。没有 Proxy、没有深层遍历——配置对象我们总是整个替换（`config.value = {...config.value, delimiters: ['-']}`），浅层追踪就够，这是「够用的最小实现」这条课程主线的又一次实践。

## 渐进实验：三个原语接入引擎

`src/reactivity.ts` 全文约百行，三个导出。核心记账：

```ts
// src/reactivity.ts · track / trigger
function track(target: object, key: PropertyKey) {
  if (!activeEffect)
    return
  let depsMap = targetMap.get(target)
  if (!depsMap)
    targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep)
    depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
  let ownDeps = effectDeps.get(activeEffect)
  if (!ownDeps)
    effectDeps.set(activeEffect, (ownDeps = new Set()))
  ownDeps.add(dep)
}

function trigger(target: object, key: PropertyKey) {
  const dep = targetMap.get(target)?.get(key)
  if (dep)
    [...dep].forEach(fn => fn())
}
```

两张表互为镜像：`targetMap` 回答「这个数据的 key 被谁读过」，`effectDeps` 回答「这个 effect 读过哪些数据」——后者就是重跑前精确清理的依据。`ref` 与 `computed` 的壳：

```ts
// src/reactivity.ts · ref / computed(节选)
export function ref<T>(value: T): Ref<T> {
  const obj = {
    get value(): T {
      track(obj, 'value')
      return value
    },
    set value(v: T) {
      value = v
      trigger(obj, 'value')
    },
  }
  return obj
}

export function computed<T>(fn: () => T): ReadonlyRef<T> {
  let cached: T = undefined as T
  let dirty = true
  const self = {
    get value(): T {
      if (dirty) {
        const outer = activeEffect
        // 读取发生在求值期间,依赖记到 notify 头上
        activeEffect = () => {
          dirty = true
          trigger(self, 'value')
        }
        try {
          cached = fn()
        }
        finally {
          activeEffect = outer
        }
        dirty = false
      }
      // computed 自己也是可依赖的数据源
      track(self, 'value')
      return cached
    },
  }
  return self
}
```

`computed` 里最妙的一手是那个匿名 `notify` 函数：求值期间把全局 effect 临时换成它，于是 `fn` 里读到的依赖全部记到 notify 名下；依赖变更时 notify 被调用——标脏，然后向 `self` 名下的下游传播。computed 因此同时扮演两个角色：对上游它是订阅者（notify），对下游它是数据源（track self）。

接入引擎不需要改动前九章的任何模块——响应式在外面包一层就够：

```ts
// 用法示例
const configRef = ref(createConfig({ delimiters: [':'] }))
const keys = computed(() => findIconKeys(text, configRef.value).map(m => m.key))
watchEffect(() => render(keys.value))
// 用户改配置:整对象替换,下游自动重算
configRef.value = { ...configRef.value, delimiters: ['-'] }
```

这正是「活的配置」的全貌：`findIconKeys` 依然是纯函数，依赖追踪只是让它的调用时机与配置数据挂钩。真实编辑器扩展把配置对象、主题色、光标位置都做成响应式源，装饰与补全都跑在 watchEffect 里——改配置的瞬间，正则重建、匹配重扫、装饰重画，一条链自动走完，没有一处手写的「配置变了要刷新 XX」。

## 验证

```bash
cd companion && pnpm test
```

71 条断言全绿，本章新增 8 条。语义逐条锁定：改 `a` 触发读过 a 的 effect、不触发只读 b 的 effect；一个 effect 依赖两个字段，任一变更即重算；computed 构造后不执行（惰性），首读计算一次、重读命中缓存，依赖变更后只标脏、下次读取才重算；computed 链上的 watchEffect 在源头变更后收到传播。引擎接入测试就是开篇事故的回归：分隔符配置从 `[':']` 换成 `['-']`，`watchEffect` 里记录的匹配结果从 `['mdi:home']` 自动变成 `['carbon-home']`——没有任何一行「刷新」代码。`stop()` 之后写数据不再触发，清理逻辑同样有测试作证。

## 小结

依赖追踪的全部机密是一个全局变量加两张镜像表：effect 运行时读谁记谁，数据写入时按名单重跑；重跑前清理旧依赖保证精确；computed 用惰性求值加脏标记做到「不读不算」，用 notify 桥接上下游实现链式传播。配置从此是活数据，识别、装饰、补全自动随它流动。引擎还剩最后一块拼图：图标数据本身也要能流动——私有集合文件一改，全网生效。下一章把数据源接上监听，收尾整条管线。
