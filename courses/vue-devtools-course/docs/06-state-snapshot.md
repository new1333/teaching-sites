---
title: 状态快照：分类与清洗
---

# 状态快照：分类与清洗

一个经典的面板白屏事故：用户在组件树里点开一个节点，面板整个空白，控制台躺着一条 `DataCloneError: function could not be cloned`。组件明明好好的，页面也正常，唯独调试器崩了。另一个版本的事故更阴险：不白屏，但面板一选中组件就「丢失」一半状态——某个 getter 读取即抛错，快照循环直接中断，后面的字段一个都没渲染。用户体验到的现象是「这个组件的状态显示不全」，没人会想到病根是别人代码里一个会抛错的 getter。

这一章做状态快照：把活实例上的 props、setup、data 拍成一份分类清晰、清洗过、单项失败不连坐的快照。它是「看见」的核心一步，也是后面一切传输与回写的原材料。

## 快照的三个来源

调试器视角下，一个组件实例的状态散落在三个口袋里：`props` 是父级传入的契约，`setupState` 是组合式 API 的战场，`data` 是选项式 API 的老家。快照要做的第一件事就是分门别类：

```ts
// src/state.ts · getInstanceState
export function getInstanceState(instance: InstanceLike): InspectorStateItem[] {
  return [
    ...processSource(instance.props, 'props'),
    ...processSource(instance.setupState, 'setup'),
    ...processSource(instance.data, 'data'),
  ]
}
```

分类不是洁癖，它直接决定面板的展示与行为：UI 按类别分栏渲染，用户凭 `type` 一眼看出「这个值是从哪来的」。顺序固定为 props、setup、data——与心智模型中「外来输入在前、自身状态在后」一致，也让两次快照之间的 diff 有稳定的基准。

每一项长这样：

```ts
// src/state.ts · InspectorStateItem
export interface InspectorStateItem {
  type: InspectorStateType   // 'props' | 'setup' | 'data'
  key: string
  value: unknown
  editable: boolean          // 这个值能不能用回写机制改
}
```

`editable` 是给两章之后的回写埋的钩子：快照不只是看的，标了 editable 的项在 UI 上会渲染成可编辑控件。它必须在这一层定，因为「能不能改」取决于值的形态，而值的形态只有拍快照的人知道。

## 两个清洗动作

开篇两个事故，对应两个清洗动作，都发生在 `processSource` 里：

```ts
// src/state.ts · processSource
function processSource(source: Record<string, unknown> | undefined, type: InspectorStateType): InspectorStateItem[] {
  if (!source)
    return []
  const items: InspectorStateItem[] = []
  for (const key of Object.keys(source)) {
    const raw = safeRead(() => source[key])
    const { value, editable } = sanitize(raw)
    items.push({ type, key, value, editable })
  }
  return items
}
```

`safeRead` 兜住「读取即抛错」。应用侧对象的属性访问什么都可能发生——getter 抛错、Proxy 陷阱炸裂、getter 里有副作用。快照循环必须保证一个字段的事故止于那一个字段：

```ts
// src/state.ts · safeRead
function safeRead(read: () => unknown): unknown {
  try {
    return read()
  }
  catch (error) {
    return `[Error] ${error instanceof Error ? error.message : String(error)}`
  }
}
```

错误本身被转成描述串塞进 `value`——用户在面板上看到的不是白屏，而是一个写着错误信息的字段，旁边其他字段照常显示。调试器的容错哲学在这一行里浓缩了：**工具的任何读取失败，都降级为数据，不升级为异常**。

`sanitize` 兜住「传不过去的东西」。跨上下文传输（无论 postMessage 还是 WebSocket 消息）都过不了函数这道坎——结构化克隆直接抛错，序列化库各有各的炸法。所以函数在快照层就被替换成占位串：

```ts
// src/state.ts · sanitize
function sanitize(value: unknown): { value: unknown, editable: boolean } {
  if (typeof value === 'function')
    return { value: '[Function]', editable: false }
  return { value, editable: true }
}
```

注意函数的 `editable` 是 false——不是「不让改」，是「改了没有意义」：把一个占位串写回实例，覆盖掉真函数，这是帮用户制造 bug。占位串保住了面板能显示 `onClick [Function]` 的信息量，又用 editable 关掉了编辑入口。

还有一个看似偷懒的决定要说清楚：**嵌套对象按引用保留，不深拷贝**。`processSource` 拍下的是第一层的活引用，`{ deep: { value: 42 } }` 进快照还是那个对象。深拷贝在下一章才做，而且有专门的做法——因为朴素的深拷贝会栽在循环引用上，那是一个值得单独一章的问题。这一章的边界感是：分类、清洗、容错，到此为止。

## 快照在管线里的位置

把 `getInstanceState` 放回整条链路里看，位置感会更清楚。用户在面板上点了一个树节点——那个节点是遍历器从 vnode 里走出来的；凭节点上的 id，从应用记录的实例表里取回活实例；然后才是本函数上场，对着活实例拍快照。事件系统在这条链里只扮演信使：组件更新事件到达时，通知 UI「该重新拉一次了」，重新拉的还是同一条链。

这条链的源头要一路回溯到第 2 章的会合点：没有那次握手，应用根本不知道该把事件发给谁；没有重放队列，早到的应用连握手的门都摸不到。所以每次你在面板上点开一个组件看到状态，背后实际发生的是：握手建立的连接里，事件系统送来一次提醒，遍历器与登记处交出实例身份，快照器把活实例翻译成安全的数据。六站接力，一站都不能少。

## 验证

把两个事故现场写成断言：

```ts
// tests/state-snapshot.test.ts · 节选
it('读取即抛错的字段：该项标记错误，不毁整份快照', () => {
  const instance = createInstance('Card', 1, {
    props: Object.create({}, {
      broken: {
        get() {
          throw new Error('getter exploded')
        },
        enumerable: true,
      },
      fine: { value: 'ok', enumerable: true },
    }) as Record<string, unknown>,
  })

  const items = getInstanceState(instance)

  const broken = findItem(items, 'props', 'broken')!
  expect(String(broken.value)).toContain('getter exploded')   // 错误降级为数据
  expect(findItem(items, 'props', 'fine')?.value).toBe('ok')  // 邻居无恙
})

it('函数值清洗为占位串，且 editable 为 false', () => {
  const instance = createInstance('Card', 1, {
    props: { title: 'hello' },
    setupState: { onClick() { return 1 }, doubled: 6 },
  })

  const items = getInstanceState(instance)

  expect(findItem(items, 'setup', 'onClick')!.value).toBe('[Function]')
  expect(findItem(items, 'setup', 'onClick')!.editable).toBe(false)
})
```

加上分类、顺序、空实例防御、引用保留，本章六条断言，全书累计三十九条全绿，`npm run typecheck` 干净。

## 小结

状态快照确立了「拍照」的纪律：分类入册、函数换占位、错误降级为数据、单项失败不连坐。`editable` 标记在这里签发，回写在两章后凭它放行。快照至今没有离开页面世界——所有的值都还是活引用。

下一步就是过桥：这份快照要送到 UI 客户端所在的另一个世界。函数已经被清洗掉了，但对象图里的循环引用还在等着——组件存了父组件的引用，父组件又存着它的引用，朴素序列化会在环上转圈到栈溢出。怎么把一张带环的图安全地编码成能过桥的形态，是下一章编码传输的全部内容；再往后，回写把面板上的修改送回本体，插件缓冲与检查器交给第三方库，双向 RPC 与通道接通 UI，最后由宿主与中继完成装配。
