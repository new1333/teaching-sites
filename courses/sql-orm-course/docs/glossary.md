---
title: 术语表
---

# 术语表

全书首教过的名词，按课程出场顺序的归类整理；每条一句话定义，出处见各章首现位置。

| 术语 | 英文 | 一句话定义 |
| --- | --- | --- |
| 数据库 | database | 一个专门负责存数据和查数据的独立程序，你用 SQL 跟它对话，它把结果按行还给你。 |
| 表 | table | 数据库里的一张二维表：列定形状和类型，一行就是一条记录，像一张带表头的 Excel。 |
| 行 | row | 表里的一条记录，对应前端世界里的一个对象。 |
| 列 | column | 表的一竖条，规定名字和类型，对应对象的一个字段——但类型是全表统一的。 |
| SQL | Structured Query Language | 跟数据库说话的固定句式语言，读数据写 SELECT、写数据用 INSERT/UPDATE/DELETE、描述表结构用 CREATE TABLE。 |
| 声明式 | declarative | 只说要什么、不说怎么做的写法，像 CSS 选择器；SQL 是声明式的：写条件，遍历交给数据库。 |
| 主键 | primary key | 一行数据的身份证号：全表唯一，靠它精确定位某一行；「永不复用」是本分，SQLite 里要显式加 AUTOINCREMENT 才兑现。 |
| 外键 | foreign key | 一列里存的是另一张表某行的主键，相当于数据库帮你验证过的「指向另一行的指针」。 |
| 约束 | constraint | 写在表定义里的守门规则（非空、唯一等），非法数据在写入那一刻就被数据库拦下。 |
| 聚合函数 | aggregate function | 把多行压成一个数的内置动作，如 COUNT 数行数、SUM 求和、AVG 求平均。 |
| 分组 | GROUP BY | 按某列的值把行分桶，每个桶各自出聚合结果，像先 Map 分组再各自 reduce。 |
| 连接 | JOIN | 按两表的关联列把行配成对的 SQL 写法，把前端手写的「两数组按 id 匹配」搬进数据库。 |
| 索引 | index | 为某列额外建的一份排好序的目录，让按这列查不用从头翻到尾。 |
| B-tree | B-tree | 索引常用的有序树结构：从中间分叉、逐层缩小范围，几步就定位目标，像按拼音排好的通讯录。 |
| 查询计划 | query plan | 数据库自述的执行方案；EXPLAIN 命令让它交代打算全表扫还是走索引。 |
| 全表扫描 | full table scan | 没有可用索引时数据库只能从第一行翻到最后一行的执行方式，行数涨多少它就慢多少。 |
| ORM | object-relational mapping | 对象关系映射：一层翻译器，这边写对象与链式调用，那边生成并执行 SQL，行与对象互相自动转换。 |
| Active Record | Active Record | ORM 一派：数据对象自带增删改能力，user.save() 直接写库。 |
| Data Mapper | Data Mapper | ORM 另一派：数据只是纯数据，读写交给独立的映射器对象，两者分开。 |
| SQL 注入 | SQL injection | 拼接字符串时用户输入被当成了 SQL 代码执行，数据库世界的 XSS。 |
| 参数化查询 | parameterized query | SQL 模板里放 ? 占位符、数据单独传的写法，用户输入永远只是数据、成不了代码。 |
| 预编译语句 | prepared statement | 先把 SQL 模板交给数据库解析好、再反复填参数执行的机制，参数化查询的底层实现。 |
| 数据定义语言 | DDL, data definition language | 描述数据结构的那类 SQL（CREATE/ALTER/DROP），盖楼的图纸；与之相对的 DML 是搬家具（增删改查）。 |
| 查询构建器 | query builder | 用链式调用攒条件、最后一步编译成 SQL 的库， knex 是典型；ORM 的查询半身。 |
| 水合 | hydration | 把查回来的裸行变成带方法的类实例的过程——注意与 SSR 的同名概念无关。 |
| 脏跟踪 | dirty tracking | 实例自己记着哪些字段被改过，save 时只把这些字段的列写回数据库。 |
| N+1 问题 | N+1 query problem | 查 1 次列表再逐行查关联、共发出 N+1 条 SQL 的病症，靠批量加载治愈。 |
| 事务 | transaction | 把多条 SQL 捆成一个整体：全部成功才提交，任何一步失败就整体回滚，像可撤销的 git commit。 |
| 原子性 | atomicity | 事务的核心承诺：里面的一串操作要么全发生、要么全没发生，不存在做一半。 |
| 迁移 | migration | 把表结构的每次变更写成带序号的脚本，像表结构的 git 历史，可回放可回滚。 |
| 连接池 | connection pool | 预建好一组数据库连接排队复用的机制，免得每个请求都付一次建连接的成本。 |
| 方言 | dialect | 各家数据库 SQL 的细微差异，如分页写法 MySQL 与 SQLite 就不同。 |
