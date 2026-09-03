export default {
  title: 'SQL 与 ORM：给前端的数据库课',
  description: '会写 Node 脚本的前端：SQL 与 ORM 从零开始',
  created: '2026-08-18',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '关于', link: '/about' },
    ],
    sidebar: [
      {
        text: '第一部分 · SQL：把查询的活还给数据库',
        collapsed: false,
        items: [
          { text: '1. 把数据放进有形状的家：表、行与类型', link: '/01-tables-and-rows.md' },
          { text: '2. 查询的艺术：WHERE、排序与分页', link: '/02-where-order-limit.md' },
          { text: '3. 改数据不翻车：UPDATE、DELETE 与约束', link: '/03-update-delete-constraints.md' },
          { text: '4. 让数据库替你算报表：聚合与分组', link: '/04-aggregate-group-by.md' },
          { text: '5. 两张表缝成一张：JOIN', link: '/05-join-tables.md' },
          { text: '6. 越用越慢的查询：索引与查询计划', link: '/06-index-query-plan.md' },
        ],
      },
      {
        text: '第二部分 · 从 SQL 到 ORM',
        collapsed: false,
        items: [
          { text: '7. ORM 是什么：分层地图与两大门派', link: '/07-what-is-orm.md' },
          { text: '8. 一个引号引发的越权：SQL 注入与参数化', link: '/08-sql-injection.md' },
        ],
      },
      {
        text: '第三部分 · 亲手造一个 mini-ORM',
        collapsed: false,
        items: [
          { text: '9. 用对象描述表：schema 与 CREATE TABLE 生成', link: '/09-schema-to-ddl.md' },
          { text: '10. 链式调用变 SQL：查询构建器', link: '/10-query-builder.md' },
          { text: '11. 行变对象，对象写回行：水合与脏跟踪', link: '/11-hydration-dirty-tracking.md' },
          { text: '12. 关联加载与 N+1：一次循环引发的 101 条 SQL', link: '/12-relations-n-plus-1.md' },
          { text: '13. 要么全成，要么全不算：事务', link: '/13-transactions.md' },
          { text: '14. 收工对账：我们的 mini-ORM 与真实 ORM 差在哪', link: '/14-finale-gaps.md' },
        ],
      },
      {
        text: '附录',
        collapsed: false,
        items: [
          { text: 'SQL 常用语法速查表', link: '/sql-cheatsheet.md' },
          { text: '术语表', link: '/glossary.md' },
          { text: 'mini-ORM 与真实 ORM 差异清单', link: '/orm-divergence.md' },
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
