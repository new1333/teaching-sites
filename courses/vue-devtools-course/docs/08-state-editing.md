---
title: 编辑回写：把修改写回活实例
---

# 编辑回写：把修改写回活实例

用户终于把组件树点开了、状态看到了，然后他在面板里把 `count` 从 3 改成 100，回车——页面纹丝不动。刷新面板，`count` 还是 3。他提了个工单：「编辑功能是假的」。排查代码发现，编辑操作确实收到了，写进的地方却是 UI 侧那份解码还原的快照对象——上一章 `decodeState` 建的那张「新图」。图上的修改精确、合法、毫无作用：**改的是照片，不是本体**。

这不是低级失误，是两个世界结构性的坑：UI 拿到的永远是过桥后的拷贝，而「改状态」必须发生在页面那一侧的活对象上。这一章实现回写，把「看见」升级成「修改」。

## 回写的最小机制：路径下行

先想清楚一次编辑由什么构成。用户在面板上编辑的是快照里的一项——第 6 章的 `InspectorStateItem` 带着它的来源（`type`）与键名（`key`）；嵌套值则是从根一路点进去的路径。所以一次编辑的完整描述是：**一个实例，一条路径，一个新值**。路径第一段选择来源（快照的 `type` 是 `setup` 时对应实例上的 `setupState`），之后逐层下钻，最后一段是赋值的目标键：

```ts
// src/editor.ts · editState
export function editState(instance: InstanceLike, path: Array<string | number>, value: unknown): boolean {
  if (path.length === 0)
    return false

  let cursor: unknown = instance
  for (let i = 0; i < path.length - 1; i++) {
    if (cursor === null || typeof cursor !== 'object')
      return false
    try {
      cursor = (cursor as Record<string | number, unknown>)[path[i]]
    }
    catch {
      return false                    // 读取即抛错的属性：与快照同款容错
    }
    if (cursor === null || typeof cursor !== 'object')
      return false                    // 中途是非对象：路径走不通
  }

  try {
    ;(cursor as Record<string | number, unknown>)[path[path.length - 1]] = value
    return true
  }
  catch {
    return false                      // 冻结/只读对象：写入被拒不升级为异常
  }
}
```

二十来行，但每一层防御都有具体的敌人。

第一层：**路径走不通**。`['props', 'nope', 'deeper']`——`nope` 是 `undefined`，继续下钻就是对 `undefined` 取属性。调试器不能假设 UI 发来的路径永远合法：路径是过桥传来的数据，UI 可能在 stale 的树上构造它（用户编辑时组件刚好卸载了）。返回 `false`，让 UI 决定怎么提示，比抛异常稳得多。

第二层：**读取抛错**。中途某个属性是 hostile getter，一读就炸——第 6 章 `safeRead` 的同款敌人，同样的处方：降级为 `false`，不升级为异常。

第三层：**写入被拒**。冻结对象、只读属性，赋值在严格模式下直接抛 `TypeError`。包住，返回 `false`。

三层防御背后是同一条纪律，第 6 章说过、这里原样适用：**工具的任何失败都降级为返回值，不升级为异常**。编辑失败应该表现为「面板上这一项没变、也许提示一下」，而不是「调试器崩了」。

还有一个语义选择要说破：**路径终点允许是新键**。`['props', 'fresh']` 会真的创建 `props.fresh`。为什么不拦？因为「往状态里加一个字段再看页面反应」是调试的正当需求——拦了它，回写就只是一部复读机。创建与修改同价，是调试器的立场。

## 写的是本体：快照与回写的分工

最容易混淆的一点值得单独立一节。快照（第 6 章）与回写（本章）操作的是同一个实例，但方向相反、对象不同：

```ts
// 用法示例
const items = getInstanceState(instance)         // 拍快照：读活实例，产出安全数据
const ok = editState(instance, ['props', 'count'], 100)  // 回写：改活实例本身
const again = getInstanceState(instance)         // 再拍一张验证

// again 里 count 已是 100——快照反映回写的结果，因为两者都对着同一个本体
```

快照可能过桥（第 7 章编码），回写永远不过桥——它收到的只是「路径 + 新值」这样的纯数据，真正的写动作发生在页面这一侧、活对象身上。过桥的是指令，不是对象。这个分工让「照片」与「本体」各安其位：UI 看照片、改照片的坐标，页面按坐标改本体，改完再拍新照片送回去。

一次完整的编辑回路因此是四步：UI 从快照里定位路径 → 路径与新值编码过桥 → 页面侧 `editState` 写回活实例 → 重新拍快照（或等事件系统通知）刷新面板。把整条链摊开看：会合点的握手让两端相遇，遍历器给出节点，应用记录的实例表交出活实例，状态快照拍照，编码传输过桥，回写改本体——每一站都在这次编辑里出场。第 10 章的双向 RPC 会把这条回路正式铺成轨道；本章先把它最重要的一节——写回本体——造出来。

## 验证

工单里的现象与三层防御全部钉成断言：

```ts
// tests/state-editing.test.ts · 节选
it('嵌套对象与数组索引都能下行', () => {
  const nested = { deep: { value: 1 } }
  const list = [10, 20, 30]
  const instance = createInstance('Card', 1, {
    props: { nested, list },
  })

  expect(editState(instance, ['props', 'nested', 'deep', 'value'], 42)).toBe(true)
  expect(editState(instance, ['props', 'list', 1], 99)).toBe(true)

  expect(nested.deep.value).toBe(42)              // 写的是本体，不是拷贝
  expect(instance.props!.nested).toBe(nested)     // 引用身份未变
})

it('写入被拒（冻结对象）：返回 false，不抛出', () => {
  const frozen = Object.freeze({ locked: 1 })
  const instance = createInstance('Card', 1, {
    props: frozen,
  })

  expect(editState(instance, ['props', 'locked'], 2)).toBe(false)
  expect(instance.props!.locked).toBe(1)
})
```

第一条断言里 `nested.deep.value` 的检查故意绕过 instance 直接读局部变量——证明写到的就是那个对象本身，不是任何中间拷贝。加上三种来源、坏路径、穿原始值、空路径、新键创建、hostile getter，本章九条断言，全书累计五十六条全绿。

## 小结

回写补齐了「能修改」：路径下行、终点赋值、三层防御把一切失败降级为 `false`。至此类比可以收束了——快照是照片，编码是过桥，回写是按坐标改本体，「看见」与「修改」在结构上闭环。

但至今所有剧情都发生在工具自己的地盘：树、快照、回写，全是调试器的自家本事。下一章把门打开——第三方库（路由、状态管理）想在自己的地盘挂一块面板，怎么挂？库比应用先初始化、比工具先就位的时序问题又回来了，插件缓冲与检查器将复用重放队列的老兵智慧；再往后，双向 RPC 与通道把编辑回路铺成正式轨道，宿主与中继完成最后的装配。
