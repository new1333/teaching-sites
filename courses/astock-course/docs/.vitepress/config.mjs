export default {
  title: 'A股投资：从小白到专家',
  description: '零基础小白的A股实战第一课',
  created: '2026-09-04',
  base: '/',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '认知地基：钱、公司与市场',
        collapsed: false,
        items: [
          { text: '1. 你的钱正在变少：时间价值、通胀与复利', link: '/01-time-value.md' },
          { text: '2. 股票是什么：你买的不是代码，是公司的一部分', link: '/02-stock-nature.md' },
        ],
      },
      {
        text: '进场：规则、行情与工具',
        collapsed: false,
        items: [
          { text: '3. A股的游戏规则：竞价、T+1、涨跌停与成本', link: '/03-market-rules.md' },
          { text: '4. K线：一根蜡烛里的多空战争', link: '/04-k-line.md' },
          { text: '5. 均线与趋势：技术分析能信几分', link: '/05-trend-ma.md' },
        ],
      },
      {
        text: '称重：看懂公司与价格',
        collapsed: false,
        items: [
          { text: '6. 财报三张表：利润是观点，现金是事实', link: '/06-financial-statements.md' },
          { text: '7. 给公司称重：市盈率、市净率与股息率', link: '/07-valuation-multiples.md' },
          { text: '8. 好公司不等于好股票：内在价值、安全边际与能力圈', link: '/08-margin-of-safety.md' },
        ],
      },
      {
        text: '活下来：风险、仓位与你自己',
        collapsed: false,
        items: [
          { text: '9. 风险的数学：波动、回撤与盈亏不对称', link: '/09-risk-math.md' },
          { text: '10. 免费的午餐：分散、相关性与资产配置', link: '/10-diversification.md' },
          { text: '11. 仓位与定投：先决定输得起，再决定买多少', link: '/11-position-sizing.md' },
          { text: '12. 行为陷阱：为什么聪明人也亏钱', link: '/12-behavior-traps.md' },
        ],
      },
      {
        text: '成体系：从会买到会投资',
        collapsed: false,
        items: [
          { text: '13. 指数基金与ETF：普通人的主力武器', link: '/13-index-etf.md' },
          { text: '14. 七步研究清单：从0到1分析一家公司', link: '/14-stock-checklist.md' },
          { text: '15. 你的投资体系：一页纸计划书', link: '/15-your-system.md' },
          { text: '16. 通往专家的路：进阶地图', link: '/16-expert-roadmap.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '速查表：费率、规则与公式', link: '/reference-table.md' },
          { text: '简化与差异清单', link: '/divergence.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
