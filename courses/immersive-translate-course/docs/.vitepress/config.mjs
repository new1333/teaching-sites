// 由 .course/outline.json 渲染生成——nav/sidebar 100% 来自大纲数据，不扫文件系统。
export default {
  title: '复刻沉浸式翻译：双语对照引擎的原理与实现',
  description: '会写 TS 与原生 DOM、想复刻双语翻译工具的开发者',
  created: '2026-08-31',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
      { text: '术语表', link: '/glossary' },
    ],
    sidebar: [
      {
        text: '第一部分 · 识别与渲染：先把骨架搭起来',
        collapsed: false,
        items: [
          { text: '1. 整页替换 vs 双语对照：两种翻译世界观', link: '/01-panorama.md' },
          { text: '2. 可译块：找到直接持有文字的节点', link: '/02-extract-blocks.md' },
          { text: '3. 双语渲染：原文纹丝不动，译文插到下面', link: '/03-render-bilingual.md' },
          { text: '4. 翻译服务抽象：引擎不认识任何 API', link: '/04-pipeline-service.md' },
        ],
      },
      {
        text: '第二部分 · 像产品一样翻译：格式、正文与成本',
        collapsed: false,
        items: [
          { text: '5. 内联格式保留：译文里的加粗和链接', link: '/05-inline-format.md' },
          { text: '6. 主内容识别：别把额度花在导航栏上', link: '/06-main-content.md' },
          { text: '7. 批量、去重与缓存：翻译的经济学', link: '/07-batch-cache.md' },
        ],
      },
      {
        text: '第三部分 · 上线：活页面与真浏览器',
        collapsed: false,
        items: [
          { text: '8. 动态内容：别让译文生译文', link: '/08-dynamic-observer.md' },
          { text: '9. 装进浏览器：从 jsdom 到真实页面', link: '/09-browser-shell.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '节点分类速查表', link: '/node-cheatsheet.md' },
          { text: '与真实产品的差异清单', link: '/divergence.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
