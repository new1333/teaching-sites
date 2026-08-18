---
title: mini-ORM 与真实 ORM 差异清单
---

# mini-ORM 与真实 ORM 差异清单

全书正文每处「本课程简化为 … / 不做 …」的集中登记。分两栏：**简化项**（做了但比真实 ORM 简化）与**未实现项**（真实 ORM 有、mini-ORM 没做），另附一节**实验场环境类简化**（不是 ORM 的差距，是教学环境的取舍）。逐条的完整原理见[第 14 章](./14-finale-gaps)的对账。

## 简化项

| 简化项 | mini-ORM 的做法 | 真实 ORM 的做法 | 正文出处 |
| --- | --- | --- | --- |
| 类型映射 | schema 只认 `integer / text / real`；布尔、日期不映射，存取自己换算 | Prisma 的 `Boolean`、TypeORM 的 `boolean` 列自动换 0/1；日期有专门列类型 | [第 9 章](./09-schema-to-ddl) |
| 命名映射 | 字段名与列名保持同名 | Prisma `@map` / `@@map`、TypeORM `namingStrategy` 做 userName ↔ user_name 自动映射 | [第 9 章](./09-schema-to-ddl)、[第 11 章](./11-hydration-dirty-tracking) |
| 查询条件 | where 只支持 AND 叠加，七个比较操作符 + LIKE | 各家支持 OR 分组、`In` / `Between` / `Not` 等操作符（TypeORM FindOptions、Prisma `where OR`） | [第 10 章](./10-query-builder)、[第 12 章](./12-relations-n-plus-1) |
| 聚合进构建器 | 聚合函数与分组不进构建器，要聚合直接写 SQL | 各家查询层支持 count/aggregate | [第 10 章](./10-query-builder) |
| 关联加载顺序 | 两跳加载不额外排序，顺序不保证 | 各家支持关联的 orderBy | [第 12 章](./12-relations-n-plus-1) |
| 隔离语义 | 只讲「同连接自见未提交、他连接不可见」一句话 | 完整隔离级别（READ COMMITTED 等）可配 | [第 13 章](./13-transactions) |

## 未实现项

| 未实现项 | 为什么没做 | 真实 ORM 怎么做 | 正文出处 |
| --- | --- | --- | --- |
| 类型推导 | schema 不生成 TS 类型，行/关联的类型是 `unknown`，接口手写 | Prisma 由 schema 生成 client 类型；Drizzle 按表定义自动推断（含可空性）；TypeORM 装饰器 + 反射 | [第 11 章](./11-hydration-dirty-tracking)、[第 14 章](./14-finale-gaps) |
| 乐观锁 | 丢更新只靠脏跟踪缓解（只写变化列），根治没做 | 版本号/时间戳列（TypeORM `@VersionColumn` 等），写入时校验版本 | [第 11 章](./11-hydration-dirty-tracking) |
| IN / BETWEEN 操作符 | 构建器白名单未收；两跳加载内部手拼参数化 IN | 查询层原生支持 | [第 10 章](./10-query-builder)、[第 12 章](./12-relations-n-plus-1) |
| 嵌套关联 | with 不支持嵌套（关联的关联） | 各家支持深层 include / relations | [第 12 章](./12-relations-n-plus-1) |
| 嵌套事务 | tx 不支持嵌套，直接抛中文错误 | 用 SAVEPOINT（保存点）实现嵌套回滚 | [第 13 章](./13-transactions) |
| 多对多 / 透视表 | 只有 hasMany / belongsTo | TypeORM `@ManyToMany` + `@JoinTable`、Prisma 隐式关系表，自动建第三张表 | [第 14 章](./14-finale-gaps) |
| 迁移 | 表结构只由 defineTable 首次建表 | Prisma Migrate / Drizzle Kit / TypeORM migration：编号迁移文件 + 历史表，两环境重放 | [第 14 章](./14-finale-gaps) |
| 连接池 | SQLite 内存库单连接，无池化必要 | MySQL/PG 驱动层预建连接排队复用（借还纪律、上限、等待队列） | [第 14 章](./14-finale-gaps) |
| 方言 / 多库 | SQL 生成绑死 SQLite 语法 | 各家为 MySQL / PG / SQLite 等分别编译（方言分叉） | [第 14 章](./14-finale-gaps) |

## 实验场环境类简化

不是 mini-ORM 与真实 ORM 的差距，是教学环境的取舍，一并登记：

| 简化项 | 实验场的做法 | 真实环境的做法 | 正文出处 |
| --- | --- | --- | --- |
| 内存库 | `createDb()` 打开 `:memory:`，进程退出即拆 | 数据库落盘持久化，数据不随进程消失 | [第 1 章](./01-tables-and-rows) |
| 磁盘成本 | 事务性能对比里没有磁盘等待，差距只剩事务开销本身 | 提交要等数据真正落盘，逐条提交的差距大一个量级 | [第 13 章](./13-transactions) |

另有三处正文声明「不展开」的知识点，不属 ORM 差异，仅备查：外键的 ON DELETE 级联动作（[第 3 章](./03-update-delete-constraints)）、日期函数与时区（[第 4 章](./04-aggregate-group-by)）、RIGHT/FULL JOIN（[第 5 章](./05-join-tables)）。
