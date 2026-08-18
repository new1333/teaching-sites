---
title: 链式调用变 SQL：查询构建器
---

# 链式调用变 SQL：查询构建器

## 一个 AND OR，让筛选页挂了一晚

周三晚上十一点，群里弹出新同事小周的消息：用户列表接口 500，页面全白。错误日志只有一行：near "OR": syntax error。

事情不复杂。那个接口有四个可选筛选：状态、最小年龄、姓名关键字、排序方式，全都可以不传。后端的老写法是拼接动态 SQL：每个 if 往一个字符串数组里塞一段条件，最后 join(' AND ') 串成 WHERE。这写法安稳跑了两个月，直到小周加第五个筛选项，把一处 join 写成了 ' OR '。两种连接词叠在一起，拼出的句子是 WHERE age > 18 AND OR name LIKE '%周%'。AND 与 OR 是 SQL 的语法关键字，数据库读到第二个连接词，直接宣布这句话不成句。TS 编译器拦不住它——拼接发生在普通字符串上，类型系统看不见语法对错，错误要到数据库才爆。这是手拼的第一重坑：语法错误。第二重是引号：用户搜 O'Brien，字符串字面量当场碎掉，第 8 章的老朋友。第三重是优先级：WHERE a OR b AND c 在 SQL 里读作 a OR (b AND c)，括号没配好，搜索范围悄悄放大。

隔壁组用 Sequelize 的仓库是另一种安静：where: { $and: [...] } 写了一屏，没人说得清它到底生成什么 SQL，出了问题只能猜。

三重坑指向同一份需求：条件用代码攒、SQL 让机器编、值走参数、编出来的文本看得见。第 7 章的分层地图早给这一层留了位置——ORM 是对象世界与关系模型之间的翻译器，翻译器分上中下三层，中层就是查询构建器。第 9 章我们把词典（schema 列清单）立好了，本章让中层上岗。

第一重坑三十秒就能复现，不进实验场也能跑：

```js
// 用法示例：手拼 SQL 拼出 AND OR，数据库当场判语法错误
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, age INTEGER)')
try {
  db.prepare('SELECT id FROM users WHERE age > 18 AND OR id < 3').all()
} catch (err) {
  console.log(err.message) // near "OR": syntax error
}
```

## 目标：一条链进，一句 SELECT 出

本章结束时，开章那类动态筛选写成这样：

```ts
// 用法示例：动态筛选的链式写法
let q = users.query()
if (filters.minAge !== undefined) q = q.where('age', '>=', filters.minAge)
if (filters.nameLike !== undefined) q = q.where('name', 'LIKE', filters.nameLike)
const rows = q.orderBy('age', 'desc').limit(10).offset(20).all()
```

想看它到底生成什么，随时停在执行之前，把账本摊开：

```ts
// 用法示例：toSQL() 交出 SQL 文本与参数数组
users.query().where('age', '>', 18).toSQL()
// { sql: 'SELECT id, name, email, age FROM users WHERE age > ?', params: [18] }
```

Sequelize 说不清的那件事，这里一眼见底。下面把这条链拆开讲：它为什么这样工作，再亲手造一遍。

## 两阶段：攒条件与编译

### 成因：SQL 的形状，运行时才定得下来

动态筛选的意思是：条件有几个、要不要排序、翻到第几页，都要等请求进门那一刻才知道。而链式调用发生在 SQL 还没定形的时候——where('age', '>', 18) 被调用的那一刻，谁也不知道后面还有没有第二个条件。这一步唯一能做的，是把参数记下来。

反过来，如果每个方法当场生成一段 SQL 字符串，那只是把手工拼接换个地方接着拼，三重坑原样都在。所以构建器把工作切成两段，这就是**两阶段：攒条件与编译**——第一阶段，链式方法只往账本上记账；第二阶段，toSQL() 拿到完整账本，一次性翻译成 SQL 文本与参数数组。开章的翻车根源在于连接词的位置散落在各个 if 里；记账制把「收集」变成一堆普通数据，把「组句」集中到一个函数。组句集中了，把关才能集中：查名单、走参数，都只需要写在一个地方。

### 载体：账本长什么样

```text
链式调用（第一阶段，只记账）          账本状态
users.query()                      wheres: []   orders: []   limit/offset 未设
.where('age', '>', 18)             wheres 追加 { column:'age', op:'>', value:18 }
.where('name', 'LIKE', '%o%')      wheres 追加 { column:'name', op:'LIKE', value:'%o%' }
.orderBy('age', 'desc')            orders 追加 { column:'age', direction:'desc' }
.limit(2)                          limitCount = 2
.offset(1)                         offsetCount = 1
```

账本里全是普通对象和数字，没有一个字符串掺着 SQL。第二阶段从上到下扫账本，逐段翻译：

```text
toSQL() 的逐段编译（第二阶段）
SELECT id, name, email, age       ← 列清单来自 schema 的键，天然是白名单
FROM users                         ← 表名来自表句柄，不出自用户输入
WHERE age > ? AND name LIKE ?      ← 每条账产一个 ?，值按序推进 params
ORDER BY age DESC                  ← direction 翻成 SQL 关键字
LIMIT ? OFFSET ?                   ← 分页成对编译，缺的半边补默认值
```

### 演算：亲手对一遍

拿上面那条链在纸面走一遍：六个调用，账本攒下两笔 where、一笔 orderBy、两个数字。toSQL() 每扫一条 where，就在句子里续一段「列名 op ?」，同时往 params 里推一个值。扫完账本，译文落定：sql 是 `SELECT id, name, email, age FROM users WHERE age > ? AND name LIKE ? ORDER BY age DESC LIMIT ? OFFSET ?`，params 是 `[18, '%o%', 2, 1]`。toSQL() 不改账本，反复调用结果不变——账在，译文就在。

### 锚点

像数组的 filter().sort().slice() 链，但有个关键差别：数组链每一步都真的算出新数组，构建器链每一步只记账，最后一步才算。

## 绑定参数数组

### 成因：? 的值需要一张提货单

第 8 章立下的规矩：模板与数据分通道，用户输入只能走占位符 ?。一条 SQL 里 ? 可能有好几个，每个 ? 都在等自己的值。把这些值按 ? 出现的顺序排成一个数组，就是**绑定参数数组**（params）——? 的提货单。第 1 章的 db.all(sql, ...params) 早就按这个约定收参数；本章的构建器照单全收，toSQL() 把 sql 与 params 一起交出来，执行层原样递给数据库。

### 载体：位置配对表

```text
sql:    SELECT … WHERE age > ? AND name LIKE ? ORDER BY age DESC LIMIT ? OFFSET ?
                │             │                │         │
params:        18          '%o%'             2         1
```

? 是位置，params 是按位填的值。第几个 ? 配第几个值，没有名字、没有标签，只有顺序。

### 演算：错一位，全错

做个思想实验：把 limit(2) 与 offset(1) 的实参对调。SQL 文本一个字都不变，params 从 [18, '%o%', 2, 1] 变成 [18, '%o%', 1, 2]——LIMIT 1 OFFSET 2，每页从两行变一行，还多跳过一行，翻页全乱。所以编译有条铁律：值跟着自己那条账走，账排第几，? 就排第几。等会儿看 toSQL() 的实现，你会发现 push 值与拼 ? 发生在同一次循环里——铁律直接长成了代码结构，想违反都难。

### 锚点

? 像函数定义里的形参，params 像调用时的实参表——按位配对，多一个少一个都不行。

## 操作符白名单

### 成因：? 装得下值，装不下语法

试想把操作符也做成参数：WHERE age ? 18。SQLite 拒绝编译这句，我在本机跑过，错误是 near "?": syntax error。原因不绕：占位符只能出现在值的位置，数据库把它当数据看；而操作符、列名、表名要成为 SQL 语法本身的一部分，语法位置容不下参数。第 8 章的注入是同一条边界的反方向：拼接让数据爬进了语法位置。正反两面合起来，就是本章要守的规矩：**标识符不能走 ?，只能走白名单**——只放行名单上的词，其余当场报错。操作符这道名单，就叫**操作符白名单**；列名那道，名单直接用第 9 章的 schema。

### 载体：两道名单

```text
位置      编译期名单（TS 类型）                运行期名单（Set）
操作符    Operator 联合类型，7 个词             OPERATORS：= != > < >= <= LIKE
列名      列名是运行时字符串，类型帮不上         table.columns 的键，schema 即名单
```

操作符这道是双保险，照抄第 9 章 COLUMN_TYPES 的先例：TS 联合类型拦编译期，Set 拦运行期——外部数据绕过类型检查混进来，也过不了第二道。列名那道不用另造名单：第 9 章的 schema 登记了这张表的每一列，那份只认三个词的保守类型映射，在这里变成现成的守门员。

### 演算：三个调用，两种下场

where('name', '~~', 'x')：~~ 不在名单上，当场抛「未知操作符」，消息写明只认哪七个词。where('hobby', '=', 'x')：hobby 不在 columns 里，抛「未知列」，消息把合法列名全部列出来。而 where('name', '=', "O'Brien")：什么都不抛——值走参数通道，引号只是数据。对比即结论：名单拦语法位置的词，参数通道放行所有值。第二重引号坑在这套分工下根本无处发生。

### 锚点

像 TS 的字面量联合类型 'asc' | 'desc'：非法值在编译期就无处容身；运行期的 Set 是同一份名单的运行时版本，给绕过类型的调用者也立规矩。

## 生成的 SQL 与第 2 章同构

构建器不发明新 SQL。toSQL() 的产物，与你第 2 章手写的 SELECT 是同一种句子：WHERE 管过滤、ORDER BY 管排序、LIMIT/OFFSET 管分页，一个字母都不多。这件事值得两条路同时验证，本章测试正是这么写的：一条断言 SQL 文本与手写版本逐字相等；另一条把构建器与手写 SELECT 各跑一遍库，断言行结果完全一致。文本同构加结果一致，构建器才算证明了自己只是「换了个写法的你」。这也是全书主里程碑的兑现：ORM 生成的 SQL，与第一部分手写的同构等价。生成的 SQL 还能拿去跑第 6 章的 EXPLAIN QUERY PLAN——查询计划照样看得懂，走不走索引、是不是全表扫描，与手写 SELECT 一视同仁。

## 亲手把链式调用编译成 SQL

老规矩，测试先行：先写 tests/query-builder.test.ts，跑一次见红——报错是找不到模块 src/builder，机械证明这是本章的新模块，旧代码一行没动。然后分三步实现。

### 第一步：名单与账本的数据形状

```ts
// src/builder.ts —— 名单与账本的数据形状（原样节选）
/** WHERE 认得的比较操作符：类型层是一份名单，下面的 Set 是同一份名单的运行时版 */
export type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE'

/** 排序方向：升序（asc）或降序（desc） */
export type OrderDirection = 'asc' | 'desc'

/** toSQL() 的产物：SQL 模板（值的位置全是 ?）与按序对应的绑定参数数组 */
export interface CompiledQuery {
  sql: string
  params: SqlValue[]
}

/** 运行期操作符白名单：op 是 SQL 语法的一部分、走不了 ?，名单之外当场报错 */
const OPERATORS = new Set<string>(['=', '!=', '>', '<', '>=', '<=', 'LIKE'])

/** 一条 WHERE 条件的账：编译前只是数据，不掺任何 SQL 文本 */
interface WhereEntry {
  column: string
  op: Operator
  value: SqlValue
}

/** 一条 ORDER BY 的账：列名加方向 */
interface OrderEntry {
  column: string
  direction: OrderDirection
}
```

七个操作符是第 2 章比较写法的主体；同章教过的 IN 与 BETWEEN 不在名单里，去向见下。CompiledQuery 是 toSQL() 的产物类型：sql 加 params，翻译结果的两半。WhereEntry 与 OrderEntry 是账本条目——字段全是数据，编译之前不掺任何 SQL 文本。

### 第二步：记账四方法

```ts
// src/builder.ts —— QueryBuilder 的记账阶段：只推进数组并返回 this（原样节选）
/** 两阶段构建器：where/orderBy/limit/offset 只往账本上记，toSQL() 一次性编译 */
export class QueryBuilder {
  private readonly table: Table
  private readonly wheres: WhereEntry[] = []
  private readonly orders: OrderEntry[] = []
  private readonly withs: string[] = []
  private limitCount: number | undefined
  private offsetCount: number | undefined

  constructor(table: Table) {
    this.table = table
  }

  /** 记一条过滤条件；多次调用按 AND 叠加（OR 分组本课程从简，取舍见正文与差异清单） */
  where(column: string, op: Operator, value: SqlValue): this {
    this.assertKnownColumn(column, 'where')
    if (!OPERATORS.has(op)) {
      throw new Error(
        `未知操作符「${String(op)}」：本课程只认 = != > < >= <= LIKE；op 是 SQL 语法的一部分，不能当参数传`
      )
    }
    this.wheres.push({ column, op, value })
    return this
  }

  /** 记一条排序；多次调用按先后叠加，如 ORDER BY age DESC, id ASC */
  orderBy(column: string, direction: OrderDirection): this {
    this.assertKnownColumn(column, 'orderBy')
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`未知排序方向「${String(direction)}」：只认 asc（升序）或 desc（降序）`)
    }
    this.orders.push({ column, direction })
    return this
  }

  /** 记最多取几行 */
  limit(count: number): this {
    this.limitCount = count
    return this
  }

  /** 记跳过前几行 */
  offset(count: number): this {
    this.offsetCount = count
    return this
  }
```

四个方法的共同点只有一个：把参数推进内部数组、返回 this，让链不断。把关发生在记账那一刻：where 先查列名名单、再查操作符名单，orderBy 查列名名单，错了当场抛中文错误，不把坏账留到编译期。账本里那行 withs 是关联加载那章长上来的第三本账：记的是要批量加载的关联名，本章不必理会，到时再讲。多次 where 按 AND 叠加——OR 需要条件树与括号语义才表达得清，本课程从简不做，取舍登记进书末的差异清单附录。orderBy 也可以多次调用、按先后叠加；排序值挤在一起时，再排一层主键兜底是第 2 章的老技巧：先 orderBy('age', 'desc') 再 orderBy('id', 'asc')，同年龄的行按主键定序。

### 第三步：编译与直查

```ts
// src/builder.ts —— 编译与执行：toSQL() 一次成型，all()/get() 直查（原样节选）
  /** 编译：把攒下的账翻成参数化 SELECT——不碰数据库，可反复调用、结果一致 */
  toSQL(): CompiledQuery {
    const params: SqlValue[] = []
    const columnList = Object.keys(this.table.columns).join(', ')
    let sql = `SELECT ${columnList} FROM ${this.table.name}`
    if (this.wheres.length > 0) {
      const clauses = this.wheres.map((entry) => {
        params.push(entry.value)
        return `${entry.column} ${entry.op} ?`
      })
      sql += ` WHERE ${clauses.join(' AND ')}`
    }
    if (this.orders.length > 0) {
      const orderList = this.orders.map(
        (entry) => `${entry.column} ${entry.direction.toUpperCase()}`
      )
      sql += ` ORDER BY ${orderList.join(', ')}`
    }
    if (this.limitCount !== undefined || this.offsetCount !== undefined) {
      // SQLite 语法里 OFFSET 必须跟在 LIMIT 后：没设 limit 就补 -1（官方语义：负 LIMIT 不设上界）
      sql += ' LIMIT ? OFFSET ?'
      params.push(this.limitCount ?? -1, this.offsetCount ?? 0)
    }
    return { sql, params }
  }

  /** 直查：编译加执行一步到位，返回所有命中的行；带 with 时行先水合成实例、再各自装上关联 */
  all<T = Record<string, SqlValue>>(): T[] {
    const { sql, params } = this.toSQL()
    const rawRows = this.table.db.all<Record<string, SqlValue>>(sql, ...params)
    if (this.withs.length === 0) return rawRows as unknown as T[]
    return loadRelations(this.table, rawRows, this.withs) as unknown as T[]
  }

  /** 直查：同 all，但只取第一行；没有命中返回 undefined；带 with 同样装关联 */
  get<T = Record<string, SqlValue>>(): T | undefined {
    const { sql, params } = this.toSQL()
    const rawRow = this.table.db.get<Record<string, SqlValue>>(sql, ...params)
    if (rawRow === undefined) return undefined
    if (this.withs.length === 0) return rawRow as unknown as T
    return loadRelations(this.table, [rawRow], this.withs)[0] as unknown as T
  }

  /** 列名白名单：要进 SQL 文本的标识符走不了 ?，只能在 schema 的列清单里查 */
  private assertKnownColumn(column: string, step: string): void {
    if (!(column in this.table.columns)) {
      throw new Error(
        `未知列「${column}」：${step} 想用它，但表 ${this.table.name} 的列只有 ${Object.keys(
          this.table.columns
        ).join('、')}`
      )
    }
  }
}
```

toSQL() 从上到下扫账本：列清单来自 schema 的键、表名来自句柄，这两处标识符不出自用户输入；WHERE 段在同一次 map 里拼 ? 与推值，绑定参数数组的铁律就落在那个 map 里。分页有个小机关：SQLite 的语法里 OFFSET 跟在 LIMIT 后面，只设了 offset 时补一个 LIMIT -1——官方文档写明，LIMIT 取负值表示返回行数不设上界；缺省的 offset 则补 0。all() 与 get() 是编译加执行的便捷门，拿 toSQL() 的产物直接调 db。块尾那截 with 分岔是关联加载那章长上来的：withs 账上没记东西就走老路返回裸行，记了才交给关联加载去水合——本章的查询一笔记不上，行为与设计时完全一致。get() 刻意不偷偷加 LIMIT 1：编译忠实于账本，想只取一行，自己往账上记 limit(1)。

### schema 那边长了什么

query() 的入口长在表句柄上——第 9 章在 Table 注释里预告的生长点，本章兑现。schema.ts 的改动只增不破：

```ts
// src/schema.ts —— Table 长出 query()：只增不破（原样节选，create/find 第 11 章、关联声明第 12 章长上）
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

```ts
// src/schema.ts —— defineTable 交回带 query() 的句柄（原样节选，create/find 第 11 章、关联声明第 12 章长上）
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

schema.ts 顶部多了运行时导入。本章接进 QueryBuilder；下一章接 insertAndHydrate 与 findByPrimaryKey——Row 那一家的户口在 src/table.ts；declareRelation 一家更晚一章接，户口在 src/relations.ts。builder.ts 对 schema 只有类型引用，两个文件在运行时不互相拉扯。旧字段一个没动——defineTable 照旧生成带主键、约束、外键子句的 DDL。本章只是交回的句柄多了 query() 这个方法：create 与 find 下一章长上，关联声明再下一章长上。第 1 到 9 章的 54 个旧断言原样全绿，就是「只增不破」的机械证明。第 9 章正文里引用的 Table 与 defineTable 代码块，也已按当前形态同步更新。

### 里程碑测试

三条断言各自盯一个承诺。第一条盯编译，toSQL() 的产物逐字可对。

```ts
// tests/query-builder.test.ts —— toSQL 的逐字断言（原样节选）
  it('全链：两个 where 按 AND 叠加，LIKE、orderBy、limit、offset 各就各位', () => {
    const db = createDb()
    const users = seedUsers(db)
    const built = users
      .query()
      .where('age', '>=', 18)
      .where('name', 'LIKE', '%o%')
      .orderBy('age', 'desc')
      .limit(2)
      .offset(1)
    expect(built.toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users WHERE age >= ? AND name LIKE ? ORDER BY age DESC LIMIT ? OFFSET ?',
      params: [18, '%o%', 2, 1],
    })
  })
```

第二条盯同构等价，SQL 文本与跑库结果两路都对。

```ts
// tests/query-builder.test.ts —— 双向验证：文本一致 + 结果一致（原样节选）
  it('双向验证：生成的 SQL 文本与手写 SELECT 逐字一致，两边跑库结果也一致', () => {
    const db = createDb()
    const users = seedUsers(db)
    const handwritten =
      'SELECT id, name, email, age FROM users WHERE age > ? ORDER BY age DESC LIMIT ? OFFSET ?'
    const built = users.query().where('age', '>', 18).orderBy('age', 'desc').limit(2).offset(1)
    expect(built.toSQL().sql).toBe(handwritten)
    expect(built.all()).toEqual(db.all(handwritten, 18, 2, 1))
  })
```

第三条是开章故事的正面重演——同一组可选筛选，条件有无只决定链上多几笔账。

```ts
// tests/query-builder.test.ts —— 动态条件：条件有无只影响攒下的账（原样节选）
function buildQuery(users: Table, filters: { minAge?: number; nameLike?: string }) {
  let q = users.query()
  if (filters.minAge !== undefined) q = q.where('age', '>=', filters.minAge)
  if (filters.nameLike !== undefined) q = q.where('name', 'LIKE', filters.nameLike)
  return q.orderBy('id', 'asc')
}
```

没有藏在 if 里的字符串，没有可能拼错位置的连接词。**条件的有无，从「改写 SQL 文本」变成了「多记一笔账」**——这就是动态条件的胜利。

## 见证它变绿

老地方，companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 67 passed (67)。第 1 到 9 章攒下的 54 个旧断言一个没伤，本章新增 13 个；src 多了 builder.ts，schema.ts 长出 query()，其余文件原样。只想跑本章：npx vitest run tests/query-builder.test.ts。

不进实验场也能验证本章的两个承重事实。存成 try-builder.mjs，跑 node try-builder.mjs。

```js
// 用法示例：验证「语法位置容不下 ?」与「负 LIMIT 不设上界」
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE t (n INTEGER)')
for (const n of [1, 2, 3, 4, 5]) db.prepare('INSERT INTO t (n) VALUES (?)').run(n)
// 事实一：把操作符的位置换成 ?，SQLite 当场拒绝——白名单存在的根源
try {
  db.prepare('SELECT n FROM t WHERE n ? 1').all()
} catch (err) {
  console.log(err.message) // near "?": syntax error
}
// 事实二：LIMIT -1 OFFSET 2 = 跳过头两行、不设上界——构建器 offset 缺省补 -1 的依据
console.log(db.prepare('SELECT n FROM t ORDER BY n LIMIT ? OFFSET ?').all(-1, 2))
```

第一段输出 near "?": syntax error——语法位置容不下占位符，这是白名单要守的边界。第二段输出 [ 3, 4, 5 ]——负 LIMIT 不封顶，只由 OFFSET 跳行，这正是只设 offset 时编译器补 -1 的底气。

## 小结

中层上岗了。链式调用只记账：where、orderBy、limit、offset 把参数推进内部数组并返回 this；toSQL() 才翻译：SELECT 列清单 FROM 表 WHERE 列 op ? AND … ORDER BY … LIMIT ? OFFSET ?，值全部进绑定参数数组。语法位置的词过不了参数通道，操作符与列名各守一道白名单，schema 的列清单第一次当上守门员。生成的 SQL 与第 2 章手写 SELECT 同构等价，文本与结果双向验证为证。动态条件从手拼字符串变成多记一笔账，开章的三重坑连发生的土壤都没了。聚合函数与分组暂不进构建器，OR 分组从简，IN 与 BETWEEN 也不进操作符名单——它们与 OR 一并登记在差异清单（IN 的正面用场在第 12 章：关联加载的两跳批量查询会亲手写出它）。往上走，第 11 章让行变成带方法的实例、只把脏列写回去；第 12 章的关联加载，也骑在这条链上。

你现在能做到：对任意一张 defineTable 建好的表，用链式调用攒出带筛选、排序、分页的参数化查询，摊开 toSQL() 逐字核对，并讲清操作符与列名为什么不能走 ?。

读完本章你该能回答：

- 开章的 AND OR 语法错误，为什么 TS 编译器拦不住、要到数据库才爆？
- 两阶段各自负责什么？如果 where() 每次直接生成 SQL 片段，会丢掉什么？
- 操作符和列名为什么走不了占位符？两道白名单各自的名单从哪来？
- limit(2) 与 offset(1) 的实参对调后，SQL 文本变不变？结果哪里不对？
