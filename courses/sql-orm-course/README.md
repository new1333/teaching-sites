# SQL 与 ORM：给前端的数据库课

一门写给前端开发者的数据库课：先在真实 SQLite 里把常用 SQL 练熟，再亲手造一个 mini-ORM（schema 建表 → 链式查询构建器 → 水合与脏跟踪 → 关联加载 → 事务），收官对照 Prisma / Drizzle / TypeORM 盘点差距。

- 读者画像：会写 Node 脚本的前端开发者，SQL 与 ORM 从零开始
- 终点里程碑：一个约 550 行、6 文件的 mini-ORM，105 项原理测试全绿（`tsc --noEmit` + `vitest run`）

## 怎么跑

两条路：

```bash
# 1) 项目根聚合站预览（推荐，能看到全部课程）
pnpm dev

# 2) 本课程单独预览
cd courses/sql-orm-course && pnpm install && pnpm docs:dev
```

伴生实验场（读者课程结束拥有的最小工程）：

```bash
cd companion && npm install && npm test     # 105 个测试按 14 章渐进解锁
```

环境要求：Node ≥ 22.5（实验场用内置 `node:sqlite`，零外部数据库依赖；本课程在 Node 24 上开发验证）。跑测试时终端会先打一行 `ExperimentalWarning`，不影响任何结果。

## 章节目录

第一部分 · SQL：把查询的活还给数据库

1. 把数据放进有形状的家：表、行与类型
2. 查询的艺术：WHERE、排序与分页
3. 改数据不翻车：UPDATE、DELETE 与约束
4. 让数据库替你算报表：聚合与分组
5. 两张表缝成一张：JOIN
6. 越用越慢的查询：索引与查询计划

第二部分 · 从 SQL 到 ORM

7. ORM 是什么：分层地图与两大门派
8. 一个引号引发的越权：SQL 注入与参数化

第三部分 · 亲手造一个 mini-ORM

9. 用对象描述表：schema 与 CREATE TABLE 生成
10. 链式调用变 SQL：查询构建器
11. 行变对象，对象写回行：水合与脏跟踪
12. 关联加载与 N+1：一次循环引发的 101 条 SQL
13. 要么全成，要么全不算：事务
14. 收工对账：我们的 mini-ORM 与真实 ORM 差在哪

附录：[SQL 常用语法速查表](docs/sql-cheatsheet.md) · [术语表](docs/glossary.md) · [mini-ORM 与真实 ORM 差异清单](docs/orm-divergence.md)

> 可感知成果说明：本课程形态是库与测试（非渲染/音频类），里程碑的「亲手开机」即上文实验场的门槛命令——每章「见证它变绿/变快」一节给了入口命令与期望输出，正文另附不进实验场也能跑的自包含脚本（各章「用法示例」）。
