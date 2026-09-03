export default {
  title: 'Vue DevTools 原理：从零实现一个调试器内核',
  description: '写过 Vue 应用、用过分水岭级调试工具，想知道「面板为什么能看见我的组件和状态」并亲手做出最小实现的开发者',
  created: '2026-08-15',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
        text: '第一部分 · 连接前夜：页面里的会合点',
        collapsed: false,
        items: [
          { text: '1. 两个世界：调试器为什么难做', link: '/01-two-worlds.md' },
          { text: '2. 全局钩子：window 上的第一次握手', link: '/02-global-hook.md' },
          { text: '3. 事件系统：从原始事件到语义事件', link: '/03-event-system.md' },
          { text: '4. 应用登记处：多应用与实例表', link: '/04-app-record.md' },
        ],
      },
      {
        text: '第二部分 · 看见：组件树与状态',
        collapsed: false,
        items: [
          { text: '5. 组件树：走 vnode，不走 DOM', link: '/05-component-tree.md' },
          { text: '6. 状态快照：分类与清洗', link: '/06-state-snapshot.md' },
          { text: '7. 序列化：循环引用的过桥方案', link: '/07-transfer-encoding.md' },
          { text: '8. 编辑回写：把修改写回活实例', link: '/08-state-editing.md' },
        ],
      },
      {
        text: '第三部分 · 对话：RPC、插件与宿主',
        collapsed: false,
        items: [
          { text: '9. 插件 API：第三方库的面板', link: '/09-plugin-and-inspector.md' },
          { text: '10. 双向 RPC 与通道抽象', link: '/10-birpc-channel.md' },
          { text: '11. 宿主形态：Vite、扩展与中继', link: '/11-hosts-and-relay.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
