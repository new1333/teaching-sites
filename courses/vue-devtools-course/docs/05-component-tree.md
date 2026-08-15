---
title: 组件树：走 vnode，不走 DOM
---

# 组件树：走 vnode，不走 DOM

第一次给面板接组件树的工程师几乎都踩过这两个坑。第一个：页面上一个组件用了 Fragment，渲染出来的 DOM 是三个兄弟节点——面板按 DOM 结构排树，这个组件在树上「消失」了，它的三个孩子直接挂在父级名下，用户对着页面数组件，对不上。第二个更致命：一个递归渲染的菜单组件嵌了上千层，面板一打开就全量递归整棵树，主线程被吃满，页面直接冻住——用户想调试卡顿，结果调试器自己就是卡顿源。

两个坑的病根是同一个：**把 DOM 当成了组件结构的来源**。DOM 是渲染的结果，组件树是渲染的输入；结果会折叠、会合并、会丢层级。调试器要展示的是「你的代码怎么组织的」，不是「浏览器怎么排版的」。这一章实现遍历器：沿着虚拟节点走下去，按需产出快照树。

## 为什么走 vnode：结构与 DOM 脱钩

组件实例手里握着自己的 `subTree`——渲染产物对应的虚拟节点树。它的可靠性正好补上 DOM 的两个短板：

- 层级保真。Fragment 渲染成几个兄弟 DOM 节点，但它的孩子在 subTree 里仍是它的孩子；Teleport 把 DOM 挪去别处，组件层级纹丝不动。
- 只含组件。DOM 里有大量非组件节点（原生标签、文本），subTree 里往下走，遇到的 `component` 引用就是组件实例，天然过滤掉了噪声。

从 subTree 收集孩子实例的逻辑很薄：

```ts
// src/tree.ts · collectInstances
function collectInstances(subTree: VNodeLike | undefined): InstanceLike[] {
  const list: InstanceLike[] = []
  if (!subTree)
    return list
  if (subTree.component)
    list.push(subTree.component)
  else if (Array.isArray(subTree.children))
    subTree.children.forEach(child => list.push(...collectInstances(child as VNodeLike)))
  return list
}
```

`component` 命中就直接收下；否则看 children 数组继续递归。真实框架的 vnode 还有 suspense 分支、函数式组件等形态，思路不变：每个分支回答的都是「这层虚拟节点里藏着哪些组件实例」。

## 按需拉取：深树不卡的秘密

第二个坑的解法不是「递归写得快一点」，而是**根本不一次走完**。遍历器接受 `maxDepth`，走到截断处就停：

```ts
// src/tree.ts · capture（节选）
function capture(instance: InstanceLike, depth: number, inactive: boolean): TreeNode {
  const id = registerInstance(app, instance)
  const children = childInstances(instance)
  const node: TreeNode = {
    id,
    name: safeName(instance),
    children: [],
    hasChildren: children.length > 0,
    inactive,
    file: (instance.type?.__file as string | undefined) ?? '',
  }
  // 深度截断：children 留空，但 hasChildren 说真话——UI 据此显示「可展开」
  if (depth < maxDepth) {
    node.children = children.map(child => capture(child.instance, depth + 1, child.inactive))
  }
  return node
}
```

关键在 `hasChildren` 与 `children` 的分工：截断处 `children` 留空，`hasChildren` 却如实为 true。UI 看到「有孩子但没给」就去要下一层——再调一次遍历器、深度加一。用户展开到哪，就走到哪；一千层的递归组件，用户只展开五层，就只走五层。

这背后是两种信息流设计的取舍。事件推送（push）：组件挂载时上报，工具被动收——数据新鲜，但深树一挂载就得全量建树，且事件洪流本身就是开销（第 3 章事件系统的守门拦的就是它）。按需拉取（pull）：UI 要树时现走一遍——一次遍历的开销与展开的深度成正比，天然适配「看多少走多少」。调试器最终选了 pull 为主、push 为辅：结构用拉的，变化用事件通知「该重新拉了」。

每次拉取都要调 `registerInstance`（第 4 章的登记处）——结果写进应用记录的实例表，正是实例上的 id 备忘保证了两次遍历之间 id 稳定，否则 UI 的展开状态、选中项在刷新后全部错位。

## 过滤与失活：两个容易被忽略的语义

过滤的语义来自一个朴素的目标：用户输入 `Card`，想看所有和 Card 有关的组件。实现是「自身命中就整棵收下，没命中就往孩子下钻」：

```ts
// src/tree.ts · findQualified
function findQualified(instance: InstanceLike, depth: number): TreeNode[] {
  if (!isAlive(instance))
    return []
  if (isQualified(instance))
    return [capture(instance, depth, instance.isDeactivated === true)]
  // 自身未命中过滤词：向孩子下钻，找到命中的后代为止
  const children = collectInstances(instance.subTree).filter(isAlive)
  return children.flatMap(child => findQualified(child, depth))
}
```

注意两处不对称。命中的节点整棵子树收下、不再对孩子过滤——用户找到了目标，目标周围的结构是上下文，应该保留。未命中的节点自身被裁掉，但孩子还有机会——否则 `Root > List > Card` 里过滤 `Card` 会一无所获。深度不随下钻递增也有讲究：过滤后的树是结果集不是结构树，结果集的根从深度 0 重新数。

keep-alive 是另一类特殊存在：被缓存的孩子已经从 subTree 上摘下，但实例还活着，用户需要看见它们（否则「切走又切回的页签为什么状态还在」就成了谜）。办法是把缓存实例以失活姿态并回孩子列表：

```ts
// src/tree.ts · childInstances（节选）
if (instance.type?.__isKeepAlive && Array.isArray(instance.__cachedChildren)) {
  const activeSet = new Set(active.map(item => item.instance))
  for (const cached of instance.__cachedChildren) {
    if (!activeSet.has(cached) && isAlive(cached))
      active.push({ instance: cached, inactive: true })
  }
}
```

`inactive: true` 是给 UI 的语义标记：这个节点存在，但当前不参与渲染——通常渲染成灰色。而 `isBeingDestroyed` 的实例被 `isAlive` 拦在树外：组件销毁有窗口期，树上出现半死的节点，点了就是取到悬空引用。

## 验证

把两个开篇之坑直接钉成断言：

```ts
// tests/component-tree.test.ts · 节选
it('maxDepth 截断：截断处 children 为空但 hasChildren 为 true', () => {
  const { root } = buildSampleTree()
  const app = createApp('main', 1, root)

  const tree = getComponentTree(app, { maxDepth: 1 })

  const listNode = tree[0].children[0]
  expect(listNode.children.length).toBe(0)
  expect(listNode.hasChildren).toBe(true)      // 说真话：还有孩子，只是这次没给
})

it('keep-alive：缓存中的失活实例以 inactive 出现在树上', () => {
  const activeTab = createInstance('TabA', 21)
  const cachedTab = createInstance('TabB', 22)
  const keepAlive = createKeepAlive(20, [activeTab], [cachedTab])
  // ...挂到 Root 下
  const tree = getComponentTree(app)

  const inactiveOnes = tree[0].children[0].children.filter(node => node.inactive)
  expect(inactiveOnes.map(node => node.name)).toEqual(['TabB'])
})
```

测试里的样例树故意用 vnode 中转挂孩子（`linkChildren`），模拟真实结构——遍历器从头到尾没碰过任何「DOM」。连同 id 稳定、过滤两种命中、销毁排除、file 透出、空根防御，本章十条断言，全书累计三十三条全绿；`npm run typecheck` 干净。

## 小结

遍历器确立了一条主线：组件树是拉出来的快照，不是攒出来的缓存。走 vnode 让结构与 DOM 脱钩，maxDepth 加 `hasChildren` 说真话让深树按需展开，id 备忘让多次拉取彼此衔接。树上挂的 `file` 已经在暗示下一个需求——用户看到节点会想看它的状态。

第二部分由此正式开场：拉到树只是「看见」的第一步，下一步是把选中节点的状态拍成状态快照——那是会合点相遇之后，信息第一次真正要离开页面世界。往后的路线在上一章的地图上已经铺开：编码传输让快照过桥，回写把修改送回本体，插件缓冲与检查器交给第三方库，双向 RPC 与通道接通 UI；等所有零件就位，最后一章把它们装配进 iframe、开发服务器与扩展宿主，看中继如何接力。回望第一部分，重放队列解决的「先到后到」问题，在每一次按需拉取里都有它的影子：工具不需要抢在应用前面，需要的时候去拿就行。
