---
title: 真机篇（下）：跑起来——终端 App 与真窗口
---

# 真机篇（下）：跑起来——终端 App 与真窗口

读完前十一章，内核是「在测试里活着」的：每个行为都有断言背书，但你从来没有**运行过一个应用**——没有一个进程启动、等你按键、把状态画到某个真实输出设备上。这一章补上最后的临门一脚，交付两样真东西：一个 `npm run demo` 就能跑、能用键盘交互的终端 App（用你自己的内核）；一个用 Bun FFI 直调 Windows 系统 DLL、**真的在屏幕上弹出系统窗口**的脚本。前者证明内核能接真实输入输出，后者证明这门课的原理不是玩具——JS 到原生 GUI 之间，只隔一层我们早就写过的 binding。

## 终端 App：把内核接到真实世界

思路一步到位：**终端就是我们的屏幕，stdin 就是我们的 OS 输入源**。原生世界的角色扮演者从「测试里的 manager」换成「真实进程的 stdout」，其余零件原封不动：

```ts
// src/app/terminalApp.ts · renderWindow（快照 → 字符窗口）
export function renderWindow(app: App, winId: number): string {
  const snap = app.manager.snapshot(winId)      // 原生快照：标题 + UI 树
  const lines = uiLines(snap.ui)                // text 一行、button 渲染成 [ +1 ]
  const width = Math.max(snap.title.length + 4, ...lines.map((l) => l.length), 12)
  const top = `┌─ ${snap.title} ${'─'.repeat(Math.max(0, width - snap.title.length - 4))}┐`
  const body = lines.map((l) => `│ ${l.padEnd(width - 2, ' ')} │`)
  return [top, ...body, `└${'─'.repeat(width)}┘`].join('\n')
}
```

注意方向：渲染读的是原生侧的快照（结构快照），不是 JS 侧的状态变量——你在屏幕上看到的，永远和 manager 里的记录一致，因为它们本来就是同一份数据的两次投影。按键处理就是「消息进队列 + 泵一次」的标准动作：

```ts
// src/app/terminalApp.ts · step
export function step(app: App, key: string, winId = 1): 'running' | 'quit' {
  if (key === 'q' || key === '\u0003') {
    emitNative(app.loop, { type: 'quit' })      // q = 一条 quit 消息
    app.loop.pumpOnce()
    return 'quit'
  }
  if (key === '+' || key === ' ' || key === '\r') {
    simulateClick(app, winId, '1')              // + = 模拟点击按钮节点
  }
  return 'running'
}
```

没有新零件。`simulateClick` 是第 10 章的（消息 → 泵 → 两级路由 → 动作反查 → 重渲染），`emitNative` 是第 9 章的，`quit` 语义是第 2 章的。**交互式应用和测试驱动的唯一区别是：消息源从 `it()` 换成了键盘**。

驱动它的 `demo.ts` 只做了两件事：TTY 环境下把 stdin 设为 raw mode（每敲一键发一次 `step`）、每帧清屏重画；非交互环境自动放映。现在跑：

```text
// 用法示例：cd companion && npm run demo（按 + 加一，按 q 退出）
┌─ Counter ─┐
│ 3          │
│ [ +1 ]     │
└────────────┘
```

你敲 `+`，穿过的是：stdin → step → simulateClick → 队列 → 泵 → 订阅表 → onAction('inc') → count++ → renderUI 走桥 → manager 换树 → renderWindow 读快照 → stdout。第 10 章画的完整回路，此刻在一个真实进程里转动。

## 真窗口：Bun FFI 直调系统 DLL

终端窗口毕竟还是字符画。最后一步，把 binding 指向真家伙——Windows 的 `user32.dll`：

```js
// src/app/native-window.mjs（Bun 运行时；bun src/app/native-window.mjs --msgbox）
import { dlopen, suffix, ptr } from 'bun:ffi'

const user32 = dlopen(`user32.${suffix}`, {
  // int MessageBoxW(HWND, LPCWSTR text, LPCWSTR caption, UINT uType)
  MessageBoxW: { args: ['i32', 'pointer', 'pointer', 'u32'], returns: 'i32' },
})

const utf16 = (s) => ptr(Buffer.from(`${s}\0`, 'utf16le'))
const ret = user32.symbols.MessageBoxW(
  0,
  utf16('这扇窗口不是 HTML——它来自 user32.dll 的 MessageBoxW'),
  utf16('JS 接入原生 GUI'),
  0, // MB_OK
)
```

逐行用课程的眼光审：`dlopen` 加载 DLL，第二个参数是一张**签名声明表**——每个函数的参数类型、返回类型都要写清楚，这不就是 binding 注册表吗？而且比第 4 章的更严苛：`args` 里写错类型（把指针写成 i32）当场崩给你看，因为 FFI 没有序列化层兜底，**它按声明直接搬字节**——第 11 章「值按对方的规矩过境」的暴力版。`ptr(Buffer.from(s, 'utf16le'))` 更是把序列化边界演活了：JS 字符串不能直接给 C，要先编码成 Windows 要的 UTF-16 字节、再拿到指针——**你在第 4 章手写的 `serialize`（深拷贝纯数据），在 FFI 里的对应物是「编码成对方内存布局」**。运行它，屏幕上真的弹出一扇系统对话框——没有 Chromium、没有 HTML，一扇如假包换的 Win32 窗口，从 JS 的一行调用里长出来。

对照一下你已知的全景：这行 `MessageBoxW` 与 Electron 里 `new BrowserWindow()` 在原理层是同一件事——JS 侧调用 → 过类型化边界 → 原生侧执行 GUI 工具包的代码 → 窗口出现。区别只在 Electron 替你把注册表、序列化、进程模型全部包装好了。**你已经分别在 wasm（第 11 章）和 DLL（本节）两边亲手跨过这条边界，框架从此对你透明**。

（顺带一提：这段脚本要跑在 Bun 下而不是 Node，因为 Node 没有内置 FFI——想跨这条边就得装 node-ffi 或写 N-API 插件。宿主决定边界长什么样，第 3 章的结论在这里又应验了一次。）

## 验证

实验场门槛照旧双跑：`tsc --noEmit` + `vitest run`（55 条断言全绿，其中本章新增 5 条：字符窗口渲染含标题与按钮、`+` 键走完整回路帧变 1、连按三次到 3、`q` 投递 quit 且队列清空、无关键无副作用）。在此之上，本章多了一层测试框架给不了的运行验证：

```text
cd companion
npm run demo            # 终端交互 App：+ 加一、q 退出（非 TTY 自动放映）
npm run demo:native     # Bun FFI：先验证 kernel32.GetTickCount 真 C 调用
bun src/app/native-window.mjs --msgbox   # 真的弹出一扇系统窗口
```

## 小结

终端 App 证明你的内核能驱动真实输入输出——消息源从测试换成键盘，回路一个零件不用换；FFI 脚本证明 binding 的尽头是真实的系统调用——签名表是注册表、编码缓冲区是序列化、返回码是回执。「JS 接入 GUI」这句话的全部内涵，你已经分别在模拟、wasm、系统 DLL 三个层面亲手实现过。下一章（也是最后一章）站在三段真机经验上回望整个生态的取舍。
