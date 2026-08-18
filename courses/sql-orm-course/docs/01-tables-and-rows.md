---
title: 把数据放进有形状的家：表、行与类型
---

# 把数据放进有形状的家：表、行与类型

## 从半小时的 reduce 说起

周五下午，同事发来一句：「把上周 status 是 paid 的订单导我一份，急」。订单在 localStorage 里——一个 JSON 数组，两千多个对象。你打开控制台：filter 一遍 status，写日期比较，sort，再 map 成他要的列。reduce 折腾了半小时导出去，晚上他回一句「怎么少了三条」。一查：补单是后来 push 进数组的，字段名从 paid_at 改成了 payTime，你的条件悄悄漏掉了它们。

你以为是手滑。第二天他要「上个月的退款单」，你又坐下来 reduce 一遍。这才是病根：真正的问题是**这份数据没有形状**——数组里每个对象自带字段，谁都能塞任何键，没有任何一步校验；查询逻辑长在你的代码里——问题换一个，遍历就重写一遍。每次都是手工作坊：数据是原料，查询是手艺，手艺一换人、一熬夜就出废品。

这一章我们把数据搬进一个有形状的家。要认识三样东西：形状本身——表、行、列与类型；房子的管家；跟管家打交道的前三句话——建表、插入、查询。

## 数据为什么要有个形状

### 成因：同一份数据，无数个问题

「用不同的问题反复查同一份数据」不是你一个人的烦恼，它比前端这个工种老得多。1970 年，IBM 研究员 E. F. Codd 发表论文，提出关系模型（relational model）——把数据组织成一张张二维表、表与表靠共同的字段关联、用一门统一的语言提问的一套思路。在他这里，查询不再是每个提问者手写的遍历，而是数据那侧一个专门程序的日常业务。这个想法后来长成了今天所有关系型数据库的共同祖先。它治的正是你的半小时：**数据的形状先讲好，查询的活交给专门的家伙**。

### 载体：表、行、列

关系（relation）就是这套理论里「表」的学名——一张表就是一个关系，它就是数据的最小载体。存用户数据的 users 表长这样：

```text
表 users —— 列定形状，一行一条记录
┌────┬───────┬───────────────────┬─────┐
│ id │ name  │ email             │ age │   ← 列：名字 + 类型，全表统一
├────┼───────┼───────────────────┼─────┤
│ 1  │ Alice │ alice@example.com │ 30  │   ← 行：一条记录，约等于一个对象
│ 2  │ Bob   │ bob@example.com   │ 25  │
└────┴───────┴───────────────────┴─────┘
```

对照前端的世界逐个翻译：一张表（table）就是一组同形状的对象；一行（row）就是一条记录、一个对象；一列（column）就是一个字段。差别在类型上：对象的字段各管各的，这一行 age 存 30、下一行存「三十」都没人管；**而列的类型是全表预先声明好的**——name 列整列是文本，age 列整列是数字。形状先于数据存在，这就是「有形状」三个字的含义。

### 演算：先锁行，再取列

一句最简单的查询：SELECT name, age FROM users WHERE age > 26。它在表上的走法可以完整手算，只有两步：WHERE 先把不满足条件的行筛掉（锁行），SELECT 再从活下来的行里挑出要的列（取列）。拿上面 3 行数据跟着算：

```text
起点：全表 3 行 4 列       第一步：WHERE age > 26 锁行    第二步：SELECT name, age 取列
 id  name    email    age   id  name    email    age      name    age
  1  Alice   alice@…  30    1  Alice   alice@…  30 留     Alice   30
  2  Bob     bob@…    25    2  Bob     bob@…    25 出局   Carol   35
  3  Carol   carol@…  35    3  Carol   carol@…  35 留
```

email 列太宽，图里缩写为 alice@… 这样的省略号——注意它到取列那一步才被丢掉，锁行动的是行、不动列。结果 2 行 2 列。以后你写的任何查询——加排序、加分组、加两表拼接——底盘都是这两步。数据库替你执行，但你可以随时在纸上推出它该回什么。

### 锚点：带表头的 Excel

表这个东西你其实天天见：一张带表头的 Excel——表头定形状，一行一条记录；也像一个 JSON 对象数组——只不过每个键的类型是先声明、后存入的。陌生的只有「类型预先讲好」这一条，其余都是老朋友。

## 数据库：一个独立的进程

数据库（database）——一个专门负责存数据和查数据的独立程序。要说清它的位置，就用你天天在用的关系：浏览器与服务器。你发请求，它回数据，你不用管它内部怎么运作。跟数据库打交道一模一样：你发一句请求过去，它把结果送回来——请求用 SQL（Structured Query Language，结构化查询语言）写成，一门跟数据库说话的固定句式语言；结果是一行一行的数据。

所以数据库是独立进程——它不活在你的页面里，也不活在你的 Node 脚本里，数据由它记住、由它保管，你的进程崩了它还在。生产里常见的 MySQL、PostgreSQL 是真的独立服务：装在服务器上、监听端口，你的代码走网络跟它说话。

实验场用的 SQLite 走另一条路：嵌入式数据库——引擎本身是一个库，直接链进你的进程，没有端口也没有网络。Node 24 把它内置成 node:sqlite 模块，一行 import 就能用，这门课因此零外部依赖。我们的 createDb() 打开的是 :memory: 数据库——整座房子盖在内存里，进程一退就拆掉。这是教学取舍：测试随开随跑，不用管落盘。记下这个简化：真实业务的数据库要落盘持久化，数据不跟着进程消失。进程独不独立是部署形态的差别；不变的是：数据由引擎保管，你只发 SQL。

## 三句话上手：建表、插入、查询

### 第一句 CREATE TABLE：把形状说出口

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  age INTEGER
);
```

括号里从上到下：表的名字，然后是列清单，每列一条——名字、类型、可选的规则。id INTEGER PRIMARY KEY 声明 id 是这张表的主键（primary key）：每一行的身份证号，全表唯一、永不复用，数据库靠它精确定位某一行。INSERT 不写 id 时，SQLite 还会自动发号——下一行拿现有最大号加一；发号机制的细节第 3 章拆。NOT NULL 是一条规则：这一列不许为空。第一句话就把「形状」连同「规矩」一起说清楚了。

### 类型：TEXT、INTEGER、REAL

SQLite 常用的列类型（TEXT/INTEGER/REAL）——分别存文本、整数、小数。它们大致对应 JS 的 string 与 number；整数和浮点在 JS 共用 number，SQLite 替你分成两种存法。完整地说，SQLite 官方把「值能以哪几种形态存放」叫存储类，一共五种：TEXT、INTEGER、REAL，再加 NULL（空值）与 BLOB（二进制块）；本课程只讲常用的三种，用到二进制的场合太少，先声明这个简化。

SQLite 在类型上出了名的宽容：类型声明更像建议。往 TEXT 列塞数字，它按一套固定的亲和规则转换或照存，不轻易报错。MySQL 与 PostgreSQL 在这一点上是另一派：建表要写 VARCHAR(255) 这样的精确类型，插错类型直接拒绝。这类差异各家的官方手册写得直白；本课程的 SQL 一律以 SQLite 官方文档为准，随讲随标差异。**记住这个对照：SQLite 的类型是建议，MySQL/PG 的类型是法律**。

### 第二句 INSERT、第三句 SELECT

```sql
INSERT INTO users (name, email, age) VALUES (?, ?, ?);
```

INSERT 把一行放进表：列清单写在哪几列，VALUES 给对应的值。注意那三个 ?——占位符：句子里先挖空，真值用参数单独传进去，而不是把值拼进句子。为什么不拼？拼字符串会闯安全大祸，后面的章节专门拆这个雷。

```sql
SELECT name, age FROM users WHERE age > 26;
```

SELECT 把行拿出来，逐个词读：FROM users——从哪张表；WHERE age > 26——只留满足条件的行，锁行；SELECT name, age——每行要哪几列，取列。正是演算那两步的原样表达。

## 亲手搭实验场

现在把这些落进实验场。驱动（driver）——代码跟数据库之间的那层接口模块——本课程直接用 Node 24 内置的 node:sqlite，零安装。DatabaseSync 打开一个数据库（:memory: 表示内存库）；prepare 把一句 SQL 编译成可反复执行的语句；run/all/get 分别对应写、读多行、读一行。本章的 src/db.ts 把这些包成四个方法，是全书最小的一层地基。

规矩是先写测试、再写实现。先写下本章要的行为：建 users 表、插 3 行、SELECT 查回的行与值逐列一致。

```ts
// tests/tables-and-rows.test.ts —— 第 1 章：建表、插入、查询的最小闭环（节选：首个断言）
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db'

describe('表、行与类型', () => {
  it('建 users 表、插 3 行，SELECT 查回的行与值逐列一致', () => {
    const db = createDb()
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER
      );
    `)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Alice', 'alice@example.com', 30)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Bob', 'bob@example.com', 25)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Carol', 'carol@example.com', 35)

    const rows = db.all<{ id: number; name: string; email: string; age: number }>(
      'SELECT id, name, email, age FROM users ORDER BY id'
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com', age: 30 })
    expect(rows[1]).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com', age: 25 })
    expect(rows[2]).toEqual({ id: 3, name: 'Carol', email: 'carol@example.com', age: 35 })
  })
```

此刻 src/db.ts 还不存在，跑 `npx vitest run` 是红的——连模块都找不到。这就是起点。然后实现：

```ts
// src/db.ts —— 内存 SQLite 薄封装：全书实验场的地基（第 1 章登场；tx 第 13 章长上）
import { DatabaseSync } from 'node:sqlite'
import { attachTx, type DbWithTx } from './tx'

/** 能塞进 SQL 里 ? 处的值：null、数字、大整数、字符串、二进制 */
export type SqlValue = null | number | bigint | string | Uint8Array

/** 一条写操作（INSERT/UPDATE/DELETE）的报告：改了几行、新插入行的行号是几 */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/** 实验场对数据库的全部需求：跑无结果批语句、带参写、带参读 */
export interface Db {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): RunResult
  all<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T[]
  get<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T | undefined
}

/** 打开一个只活在内存里的 SQLite 数据库：随建随毁，测试即开即跑；第 13 章起句柄上多了 tx */
export function createDb(): DbWithTx {
  const db = new DatabaseSync(':memory:')
  // 外键约束 SQLite 默认关闭，实验场统一手动打开（第 3 章讲它是怎么回事）
  db.exec('PRAGMA foreign_keys = ON')
  return attachTx({
    exec(sql: string): void {
      db.exec(sql)
    },
    run(sql: string, ...params: SqlValue[]): RunResult {
      const { changes, lastInsertRowid } = db.prepare(sql).run(...params)
      return { changes: Number(changes), lastInsertRowid }
    },
    all<T>(sql: string, ...params: SqlValue[]): T[] {
      return db.prepare(sql).all(...params) as unknown as T[]
    },
    get<T>(sql: string, ...params: SqlValue[]): T | undefined {
      return db.prepare(sql).get(...params) as unknown as T | undefined
    },
  })
}
```

逐个看这层薄封装：exec 跑无结果的批语句（建表、开开关）；run 执行写操作，返回 RunResult——changes 是刚改了几行，lastInsertRowid 是新插入行拿到的行号；all 查回行数组，get 查回单行或 undefined（查不到就是它）；...params 把参数按 ? 的出现顺序送进去。createDb 里还有一句 PRAGMA foreign_keys = ON。PRAGMA 是 SQLite 的一类开关指令，这句打开外键检查——外键是一列里存着另一张表某行的主键 id，检查开着，瞎指一个不存在的 id 才会被拦下；默认是关的，SQLite 官方文档写得直白。它的用处到约束那一章见分晓。末尾的 attachTx 是后文长上来的组合点：它给句柄装上事务能力，本章按下不表，代码块始终按书的最终形态引用。

同一文件里另有四个断言：run 的报告数字、get 的单行查询、三种类型各查回各的、外键开关确实开了。**整本书都长在这四个方法上**——后面十几章的 SQL 练习与 mini-ORM，全部经由这层进数据库。

## 见证它变绿

两道门槛，都在 companion 目录下跑：

```bash
npx tsc --noEmit && npx vitest run
```

tsc --noEmit 只做类型检查、不产出文件；vitest 是实验场的测试跑器。跑起来还会先打一行 ExperimentalWarning——node:sqlite 在 Node 24 仍标为实验特性。警告不影响任何结果；本课程锁定 Node 24，行为以官方文档为准。全绿的样子：Tests 5 passed (5)。

不进实验场也能亲手验证本章的一切。把下面几行存成 try.mjs，跑 node try.mjs：

```js
// 用法示例：Node 24 内置 node:sqlite，存成 try.mjs，node try.mjs 就能跑
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)')
db.prepare('INSERT INTO users (name, age) VALUES (?, ?)').run('Alice', 30)
db.prepare('INSERT INTO users (name, age) VALUES (?, ?)').run('Bob', 25)
const rows = db.prepare('SELECT name, age FROM users WHERE age > ?').all(26)
console.log(rows)
// 打印：[ [Object: null prototype] { name: 'Alice', age: 30 } ]
```

终端打出 [ [Object: null prototype] { name: 'Alice', age: 30 } ]。开头的 [Object: null prototype] 是个记号：Node 的 sqlite 返回的对象不带 JS 原型。数据就是 name 和 age 两项，照常 .name 取用。一张表、两次占位符插入、一次锁行取列，十行之内。本章的每个断言，你都能用这个文件独立复现。

## 小结

从 localStorage 的手工作坊出发，本章建立了三样东西。世界观：数据住进有形状的家——表定形状、行是记录、列是带类型的字段；管家是个独立进程——你发 SQL，它回行；SQL 的前三句——CREATE TABLE、INSERT、SELECT。代码上，实验场新增 src/db.ts：createDb/exec/run/all/get，内存库、零外部依赖。

你现在能做到：建一张带类型与规则的表，插入若干行，用 SELECT 连条件带列地查回来，并在测试里逐列核对结果。

后面的去向：WHERE 的过滤、排序与分页在第 2 章；主键背后的守门规则——外键与各类约束——在第 3 章；再往后是聚合报表、两表 JOIN、索引，然后跨进 ORM 的世界——那层替你把对象翻译成 SQL 的东西。

读完本章你该能回答：

- 行和列分别对应 JS 世界里的什么？列比对象的字段多管了哪一件事？
- 「数据库是独立进程」怎么理解？实验场的 :memory: 简化了什么？
- ? 占位符传参，和把值直接写进 SQL 句子，差在哪？
- SQLite 与 MySQL/PostgreSQL 在列类型上的态度差在哪？
