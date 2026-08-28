export default {
  title: 'dayjs 源码走读：一个日期库的最小内核',
  description: '看得懂 JavaScript、想读一个真实开源库的工程师',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
        text: '一、内核：一个类与一条解析路径',
        collapsed: false,
        items: [
          { text: '1. dayjs() 是个工厂：入口与实例', link: '/01-factory-and-instance.md' },
          { text: '2. parseDate：四类输入，一条路径', link: '/02-parse-date.md' },
          { text: '3. init：为什么实例上挂满了 $ 变量', link: '/03-init-cache.md' },
        ],
      },
      {
        text: '二、三根支柱：不可变、单位对齐、格式化',
        collapsed: false,
        items: [
          { text: '4. 不可变性：add/set 为什么返回新对象', link: '/04-immutability.md' },
          { text: '5. startOf/endOf：单位对齐的两个工厂', link: '/05-startof-endof.md' },
          { text: '6. format：一次正则替换的全文翻译器', link: '/06-format.md' },
        ],
      },
      {
        text: '三、生态：语言包与插件',
        collapsed: false,
        items: [
          { text: '7. locale：L 与 Ls 的一张注册表', link: '/07-locale-registry.md' },
          { text: '8. extend：三十多个插件共用的三个参数', link: '/08-plugin-system.md' },
          { text: '9. 复盘：这张源码地图你现在走完了', link: '/09-review.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '源码地图速查', link: '/source-map.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
