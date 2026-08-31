export default {
  title: 'fable-nginx：亲手复刻一个 nginx',
  description: '会写代码、用过 HTTP，但没碰过网络编程与事件驱动的开发者',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 先把服务器写出来',
        collapsed: false,
        items: [
          { text: '1. 一个 HTTP 服务器的最小闭环', link: '/01-first-http-server.md' },
          { text: '2. 一连接一线程的代价：C10K 从哪来', link: '/02-thread-per-connection-cost.md' },
        ],
      },
      {
        text: '第二部分 · nginx 的心脏：事件驱动',
        collapsed: false,
        items: [
          { text: '3. 把「等」集中起来：非阻塞 IO 与事件循环', link: '/03-event-loop.md' },
          { text: '4. 半读半写的世界：事件驱动的连接状态机', link: '/04-connection-state-machine.md' },
        ],
      },
      {
        text: '第三部分 · 长成 nginx 的形状',
        collapsed: false,
        items: [
          { text: '5. master 与 worker：nginx 的多进程骨架', link: '/05-master-workers.md' },
          { text: '6. 反向代理：既当前台，又当传话员', link: '/06-reverse-proxy.md' },
          { text: '7. 对账真 nginx：我们写的和它差在哪', link: '/07-vs-real-nginx.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '差异清单：我们对现实的每一处简化', link: '/simplifications.md' },
          { text: '练习路线：把 mini nginx 再写一遍', link: '/exercises.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
