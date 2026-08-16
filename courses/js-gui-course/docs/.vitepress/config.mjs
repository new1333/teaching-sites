// 由 .course/outline.json 渲染生成；改章节请改大纲后重新生成，勿手改
export default {
  title: 'JS 接入原生 GUI 的原理——从零理解 Electron 式桌面端',
  description: '会用 Electron/Tauri 调 API，但说不清「JS 一行代码怎么变成屏幕上的一个窗口」的开发者',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
        text: '原生世界：GUI 程序怎么活',
        collapsed: false,
        items: [
          { text: '1. 桌面 GUI 程序的骨架：窗口与消息循环', link: '/01-gui-skeleton.md' },
          { text: '2. 手写最小消息循环', link: '/02-message-loop.md' },
        ],
      },
      {
        text: '嵌入与桥：JS 世界怎么接上来',
        collapsed: false,
        items: [
          { text: '3. JS 没有 GUI：运行时是被嵌入的', link: '/03-embedded-runtime.md' },
          { text: '4. binding 层：JS 怎么调用「另一个语言」', link: '/04-binding-layer.md' },
          { text: '5. 窗口对象：宿主给你的遥控器', link: '/05-window-handle.md' },
          { text: '6. 单线程遇多线程：异步桥', link: '/06-async-bridge.md' },
        ],
      },
      {
        text: '进程与组装：mini-Electron 闭环与真机',
        collapsed: false,
        items: [
          { text: '7. 为什么是两个进程', link: '/07-process-model.md' },
          { text: '8. IPC：invoke/handle 与 send/on', link: '/08-ipc-channel.md' },
          { text: '9. 反方向：native 事件进 JS', link: '/09-native-events-to-js.md' },
          { text: '10. 组装 mini-Electron', link: '/10-assemble-mini-electron.md' },
          { text: '11. 真机篇（上）：WebAssembly——第一次真的跨语言', link: '/11-wasm-binding.md' },
          { text: '12. 真机篇（下）：跑起来——终端 App 与真窗口', link: '/12-terminal-app.md' },
          { text: '13. 回望：Electron、Tauri 与原生绑定的同一原理', link: '/13-ecosystem-tradeoffs.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
