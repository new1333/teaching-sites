---
title: 应用登记处：多应用与实例表
---

# 应用登记处：多应用与实例表

一个真实的微前端事故：平台页面上同时跑着主应用和 iframe 里的子应用，两边都是同一个框架。调试面板接进来之后怪事不断——组件树只显示主应用；更糟的是有一天点树上的「Row」节点，页面高亮的却是另一个应用里的「Row」。排查发现两棵树里各有一个 `uid = 3` 的组件，而面板拿 uid 当唯一标识：两个世界各自从 1 开始编号，撞号是必然的。点 A 高亮 B，不是灵异，是**把局部编号当成了全局身份**。

这一章解决两笔账：页面上有哪些应用（应用记录），每个应用里有哪些组件实例（实例表）。它们是后面所有「看见」与「修改」的寻址基础——树要按实例找孩子，快照要按实例取状态，回写更要按实例改本体。

## 应用记录：给每个应用发一张身份证

内核视角下，一个应用就是「一次独立挂载的根」。登记处的工作是给它发一张身份证：

```ts
// src/record.ts · createAppRegistry
export function createAppRegistry(): AppRegistry {
  const apps: AppRecord[] = []
  let appSeq = 0

  const registry: AppRegistry = {
    apps,
    get activeAppRecord() {
      return apps[0]
    },
    registerApp(app, meta) {
      const existing = apps.find(record => record.app === app)
      if (existing)
        return existing

      appSeq += 1
      const record: AppRecord = {
        id: `app:${appSeq}:${app.name ?? 'anonymous'}`,
        name: meta?.name ?? app.name ?? 'anonymous',
        app,
        instanceMap: new Map(),
      }
      apps.push(record)
      return record
    },
    unregisterApp(app) {
      const index = apps.findIndex(record => record.app === app)
      if (index !== -1)
        apps.splice(index, 1)
    },
    setActive(id) {
      const index = apps.findIndex(record => record.id === id)
      if (index > 0) {
        const [record] = apps.splice(index, 1)
        apps.unshift(record)
      }
    },
  }

  currentRegistry = registry
  return registry
}
```

应用记录的 `id` 由登记处签发：自增序号保证同页多应用不重名，名字只是展示用。`activeAppRecord` 用 getter 直接取 `apps[0]`——「活动应用」就是列表头部，`setActive` 做的事不过是把目标记录挪到头部。用列表顺序表达活动状态，省掉一个与列表可能失同步的独立变量。

三个注册语义值得注意。重复注册同一应用返回已有记录（幂等——应用重连、工具重放队列时都会再来一次 init）。首个注册的应用自动成为活动应用（最常见的单应用页面不需要显式切换）。注销活动应用后活动身份自然落到下一个（用 getter 表达状态的好处在这里兑现：删掉头部，下一个自动顶上，不需要写一行切换逻辑）。

`AppRecord` 上挂着 `instanceMap`——这张表是本章的另一半，也是全书最重要的一张表：**id → 组件实例的活引用**。注意存的是实例本身，不是任何快照。快照是照片，拍完就旧了；活引用是本体，随应用状态一起变。后面取树、取状态、回写，走的都是这张表。

## 实例表：uid 为什么不够，唯一 id 怎么发

现在看实例登记：

```ts
// src/record.ts · registerInstance
export function registerInstance(app: AppLike, instance: InstanceLike): string {
  const record = requireRegistry().apps.find(r => r.app === app)
  if (!record)
    throw new Error(`[mini-devtools] app not registered: ${app.name ?? app.uid}`)

  const memoId = instance[INSTANCE_ID_KEY] as string | undefined
  if (memoId != null) {
    // 复用：多次遍历/多次快照面对的是同一实例
    if (!record.instanceMap.has(memoId))
      record.instanceMap.set(memoId, instance)
    return memoId
  }

  const id = `${record.id}:instance:${record.instanceMap.size + 1}`
  instance[INSTANCE_ID_KEY] = id
  record.instanceMap.set(id, instance)
  return id
}
```

为什么不用实例自带的 `uid`？开篇的事故已经给出答案的一半：uid 是应用内局部编号，多应用必然撞号。还有另一半：某些组件形态（异步组件、抽象组件）下 uid 的稳定性并不可靠，同一个逻辑组件在生命周期的不同阶段可能顶着不同 uid 出现。所以调试器必须**自己发身份**，不依赖应用世界任何「大概唯一」的编号。

发的办法是给实例本身贴一张备忘：`__MINI_DEVTOOLS_NEXT_ID__`。第一次登记时算出 id、写回实例、入表；之后再遇到同一实例，读备忘直接复用。这个「写回实例」的动作初看有点越界——往应用的对象上塞调试器的字段。但它是值得的：组件树会被反复遍历（每次面板刷新、每次更新事件），没有备忘，同一个实例每次遍历都换新 id，UI 侧的展开状态、选中状态全部失灵。真实世界里的调试器也做同样的事，字段名换了一套而已。

id 的构成 `${app.id}:instance:${n}` 把应用身份编进了实例身份——跨应用天然不撞号，跨记录可读（看 id 就知道属于哪个应用）。`getInstance` 则是它的逆运算：从所属记录的实例表里凭 id 取活引用，取不到返回 `undefined` 而不是抛错——查无此人是调试器日常，不是异常。

## 验证

把开篇事故的两个现场直接写成断言：

```ts
// tests/app-record.test.ts · 节选
it('不同应用里 uid 相同的两个实例，id 互不冲突', () => {
  const registry = createAppRegistry()
  const main = createApp('main', 1)
  const sub = createApp('sub', 2)
  registry.registerApp(main)
  registry.registerApp(sub)

  const mainCard = createInstance('Card', 7)
  const subCard = createInstance('Card', 7)   // 与 mainCard 同名同 uid

  const mainId = registerInstance(main, mainCard)
  const subId = registerInstance(sub, subCard)

  expect(mainId).not.toBe(subId)
  expect(getInstance(main, mainId)).toBe(mainCard)
  expect(getInstance(main, subId)).toBeUndefined()   // 拿 A 的 id 查 B 的表，查无此人
})

it('同一应用内两个不同实例即便 uid 相同也能区分', () => {
  const registry = createAppRegistry()
  const app = createApp('main', 1)
  registry.registerApp(app)

  const a = createInstance('Row', 3)
  const b = createInstance('Row', 3)          // uid 撞号

  expect(registerInstance(app, a)).not.toBe(registerInstance(app, b))
})
```

再补上注册/切换/注销的应用级行为与「同实例两次登记 id 相同、表里只有一条」，共八条。连同前两章，二十三条断言全绿，`npm run typecheck` 干净。

## 小结

应用记录回答「页面上有谁」，实例表回答「每个应用里谁是谁」。身份必须由工具侧签发：应用世界的编号既不全局唯一也不保证稳定，把局部编号当全局身份，就会上演点 A 高亮 B。实例表存活引用而非快照，这让「按 id 找到本体」成为后面每一章的公共入口。

把这一章放进全书坐标：会合点与事件系统把应用 init 送到了登记处门口，登记处签发的 id 从此贯穿下游——遍历器用它保证同一棵树两次遍历 id 稳定，状态快照按它取活实例，回写按它改本体；快照出页面靠编码传输，插件缓冲与检查器让第三方库挂面板，双向 RPC 与通道接通 UI，中继把这一切搬进扩展宿主。第一部分到此收束：相遇、听话、记账，连接前夜的三件事都齐了。
