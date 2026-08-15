---
title: 窗口对象：宿主给你的遥控器
---

# 窗口对象：宿主给你的遥控器

一个真实的翻车现场：有人把 `const win = createWindow()` 返回的对象存进了一个全局注册表，供多个模块「共享窗口」；后来某处调用了 `win.destroy()`，另一个模块毫不知情，继续拿着旧对象调 `setTitle`，于是线上一片 `unknown window` 报错，而且只在特定操作序列下复现。修 bug 的人翻遍自己的 JS 代码：对象明明还在内存里，方法也调用了，为什么会「窗口不存在」？

如果把 `win` 当成「窗口本身」，这个问题无解。真相是第 1 章埋的那句话：**窗口本体在原生世界，JS 侧拿到的 `win` 只是句柄（handle）——一个编号加一组转发方法**。对象在 JS 内存里活着，和窗口在原生世界里活着，是两件独立的事。这一章我们把这个结构亲手搭出来，让「遥控器和电视」的关系落到代码上。

## 原生侧：窗口管理器，一个资源表

先造原生世界的一半。`createWindowManager` 维护一张 `id → 窗口记录` 的表，窗口记录是纯数据（标题、可见性、位置尺寸）。真实 OS 里这张表后面连着合成器与绘制管线，我们用结构快照（snapshot）代替像素——测试拿快照断言，原理不分毫：

```ts
// src/native/windowManager.ts · createWindowManager（节选）
export function createWindowManager(): WindowManager {
  const windows = new Map<number, NativeWindowRecord>()
  let nextId = 1
  const find = (id: number): NativeWindowRecord => {
    const w = windows.get(id)
    if (!w) throw new Error(`[windowManager] unknown window: ${id}`)
    return w
  }
  return {
    create(options) {
      const id = nextId++          // 本体获得身份：一个递增编号
      windows.set(id, { id, title: options?.title ?? 'untitled', visible: false, /* … */ })
      return id
    },
    setTitle(id, title) { find(id).title = title },
    show(id) { find(id).visible = true },
    destroy(id) { find(id); windows.delete(id) },  // 本体消失，编号作废
    snapshot(id) { return { ...find(id) }, },      // 副本出关
  }
}
```

注意 `find` 的报错：操作不存在的编号，原生侧立刻抛 `[windowManager] unknown window`。这个报错就是开篇事故的正解——它不是 bug，是原生世界在诚实地说「你手里的遥控器没对上任何电视」。

## JS 侧：句柄类，方法全是转发

另一半是把能力装进宿主。`installWindowApi` 做的事就是上一章的完整应用：把窗口管理器的操作逐个注册到 binding 桥上，再往 JS 世界注入一个 `createWindow`：

```ts
// src/windows.ts · installWindowApi + WindowHandle（节选）
export class WindowHandle {
  constructor(
    readonly id: number,
    private readonly bridge: Bridge,
  ) {}

  setTitle(title: string): void {
    this.bridge.invoke('win.setTitle', this.id, title)   // 每个方法都走桥
  }
  // show/hide/destroy/snapshot 同构……
}

export function installWindowApi(runtime, bridge, manager): void {
  bridge.register('win.create', (options?) => manager.create(options))
  bridge.register('win.setTitle', (id, title) => manager.setTitle(id, title))
  // …show/hide/destroy/snapshot 同构
  const createWindow = (options?) => {
    const id = bridge.invoke('win.create', options ?? {}) as number
    return new WindowHandle(id, bridge)   // JS 侧只拿到编号 + 转发器
  }
  runtime.inject('createWindow', createWindow)
}
```

停下来看这个结构的三个要点。第一，`WindowHandle` 里没有窗口数据，只有 `id` 和 `bridge`——你调 `win.setTitle('B')`，实际发生的是 `bridge.invoke('win.setTitle', id, 'B')`，穿越序列化边界，查注册表，落到 `manager.setTitle(id, 'B')`。第二，`id` 是唯一把两个世界缝起来的线：JS 对象再怎么传、存、复制，原生侧认的只有那个数字。第三，`snapshot()` 也要走桥，返回值经上一章的 `serialize` 拷贝——所以 JS 拿到的快照改坏了也不影响原生记录，测试里专门断言了这条。

## 验证

`pnpm test` 后这一章新增五条断言全绿，覆盖四个关键行为：

- `createWindow` 返回句柄，原生侧同步出现 `title: 'Counter'` 的记录（初建不可见）；
- `setTitle/show/hide` 之后原生快照同步变化——遥控器按什么，电视变什么；
- 两个窗口 `id` 不同、互不串扰，A 改标题 B 不动；
- 销毁后再 `setTitle` 抛 `[windowManager] unknown window`——失效句柄是显式错误，不是静默。

```ts
// tests/window-handle.test.ts · 失效句柄
const win = g.createWindow({ title: 'x' })
win.destroy()
expect(() => win.setTitle('y')).toThrowError(/\[windowManager\] unknown window/)
```

最后一条值得多说一句：真实 Electron 的 `BrowserWindow` 销毁后再调用方法同样抛 `Object has been destroyed`——同一个原理。**句柄的生命周期永远短于或等于本体的生命周期，且两者的销毁不同步**，这是所有跨世界编程的公共陷阱。

## 小结

至此 JS 侧第一次「拥有」了一个窗口，尽管拥有的只是遥控器：`createWindow → id + 转发方法 → 原生资源表`。组装起来的完整链路是——宿主 `installWindowApi` 把原生管理器注册上桥、注入 JS；JS 调 `createWindow` 拿句柄；句柄的每个方法都是一次 binding 调用。开篇的注册表事故现在可以给出完整诊断：存进注册表的是遥控器，电视被搬走后，遥控器按键全部落空。下一章解决下一个真实矛盾：原生操作可能很慢，而 JS 只有一条线程。
