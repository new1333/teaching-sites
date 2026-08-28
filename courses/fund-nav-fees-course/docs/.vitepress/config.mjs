export default {
  title: '基金净值与费率：从看得懂的数字到算得清的账',
  description: '净值怎么来、按哪天结算、每类费用怎么算——十章把每笔账算到分',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [
      {
        text: '一、净值那本账',
        collapsed: false,
        items: [
          { text: '1. 单位净值：一份基金到底值多少钱', link: '/01-unit-nav.md' },
          { text: '2. 分红、折算与累计净值：净值为什么会「跳」', link: '/02-dividend-and-cum-nav.md' },
          { text: '3. 未知价法：今天下午买，按哪天的净值算', link: '/03-unknown-price.md' },
        ],
      },
      {
        text: '二、费率那本账',
        collapsed: false,
        items: [
          { text: '4. 申购费：外扣法一笔算清', link: '/04-purchase-fee.md' },
          { text: '5. 赎回费：持有期阶梯与 7 天惩罚', link: '/05-redemption-fee.md' },
          { text: '6. 管理费与托管费：藏在净值里的日计提', link: '/06-management-fee-daily.md' },
          { text: '7. A 类还是 C 类：一次可以算出来的选择', link: '/07-share-class-break-even.md' },
        ],
      },
      {
        text: '三、算明白',
        collapsed: false,
        items: [
          { text: '8. 货币基金的两个数：万份收益与七日年化', link: '/08-money-fund-numbers.md' },
          { text: '9. 申赎对账单：从买入到卖出一笔记到底', link: '/09-full-statement.md' },
          { text: '10. 复盘：你现在能独立算清的账', link: '/10-review.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: '术语表', link: '/glossary.md' },
          { text: '费率速查表', link: '/fee-cheatsheet.md' },
          { text: '本课简化与真实规则的差异', link: '/divergence-list.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
