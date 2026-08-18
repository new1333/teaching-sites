---
title: 行变对象，对象写回行：水合与脏跟踪
---

# 行变对象，对象写回行：水合与脏跟踪

## 三秒前的备注，被一次保存抹掉了

周五下午四点，客服组的小 A 在管理后台把工单 1024 的备注改成「客户要求周三前改地址」，保存成功。三秒后，你在另一个标签页里对同一个工单点了保存——你只是想把负责人换成自己。小 A 一刷新，她写的备注没了，页面回到她几分钟前看到的旧文案。她没点错，你也没点错，数据自己丢了。

两个页面背后是同一套老代码：打开工单时把整行读进表单，备注也一起读；保存时把表单里所有字段一句 UPDATE 全部写回。你页面上的备注是旧的——这次保存把备注列覆盖回了旧值，小 A 三秒前的写入无声消失。这类事故有名字：丢更新（lost update）——两个写入者基于同一份旧数据先后落笔，后到的把先到的改动盖掉，全程没有一条报错。全字段 UPDATE 的形状是这样：

```sql
-- 用法示例：只想改负责人，却把没动过的列也写了回去
UPDATE tickets SET title = ?, owner = ?, note = ?, updated_at = ? WHERE id = ?
```

单看 SQL 挑不出毛病，毛病在 SET 列了哪些列：只想改 owner，没动过的 note 也跟着出门，带着你页面上的旧值。

就算没有并发，另一层磨损也天天发生：查回来的行是裸对象，row.user_name 这种蛇形列名跟 TS 里的 userName 对不上，项目里到处是手工映射的样板代码。两个症状指向同一块缺失的层。第 7 章的分层地图早就给它留了位置：中层查询构建器第 10 章上岗，where 管筛选、orderBy 管排序、limit 与 offset 管分页。可 query().all() 吐回来的还是裸行——地图最上层的「水合与脏跟踪」，本章立起来。行进来时装上方法，写回时只写改过的列，丢更新从「改任何列都会出事」降到「只剩同列冲突」；蛇形列名的症状也在这层一起消失——实例的字段名就是 schema 里的字段名（第 9 章「字段与列同名」的规矩），裸行到实例一趟直达，手工映射的样板没活干了（想要 TS 里 userName、库里 user_name 的自动映射？本课程不做，差异清单见书末）。

## 目标：find 出来的行，自己会写回

本章结束时，开章那类编辑写成这样：

```ts
// 用法示例：find 出来的实例，改一列、存一列
const alice = users.find(1)
alice.age = 31
alice.save() // UPDATE users SET age = ? WHERE id = ?——SET 里只有 age
```

没改就保存，一条 SQL 都不发；同事的备注你不碰，除非你们改了同一列——那个残留的坑，本章末尾如实交代。

## 水合：把裸行装进带方法的实例

### 成因：数据库还回来的行，是「死」的

db.all 与 query().all() 还回来的行是普通对象：只有数据，没有动作。这种东西你前端天天见——fetch 回来的 JSON，字段都在，方法没有。写回数据库偏偏是一件需要「会做事」的事：UPDATE 得知道自己是哪张表、按哪个主键定位、哪些列改过。裸行一样都答不上。所以 ORM 在查询与写回之间加一道工序：把裸行装进一个带方法的对象，表名与主键一并带上。它还随身带一份快照（snapshot）——按下快门那一刻拍下存档的值，之后任凭实例怎么改，它一动不动。这道工序叫水合（hydration）——查回来的裸行泡进实例这个容器，装上 save() 与 remove()，从「能看的数据」变成「能写回的对象」。实例，就是类造出来的具体那个对象，像 new User() 得到的 user。

### 撞词：此 hydration 非彼 hydration

前端听到 hydration，第一反应多半是 SSR 那个：服务器把组件渲染成 HTML 发给浏览器，浏览器里框架再接管这堆静态标签——挂上事件监听、建立状态，页面从「能看」变「能点」。数据库这边的水合是另一回事：把行装上方法，从「能读」变「能写回」。两个同名概念共用的只有词根本意——让一份干巴巴的静态产物活起来；被接管的对象不同，一个是页面标签，一个是数据行。本章说水合，一律指后者。

### 载体：裸行与实例对照

```text
裸行（query().all() 的产物）       实例（水合的产物，Row 类）
┌──────────────────────┐         ┌────────────────────────────────┐
│ id: 1                │         │ 列值：id:1, name:'alice', age:30 │ ← 数据都在
│ name: 'alice'        │  ──►    │ save() / remove()               │ ← 长出动作
│ age: 30              │  水合   │ dirtyColumns()                  │
└──────────────────────┘         │ snapshot：装进来那一刻的存档      │ ← 私藏的底片
                                 └────────────────────────────────┘
```

### 演算：create 的三次交接

create({ name: 'carol', email: 'carol@example.com', age: 35 }) 不是把输入对象直接还给调用者，中间三步。第一步：按 schema 列白名单收列，生成参数化 INSERT——列名清单来自第 9 章的 schema（name、email、age），值全走 ?；执行后数据库回报 lastInsertRowid（第 1 章的老相识，RunResult 里的新行行号），本次是 3。第二步：拿这个行号回查——插入完立刻按主键 SELECT 一次。为什么多这一步？因为库才是事实：nickname 你没给，是表定义里的 DEFAULT '暂无昵称' 顶上的；id 是 INTEGER PRIMARY KEY 自动发的号。这些值输入对象里都没有，回查回来的裸行才有。第三步：把回查的裸行装进 Row。实例身上的每个值，都是库里现在的值——不是你以为给过的值。

### 锚点

接口回来的裸 JSON 经 new User(json) 变成带 save() 的实例——把「死数据」泡「活」，泡的就是这一下。

## 脏跟踪：实例记着自己改过哪些列

### 成因：save 需要知道「该写什么」

带方法的实例到手，save() 面前摆着两条路。第一条：把每一列都写回去——全字段 UPDATE，正是开章事故的形状。第二条：只写改过的列。第二条要成立，得有人记着「哪些列改过」。让实例自己记，这套记账叫脏跟踪（dirty tracking）——「脏」不是贬义，指与数据库里的版本不再一致；被改过、等着写回的列，叫脏列。前端表单的 dirty 语义（改过没有）是同一盏灯，只是这里记的是列。

### 载体：一份不动的快照

记法有两种。一种用 Proxy——JS 的代理对象，拦截每次属性赋值、当场记账；另一种用快照：装进来那一刻把整行值抄一份存档，之后任你改，存档不动，save 时把现在的列值与存档逐列对账——对不上的就是脏列。我们选快照：Proxy 对本章读者是超纲武器，多一层拦截魔法，读代码时脑补不出一次赋值到底绕了哪些路；快照加对账是平实的笨办法，账目一眼见底。教学优先，选看得懂的。

```text
alice = users.find(1)        实例身上的列值                     快照（私藏）
装进来时     id=1  name='alice'  nickname='暂无昵称'  age=30    同左（抄一份）
alice.age = 31     id=1  name='alice'  nickname='暂无昵称'  age=31    原样不动
逐列对账          id 同、name 同、nickname 同、age 31 ≠ 30   →  脏列 = ['age']
```

### 演算：一次 save 的两笔账

跟着算：脏列是 ['age']，save() 拼出 UPDATE users SET age = ? WHERE id = ?，params 是 [31, 1]。SET 里只有 age——没动过的列不出门；值走 ?（第 8 章的占位符），WHERE 的主键值取自快照。发完语句，快照重拍：age=31 存进新快照，实例回到「干净」。紧接着再 save() 一次：对账全同，脏列为空，直接返回——一条 SQL 都不发。**没改动就不发 UPDATE，不是省事的优化，是脏跟踪的组成部分**：没有脏列，就无事可写。

### 锚点

git 的暂存区：改了哪些文件它都记着，提交时只提交这些；快照就是 git status 比对的那份基准。

## 丢更新：只写脏列是缓解，不是根治

### 成因：两个实例，两份快照

并发——两位用户同时操作同一行——是丢更新的土壤。小 A 与你的页面各自 find(1)，各自水合出实例，各带一份快照，两份快照里备注都是旧的。全字段 UPDATE 的破坏面在于：SET 连你没动的备注列也写了回去，写的是你快照里的旧值，盖掉别人的新值。只写脏列把破坏面收窄到你确实改过的列——没动过的列不再出门。可要是两人改了同一列呢？后保存的照样赢：他的实例不知道这行在 find 之后被别人动过。

### 载体：时间线

```text
时刻   实例 a（小 A）                  实例 b（你）                  数据库里的行
t1    find(1)，快照 note='旧'          find(1)，快照 note='旧'        note='旧'
t2    a.note='已退款'；a.save()                                       note='已退款'
t3                                     b.age=41；b.save()
t3①   b 发全字段 UPDATE：SET note='旧', age=41                        note='旧'   ← 覆盖
t3②   b 只写脏列：SET age=41                                          note='已退款' ← 保住
t4    （两人都改 note）b.note='稍等'；b.save()                        note='稍等'  ← 后者赢
```

### 演算：三条路各走一遍

同一组数字，三条路。路一，全字段：b 的 SET 含 note 与 age，note 绑的是 b 快照里的旧值——A 的「已退款」没了，无人报错。路二，只写脏列：b 的 SET 只含 age——A 的备注保住，两边的改动都活着。路三，同列冲突：b 也改了 note，脏列含 note——后保存的赢，A 的字又没了。结论一句话：**只写脏列把丢更新从「改任何列都会覆盖」缓解到「只有同列冲突才发生」，根治要靠乐观锁**。乐观锁（optimistic locking）是一种「先不锁、提交时再查岗」的做法：给表加一列版本号，每次 UPDATE 带 WHERE version = ? 并让版本号加一；影响行数为 0，说明有人先动了这行，保存方重读重试。本课程不做乐观锁，登记进书末的差异清单附录。

### 锚点

像两人各自下载同一份网盘文件、改完先后传回，后传的把先传的盖掉；在线文档靠「别人正在编辑」的提示避免互盖——乐观锁就是数据库版的那盏灯。

## save() 长在实例身上：这是 Active Record 的味道

第 7 章讲过，ORM 是对象世界与关系模型之间的翻译器，翻译器分两大门派，现在对号入座。Active Record：数据对象自带增删改能力，user.save() 直接写库；Data Mapper：数据只是纯数据，读写交给独立的映射器对象。我们的 alice.save() 长在实例身上，实例揣着表上下文自己发 UPDATE——标准的 Active Record 味。这一派的祖师是 Ruby on Rails 的 ActiveRecord，Sequelize 的模型实例也是这个形状；Prisma 的写法偏 Data Mapper 味——数据交给 client 去 update；TypeORM 则两种姿势都支持。选 AR 不是因为它更正统，而是「数据带方法」用最少的概念讲清水合与脏跟踪：换成 DM，机制一模一样，只是 save 搬进映射器、实例退化成纯数据。第 7 章分层地图的上层至此立起来了，还差最后一块：关联加载。

## 实例的一生

「实例从哪来、到哪去」，串成一张生命周期：

```text
users.create(data)  → INSERT → 回查 → 水合 → 实例（快照 = 库里的行）
users.find(id)      → 按主键 SELECT → 水合  → 实例（快照 = 库里的行）
实例.列 = 值         → 只有实例身上的值变，快照不动 → 脏列出现
instance.save()     → 脏列非空：UPDATE 脏列 + 重拍快照（回到干净）
                      脏列为空：不发任何 SQL
instance.remove()   → DELETE → 实例作废：再 save/remove 抛中文错误
```

每条边都有断言盯着，等会儿逐条见。

## 亲手造：src/table.ts

老规矩，测试先行：先写 tests/hydration-dirty-tracking.test.ts，跑一次见红。报错是找不到模块 table——机械证明这是本章的新模块，旧代码一行没动。然后三步。

### 第一步：Row 类——列值、快照、对账

```ts
// src/table.ts —— Row 类：列值、私藏的快照、与快照对账（原样节选）
/** 水合的产物：一行数据长出方法——列值在身上，save()/remove()/dirtyColumns() 也在身上 */
export class Row {
  /** 列数据：键是列名、值是 SqlValue；类型层放宽为 unknown，取舍见正文与差异清单 */
  [column: string]: unknown

  private readonly table: Table
  /** 装进来那一刻的快照：与快照不同的列才是脏列；save 成功后重拍 */
  private snapshot: Record<string, SqlValue>
  private removed = false

  constructor(table: Table, row: Record<string, SqlValue>) {
    this.table = table
    this.snapshot = { ...row }
    Object.assign(this, row)
  }

  /** 与快照对过账的脏列清单：装进来时为空，改一列长一列，save 后清零 */
  dirtyColumns(): string[] {
    return Object.keys(this.table.columns).filter(
      (column) => this[column] !== this.snapshot[column]
    )
  }
```

三件事值得看。第一，[column: string]: unknown 把「每列什么类型」在类型层放宽了——第 9 章的类型映射只认三个词，但「这张表每列叫什么」是运行时信息，TS 的类型系统接不住动态键名；真实 ORM 用「由 schema 生成类型」解决，这项差距登记在书末差异清单。第二，快照用 { ...row } 抄一份浅拷贝——快照与列值从此是两份内存，改实例不会误伤存档。第三，对账只在 schema 列清单里比，列名来自白名单，与第 10 章同一条家规。

### 第二步：save 与 remove——写回与作废

```ts
// src/table.ts —— Row 的写回与作废：save 只发脏列，remove 后实例作废（原样节选）
  /** 只把脏列写回：UPDATE 表 SET 脏列 = ? WHERE 主键 = ?；没有脏列就不发 UPDATE，随后重拍快照 */
  save(): this {
    this.assertNotRemoved('save')
    const dirty = this.dirtyColumns()
    if (dirty.length === 0) return this
    const pk = primaryKeyColumn(this.table)
    const params: SqlValue[] = dirty.map((column) => this[column] as SqlValue)
    // WHERE 用快照里的主键：定位「装进来的那一行」，改过 id 也能找对行
    params.push(this.snapshot[pk])
    const setClause = dirty.map((column) => `${column} = ?`).join(', ')
    const sql = `UPDATE ${this.table.name} SET ${setClause} WHERE ${pk} = ?`
    this.table.db.run(sql, ...params)
    this.refreshSnapshot()
    return this
  }

  /** 删除这一行：DELETE FROM 表 WHERE 主键 = ?；删完实例作废，再 save/remove 报错 */
  remove(): void {
    this.assertNotRemoved('remove')
    const pk = primaryKeyColumn(this.table)
    this.table.db.run(`DELETE FROM ${this.table.name} WHERE ${pk} = ?`, this.snapshot[pk])
    this.removed = true
  }

  /** UPDATE 成功后重拍快照：现在的值就是新的「干净」基准 */
  private refreshSnapshot(): void {
    const fresh: Record<string, SqlValue> = {}
    for (const column of Object.keys(this.table.columns)) {
      fresh[column] = this[column] as SqlValue
    }
    this.snapshot = fresh
  }

  /** 生命周期守门：删掉的行不允许再写回，报错而不是静默装作没事 */
  private assertNotRemoved(step: string): void {
    if (this.removed) {
      throw new Error(
        `${step} 失败：这个实例已经 remove，行没了——要再写请重新 create 或 find 一个新实例`
      )
    }
  }
}
```

save 的顺序是对账、拼句、执行、重拍。两个细节：WHERE 的主键值取自快照——它定位「装进来的那一行」，就算有人改了实例上的 id，也能找对行；重拍快照放在 UPDATE 之后，保存成功的标志就是快照与列值重新一致。remove 删完把 removed 置位，这个布尔位是生命周期的守门员——作废的实例再想写回，中文错误当场拦下，不静默装作没事，错误家规与第 9、10 章一脉。

### 第三步：hydrate、insertAndHydrate、findByPrimaryKey

水合这道门本身只有一行，create 与 find 都从这里过。

```ts
// src/table.ts —— 水合这道门（原样节选）
/** 水合：把查回来的裸行装进 Row——本章的核心动作，create 与 find 都走这道门 */
export function hydrate(table: Table, row: Record<string, SqlValue>): Row {
  return new Row(table, row)
}
```

create 的实现分两件事：收列把关，插入加回查。

```ts
// src/table.ts —— insertAndHydrate：白名单收列、参数化 INSERT、回查水合（原样节选）
/** create 的实现：按 schema 白名单收列、参数化 INSERT、按 lastInsertRowid 回查水合 */
export function insertAndHydrate(
  table: Table,
  data: Record<string, SqlValue>
): Row {
  const columns: string[] = []
  const values: SqlValue[] = []
  for (const [column, value] of Object.entries(data)) {
    if (!(column in table.columns)) {
      throw new Error(
        `未知列「${column}」：create 想插它，但表 ${table.name} 的列只有 ${Object.keys(
          table.columns
        ).join('、')}——悄悄丢掉它等于吞掉一个拼写错误`
      )
    }
    columns.push(column)
    values.push(value)
  }
  if (columns.length === 0) {
    throw new Error('create 失败：传进来的对象一列都没有，至少给一列再插')
  }
  const placeholders = columns.map(() => '?').join(', ')
  const insertSql = `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`
  const result = table.db.run(insertSql, ...values)
  const row = findByRawPk(table, result.lastInsertRowid)
  if (!row) {
    throw new Error(`create 回查失败：行刚插进 ${table.name}，按主键却查不回来`)
  }
  return hydrate(table, row)
}
```

schema 之外的列当场抛「未知列」——悄悄丢掉它，等于吞掉一个拼写错误。emial 这种手滑永远存在，早拦比晚拦好。空对象也过不了门。INSERT 后的回查复用 findByRawPk——与 find 同一条按主键的 SELECT，两条路在「水合」这道门汇合。

find 与主键定位的地基：

```ts
// src/table.ts —— find 的实现与主键地基（原样节选）
/** find 的实现：主键查询加一次水合；查不到返回 undefined */
export function findByPrimaryKey(table: Table, id: SqlValue): Row | undefined {
  const row = findByRawPk(table, id)
  return row ? hydrate(table, row) : undefined
}

/** 主键列的裸行查询：SELECT 全列 WHERE 主键 = ?——create 回查与 find 共用 */
function findByRawPk(table: Table, id: SqlValue): Record<string, SqlValue> | undefined {
  const pk = primaryKeyColumn(table)
  return table.db.get<Record<string, SqlValue>>(
    `SELECT ${Object.keys(table.columns).join(', ')} FROM ${table.name} WHERE ${pk} = ?`,
    id
  )
}

/** 主键列名：find/save/remove 都靠它精确定位一行；没定义主键的表当场报错 */
function primaryKeyColumn(table: Table): string {
  const pk = Object.keys(table.columns).find((column) => table.columns[column].primaryKey)
  if (!pk) {
    throw new Error(
      `表 ${table.name} 没有主键列：find/save/remove 都靠主键定位行，请给 schema 配上 primaryKey`
    )
  }
  return pk
}
```

findByRawPk 的 SELECT 走主键，第 6 章讲过主键自带索引，这条回查不贵。primaryKeyColumn 是全文件的地基：find、save、remove、回查全靠主键定位一行，没定义主键的表当场报错。

### schema 那边长了什么

create/find 与 query() 同款生长模式：入口长在表句柄上，实现住在 src/table.ts。

```ts
// src/schema.ts —— Table 接口现状：create/find 与 query() 同款生长（原样节选，关联声明第 12 章长上）
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
// src/schema.ts —— defineTable 交回的句柄：create/find 转发给 src/table.ts（原样节选）
    create(data) {
      return insertAndHydrate(this, data)
    },
    find(id) {
      return findByPrimaryKey(this, id)
    },
```

builder.ts 与 db.ts 一行没动，defineTable 照旧按第 9 章的规矩生成 DDL——主键、约束、外键子句一样不少，本章只添了两个转发。第 1 到 10 章的 67 个旧断言原样全绿——只增不破的哨兵还在站岗。第 9、10 章正文引用的 Table 与 defineTable 代码块，已按当前形态同步更新；接口里多出的关联注册表 relations 与声明方法 hasMany/belongsTo 是第 12 章长上来的，户口在 src/relations.ts。

### 里程碑测试：把 SQL 拍在桌上

脏跟踪的承诺，要靠「看得见 SQL」来验证。测试先给 Db 包一层记账皮，语句原样透传、账目按序落袋：

```ts
// tests/hydration-dirty-tracking.test.ts —— SQL 记账皮（原样节选）
/** 给 Db 包一层记账皮：run/all/get 原样透传，但每条 SQL 与参数按序记进 log（exec 不记，DDL 不算数） */
function withSqlLog(inner: Db): { db: Db; log: SqlLogEntry[] } {
  const log: SqlLogEntry[] = []
  const db: Db = {
    exec(sql) {
      inner.exec(sql)
    },
    run(sql, ...params) {
      log.push({ sql, params })
      return inner.run(sql, ...params)
    },
    all(sql, ...params) {
      log.push({ sql, params })
      return inner.all(sql, ...params)
    },
    get(sql, ...params) {
      log.push({ sql, params })
      return inner.get(sql, ...params)
    },
  }
  return { db, log }
}
```

三条断言各自盯一个承诺。第一条盯「只写脏列」，SQL 文本与参数逐字对账。

```ts
// tests/hydration-dirty-tracking.test.ts —— 只写脏列的逐字断言（原样节选）
  it('改一列：UPDATE 的 SET 只含该列，值走参数、WHERE 用主键', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const alice = users.find(1)
    alice!.nickname = '管理员改的'
    alice!.save()
    const updates = statements(log, 'UPDATE')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      sql: 'UPDATE users SET nickname = ? WHERE id = ?',
      params: ['管理员改的', 1],
    })
    expect(db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', 1)).toEqual({
      nickname: '管理员改的',
    })
  })
```

第二条盯「没改动不发 UPDATE」——SQL 计数为 0。

```ts
// tests/hydration-dirty-tracking.test.ts —— 干净实例不发 UPDATE（原样节选）
  it('干净实例 save：一条 UPDATE 都不发（SQL 计数为 0）', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedUsers(wrapped.db)
    const alice = users.find(1)
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(0)
    alice!.save()
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(0)
  })
```

第三条盯「丢更新被缓解」，两个实例各改各的列，b 的 SET 里没有 note。

```ts
// tests/hydration-dirty-tracking.test.ts —— 丢更新的缓解现场（原样节选）
  it('两个实例各改各的列：没动过的列不再覆盖别人的写入', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const a = users.find(1)!
    const b = users.find(1)! // b 在 a 保存之前取的行，身上是旧数据
    a.nickname = '客服备注：已退款'
    a.save()
    b.age = 40
    b.save()
    // b 只改了 age：SET 里只有 age，a 刚写的 nickname 没被拖下水
    expect(statements(log, 'UPDATE').at(-1)).toEqual({
      sql: 'UPDATE users SET age = ? WHERE id = ?',
      params: [40, 1],
    })
    expect(db.get<{ nickname: string; age: number }>('SELECT nickname, age FROM users WHERE id = ?', 1)).toEqual({
      nickname: '客服备注：已退款',
      age: 40,
    })
  })
```

开章事故在这条断言里翻案：a、b 各自水合、各改一列，两边的写入都活着。另有两条断言守住生命周期的边界：remove 之后 find(1) 是 undefined、作废实例再 save 抛「已经 remove」；同列冲突那条（两人都改 nickname、后保存的赢）也在测试里如实记着，提醒读者缓解不等于根治。

## 见证它变绿

老地方，companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 82 passed (82)。第 1 到 10 章攒下的 67 个旧断言一个没伤，本章新增 15 个；src 多了 table.ts，schema.ts 长出 create/find，其余文件原样。只想跑本章：npx vitest run tests/hydration-dirty-tracking.test.ts。

不进实验场也能复现开章事故。存成 try-lost-update.mjs，跑 node try-lost-update.mjs。

```js
// 用法示例：三十秒复现丢更新
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec("CREATE TABLE tickets (id INTEGER PRIMARY KEY, note TEXT DEFAULT '旧', owner TEXT)")
db.prepare('INSERT INTO tickets (owner) VALUES (?)').run('我')
// 两个「页面」各自取走同一行
const pageA = db.prepare('SELECT * FROM tickets WHERE id = ?').get(1)
const pageB = db.prepare('SELECT * FROM tickets WHERE id = ?').get(1)
// A 改备注、先保存
db.prepare('UPDATE tickets SET note = ? WHERE id = ?').run('客户要求周三前改地址', 1)
// B 只想改负责人，却把整行写回——note 绑的是 B 手上的旧值
db.prepare('UPDATE tickets SET note = ?, owner = ? WHERE id = ?').run(pageB.note, '同事', 1)
console.log(pageA.note)                                                    // A 眼里的备注
console.log(db.prepare('SELECT note FROM tickets WHERE id = ?').get(1))    // 库里最终值
```

两行输出都是 旧。第一行是 A 页面对象上的值——A 从没重查过库，连她自己都不知道写入没了；第二行是库里的最终值。A 写进去的「客户要求周三前改地址」哪儿都找不到了——全程没有一条报错。把最后一句 UPDATE 的 SET 改成只含 owner 再跑，备注就活下来：全字段与只写脏列的差别，三十秒亲手摸到。

## 小结

地图上层立起来了。水合：查回来的裸行装进带 save()/remove() 的实例，与 SSR 的同名概念只共用「让静态产物活起来」这层词根；create 走 INSERT、回查、装实例三步，find 走主键 SELECT、装实例两步，实例身上的值永远以库里为准。脏跟踪：实例私藏装进来那一刻的快照，save 前逐列对账，只把脏列拼进 UPDATE、值走参数；没脏列就不发语句，UPDATE 之后快照重拍。丢更新：全字段 UPDATE 连没动的列也写回旧值，脏跟踪把破坏面收窄到同列冲突，根治要乐观锁与版本号——本课程不做，登记差异清单。save() 长在实例身上，这是 Active Record 的味道；换 Data Mapper，机制不变，方法搬家。Row 的列值类型放宽为 unknown，schema 生成类型这道差距同样记在差异清单。往上走：第 12 章的关联加载骑在 query() 链上、实例由它批量水合；第 13 章的事务把 save 与 remove 这类写操作捆成一个整体。

你现在能做到：对 defineTable 建好的表 create 出实例、find 回实例，改哪列写哪列，讲清快照对账与「没改动不发 UPDATE」，以及丢更新为什么只是被缓解。

读完本章你该能回答：

- SSR 的 hydration 与本章的水合，各自「让什么活起来」？共用的是哪层意思？
- create 为什么要回查一次再水合，而不是把输入对象直接装进实例？
- 实例改了 age 与 nickname 两列又改回原值，save 会发什么样的 UPDATE？为什么？
- 两个实例都改了同一列，脏跟踪为什么救不了？乐观锁靠什么救？
- instance.save() 是哪一派的写法？换成另一派，代码结构动哪里？
