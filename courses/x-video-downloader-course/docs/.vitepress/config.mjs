export default {
  title: 'X 视频下载插件：从零写一个真能用的浏览器扩展',
  description: '会写 JS、装过插件没写过的开发者，做一个真能用的下载器',
  created: '2026-08-31',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
        text: '一、住进页面',
        collapsed: false,
        items: [
          { text: '1. 让代码跑在 x.com 上：MV3 插件的最小骨架', link: '/01-mv3-anatomy.md' },
          { text: '2. 视频不在 video 标签里：让它在网络面板现形', link: '/02-network-watch.md' },
        ],
      },
      {
        text: '二、拿到文件',
        collapsed: false,
        items: [
          { text: '3. 拆开播放列表：从 m3u8 到清晰度清单', link: '/03-m3u8-parse.md' },
          { text: '4. 把播放列表变回一个文件：分片下载管线', link: '/04-download-pipeline.md' },
        ],
      },
      {
        text: '三、做成产品',
        collapsed: false,
        items: [
          { text: '5. 把按钮放上推文：SPA 世界的 DOM 注入', link: '/05-inject-ui.md' },
          { text: '6. 权限的代价：CSP、CORS 与上架清单', link: '/06-permissions-publish.md' },
          { text: '7. 从点击到落盘：全链路对账', link: '/07-full-chain-review.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '本课程简化了什么', link: '/divergence-list.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
