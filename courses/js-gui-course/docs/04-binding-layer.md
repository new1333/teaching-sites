---
title: binding 层：JS 怎么调用「另一个语言」
---

# binding 层：JS 怎么调用「另一个语言」

调试过 Electron/preload 脚本的人多半见过这类报错：`Error processing argument at index 0, conversion from JS to JSON failed`，或者更隐蔽的场景——明明传了个对象过去，原生侧拿到手一改，JS 这边的对象竟然没变，于是有人开始到处 `JSON.parse(JSON.stringify(x))`「消毒」。这些奇怪现象的源头都是同一个地方：**JS 函数调用与原生实现之间隔着一层 binding（绑定层），而这层边界的通行规则不是「传引用」，是「拷贝数据」**。这一章我们把这层边界亲手写出来——写完你会发现，调包时代那些玄学报错，全是这条规则的直接推论。

上一章结尾留了问题：宿主把自己的能力挂到 JS 全局上，这个「挂」的动作里藏着什么电路？拆开就两个零件：一个装函数的注册表，一个管通关的序列化器。

## 先写宿主：一个可以被注入的世界

上一章的十行伪码，这一章变成真代码。`createRuntime` 模拟宿主创建一个隔离的 JS 世界：

```ts
// src/runtime/host.ts · createRuntime
export interface Runtime {
  readonly name: string
  readonly globals: Record<string, unknown>
  inject(key: string, value: unknown): void
  run(script: () => void): void
}

export function createRuntime(name: string): Runtime {
  const globals: Record<string, unknown> = {}
  return {
    name,
    globals,
    inject(key, value) { globals[key] = value },
    run(script) { script() },
  }
}
```

它小到不像话，但两条测试把上一章的概念钉死了：宿主 `inject('sayHi', fn)` 之后，脚本跑起来就能调到；两个 runtime（`main` 和 `renderer`）各建一个，A 里注入的 key 在 B 里不存在——隔离环境的最小验证。真实 V8 里 isolate/context 的隔离要复杂几个数量级，但语义承诺是一样的。

## 注册表：调用找实现

binding 的第一半是回答「JS 调的 `createWindow` 是谁」。没有魔法，就是一张 `名字 → 原生函数` 的表。宿主启动时逐个注册，JS 调用时按名查表、转发参数、取回返回值：

```ts
// src/runtime/bridge.ts · createBridge（骨架）
export function createBridge(): Bridge {
  const registry = new Map<string, NativeFn>()
  return {
    register(name, fn) { registry.set(name, fn) },
    invoke(name, ...args) {
      const fn = registry.get(name)
      if (!fn) throw new Error(`[binding] unknown api: ${name}`)
      // …序列化通关，见下文
    },
  }
}
```

对照第 2 章：runLoop 的 `handlers`（type → 处理函数）与这里的 `registry`（api 名 → 实现）是同构的注册表——一个路由消息，一个路由调用。真实世界里 Node 的 N-API、Electron 的 native module 加载，落到最底层都是这样一张表加类型转换，区别只在转换由谁生成（手写绑定代码，还是 DSL 自动生成）。

## 序列化：边界上只许过纯数据

第二半是整章的核心：参数怎么过边界。两个世界不共享内存——严格说 V8 和 C++ 可以共享（那是后话的优化路径），但 binding 的安全模型建立在一个简单规则上：**参数和返回值都走序列化（serialization）——深拷贝成纯数据，原对象不过去**。原因很实际：JS 对象背后是 V8 的 GC 世界（对象随时可能被移动、回收），原生侧若直接持有裸引用，GC 一动就是野指针崩溃；反过来，原生对象带着自己的生命周期与线程规则，塞给 JS 同样是灾难。拷贝数据是最笨也最稳的交界方式。

```ts
// src/runtime/bridge.ts · serialize（节选）
function serialize(value: unknown, seen: string): unknown {
  const t = typeof value
  if (value === null || t === 'undefined' || t === 'number' || t === 'boolean' || t === 'string' || t === 'bigint') {
    return value
  }
  if (t === 'function' || t === 'symbol') {
    throw new Error(`[binding] args must be serializable (函数/符号不能跨边界): ${seen}`)
  }
  if (Array.isArray(value)) return value.map((v, i) => serialize(v, `${seen}[${i}]`))
  // 纯对象：原型是 Object.prototype 或 null；class 实例的原型不是，拒收
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`[binding] args must be serializable (class 实例不能跨边界): ${seen}`)
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = serialize(v, `${seen}.${k}`)
  return out
}
```

原始类型放行；数组、纯对象递归拷贝；函数、symbol、class 实例一律拒收。为什么函数过不去？函数不是数据，是「代码 + 它闭包里锁着的那个世界的引用」——把函数传过边界，等于把一个 runtime 的内存拓扑走私给另一个 runtime。这在 binding 层被禁止，但注意它并没有消失：后面讲 IPC 的章节你会看到，「想把回调传过去」这个真实需求，最终靠「传一个 id、对端拿 id 反向调用」解决——序列化边界逼出来的设计。原生侧同理：返回值也走一遍 `serialize`，所以拿到了副本。

`invoke` 的完整顺序是：查表（查不到抛 `[binding] unknown api`）→ 参数逐个序列化 → 调用原生函数 → 返回值序列化后交回。

## 验证：三条最值钱的断言

`pnpm test` 跑十四条用例，这一章最值钱的是这三条：

```ts
// tests/binding-layer.test.ts · 参数是副本不是引用
bridge.register('mutate', (obj: Record<string, unknown>) => {
  received = obj
  obj.hacked = true // 原生侧试图污染调用方
})
const arg = { count: 1 }
bridge.invoke('mutate', arg)
expect((arg as Record<string, unknown>).hacked).toBeUndefined()
```

其一，原生侧在参数上写 `hacked`，JS 调用方的 `arg` 毫发无损——副本隔离生效。其二，`invoke('fs.read')` 未注册即抛 `[binding] unknown api: fs.read`——「调不到」的报错有名字、可定位，这正是开头那些玄学报错的正统形态。其三，把函数直接传、或藏在对象属性里传，都被同一条规则拦下——藏是藏不过去的，因为序列化是递归的。

## 小结

binding 层 = 注册表 + 序列化通关。JS 调用原生函数的全过程：按名查表、参数深拷贝、执行、返回值深拷贝。开头的两个玄学现象现在都能解释了：JSON conversion 报错就是序列化拒收（你传了函数、DOM 引用或 class 实例）；「改了不影响」就是副本语义在工作。下一章给注册表填上第一批真实能力：原生窗口管理器，让 JS 侧第一次拿到一个窗口——以句柄的形式。
