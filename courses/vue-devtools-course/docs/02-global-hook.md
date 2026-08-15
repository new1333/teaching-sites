---
title: 全局钩子：window 上的第一次握手
---

# 全局钩子：window 上的第一次握手

设想这样一个上线前夜：你给自己的应用接一个性能监测脚本，脚本从 CDN 异步加载。第二天测试反馈「数据时有时无」。排查了一小时你才发现规律——网络快的时候数据在，网络慢的时候数据就没了。原因是应用在监测脚本加载完之前就完成了初始化，初始化时往 `window` 上找钩子没找到，只能放弃上报；等脚本姗姗来迟，该发生的都发生完了。**错过的信息，永远不会自己补回来**——除非有人把它存下来。

调试器面对的是一模一样的处境，而且更糟：它不但可能比应用晚到，还可能根本没被加载（用户没装工具）。所以设计必须同时满足两个方向：

1. 应用侧：找得到钩子就立刻用；找不到，把「钩子来了之后要做的事」排队存好。
2. 工具侧：就位时先检查有没有排队的事，有就逐个重放，然后接管会合点。

这一章我们在伴生实验场里把这套会合机制亲手做出来。

## 钩子对象：一个极简的事件集线器

先看工具侧要交出的东西。所谓「钩子」，本质上就是一个挂在全局对象上、按约定名暴露的事件集线器：

```ts
// src/hook.ts · createHook
export function createHook(): Hook {
  const events = new Map<string, HookEventHandler[]>()
  const hook: Hook = {
    id: 'mini-devtools',
    apps: [],
    on(event, fn) {
      if (!events.has(event))
        events.set(event, [])
      events.get(event)!.push(fn)
      return () => hook.off(event, fn)
    },
    once(event, fn) {
      const onceFn: HookEventHandler = (...args) => {
        hook.off(event, onceFn)
        fn(...args)
      }
      hook.on(event, onceFn)
    },
    off(event, fn) {
      const list = events.get(event)
      if (!list)
        return
      const index = list.indexOf(fn)
      if (index !== -1)
        list.splice(index, 1)
    },
    emit(event, ...payload) {
      // 复制一份：监听器里解绑自己时不能影响本轮遍历
      const list = [...(events.get(event) ?? [])]
      list.forEach(fn => fn(...payload))
    },
  }
  return hook
}
```

几个细节值得停下看一眼。

`on` 返回一个解绑函数。这不是顺手为之——调试器是长会话程序，用户会切换应用、关闭面板，监听必须能成对撤销，否则就是泄漏。第 3 章整章都在跟这个承诺打交道。

`once` 的实现是「先包一层再注册」：包装函数触发时先把自己解绑，再执行真身。`emit` 里那行复制同样不起眼但关键：如果某个监听器在触发过程中把自己解绑了，直接遍历原数组会跳过元素甚至越界，复制一份就能安全走完本轮。

还有 `apps: []`。钩子上留一个应用列表，是给「工具比应用晚到」这个场景兜底用的：应用 init 时不管有没有人监听，都把自己塞进这个列表；工具后到时不用等下一个应用出现，翻列表就知道页面上跑着谁。

## 会合：两边各自的动作

应用侧的动作封装成一个函数：

```ts
// src/hook.ts · queueUntilHookInstalled
export function queueUntilHookInstalled(target: HookTarget, cb: (hook: Hook) => void): void {
  const existing = target[HOOK_GLOBAL_NAME]
  if (existing) {
    cb(existing)
    return
  }
  if (!target[REPLAY_QUEUE_NAME])
    target[REPLAY_QUEUE_NAME] = []
  ;(target[REPLAY_QUEUE_NAME] as Array<(hook: Hook) => void>).push(cb)
}
```

钩子在，立即执行；不在，入队等待。工具侧则负责安装与重放：

```ts
// src/hook.ts · installHook
export function installHook(target: HookTarget): Hook {
  const existing = target[HOOK_GLOBAL_NAME]
  if (existing)
    return existing

  const hook = createHook()

  const queue = target[REPLAY_QUEUE_NAME] as Array<(hook: Hook) => void> | undefined
  if (queue) {
    try {
      queue.forEach(cb => cb(hook))
    }
    finally {
      target[REPLAY_QUEUE_NAME] = []
    }
  }

  target[HOOK_GLOBAL_NAME] = hook
  return hook
}
```

两个函数各自只有十几行，但三个设计决策藏在里面。

**先重放，后挂名。**注意顺序：重放队列在前，把钩子挂到约定名上在后。重放的回调里拿到的钩子参数由 `installHook` 直接传入，不依赖全局名已就位；而队列在 `finally` 里清空，哪怕某个回调抛错，也不会留下半截队列导致下次安装再重放一遍。

**幂等。**第二次 `installHook` 直接返回已有钩子。扩展、插件、Vite 注入的脚本可能各装一次，没有幂等保护，后装的会把先装的监听全部作废——这正是「装了两个工具，面板抽风」类 bug 的温床。

**排队的是回调，不是事件。**等待队列里存的是「拿到钩子后要做什么」，而不是「发生过什么事件」。这个选择有代价：事件本身的时序信息丢了（回调执行时只知道「钩子刚就位」），换来的是简单——不用为每种事件设计可序列化的暂存格式。对调试器来说这笔交易是划算的，因为真正要紧的存量信息（应用列表、组件树）都有各自的按需拉取机制兜底，后者是第 5 章的主角。

## 验证

时序 bug 最怕「跑起来碰巧对」。测试要把两种加载顺序都钉死：

```ts
// tests/global-hook.test.ts · 节选
it('钩子未就位时排队，installHook 后重放且恰好一次', () => {
  const target = createTarget()
  const seen: string[] = []
  queueUntilHookInstalled(target, (hook) => {
    seen.push(`first:${hook.id}`)
  })
  expect(seen).toEqual([])          // 没有钩子时，什么都不能发生
  const hook = installHook(target)
  expect(seen).toEqual([`first:${hook.id}`])  // 安装即重放
})

it('钩子已就位时立即执行', () => {
  const target = createTarget()
  const hook = installHook(target)
  const fn = vi.fn()
  queueUntilHookInstalled(target, fn)
  expect(fn).toHaveBeenCalledTimes(1)
  expect(fn).toHaveBeenCalledWith(hook)
})
```

再加一条「重复安装返回同一钩子」和一条「重放后队列清空、不会二次重放」，配合 `on/off/once` 的基本语义，共八条断言。`HookTarget` 用普通对象模拟 `window`——这套机制对宿主没有任何要求，有一个能挂属性的对象就行，这正是它能同时活在页面、iframe 与测试里的原因。

跑 `npm test`，八条全绿；`npm run typecheck` 干净。把顺序反过来（先安装后排队）再跑一遍，仍然全绿——两种时序都被机械地钉住了。

## 小结

会合点解决的是「在哪里相遇」，重放队列解决的是「谁先到怎么办」。合起来，两份加载时机互不受控的代码，终于能在同一个全局对象上完成握手，而且顺序无关。真实世界里的 Vue DevTools 走的就是这条路：页面脚本在全局对象上排队，工具就位时重放，钩子上同样留着应用列表兜底。

但握手只是开始。应用接下来会通过钩子发来一连串原始事件——组件挂了、卸了、更新了。工具不能把它们原样灌给内部模块：要不要过滤？谁来解绑？这是下一章事件系统要回答的问题。

顺手把全书的地图也铺在这里，后面每一站都是本章机制的延伸：应用登记处用应用记录与实例表给「页面上有谁」记账；遍历器按需产出组件树；状态快照把活实例拍成可传输的照片；编码传输让照片能过桥；回写把面板上的修改写回本体；插件缓冲与检查器让第三方库挂上自己的面板；双向 RPC 与通道让 UI 与内核互相对话；中继则把这些搬进扩展的隔离世界。每到一个新站，回头看的都是这章埋下的同一套思路：先到者排队，后到者重放，相遇之后一切才有可能。
