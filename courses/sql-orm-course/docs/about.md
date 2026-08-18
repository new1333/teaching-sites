# 关于本课程

这是一门写给前端开发者的数据库课。输入是一句主题：「SQL 常用操作；面向前端开发；常用 ORM；ORM 原理与亲手实现」——读者画像按零基础校准：会写 Node 脚本，SQL 与 ORM 双零起点。

全书 14 章（全部完成）分三部分：第一部分用 6 章把常用 SQL 语法在真实 SQLite 里练熟（建表、查询、写操作与约束、聚合分组、JOIN、索引与查询计划）；第二部分用 2 章建立 ORM 的概念地图并亲手复现 SQL 注入；第三部分用 6 章在伴生实验场里造出一个 mini-ORM——schema 建表、链式查询构建器、水合与脏跟踪、关联加载、事务，收官对照真实 ORM 盘点差距。

伴生实验场 `companion/` 是一个 TypeScript + vitest 工程（数据库用 Node 内置 `node:sqlite` 的内存库，零外部依赖），全书 105 个测试按章渐进解锁，`cd companion && npm install && npm test` 即可跑通。第 14 章末尾有与真实 ORM 的[差异清单](./orm-divergence)，常用语法可查[速查表](./sql-cheatsheet)，名词可查[术语表](./glossary)。
