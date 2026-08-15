---
title: 序列化：循环引用的过桥方案
---

# 序列化：循环引用的过桥方案

上一个迭代埋的雷在这个周三炸了：有人在组件状态里存了父组件的引用——很合理的建模，树形数据本来就该双向可走。结果面板一选中这个组件，调试器直接报错崩溃，控制台躺着 `RangeError: Maximum call stack size exceeded`。朴素序列化在环上转圈：序列化 parent 要先序列化 child，序列化 child 又要先序列化 parent。同一天还收到另一个更隐蔽的报告：两个属性引用同一个对象，面板上改了其中一个，另一个纹丝不动——朴素深拷贝把共享引用拆成了两份独立拷贝，改的只是其中一份。

一个环、一次共享，把「把对象图变成能过桥的消息」这件事的全部难点摆上了台面。上一章的状态快照按引用保留了嵌套对象，遍历器交出的节点又能随时凭应用记录的实例表取回活实例——「看见」的整条链都已经就位，唯独快照里的对象图还出不了页面这一侧。这一章实现编码传输：把任意（含环、含共享）对象图编码成一张平面的「对象表」，过桥后再解码还原。

## 对象表：用索引代替嵌套

先看清问题的形状。JSON 之所以处理不了环，是因为它的格式是**嵌套的**——值必须完整地躺在属性的位置上，环意味着「值在某处包含自己」，嵌套结构装不下。解法因此显而易见：换成**平铺的**。把图里每个对象登记进一张表，属性的槽位里不存对象本身，只存它在表里的索引：

```text
对象图                          对象表
{name:'root', self:↺}    →    [ {name:1, self:0},      ← 索引 0 是根
                                  'root' ]                ← 索引 1 是字符串
```

`self` 的槽位存数字 `0`——根自己的索引。环不再是「包含自己」，只是「指回第 0 项」，平铺结构装得下。共享引用同理：两个槽位存同一个索引，解码时按索引取，天然取回同一个对象。

但这里立刻冒出一个歧义：**槽位里的数字到底是索引，还是本来就个数字值？**用户状态里 `count: 42`，表里恰好有第 42 项，怎么办？这一章的编码规则用一条硬约定消灭歧义：

```ts
// src/transfer.ts · 文件头注释（约定）
// - 表的每一项要么是容器（普通对象/数组，属性值全部是索引），要么是原始值；
// - 对象/数组的每个属性槽位存的是「表内索引」（数字）；
// - 原始值直接躺在表项里，靠槽位的索引引用；
```

槽位里的数字一律是索引，无一例外；真正的原始值（包括数字）都躺在表项里。想拿到 `count` 的值，先读槽位里的索引，再去表里取那一项。规则钝，但零歧义——序列化格式的美德。

## 编码：先登记，再填槽

```ts
// src/transfer.ts · encode
function encode(value: unknown, list: unknown[], seen: Map<unknown, number>): number {
  if (!isContainer(value)) {
    // 原始值：占一个表项，返回它的索引
    const index = list.length
    list.push(value)
    return index
  }

  const seenIndex = seen.get(value)
  if (seenIndex != null)
    return seenIndex                     // 循环与共享：只写索引，不二次展开

  const index = list.length
  seen.set(value, index)                 // 先登记再填槽：环在展开前就已可引用

  if (Array.isArray(value)) {
    const stored: unknown[] = []
    list.push(stored)
    value.forEach((item) => {
      stored.push(encode(item, list, seen))
    })
  }
  else {
    const stored: Record<string, unknown> = {}
    list.push(stored)
    for (const key of Object.keys(value))
      stored[key] = encode(value[key], list, seen)
  }
  return index
}
```

三分支对应三类值。原始值：占个表项，返回索引。见过的容器：直接返回上次的索引——循环引用与共享引用在这里统一被解决，因为对编码器来说「再次遇到」就是「写索引」，至于是不是环它根本不用关心。没见过的容器：**先**在表里占位、**再**填槽。这个顺序是防栈溢出的关键：填槽是递归的，孩子里可能绕回自己；先占位，绕回来时 `seen` 里已经有它，递归当场截断，栈安全。

`encodeState` 只是入口包装：建表、建 `seen` 映射、从根开始走，根落在索引 0。

## 解码：同一套舞步，反着跳

```ts
// src/transfer.ts · resolve
function resolve(index: number, list: unknown[], cache: Map<number, unknown>): unknown {
  if (cache.has(index))
    return cache.get(index)              // 环与共享：同一索引只建一次

  const entry = list[index]
  if (Array.isArray(entry)) {
    const built: unknown[] = []
    cache.set(index, built)              // 先缓存再填槽，环才有回头路
    entry.forEach((slot) => {
      built.push(resolve(slot as number, list, cache))
    })
    return built
  }
  if (entry !== null && typeof entry === 'object') {
    const built: Record<string, unknown> = {}
    cache.set(index, built)
    for (const key of Object.keys(entry))
      built[key] = resolve((entry as Record<string, unknown>)[key] as number, list, cache)
    return built
  }
  return entry                            // 原始值：躺在表项里，直接取
}
```

结构与编码严格对称：查缓存、按表项类型分派、先登记占位再递归填槽。`cache` 按「索引 → 已建对象」记账，它同时解决两个问题：环（再次遇到索引 0 时直接返回正在构建的对象本身）与共享（两个槽位指向同一索引，取回同一个对象，身份保持）。解码产物是全新对象图——过桥之后的世界里，一切都要重建，这正是「传输格式」与「页面内存」两个世界的边界。

边界上还有一处务实的设计：编码产物本身是**普通数组套普通对象，无环**，所以它能被 `JSON.stringify` 再过一道——真实通道（postMessage 能结构化克隆，WebSocket 只能传字符串）形态各异，编码层保证产物对任何通道都是安全载荷。

## 验证

这一章的断言把三个险情各钉一遍：

```ts
// tests/transfer-encoding.test.ts · 节选
it('自引用环：往返后 self 指向解码结果自身', () => {
  const node: Record<string, unknown> = { name: 'root' }
  node.self = node

  const decoded = decodeState(encodeState(node)) as Record<string, unknown>

  expect(decoded.name).toBe('root')
  expect(decoded.self).toBe(decoded)          // 环还原，且是同一个对象
})

it('共享引用：两个属性指向同一对象，解码后仍是同一对象', () => {
  const shared = { id: 's1' }
  const data = { a: shared, b: shared }

  const decoded = decodeState(encodeState(data)) as Record<string, unknown>

  expect(decoded.a).toBe(decoded.b)            // 身份保持，不是两份拷贝
})

it('编码产物里不含循环：可以被 JSON.stringify', () => {
  const node: Record<string, unknown> = { name: 'root' }
  node.self = node
  node.children = [{ parent: node }]

  expect(() => JSON.stringify(encodeState(node))).not.toThrow()
})
```

数字歧义的用例专门造了张超过 60 项的表，让「值 42」与「第 42 项」同场：`lucky` 解回来必须是数字 42，`k42` 必须查到哨兵字符串——硬约定经受住了碰撞测试。加上数组环、根原始值、500 层深嵌套不爆栈，本章八条断言，全书累计四十七条全绿。

## 小结

编码传输的核心不是算法多巧，而是格式的选择：嵌套装不下图，平铺装得下。一条「槽位一律存索引」的钝约定消灭歧义，两处「先登记再填槽」的顺序保证环与深度的栈安全。从此任何快照都能安全过桥——会合点相遇之后的两个世界，第一次真正交换了完整的状态。

也把地图续上一段：这条链从会合点与重放队列的握手起步，经事件系统的通知、遍历器与实例表的寻址、状态快照的拍照，到本章的编码过桥，「看见」至此闭环。剩下的路都在桥的另一头：回写把面板上的修改送回本体，插件缓冲与检查器交给第三方库，双向 RPC 与通道把桥修成双向车道，宿主与中继再把它架进每一种形态。
