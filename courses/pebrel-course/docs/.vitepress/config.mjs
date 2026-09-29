export default {
  title: 'Pebrel 源码走读：GPU 终端模拟器的九个 crate',
  description: '能用 Rust 读写中等单文件、想读懂真实工业级仓库的开发者',
  created: '2026-09-29',
  base: '/',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' }
    ],
    sidebar: [
      {
        text: '第一部分 · 地基：地图与终端本体',
        collapsed: false,
        items: [
          { text: '1. 第 1 章 仓库地图：九个 crate 与所有权合同', link: '/01-repo-map.md' },
          { text: '2. 第 2 章 从字节到屏幕：VT 解析与网格状态机', link: '/02-vt-grid.md' },
          { text: '3. 第 3 章 PTY 桥与事件循环：shell 输出的跨线程旅程', link: '/03-pty-event-loop.md' }
        ]
      },
      {
        text: '第二部分 · 界面：分屏与 GPUI 壳',
        collapsed: false,
        items: [
          { text: '4. 第 4 章 纯数据分屏树：不含一个 UI 类型的布局内核', link: '/04-split-tree.md' },
          { text: '5. 第 5 章 GPUI 壳与 pane 生命周期', link: '/05-gpui-shell.md' }
        ]
      },
      {
        text: '第三部分 · 远端：SSH 工作区',
        collapsed: false,
        items: [
          { text: '6. 第 6 章 传输层无关：SSH 远端终端', link: '/06-ssh-session.md' },
          { text: '7. 第 7 章 SFTP 并发引擎：多句柄绕开在途上限', link: '/07-sftp-engine.md' }
        ]
      },
      {
        text: '第四部分 · AI 会话宿主',
        collapsed: false,
        items: [
          { text: '8. 第 8 章 钩子桥进程：AI CLI 事件的隐形搬运工', link: '/08-ai-hook-bridge.md' },
          { text: '9. 第 9 章 事件归一与门控排序：从原始载荷到类型化状态机', link: '/09-ai-lifecycle.md' },
          { text: '10. 第 10 章 屏幕证据：为未知 CLI 写状态推断规则', link: '/10-screen-evidence.md' }
        ]
      },
      {
        text: '第五部分 · 数据与配置',
        collapsed: false,
        items: [
          { text: '11. 第 11 章 会话持久化：崩溃安全快照与恢复护栏', link: '/11-session-persistence.md' },
          { text: '12. 第 12 章 Lua 配置：本地执行、产物可校验', link: '/12-lua-config.md' }
        ]
      },
      {
        text: '第六部分 · 原生体验扩展',
        collapsed: false,
        items: [
          { text: '13. 第 13 章 原生 TeX 管线：后端无关的公式排版', link: '/13-native-math.md' },
          { text: '14. 第 14 章 AI 回答阅读器：共享管线的复用范式', link: '/14-answer-reader.md' },
          { text: '15. 第 15 章 独立补全引擎：从 Nushell 抽出的零 UI crate', link: '/15-completion-engine.md' }
        ]
      },
      {
        text: '第七部分 · 收束',
        collapsed: false,
        items: [
          { text: '16. 第 16 章 从地图回到地图：全书能力对账', link: '/16-review.md' }
        ]
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '源码阅读地图', link: '/source-map.md' },
          { text: '练习：为未知 CLI 写屏幕证据规则', link: '/exercises.md' }
        ]
      }
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' }
  }
}
