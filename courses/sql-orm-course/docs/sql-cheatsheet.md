---
title: SQL 常用语法速查表
---

# SQL 常用语法速查表

全书教过的 SQL 语法一览，以 SQLite 为准；方言列标注 MySQL（MySQL）/PostgreSQL（PG）的差异。只列本书教过的写法——各条的正文的演算与断言见括号里的章号。

## 建表与约束（DDL）

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `CREATE TABLE 表名 (列名 类型 约束, …);` | 把形状说出口（第 1、3 章） | 列定义 = 名字 + 类型 + 可选约束串 |
| `INTEGER PRIMARY KEY` | 主键：行的身份证号（第 3 章） | SQLite 里它是隐藏行号 rowid 的别名 |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | 发号只增不减、删号不复用（第 3 章） | 通常不需要；MySQL 写 `AUTO_INCREMENT`，PG 写 `SERIAL` 或 `GENERATED … AS IDENTITY` |
| `NOT NULL` | 这列不许为空（第 3 章） | |
| `UNIQUE` | 这列全表不得重复（第 3 章） | SQLite 实现自带一本自动目录 |
| `DEFAULT 值` | 插入不给这列时自动补（第 3 章） | 字符串字面量要引号 |
| `REFERENCES 表(列)` | 外键：指向另一张表某行的主键（第 3 章） | SQLite 默认不执法，要 `PRAGMA foreign_keys = ON`；MySQL（InnoDB）与 PG 建了就强制 |
| `CREATE INDEX idx_表_列 ON 表(列);` / `CREATE INDEX … ON 表(列1, 列2);` | 建目录 / 联合目录（第 6 章） | 联合索引守最左前缀：条件从最左列连续成段，段内最后一列才许范围 |
| `DROP INDEX 索引名;` / `DROP TABLE 表名;` | 拆目录 / 拆整张表（第 6、3 章） | DELETE FROM 只删行，DROP TABLE 连房子一起拆 |

类型：`TEXT`（文本）、`INTEGER`（整数）、`REAL`（小数）——SQLite 没有布尔与日期类型（取舍见第 9 章与[差异清单](./orm-divergence)）。SQLite 的类型是建议，MySQL/PG 的类型是法律。

## 查询（DML）

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `SELECT 列1, 列2 FROM 表;` | 锁行取列（第 1 章） | `*` 表示所有列全要 |
| `WHERE 条件` | 筛行（第 2 章） | 比较符 `= != > < >= <=` 与 JS 几乎一致 |
| `AND` / `OR` / `NOT` | 组合条件（第 2 章） | AND 优先级高于 OR，拿不准加括号 |
| `IN ('a', 'b')` | 值在候选清单里（第 2 章） | |
| `BETWEEN a AND b` | 闭区间，两端都算（第 2 章） | 等价 `>= a AND <= b` |
| `LIKE 'a%'` / `'_b'` | 模糊匹配：% 任意长度、_ 恰一个字符（第 2 章） | SQLite 默认只对 ASCII 不分大小写；PG 区分（不区分用 ILIKE）；前导通配走不了索引 |
| `IS NULL` / `IS NOT NULL` | 查空 / 查非空（第 2 章） | `= NULL` 永远查不出任何行——NULL 比较得 UNKNOWN |
| `ORDER BY 列 DESC, 列2 ASC` | 排序，多列各带方向（第 2 章） | 业务列在前、主键兜底在后，分页才不重不漏 |
| `LIMIT n OFFSET m` | 分页：取 n 行、先跳 m 行（第 2 章） | `OFFSET = (页码−1) × 每页行数`；MySQL 另有逗号版 `LIMIT m, n`（先跳后取，别记混） |
| `AS 别名` | 给列或表起短名（第 4、5 章） | WHERE 用别名 MySQL/PG 不认、SQLite 宽容但未承诺——跨库别用 |

## 聚合与分组

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `COUNT(*)` / `COUNT(列)` | 数行 / 只数有值的格子（第 4 章） | 差额就是该列为 NULL 的行数 |
| `SUM` / `AVG` / `MIN` / `MAX` | 求和 / 平均 / 最小 / 最大（第 4 章） | 全部跳过 NULL；全空时 SUM、AVG 出 NULL |
| `GROUP BY 列` | 按列的值分桶，每桶出一行（第 4 章） | SELECT 里只放分组列和聚合表达式（裸列是 SQLite 的宽容扩展） |
| `HAVING 组条件` | 分组后筛组（第 4 章） | WHERE 筛行在先、HAVING 筛组在后；条件带聚合函数必是组条件 |

## 多表

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `FROM a INNER JOIN b ON a.x = b.y` | 只留两边都配得上的行（第 5 章） | 一对多时左行会重复出现 |
| `FROM a LEFT JOIN b ON …` | 保左表全量，配不上的右列补 NULL（第 5 章） | 行数 ≥ INNER 版，差额正是配不上的左行数 |
| `表别名`（`users u`）与 `u.列` 前缀 | 消歧（第 5 章） | 连接条件写 ON、筛选条件写 WHERE；LEFT 下对右表列的 WHERE 会把保左打回 INNER |
| `FROM a, b WHERE …`（逗号老写法） | 等价内连接（第 5 章） | 忘写条件即叉积；新代码一律 JOIN … ON |

## 写操作

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `INSERT INTO 表 (列…) VALUES (?, …);` | 放一行进去（第 1 章） | 值永远走占位符参数，不拼字符串（第 8 章） |
| `UPDATE 表 SET 列 = ? WHERE …;` | 改行（第 3 章） | 省略 WHERE = 全表都是目标；changes 回执告诉你改了几行 |
| `DELETE FROM 表 WHERE …;` | 删行（第 3 章） | 同上，省略 WHERE 清空整表 |

## 事务与工具

| 语法 | 作用 | 备注 |
| --- | --- | --- |
| `BEGIN;` / `COMMIT;` / `ROLLBACK;` | 开事务 / 一次生效 / 全部作废（第 13 章） | 圈进来的语句捆绑成败；性能是副产品 |
| `EXPLAIN QUERY PLAN 语句` | 让数据库交代执行方案（第 6 章） | SCAN 整表逐行、SEARCH 只碰一部分；MySQL/PG 用 `EXPLAIN`（PG 另有 `EXPLAIN ANALYZE`） |
| `PRAGMA foreign_keys = ON;` | 打开外键执法（第 3 章） | 每个连接都要手动开；事务中途改它是空操作 |

安全铁律：用户输入永远走 `?` 占位符 + 参数绑定（第 8 章）；进不了参数通道的只有标识符（列名、表名）与结构（占位符个数），它们只能拼，且必须过白名单（第 10、12 章）。
