export default {
  title: 'Pinia 从零实现',
  description: '会用 Vue 3 组合式 API、想真正吃透状态管理而非只会调 API 的开发者',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · 地基与容器',
        collapsed: false,
        items: [
          { text: '1. 状态管理的四种尝试与它们的极限', link: '/01-why-state-management.md' },
          { text: '2. Vue 响应式工具箱：pinia 的六块地基', link: '/02-vue-reactivity-toolkit.md' },
          { text: '3. createPinia：一个挂在 app 上的容器', link: '/03-create-pinia.md' },
          { text: '4. defineStore 与 store 的单例身份', link: '/04-define-store.md' },
        ],
      },
      {
        text: '第二部分 · store 的血肉',
        collapsed: false,
        items: [
          { text: '5. 选项式 store：state、getters、actions 三件套', link: '/05-option-store.md' },
          { text: '6. 组合式 store 与运行时分类', link: '/06-setup-store.md' },
          { text: '7. $patch 深合并与 $reset', link: '/07-patch-and-reset.md' },
          { text: '8. 订阅系统：$subscribe 与 $onAction', link: '/08-subscriptions.md' },
          { text: '9. storeToRefs：解构不丢响应性的秘密', link: '/09-store-to-refs.md' },
        ],
      },
      {
        text: '第三部分 · 扩展与生产',
        collapsed: false,
        items: [
          { text: '10. 插件系统：pinia.use 与 store 扩展', link: '/10-plugins.md' },
          { text: '11. activePinia：一个应用一个容器', link: '/11-active-pinia-and-ssr.md' },
          { text: '12. pinia-mini vs pinia：差异地图', link: '/12-pinia-vs-mini.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
