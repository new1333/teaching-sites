---
title: 用对象描述表：schema 与 CREATE TABLE 生成
---

# 用对象描述表：schema 与 CREATE TABLE 生成

## 一个字段漂移三周，上线即 500

周三早上九点，产品群里先炸了：用户资料页全挂，接口一律 500。你翻日志，错误只有一行：no such column: nickname——数据库里没有 nickname 这一列。

事情要倒回三周前。建表 SQL 是当时手写的 CREATE TABLE，躺在 migrations 目录里；上周同事做「昵称」需求，在 TS 里给 User 接口加了 nickname 字段，注册表单、展示组件一路绿灯，本地测试全过。他不知道表结构在另一个文件里等着人手工同步，也没有任何机制提醒他去改。TS 里一份结构，SQL 里一份结构，全靠人肉保持一致。**漂移不是谁的失误，是这种维护方式的默认结局**：改了一处，另一处根本不知道。

你要的其实很朴素：**一份定义，两边生效**。第 7 章给 ORM 立过分层地图，也记下两笔旧账，第一笔就是「结构两处维护」。从本章起连着五章，我们把对象世界与关系模型之间的那层翻译器真的造出来；造它的第一块砖，就是还这笔账——表结构只存一份，TS 能检查它，CREATE TABLE 由它生成。

## schema：表结构的唯一一份清单

### 成因：结构先于数据，也只该有一份

先教这个词。schema 在数据库语境里指的就是表结构定义——这张表有哪些列、每列什么类型、带哪些约束。前端口中的 schema 多半是 JSON Schema 或表单校验规则；到了数据库这边，它说的就是列清单本身。

一张表在迎来第一行数据之前，得先把结构立好。列名、类型、主键、外键，这些不是某一行数据的属性，是整张表的属性。TS 里你早就写过同样性质的东西——interface。**schema 就是数据库世界的 interface**：一份「这行数据有哪些字段、什么类型」的契约。开章那单事故，病根就是同一份契约被抄成了两份，而手工抄写没有同步机制。

### 载体：同一份结构，两种手抄

旧世界长这样。第一处，TS 里：

```ts
interface User {
  id: number
  name: string
  email: string
  nickname: string
}
```

第二处，SQL 里：

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT DEFAULT '暂无昵称'
);
```

右边这句属于 DDL（数据定义语言）——描述结构的那族 SQL，下一节专门拆它。两份内容一一对应，也正因此，谁也不监督谁。

### 演算：合成一份

现在把两处合成一处：一个对象，键是列名，值是这一列的描述。

```ts
// 用法示例：本章给结构立的唯一一份定义
const users = {
  id: { type: 'integer', primaryKey: true },
  name: { type: 'text', notNull: true },
  email: { type: 'text', notNull: true, unique: true },
  nickname: { type: 'text', default: '暂无昵称' },
}
```

跟着算一遍它能翻出什么：id 列类型 integer、带 primaryKey，翻成 id INTEGER PRIMARY KEY；name 是 text 加 notNull，翻成 name TEXT NOT NULL；email 再叠一个 unique；nickname 的 default 是字符串，翻成 DEFAULT '暂无昵称'。四列各得一条子句，逗号隔开、括号包好，就是一句完整的 CREATE TABLE。这份对象进、DDL 出——本章要造的东西，核心就这一句。

## DDL：描述结构的那族 SQL

### 成因：SQL 的动词分两族

DDL（Data Definition Language，数据定义语言）是 SQL 里专门描述结构的语句家族。CREATE TABLE、ALTER TABLE、DROP TABLE 都在名下。与之相对的是 DML（数据操作语言），管搬数据。你前八章写的几乎全是后者——第 2 章的 WHERE、排序、分页，第 4 章的聚合函数与分组，第 8 章的占位符与参数绑定，全是围着已有的行打转。盖楼与住人分两套动词，因为风险等级不同：第 3 章你见过忘写 WHERE 的 UPDATE 毁掉一张表的数据，而一句 DROP TABLE 毁掉的是表本身。

### 载体：一句 CREATE TABLE 的骨架

```text
CREATE TABLE 表名 (
  列名1 类型 约束…,
  列名2 类型 约束…
);
```

每列一条：名字、类型、可选的约束串。锚点一句话：DDL 之于数据库是盖楼前的图纸，DML（搬数据那套）是往楼里搬家具——图纸动工前定形状，家具天天进出。

### 演算：把 users 对象手工翻一遍

翻译规则逐条列出：

```text
type: 'integer' | 'text' | 'real'   →  INTEGER / TEXT / REAL（直译，只是大写）
primaryKey: true                    →  PRIMARY KEY
notNull: true                       →  NOT NULL
unique: true                        →  UNIQUE
default: '暂无昵称'                  →  DEFAULT '暂无昵称'（字符串加引号，数字裸写）
references: { table, column }       →  REFERENCES 表名(列名)
```

纸笔就能验：拿上面的 users 对象逐列套规则，得到的正是载体一节那句 CREATE TABLE。这步手工演算值得做一次——它证明翻译是机械的，而机械的活，正适合交给代码。

顺带把第 7 章的比喻接上：翻译器上岗第一件事不是学造句，是背词典。schema 就是词典的第一页——列名、类型、约束都在这页上，后面几章的查询、写入、关联，全要回头查它。

## 类型映射：SQLite 没有的类型怎么办

类型映射——把 TypeScript 这边的类型翻译成数据库那边列类型的对照规则——为什么单独算一课？因为两套类型系统各自长大，从没对过表。

### 成因：SQLite 没有布尔，也没有日期

SQLite 官方文档写明：它没有单独的布尔存储类型，真值存成整数 0 与 1；也没有专为日期准备的存储类型，日期以 TEXT、REAL、INTEGER 三种形态之一入库。而 TS 里 boolean 与 Date 是日常。于是映射表上必然出现两处空格。

### 载体：映射表

```text
TypeScript 类型     列类型
string            → text
number            → integer 或 real（整数与小数分开声明）
boolean           → ？（SQLite：没有布尔，只能存 0/1）
Date              → ？（SQLite：没有日期，只能存文本或数字）
```

先说清这张表的性质：它是知识对照，不是本课程在跑的规则——列类型由你在 schema 里手写 type: 'integer'，连 string → text 这层也不自动推。

### 演算：一个布尔列的三种命运

给 users 加 is_vip。第一种：不管映射，直接存——这条路在我们的工具链上当场撞墙：第 1 章立的 SqlValue 里就没有 boolean，tsc 先拦；硬绕过类型、运行时把 true 传给绑定参数，node:sqlite 直接抛错（我实测：Provided value cannot be bound to SQLite parameter）。别的驱动确实会替你转——比如一些 Node 的 SQLite 驱动把 true 落库成 1，可你读回来的是 1 不是 true：if (row.is_vip) 碰巧能用（1 是真值），=== true 就翻车。第二种：映射层自动转，写入 true 变 1、读出 1 还你 true——真实 ORM 常这么干（Prisma 的 Boolean、TypeORM 的 boolean 列都是公开概念）。第三种：干脆不映射。

本课程选第三种，如实声明简化：schema 只认 integer、text、real 三个词。要存布尔，就声明 integer、自己换算 0/1；要存日期，就声明 text、自己存 ISO 字符串。少一层自动魔法，换来每次落库都知道那行里到底是什么。这项取舍与真实 ORM 的差距，登记进书末的差异清单附录，第 14 章逐条对账。

同类取舍还有一个：命名。真实 ORM 常做驼峰与蛇形的自动映射——TS 里写 userName，列名自动变 user_name；本课程 schema 的字段名与列名保持同名，多一层映射就少一层直观，这项差异同样登记在案。

锚点一句话收住：类型映射像出国旅行的电源转换头——TypeScript 的插头与 SQLite 的插座形状不同，中间那截转换就是映射；转换头没覆盖的形状（布尔、日期），要么自己带备用插头，要么别带这类电器。

## 纯函数：先做翻译，再碰数据库

动手前定最后一条架构规矩：**生成 DDL 的代码写成纯函数**——columns 进、SQL 字符串出，不碰数据库。好处直接：不建库、不连进程，就能对生成的 SQL 文本做单元测试，等会儿的断言正是逐字比对。defineTable 只做两件事：拿纯函数的产物交给 db.exec 建表，再把表句柄交回调用方。

这里补一段第 8 章视角的旁注。我们一路如临大敌的拼字符串，在 DDL 这边是安全的：CREATE TABLE 里的每个词——表名、列名、约束——都出自程序员之手，没有一处用户输入，也就没有数据能爬进代码的位置。**DDL 是本课程唯一放心拼 SQL 的地方**，边界就在「有没有用户输入」这条线上。

## 亲手把 schema 立成表

实验场的动作顺序照旧是测试先行：先写本章测试，跑一次见红——报错是找不到模块 src/schema；这就机械地证明了 schema 是本章新添的模块、旧代码一行没动——然后再实现。src 新增一个文件 schema.ts，db.ts 一行不动。

### 一列的描述：ColumnDef

```ts
// src/schema.ts —— 列定义与表句柄（第 9 章登场，原样节选）
/** 列类型：SQLite 三种存储类型直译，boolean 与 Date 不做映射（取舍见第 9 章正文） */
export type ColumnType = 'integer' | 'text' | 'real'

/** 一列的描述：类型加约束；可选键按固定顺序拼进 DDL 子句 */
export interface ColumnDef {
  type: ColumnType
  primaryKey?: boolean
  notNull?: boolean
  unique?: boolean
  default?: number | string | null
  references?: { table: string; column: string }
}

/** 表句柄：defineTable 的返回值——db、表名、列定义都在身上；query() 第 10 章、create()/find() 第 11 章长上，关联声明与注册表第 12 章长上 */
export interface Table {
  readonly db: Db
  readonly name: string
  readonly columns: Record<string, ColumnDef>
  /** 关联注册表：hasMany/belongsTo 的声明账——名字到关联定义；query().with(name) 按名字来这里查 */
  readonly relations: Record<string, RelationDef>
  query(): QueryBuilder
  create(data: Record<string, SqlValue>): Row
  find(id: SqlValue): Row | undefined
  hasMany(name: string, options: RelationOptions): Table
  belongsTo(name: string, options: RelationOptions): Table
}
```

类型只收三个词，就是类型映射一节声明的取舍。references 用对象而不是 'users(id)' 这样的字符串，多打几个字，换来拼写检查与编辑器补全——两可的取舍，我们选可检查的那种。Table 身上多出的方法都是后面几章的入口，本章按下不表：query() 是下一章的查询构建器；create 与 find 管插入与按主键取回，再晚一章从 src/table.ts 长上来；hasMany 与 belongsTo 管登记两张表的关联，更晚一章从 src/relations.ts 长上来。方法一章长一批，正文里的代码块始终按最终形态引用。

### 翻译器本体：generateCreateTableSql

```ts
// src/schema.ts —— 翻译器本体：白名单、默认值、逐列拼装（原样节选）
/** 本课程认得的列类型，白名单之外的类型当场报错 */
const COLUMN_TYPES = new Set<string>(['integer', 'text', 'real'])

/** 把默认值翻成 DDL 字面量：数字裸写、字符串加引号、null 写 NULL */
function renderDefault(value: number | string | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

/** 纯函数：columns 进、CREATE TABLE 文本出——不碰数据库，可独立单测 */
export function generateCreateTableSql(
  name: string,
  columns: Record<string, ColumnDef>
): string {
  const lines: string[] = []
  for (const [column, def] of Object.entries(columns)) {
    if (!COLUMN_TYPES.has(def.type)) {
      throw new Error(
        `未知列类型「${String(def.type)}」：本课程只认 integer/text/real，boolean 与日期的取舍见第 9 章`
      )
    }
    let line = `${column} ${def.type.toUpperCase()}`
    if (def.primaryKey) line += ' PRIMARY KEY'
    if (def.notNull) line += ' NOT NULL'
    if (def.unique) line += ' UNIQUE'
    if (def.default !== undefined) line += ` DEFAULT ${renderDefault(def.default)}`
    if (def.references) {
      line += ` REFERENCES ${def.references.table}(${def.references.column})`
    }
    lines.push(line)
  }
  return `CREATE TABLE ${name} (\n  ${lines.join(',\n  ')}\n);`
}
```

四个实现决策，逐一交代：

- 列按定义顺序输出。对象的字符串键按书写顺序遍历——列名都是普通标识符，恰好避开 JS 把数字样式的键提前重排的特例。顺序稳定，输出才唯一，测试才能逐字对齐。
- 约束固定按 PRIMARY KEY、NOT NULL、UNIQUE、DEFAULT、REFERENCES 的顺序拼。SQLite 其实允许任意顺序，我们固定一种，让生成结果有唯一答案。
- 不生成 AUTOINCREMENT。第 3 章的结论在这里兑现：INTEGER PRIMARY KEY 已是 rowid 的别名，插入不填值就自动发号；AUTOINCREMENT 只额外保证删掉的号不复用，代价是多记一本流水账，通常不需要。
- 未知类型当场抛错，中文消息写清哪一步、为什么——错误消息让人看得懂，这条规矩全书不变。

顺带复习第 6 章：PRIMARY KEY 与 UNIQUE 不只是约束，背后各自默默带了一份索引——这就是主键查询与唯一列查询快的原因。另外 renderDefault 不转义字符串里的引号：默认值出自程序员之手，这条边界与「DDL 无用户输入」是同一条。

### 建表并交回句柄：defineTable

```ts
// src/schema.ts —— 把 schema 立成真表（原样节选，create/find 第 11 章、关联声明第 12 章长上）
/** 把 schema 立成真表：生成 DDL、exec 建表、交回表句柄 */
export function defineTable(
  db: Db,
  name: string,
  columns: Record<string, ColumnDef>
): Table {
  db.exec(generateCreateTableSql(name, columns))
  return {
    db,
    name,
    columns,
    relations: {},
    query() {
      return new QueryBuilder(this)
    },
    create(data) {
      return insertAndHydrate(this, data)
    },
    find(id) {
      return findByPrimaryKey(this, id)
    },
    hasMany(name, options) {
      return declareRelation(this, name, 'hasMany', options)
    },
    belongsTo(name, options) {
      return declareRelation(this, name, 'belongsTo', options)
    },
  }
}
```

句柄——一个代表「这张表」的对象，拿着它就能对这张表做事。db、表名、列定义是它的三样家底；query() 是第 10 章长上来的第一个方法，查询构建器的入口——本章只需知道它指了个方向，下一章开讲。create 与 find 晚一章长上来：插入加水合、按主键取回加水合，户口在 src/table.ts。关联注册表与声明方法再晚一章长上来：hasMany 与 belongsTo 登记两张表的对应关系，户口在 src/relations.ts。方法一个一个长，而不是一次全设计好：每个方法都该等需求想清楚再动手。

### 里程碑：逐字对齐的 DDL 与守规矩的外键

纯函数让「生成的 SQL 文本与预期一致」可以逐字断言。

```ts
// tests/schema-to-ddl.test.ts —— 纯函数的逐字断言（原样节选）
  it('类型与约束逐条翻译：integer/text 直译，PRIMARY KEY/NOT NULL/UNIQUE 各就各位', () => {
    expect(generateCreateTableSql('users', usersColumns())).toBe(`CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT DEFAULT '暂无昵称'
);`)
  })
```

外键那条例子单独验「建出来的表真的守规矩」：先建 users 再建 orders，插孤儿订单被拦、先立用户再下单放行：

```ts
// tests/schema-to-ddl.test.ts —— 里程碑断言：外键真的生效（原样节选）
  it('外键表建表后 PRAGMA 约束真的生效：孤儿订单被拦、合法的能插', () => {
    const db = createDb()
    defineTable(db, 'users', usersColumns())
    defineTable(db, 'orders', ordersColumns())
    // user_id 999 在 users 里不存在——外键拦下
    expect(() => db.run('INSERT INTO orders (user_id, amount) VALUES (?, ?)', 999, 9.9)).toThrow()
    // 先立合法用户再下单：放行
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'alice', 'alice@example.com')
    const result = db.run('INSERT INTO orders (user_id, amount) VALUES (?, ?)', 1, 9.9)
    expect(result.changes).toBe(1)
  })
```

还有一条断言盯错误约定：把 type 写成 'boolean' 传进去，defineTable 必须抛出带「未知列类型」的中文错误，而不是静默生成一个 SQLite 不认识的列类型。默认值也有专属用例：数字 0 裸写成 DEFAULT 0，字符串加引号写成 DEFAULT 'CNY'——renderDefault 的两条分支各有人看守。

## 见证它变绿

老地方，companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 54 passed (54)。第 1 到 8 章攒下的 47 个旧断言一个没伤，本章新增 7 个；src 多了一个 schema.ts，其余文件原样。

不进实验场也能验证本章的核心事实：建表之后，DDL 原文就存在数据库自己的系统表 sqlite_master 里——库用它记录自家有哪些表、各是什么结构。存成 try-schema.mjs，跑 node try-schema.mjs：

```js
// 用法示例：三十秒看数据库保存的图纸
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);`)
// 系统表 sqlite_master：库自己的户口本，每张表一行，sql 列存建表原文
const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
console.log(row.sql)
// PRAGMA table_info 则给出结构化清单：每列一行——序号、名字、类型、非空、默认值、是否主键
console.log(db.prepare('PRAGMA table_info(users)').all())
```

第一段输出正是你 exec 进去的那句 CREATE TABLE——分号除外，库只保存句子本身。第二段每列一行：id 是 INTEGER、主键位为 1；name 是 TEXT、非空位为 1。图纸交出去了，数据库还留着底，随时可查。

## 小结

第一笔旧账清了。表结构现在只存一份：一个 TS 对象。类型写错，tsc 当场拦下；结构翻成 DDL，由 generateCreateTableSql 代劳；建表交给 defineTable 一手包办。TS 与 SQL 两边从同一份 schema 出发，漂移失去了土壤。DDL 是描述结构的那族 SQL，CREATE TABLE 是它的头号动词；类型映射上我们只认三个词，布尔与日期的换算留给调用方，驼峰蛇形映射不做——两处取舍都已登记差异清单。生成器是纯函数，输出逐字可测；建出来的表受主键、约束、外键全程看守，生成的 SQL 照样能拿去跑第 6 章的查询计划。下一层，第 10 章的查询构建器会接过这份列清单，校验 WHERE 里出现的每个列名。

你现在能做到：用对象描述一张带主键、外键、约束的表，讲清每个字段会翻成 DDL 里的哪一段，以及 boolean 在 SQLite 里为什么没有家。

读完本章你该能回答：

- 开章的 500 为什么本地测试没拦住？两份结构各自靠什么「不知道对方变了」？
- DDL 与 DML 各管什么？你前八章写过的语句里，哪些属于 DDL？
- 一个 boolean 值在 SQLite 里落地成什么？读回来是什么？本课程的取舍是什么？
- generateCreateTableSql 为什么刻意不碰 db？这个决定换来了什么测试能力？
