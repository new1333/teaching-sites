// 由 .course/outline.json 渲染生成,勿手改——改大纲后重新生成。
export default {
  title: '编辑器里的图标智能:VSCode 扩展原理十二讲',
  description: '想理解 VSCode 扩展如何对代码文本做识别、补全与内联渲染的前端开发者;不要求写过扩展,但需要 TypeScript 基础',
  created: '2026-08-16',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '识别:从文本里找出图标名',
        collapsed: false,
        items: [
          { text: '1. 一个插件的边界:文本智能的三条通道', link: '/01-extension-channels.md' },
          { text: '2. 可配置的正则组装:识别规则不该写死', link: '/02-configurable-regex.md' },
          { text: '3. 偏移、行列与范围:装饰为什么盖错了地方', link: '/03-offset-to-position.md' },
          { text: '4. 图标名解析与别名:mdi-light 不是 mdi', link: '/04-icon-parsing.md' },
        ],
      },
      {
        text: '数据:图标从哪来、怎么渲染',
        collapsed: false,
        items: [
          { text: '5. 三级缓存与在途去重:同一本书只取一次', link: '/05-cache-chain.md' },
          { text: '6. SVG 渲染管线:currentColor、宽高比与 data URL', link: '/06-svg-pipeline.md' },
          { text: '7. 构建期与运行期的分界:索引卡片与书', link: '/07-build-vs-runtime.md' },
        ],
      },
      {
        text: '智能:补全、悬停与活的配置',
        collapsed: false,
        items: [
          { text: '8. 装饰收集器与 in-place 模式:光标行不藏字', link: '/08-inplace-decorations.md' },
          { text: '9. 补全与悬停:延迟出图的提供方', link: '/09-providers-lazy-docs.md' },
          { text: '10. 活的配置:最小依赖追踪', link: '/10-reactive-config.md' },
          { text: '11. 自定义集合与热重载:私有图标库天天改', link: '/11-custom-collections.md' },
          { text: '12. 激活、命令与生命周期:别拖慢所有人的启动', link: '/12-activation-lifecycle.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
