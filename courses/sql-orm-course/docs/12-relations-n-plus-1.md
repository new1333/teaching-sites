---
title: 关联加载与 N+1：一次循环引发的 101 条 SQL
---

# 关联加载与 N+1：一次循环引发的 101 条 SQL

## 一行 include，一百零一条 SELECT

周四上线的列表页：一百个用户，每人名下挂出自己的订单。代码里只写了一行 ORM 的 include，评审时没人多看一眼。上线当天接口 300 毫秒，周五涨到 1 秒，第二周稳定在 3.2 秒，运营开始截图催你。打开 SQL 日志往上翻：一条查用户的 SELECT 之后，跟着整整齐齐一百条查订单的 SELECT，WHERE user_id = 1、WHERE user_id = 2，一路编到 user_id = 100。控制台里它们闪得飞快，肉眼数不过来，得靠行号才知道是 101 条。

每条语句单看都无辜：走了索引，单独执行不到一毫秒。慢的不在哪一条，在条数——1 条主查询加 100 条关联查询。这是 ORM 世界最著名的坑，第 7 章那句警告在此兑现：**ORM 替你写 SQL，不替你判断 SQL 好不好**——数清它发了几条，正是判断好坏的第一步。它有个学名，本章把它拆到骨头：病因是循环里逐条查关联，药方有两种，而我们只花一条语句的钱就把对象补齐。

## 目标：声明一次，with 一跳

本章结束时，开章那个列表页写成这样：

```ts
// 用法示例：本章结束后的写法
const users = defineTable(db, 'users', usersColumns)
const orders = defineTable(db, 'orders', ordersColumns)
// 声明一次：一个用户有多笔订单——from 是本表列，to 是对方表列
users.hasMany('orders', { table: orders, from: 'id', to: 'user_id' })

const list = users.query().with('orders').all()
// 100 个用户各自挂上订单实例，总共 2 条 SELECT：1 条主查询 + 1 条 IN 批量查询
```

orders 挂上来的还是第 11 章那种带 save() 的水合实例；不带 with 的查询一行账都不多记，行为与第 10 章完全一致。

## N+1 问题：一次循环引发的 101 条

### 成因：封装太自然，行数变成语句数

ORM 把「查一个用户的订单」封装成一次属性访问或一次调用，单看毫无问题。放进循环，灾难开始：主查询拿回 N 行，循环体里每行再查一次关联，语句数就是 N 加 1。这就是 N+1 问题——查 1 次列表，再逐行查 N 次关联，共发出 N+1 条 SQL。它为什么慢？第 1 章讲过数据库是独立进程：真机上每条 SQL 都是一次跨进程往返，打包、传输、解析、执行、回传，一样不能少。单条 3 毫秒不算什么，101 条就是 300 毫秒起步——开章的 3.2 秒还叠上了每条语句各自的准备成本。

这里有个诚实的声明：实验场用的是内存 SQLite，同进程调用，101 条几乎免费。所以本章的测试只断言语句条数，不断言秒数——条数是结构性的，耗时随环境放大，而结构先于环境存在。

### 载体：语句清单的形状

```text
第    1 条  SELECT id, name FROM users                ← 主查询：拿 100 个用户
第    2 条  SELECT … FROM orders WHERE user_id = 1    ← 给第 1 个用户查订单
第    3 条  SELECT … FROM orders WHERE user_id = 2
     ……
第  101 条  SELECT … FROM orders WHERE user_id = 100  ← 给第 100 个用户查订单
```

这份清单是 N+1 的全部证据：第一条与第一百零一条长得一模一样，只有参数不同——同一件事做了一百遍。

### 演算：1 + N

列表页分页取 100 个用户，N 是 100，语句 101 条。页面大小改成 1000，语句 1001 条；每多一个带关联的页面，再乘一份。**1 + N 里的 N 是行数，不是常数**——代码永远只有一行，行数却在跟业务一起涨，这就是它能在评审里溜过去的原因。加索引救不了：第 6 章讲过索引让单条查询快，可它一条也不少发。

### 锚点

循环里逐条 await fetch 一百次，还是发一次批量请求？前端的你绝不会写前者。N+1 就是数据库版的逐条 fetch——数量词是它的一切：说清它，等于说清「几条、每条多贵」。

## 两种药方：JOIN 策略 vs 两跳策略

N+1 的修法都能归结成一句话：把逐条换成批量。但批量落地有两条路，各有各的形状。

### 成因：行形状之争

第一条路是 JOIN（连接）——第 5 章的老工具，按关联列把两张表的行配成对，一条语句拿全。第二条路是两跳查询（two-hop，也叫 IN 批量加载）——先查主表，再收集主表行的关联值，用一条 IN 清单查询把所有关联行一次捞回，最后分桶挂回各实例。两条路治同一个病，分歧在查询结果该长什么形状：JOIN 策略把结果拍平成一张宽表，两跳策略保住对象的原形。

### 载体：宽行与两跳时序

JOIN 的一对多放大：一个用户有三笔订单，结果里这个用户就出现三行，用户列跟着重复三份。

```text
JOIN 结果（拍平）：                      两跳时序（保形状）：
u1 alice | o1 100                       第一跳  SELECT id, name FROM users      → 100 行
u1 alice | o2 250                       收集    [1, 2, …, 100]（from 列的值，去重）
u1 alice | o5  90                       第二跳  SELECT … FROM orders
u2 bob   | o3  50                                WHERE user_id IN (?, …共 100 个) → 该批全部订单
u3 carol | o4  30                       挂载    按 user_id 分桶 → user.orders = 桶里的实例
```

关系模型的世界里行归行、列归列，JOIN 结果就是一行行宽记录；页面要的却是「100 个用户、每人挂一个订单数组」的对象形状。JOIN 策略拿到宽行还得按用户主键重新分组折叠，把拍平的再叠回去；两跳策略的第一跳本来就是对象本尊，第二跳只往上补属性。

### 演算：纸上比一比

设用户 2 列、订单 3 列、每人平均 3 笔订单。JOIN 路线：100×3 等于 300 行宽行，每行 5 列，共 1500 个值——其中用户列的 600 个值里有 400 个是复读。两跳路线：第一跳 100 行乘 2 列是 200 个值，第二跳 300 行乘 3 列是 900 个值，共 1100 个。用户列涨到 10 列再看：JOIN 是 300×13 共 3900，两跳是 1000 加 900 共 1900——**用户列越宽、订单越密，拍平的复读越亏**。再算索引账：第二跳的 WHERE to IN (…) 正是吃 to 列索引的形状。第 6 章讲过主键与 UNIQUE 自带目录；外键列没有这份待遇——SQLite 不替外键自动建目录，想吃红利得自己建——建好后拿 EXPLAIN QUERY PLAN 看第二跳，SCAN 就成了 SEARCH，查询计划的读法原样适用；将来第二跳要加「按用户加时间」的条件，联合索引把 user_id 放最左，最左前缀的规矩不变。

### 锚点

第 5 章开章的双重循环按 userId 匹配，就是 JOIN 的手工版；先拿 id 名单、再按名单一次取齐，就是两跳。本课程选两跳：对象形状不用重新分组、第二跳天然吃外键列索引、实现只需要亲手拼一条参数化 IN。JOIN 策略不是错误答案，报表型查询它仍是一把好手；真实 ORM 两种路子都有实现，选型时翻 SQL 日志确认它发的是哪种——这正是第 7 章练的本事。取舍的代价也要记账：两跳比 JOIN 多一次往返，两条语句之间数据可能变化，一致读要靠事务兜底，第 13 章见。

## 两跳查询：IN 的正面用场

### 成因：为什么 IN 一直没进操作符名单

第 10 章小结留过一句话：IN 的正面用场在第 12 章，关联加载的两跳批量查询会亲手写出它。现在兑现。第 2 章你见过 IN——列值在清单里就命中；第 8 章的教训则是一条铁律：拼接让数据变成代码，参数化是唯一的墙。第 10 章的 where() 没把 IN 收进操作符名单，原因在形状：where 的值是一颗，IN 的值是一串。一颗值能走一个 ? 占位符；一串值没法塞进一个 ?，只能按个数生成一排占位符。这排占位符拼在 SQL 模板里，值仍走参数通道——两跳的 IN 就是为这种「一串值」的形状生的。

### 载体：第二跳的完整账

```text
收集    for 每个主行：取 from 列的值 → 跳过 NULL（IN 永远匹配不上 NULL，第 2 章的三值逻辑）→ 去重
拼句    SELECT 对方列清单 FROM 对方表 WHERE to IN (?, ?, ?, …占位符个数 = 收集到的值个数)
执行    db.all(sql, ...values)   ← 值全走参数
挂载    水合 → 按 to 值分桶 → 挂到各实例
```

### 演算：跟着 3 个用户走一遍

主查询拿回 alice、bob、carol，from 列（id）的值是 [1, 2, 3]——没有 NULL，也没有重复，清单三项。占位符按 3 生成：IN (?, ?, ?)，参数数组 [1, 2, 3]。第二跳 SQL 与参数逐字如下，这是测试里真实断言的形状：

```sql
-- 用法示例：第二跳的真实形状（3 个用户）
SELECT id, user_id, total FROM orders WHERE user_id IN (?, ?, ?)
-- params: [1, 2, 3]
```

主查询命中 0 行时，清单为空，第二条干脆不发——IN () 在 SQL 里是语法错误，实现里专门有一道门拦住它。还有一种瘦场景：主查询被分页条件削到只剩 1 个用户，清单就一项、占位符一个，形状不变。占位符的个数永远跟着值走——**占位符的个数是 SQL 的结构，值才是数据**。第 8 章的分通道原则在此第三次上岗：模板（结构）可以拼，拼的依据是「个数」这个数字；值一个也不进模板。

### 锚点

点外卖前先报一串房间号，后厨按单子一次配齐——不是一间一间跑一趟。

## 亲手造：src/relations.ts

老规矩，测试先行：先写 tests/relations-n-plus-1.test.ts，跑一次见红。报错是 users.hasMany is not a function——表句柄上还没有这个方法，旧代码一行没动。然后四步。

### 第一步：声明——hasMany/belongsTo 与注册表

```ts
// src/relations.ts —— 一条关联的声明账与共同参数（原样节选）
/** 一条关联的声明账：类型（一对多还是多对一）、对方表、两端的列——from 是本表列、to 是对方表列 */
export interface RelationDef {
  kind: 'hasMany' | 'belongsTo'
  table: Table
  from: string
  to: string
}

/** hasMany/belongsTo 的共同参数：table 是对方表句柄；from 本表列，to 对方表列 */
export interface RelationOptions {
  table: Table
  from: string
  to: string
}
```

声明的实现是一道门：校验加记账，hasMany 与 belongsTo 都从这过。

```ts
// src/relations.ts —— declareRelation：四道校验 + 记进注册表（原样节选）
/** 声明的实现：校验加记账——hasMany 与 belongsTo 都走这道门，账本就是表句柄身上的 relations */
export function declareRelation(
  table: Table,
  name: string,
  kind: RelationDef['kind'],
  options: RelationOptions
): Table {
  if (name in table.relations) {
    throw new Error(
      `关联「${name}」重复声明：表 ${table.name} 上已经有一个同名关联，一个名字只装一种关联`
    )
  }
  if (name in table.columns) {
    throw new Error(
      `关联名「${name}」与表 ${table.name} 的列名撞车：挂载时要把关联当属性装到实例上，会盖掉这一列的值——换个名字`
    )
  }
  if (!(options.from in table.columns)) {
    throw new Error(
      `未知列「${options.from}」：声明关联 ${name} 的 from 得是本表（${table.name}）的列，列只有 ${Object.keys(
        table.columns
      ).join('、')}`
    )
  }
  if (!(options.to in options.table.columns)) {
    throw new Error(
      `未知列「${options.to}」：声明关联 ${name} 的 to 得是对方表（${options.table.name}）的列，列只有 ${Object.keys(
        options.table.columns
      ).join('、')}`
    )
  }
  table.relations[name] = { kind, table: options.table, from: options.from, to: options.to }
  return table
}
```

四道校验各拦一种事故：重复声明、关联名撞列名、from 不在本表列、to 不在对方表列。第二道最容易漏想：挂载是把关联当属性装到实例上，关联若叫 name，就把 name 列的值盖掉了——所以当场拦下。这四道闸同时完成一件事：注册表里的列名与表名全部过过白名单，第二跳拼 SQL 时直接取用，不再碰任何用户输入。错误家规与第 9、10、11 章一脉：中文消息，说清哪一步、为什么。

表句柄这边长出注册表与两个声明方法，转发给 relations.ts：

```ts
// src/schema.ts —— Table 接口现状：注册表与关联声明第 12 章长上（原样节选）
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
// src/schema.ts —— defineTable 交回的句柄：关联声明转发给 src/relations.ts（原样节选）
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
```

defineTable 照旧生成 DDL 建表，本章没动建表一行；第 9、10、11 章正文引用的 Table 与 defineTable 代码块，已按当前形态同步回写。

### 第二步：with 记账——两阶段的又一次复用

```ts
// src/builder.ts —— with()：记账不编译，与 where/orderBy 同一款家规（原样节选）
  /** 记一个要批量加载的关联名；多次调用各记一笔（重复的名字只记一次），all()/get() 时各自装一跳 */
  with(name: string): this {
    if (!(name in this.table.relations)) {
      throw new Error(
        `未知关联「${name}」：表 ${this.table.name} 声明过的关联只有 ${
          Object.keys(this.table.relations).join('、') || '（一个都没有）'
        }——先在表句柄上 hasMany/belongsTo 声明，再 with`
      )
    }
    if (!this.withs.includes(name)) this.withs.push(name)
    return this
  }
```

with 记的账不进 toSQL()——它不改主查询的形状，where、排序、分页照旧；它只决定查询之后补几跳。未知关联名在记账当场抛中文错误，重复的名字只记一次。执行端在 all() 与 get() 分岔：账上没有 with，走第 10 章的老路返回裸行；有 with，把裸行交给 loadRelations。

```ts
// src/builder.ts —— all()/get() 的分岔：无 with 老行为，有 with 两跳（原样节选）
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
```

### 第三步：亲手拼 IN——本章的核心函数

```ts
// src/relations.ts —— loadRelations：两跳的第二跳，全貌（原样节选）
/** with 的执行：第一跳的主行已到手，这里做第二跳——每个关联一条 IN 批量查询，水合后按 to 分桶挂到各实例 */
export function loadRelations(
  table: Table,
  rows: Record<string, SqlValue>[],
  names: string[]
): Row[] {
  const instances = rows.map((row) => hydrate(table, row))
  for (const name of names) {
    const rel = table.relations[name]
    // 收集 from 列的值：跳过 NULL（IN 永远匹配不上 NULL，进清单只是白占一个占位符）、去重
    const values: SqlValue[] = []
    for (const row of rows) {
      const value = row[rel.from]
      if (value !== null && !values.includes(value)) values.push(value)
    }
    const buckets = new Map<string, Row[]>()
    if (values.length > 0) {
      // 占位符按值的个数生成：个数是 SQL 结构的一部分，写死一个 ? 装不下多个值
      const placeholders = values.map(() => '?').join(', ')
      const sql = `SELECT ${Object.keys(rel.table.columns).join(', ')} FROM ${rel.table.name} WHERE ${rel.to} IN (${placeholders})`
      const related = rel.table.db.all<Record<string, SqlValue>>(sql, ...values)
      for (const raw of related) {
        const bucket = buckets.get(String(raw[rel.to])) ?? []
        bucket.push(hydrate(rel.table, raw))
        buckets.set(String(raw[rel.to]), bucket)
      }
    }
    for (const instance of instances) {
      const key = instance[rel.from]
      const bucket = key === null || key === undefined ? [] : buckets.get(String(key)) ?? []
      // hasMany 挂数组（一条没有也是空数组）；belongsTo 挂单对象，查不到挂 null
      instance[name] = rel.kind === 'hasMany' ? bucket : bucket[0] ?? null
    }
  }
  return instances
}
```

逐段看。收集：从主行取 from 列的值，跳过 NULL、按出现序去重——100 个用户最多 100 项，哪怕订单表有十万行。拼句：列清单与表名取自对方表的 schema，to 列名取自声明时过过白名单的注册表，占位符个数等于值的个数——模板里唯一「拼」出来的东西是重复 ? 的次数，依据是数字不是值。执行：值整个数组摊开进参数，一个不少。为空不发第二条：IN () 在 SQL 里是语法错误，主查询命中 0 行时第二跳干脆跳过，这也有断言盯着。

### 第四步：水合挂载——第 11 章在此复用

第二跳查回的关联行照旧过 hydrate——只不过这次装进的是对方表的实例：订单行水合成 orders 的 Row，带 save() 与 remove()。分桶用 Map，键是 to 值的字符串形态——第 4 章讲 GROUP BY 时的分桶直觉原样搬来，只是这次分完桶各自挂回。挂载规则两句：hasMany 挂数组，一条没有也是空数组——空数组让调用方免判空；belongsTo 挂单对象，查不到挂 null。挂完的实例长这样：user.orders[0].total、order.user.name，取值直达，且每个元素都是能写回的活实例。

一个类型层的诚实声明：关联属性在类型系统里是 unknown——第 9 章的类型映射只管列，不管关联；「由 schema 生成关联类型」这道差距登记在书末差异清单，与 Row 列值放宽为 unknown 是同一笔账。

### 里程碑测试：把条数拍在桌上

计数靠第 11 章那款 SQL 记账皮：给 Db 包一层，语句与参数按序落袋。先看开章事故的机械复现——循环逐条查，101 条：

```ts
// tests/relations-n-plus-1.test.ts —— N+1 现场（原样节选）
  it('先查列表再逐行查关联：SELECT 计数 1 + 100 = 101', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedBig(wrapped.db)
    const list = users.query().all()
    expect(list).toHaveLength(100)
    // 「很自然」的写法：每个用户单独查一次订单——每条都不慢，慢在条数
    for (const user of list) {
      wrapped.db.all('SELECT id, user_id, total FROM orders WHERE user_id = ?', user.id)
    }
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(101)
  })
```

同一个数据集，换成 with，条数与 SQL 文本双双对账：

```ts
// tests/relations-n-plus-1.test.ts —— 两跳加载的条数与文本（原样节选）
  it('100 用户 with orders：总共 2 条 SELECT（1 条主查询 + 1 条 IN 批量查询）', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedBig(wrapped.db)
    const list = users.query().with('orders').all<Row>()
    expect(list).toHaveLength(100)
    for (const user of list) {
      const orders = user.orders as Row[]
      expect(orders).toHaveLength(1)
      expect(orders[0].user_id).toBe(user.id)
    }
    const selects = statements(wrapped.log, 'SELECT')
    expect(selects).toHaveLength(2)
  })

  it('第二跳的 SQL 与参数：列名表名走注册表白名单，占位符按收集到的值个数生成', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    users.query().with('orders').all<Row>()
    const selects = statements(wrapped.log, 'SELECT')
    expect(selects[0]).toEqual({ sql: 'SELECT id, name FROM users', params: [] })
    expect(selects[1]).toEqual({
      sql: 'SELECT id, user_id, total FROM orders WHERE user_id IN (?, ?, ?)',
      params: [1, 2, 3],
    })
  })
```

101 对 2，同一份数据、同一个断言口径——数量词就是疗效。belongsTo 的挂载也有专测：user_id 为 NULL 的订单挂 null、去重后第二跳只剩两个占位符、总数仍是 2 条。另有四条边界断言：无 with 时一条关联查询都不发；未知关联名当场抛中文错误；重复 with 只装一跳；两个关联各装一跳共 3 条——with('orders').with('reviews') 这种多关联同挂，每关联一跳，条数恒为 1 加关联数。本章实现的多关联同挂是顺手的循环，没多花一行特判。

## 见证它变绿

companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 94 passed (94)。第 1 到 11 章攒下的 82 个旧断言一个没伤，本章新增 12 个；src 多了 relations.ts，schema.ts 长出注册表与声明方法，builder.ts 长出 with() 与分岔的 all()/get()，table.ts 与 db.ts 一行没动。只想跑本章：npx vitest run tests/relations-n-plus-1.test.ts。

不进实验场也能数出 101 对 2。存成 try-n-plus-1.mjs，跑 node try-n-plus-1.mjs：

```js
// 用法示例：三十秒数出 101 对 2
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)')
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER)')
for (let i = 1; i <= 100; i++) {
  db.prepare('INSERT INTO users (name) VALUES (?)').run(`user${i}`)
  db.prepare('INSERT INTO orders (user_id, total) VALUES (?, ?)').run(i, i * 10)
}
let count = 0
const run = (sql, ...params) => (count++, db.prepare(sql).all(...params))
// 路线一：循环逐条——每个用户单独查一次订单
const users = run('SELECT id FROM users')
for (const u of users) run('SELECT * FROM orders WHERE user_id = ?', u.id)
console.log('循环逐条：', count) // 101
// 路线二：一次批量——收集 id、按个数生成占位符、一条 IN
count = 0
const ids = run('SELECT id FROM users').map((u) => u.id)
const marks = ids.map(() => '?').join(', ')
run(`SELECT * FROM orders WHERE user_id IN (${marks})`, ...ids)
console.log('一次 IN：', count) // 2
```

两行输出 101 与 2。想看每条都走了哪条索引，给 orders 的 user_id 建个索引再跑 EXPLAIN QUERY PLAN——第 6 章的读法原样适用。

## 小结

N+1 的病因是循环里逐条查关联：主查询 1 条加关联 N 条，N 是行数不是常数；单条都无辜，慢在条数乘以每条往返。两种药方：JOIN 策略一条语句拿全，代价是行被拍平、用户列复读、ORM 还得重新分组；两跳策略先查主表再用一条 IN 批量捞关联，对象形状不破、天然吃外键列索引——SQLite 不替外键自动建目录，记得自己建。本课程选两跳。实现四步：hasMany/belongsTo 声明记进 Table 上的注册表，四道校验顺带把列名表名白名单化；with 只记账，all()/get() 分岔执行；第二跳亲手拼 IN——占位符按收集到的值个数生成，值全走参数，NULL 跳过、按出现序去重；关联行过第 11 章的水合门，按 to 值分桶挂载，hasMany 挂数组、belongsTo 挂单对象或 null。条数恒为 1 加关联数，无 with 零开销。简化如实记账：第二跳不额外排序、嵌套关联（订单再挂商品）不做、关联属性类型层是 unknown——都在差异清单里。往上走：第 13 章的事务把多条语句捆成一个整体，两跳之间的一致读、写操作的成败捆绑，都归它管。

你现在能做到：给两张表声明 hasMany/belongsTo，用 with 一次批量加载，讲清 101 条怎么来、为什么 2 条就够，以及占位符个数为什么必须拼、值为什么一个不拼。

读完本章你该能回答：

- 页面大小从 100 涨到 1000，N+1 的语句数怎么变？加索引能救吗？
- JOIN 与两跳各自拿回什么形状的结果？用户列 10 列、每人 3 笔订单时，两条路各传多少个值？
- IN 的占位符为什么不能写死一个 ？个数从哪来，值走哪条通道？
- bob 一笔订单都没有，with 之后他的 orders 是什么？belongsTo 查不到对方时挂什么？
- with 不写的时候，普通 query 多发了什么？为什么旧章测试一个都不用改？
