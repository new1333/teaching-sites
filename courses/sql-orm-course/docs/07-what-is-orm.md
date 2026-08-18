---
title: ORM 是什么：一张分层地图与两大门派
---

# ORM 是什么：一张分层地图与两大门派

## 接手那天，SQL 突然不见了

周一接手一个后端仓库。业务眼熟：用户、文章、订单——前 6 章攒的 SQL 全够用。可翻遍 src，一条 SELECT 都找不到。满屏是 `prisma.user.findMany({ where: { role: 'admin' }, include: { posts: true } })`，隔壁模块又是另一套写法：`userRepository.find({ where: { isActive: true } })`。

你接到第一个需求：给管理员列表加「最近 30 天登录」的筛选。盯着那行查询看了十分钟，三个问号没一个答得上：它对应哪条 SELECT？`include: { posts: true }` 背后发了几条语句？日期条件该加在哪？最后只能复制粘贴一段旁边长得像的调用，改两个词，跑一遍看结果——对了不知道为什么对，错了不知道错在哪，只能再换一段复制粘贴接着试。

前 6 章的手艺突然失明：数据库明明还在，你却看不见它了。

问题不在你，在隔层。这些库统称 ORM（object-relational mapping，对象关系映射）——一层自动翻译器：这边写对象与方法调用，那边生成 SQL 发给数据库，再把行装回对象。它隔在你与 SQL 之间；不懂它的规则，就两边都看不清。这一章立一张地图，任何 ORM 库都放得上去：它为什么存在、翻译什么、内部分几层、分哪两派。然后把五个常见名字对号入座，最后预告 Part 3——我们要亲手造一个 mini-ORM，把这层翻译器拆开看。

本章是原理章：不写新测试、不动实验场。实验是纸笔翻译加一个二十来行的小脚本，每条结论都轮得到你亲手验证。

## ORM 为什么存在：手写 SQL 的两笔旧账

「为什么要多一层翻译」不是玄学，是两笔你已经亲手付过的账。

**第一笔：同一份数据结构，两处维护。** 第 1 章你写过 users 的建表语句（id、name、email、age 四列，`CREATE TABLE users (id INTEGER PRIMARY KEY, …, email TEXT NOT NULL)`）。同一个仓库里，大概率还躺着一个 TS 接口：

```ts
// 用法示例：手写时代的双份真相
interface User {
  id: number
  email: string
}
const users = db.all<User>('SELECT id, email FROM users')
```

表要加一列 nickname，你得改建表语句（DDL——描述表结构的那类 SQL，第 9 章细讲）、改接口，还得记得改 SELECT 的列清单。三处有一处忘了，两边就漂移。更细的裂缝在类型上：`db.all` 的泛型 `User` 只是你口头担保，数据库不认识它。哪天有人改了列名，tsc 一声不吭，运行到查询那一刻才炸。

**第二笔：SQL 是字符串。** 列名拼成 `emial`，编辑器不报错，tsc 也不报错，语句送到数据库才回一句 no such column: emial。更麻烦的是条件本身是运行时的数据：筛选项传没传、要不要拼进 WHERE，只能靠字符串拼接加三元表达式。括号少了、AND 连错了，都是运行时才现形的 bug。字符串没有类型，类型检查器帮不上忙——这就是第二笔账的病根。

两笔账合一句：TS 世界和 SQL 世界各有一套词汇，你在中间当人肉翻译，还没有校对。

### 翻译什么：两个世界的词汇表

ORM 的全名把答案写在脸上：object 与 relational model 的映射——对象（object）这边是接口、实例、字段；关系模型（relational model）那边是表、行、列。「映射」就是一张对照表：

| 对象世界 | 关系模型世界 | 哪一章立的 |
| --- | --- | --- |
| interface / class | 表 | 第 1 章 |
| 一个对象 | 一行 | 第 1 章 |
| 一个字段 | 一列 | 第 1 章 |
| 对象里的 id 字段 | 主键 | 第 3 章 |
| 对象里的 userId 字段 | 外键 | 第 3 章 |
| 「邮箱不许重复」的愿望 | UNIQUE 约束 | 第 3 章 |
| user.posts 数组 | 另一张表的多行（JOIN 查回） | 第 5 章 |

翻译是双向的。下行：方法调用变 SQL——`findMany({ where: ... })` 变一条 SELECT。上行：行变对象——查回的裸行装上类型、挂上关联，成为你能点出来的东西。

### 演算：纸笔翻一条查询

拿开章那行开刀，先翻 where 半边：

```text
prisma.user.findMany({ where: { role: 'admin' } })
        ↓ 翻译
SELECT id, email, name FROM users WHERE role = 'admin'
```

三处信息各有来源。表名来自 schema（那份「表有哪些列」的对齐清单，本章后面细说）里的 `model User`——具体长什么样，开日志见真章，各家默认并不相同；列清单来自 schema 里声明的字段——生成查询的代码手里握着全份字段名单，不必写星号；WHERE 子句来自 where 对象，一个键值对一个条件。你在第 2 章手写的 WHERE，在这里变成了一个 JS 对象。

### 锚点

编译器：你写 TS，它出机器码，两套词汇不同、语义对得上。ORM 之于对象与 SQL，就是编译器之于源码与机器码——**SQL 与对象两个世界之间，隔着一层翻译器**。这句话是本章的基准比喻，后面反复用它。

## 分层地图：三层各司其职

「ORM」这个词日常用得很宽：有人拿它指整个库，有人拿它指一层薄封装。看清它的最好办法，是把你的代码到数据库之间切成三层。多数真实库，都是三层厚薄不同地叠出来的：

```text
你的代码   prisma.user.findMany({ where: { role: 'admin' } })   ← 只想跟对象打交道
   ↓
上 · ORM（对象映射）    行装成实例（水合）· 记谁改过（脏跟踪）· 补关联 · 事务（把要发的一串语句捆成一个整体）
   ↓ 对象侧的活儿要先变成 SQL
中 · 查询构建器         where / orderBy / limit 链式攒条件，toSQL() 一步编译出
                       SQL 字符串 + 参数数组
   ↓ SQL 与参数交给
下 · 驱动（driver）     建连接 · 把语句和参数发给数据库进程 · 把行收回来
   ↓
数据库（独立进程）      解析 SQL · 查表 · 还回行
```

三层各司其职：上层管对象侧的语义，中层管 SQL 怎么拼，下层管怎么跟数据库进程说话。从下往上讲，因为越靠下你越眼熟。

### 下：驱动（driver）

驱动（driver）——专职跟数据库进程通信的那段代码。成因第 1 章就立过：数据库是独立进程，你的 Node 进程跟它说话要走专门的协议——参数怎么编码、行怎么传回，都得有人管，这层活就是驱动的。它的接口窄得很：吃进 SQL 字符串和参数数组，吐出行数组。

你早就用过它。实验场的 `src/db.ts` 包着 Node 内置 node:sqlite 的 `DatabaseSync`——那就是随 Node 官方内置的 SQLite 驱动，零第三方依赖；第 1 章你写的薄封装，放在地图上正属这一层。

锚点：fetch。你调 fetch() 从不自己拼 HTTP 报文——驱动之于 SQL，就是 fetch 之于 HTTP。

### 中：查询构建器（概念层）

查询构建器（query builder，本章讲它的概念层，动手造是 Part 3 的事）——用链式调用攒条件、最后一步才编译成 SQL 的库。

成因直接接第二笔账：条件是运行时的数据，字符串是写死的。构建器把每个 SQL 片段换成函数调用，调一次、往内部清单记一笔，到 toSQL() 那一刻才统一编译。参数也从一开始就和 SQL 分了家：值永远走 `?` 占位符的通道。这个分家还顺手挡住一类攻击，下一章细说。

载体是一张不断生长的内部清单。纸笔跟着调一遍（演算）：

```text
query('users')
  .where('role', 'admin')  →  wheres: ['role = ?']              params: ['admin']
  .where('city', '杭州')    →  wheres: ['role = ?', 'city = ?']  params: ['admin', '杭州']
  .limit(10)               →  limit: 10
  .toSQL()                 →  { sql: 'SELECT * FROM users WHERE role = ? AND city = ? LIMIT 10',
                                params: ['admin', '杭州'] }
```

每一步只是记账，没有一行真的碰数据库——直到编译那一刻。你前 6 章的手艺在这层各有一个座位：WHERE 对 `where`，排序（ORDER BY）对 `orderBy`，分页（LIMIT/OFFSET）对 `limit`/`offset`，分组（GROUP BY）对 `groupBy`，聚合函数对 `count`/`sum`。学过 SQL 再看构建器，就是查字典。

锚点：数组的 `filter().sort().slice()` 链——一步接一步、各管一段的手感一模一样；区别是数组链每步立刻执行，构建器把执行攒到最后一步。

### 上：对象映射

上层接手的是「行变成对象之后」的事。成因同样具体：裸行没有方法。`db.all()` 回来的普通对象不会 save，也没有 user.posts。要有这些，得有人干三件活：把行装成类实例——行是死数据，装上方法才是活对象，这个动作叫水合；实例改了哪些字段得记着，save 时只写改过的列——脏跟踪；关联字段得另发查询补上——关联加载。三个名词本章都只挂名，它们是 Part 3 后半程的主角。

还有半本词典也归上层管：表结构本身。一切映射都靠「这张表有哪些列、对象有哪些字段」的对齐活着，这份对齐清单叫 schema——Part 3 开头第一章就造它。

## 两大门派：save 放在谁身上

同一个问题，两种答案。问题：改了 `user.email`，谁来发 UPDATE？

### Active Record：对象自己管自己

Active Record（活动记录）——数据对象自带存取能力的一派：行装进实例，实例身上就有 save() 和 remove()，字段一改、save() 一调，SQL 当场发出。

```ts
// 用法示例：Active Record 风格，形态取自 TypeORM 官方文档（实体继承 BaseEntity）
const user = await User.findOneBy({ id: 1 })
user.isActive = false
await user.save()    // 发出 UPDATE users SET is_active = ? WHERE id = ?
await user.remove()  // 发出 DELETE FROM users WHERE id = ?
```

演算就是读代码：改字段、调 save，UPDATE 从对象自己身上发出去。锚点：像组件自带状态、又能自己把状态存走——AR 实例是自带存档功能的对象。

### Data Mapper：数据和存取分家

Data Mapper（数据映射器）——另一派：实体只是装数据的壳，读写交给独立的映射器，通常叫 Repository（仓库）。TypeORM 文档形容这种实体 very dumb——笨得只剩字段。

成因是规模。项目一大，「对象长什么样」跟着页面需求变，「怎么存取」跟着表结构变——两件事变化的原因不同，挤在一个类里就互相拖累。拆开：实体归实体，仓库归仓库。

```ts
// 用法示例：Data Mapper 风格，形态取自 TypeORM 官方文档（查询走 repository）
const repo = dataSource.getRepository(User)
const user = await repo.findOneBy({ id: 1 })
user.isActive = false
await repo.save(user)  // UPDATE 由仓库发出；User 实例自己没有任何存取方法
```

锚点：纯展示组件加 store——组件只管渲染，状态存取归 store；实体只管装数据，存取归 mapper，各管各的。

### 怎么选

TypeORM 官方文档对这个问题的答复值得原样转述：两种都支持，选择在你；AR 帮你保持简单，适合小应用；DM 帮你保持可维护，大项目更划算。门派不是宗教，是「save 放哪」的工程取舍——同一个库里甚至可以共存，TypeORM 就是两边都教。

## 生态巡礼：五个名字放回地图

选型前先认人。下表只讲各库公开文档里的定位与形态，一行都不引它们的源码：

| 库 | 自我定位 | schema 怎么定义 | 门派气质 |
| --- | --- | --- | --- |
| Sequelize | 老牌全功能 ORM | JS 对象 + DataTypes | AR 味浓：实例自带 save() |
| TypeORM | 装饰器实体 ORM | TS 装饰器 @Entity / @Column | 两派都支持 |
| Prisma | schema 文件 + 生成式客户端 | 独立 .prisma 文件，generate 出 client | DM 味：统一从 prisma.user 出发 |
| Drizzle | 轻量 TS ORM，API 贴 SQL | TS 对象直接定义表 | 介于其间：上层薄，重心在中层 |
| knex | SQL 查询构建器（官方自述 batteries included） | 无对象映射 schema（建表另有 knex.schema） | 无从谈起——没有对象层 |

四列各补几句。

knex 是最好的参照物。它的官方自我定位就是 SQL 查询构建器——地图上只占中层（自带连接管理，下层也沾一份），没有上层。查回来的就是裸行对象，没有 save，没有关联挂载。用它理解「中层」最纯粹：

```ts
// 用法示例：knex 链式查询，形态取自官方文档
const rows = await knex('users').where({ role: 'admin' }).select('id', 'email')
```

Prisma 把 schema 写在独立的 prisma/schema.prisma 文件里。这门文件语言是 DSL（domain-specific language，为特定领域设计的小语言）。写好后 `prisma generate` 生成带类型的客户端：

```prisma
// 用法示例：Prisma 的 schema 定义，形态取自官方文档
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}
```

```ts
// 用法示例：Prisma 客户端查询，形态取自官方文档
const admins = await prisma.user.findMany({
  where: { role: 'admin' },
  include: { posts: true }, // 把关联的 posts 一起带回来
})
```

TypeORM 用 TS 装饰器把映射写在实体类上，类定义即表定义：

```ts
// 用法示例：TypeORM 实体，形态取自官方文档
@Entity()
class User {
  @PrimaryGeneratedColumn() id: number
  @Column() email: string
}
```

Drizzle 最 SQL 味：表用 TS 对象定义，查询几乎就是把 SQL 的语序抄成函数调用：

```ts
// 用法示例：Drizzle 的表定义与查询，形态取自官方文档
const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  email: text('email').notNull(),
})
const rows = db.select().from(users).where(eq(users.email, 'a@b.c'))
```

Sequelize 资历最老，模型用 JS 对象加 DataTypes 定义，实例天生带保存能力：

```ts
// 用法示例：Sequelize 模型与保存，形态取自官方文档
const User = sequelize.define('User', { email: DataTypes.STRING })
const u = await User.findOne({ where: { id: 1 } })
u.email = 'new@example.com'
await u.save()
```

## 你仍然要看得懂它生成的 SQL

回到开章的第三个问号：`include: { posts: true }` 背后发了几条语句？诚实的答案：不开日志就不确定。文档承诺的是「把每个用户的 posts 带回来」这个结果，没承诺 SQL 长什么样——可能是一条 JOIN，也可能先查 users、再按外键那列去 posts 里捞一批。手写时代你有直觉，生成的语句要靠看。

看的方法各库都有公开开关。Prisma 客户端构造时传 `log: ['query']`；TypeORM 在连接选项里开 logging；knex 和 Drizzle 的查询都有 toSQL()——把生成的 SQL 与参数当场打出来。打印出来的东西，正是你第 1～6 章天天写的那种 SQL。

然后是本章真正的警惕句：ORM 生成的 SQL，你仍然要看得懂。它生成的也是 SQL——第 6 章的 EXPLAIN QUERY PLAN 原样适用：生成的查询没索引可用，照样 SCAN；查询计划照样一行一行读。**ORM 替你写 SQL，不替你判断 SQL 好不好**。无索引的 WHERE 它照发不误；循环里逐条查关联，它也照发不误——后一种病症叫 N+1，第 12 章专门拆。写得对和写得快是两道门，ORM 只守第一道。

## 亲手做实验

原理章不写新测试、不动实验场。本章实验两样：纸笔翻译，加一个二十来行的小脚本。先跑脚本——中层的最小活体，存成 try-builder.mjs：

```js
// 用法示例：中层的最小玩具——链式调用攒条件，toSQL() 一步编译；存成 try-builder.mjs
const query = (table) => ({
  wheres: [],
  params: [],
  limit_: 0,
  where(col, value) {
    this.wheres.push(`${col} = ?`)
    this.params.push(value)
    return this
  },
  limit(n) {
    this.limit_ = n
    return this
  },
  toSQL() {
    let sql = `SELECT * FROM ${table}`
    if (this.wheres.length) sql += ' WHERE ' + this.wheres.join(' AND ')
    if (this.limit_) sql += ` LIMIT ${this.limit_}`
    return { sql, params: this.params }
  },
})

console.log(query('users').where('role', 'admin').where('city', '杭州').limit(10).toSQL())
```

## 见证翻译发生

跑 `node try-builder.mjs`，终端打出 sql 与 params 两样：

```text
{
  sql: 'SELECT * FROM users WHERE role = ? AND city = ? LIMIT 10',
  params: [ 'admin', '杭州' ]
}
```

先别跑，笔算一遍再对照：where 记两笔、limit 记一笔、toSQL 才连成一句。对上了，中层就懂了。三个加练：给玩具加一个 orderBy(col)，对应第 2 章的排序；把 where 的条件换成你的真实业务；再反向玩——随手写一条 SELECT，用玩具拼出它。正反两个方向都通，「翻译器」三个字就落了地。

纸笔实验接着做：把开章那行 findMany 完整翻成 SQL。where 半边本章翻过；include 半边，想想第 3 章的外键（posts 表里那列该叫什么？）和第 5 章的连接条件，写出你手写时会写的那条查询。写完自然冒出一个问题：Prisma 真是这么发的吗？答案在上一节——开日志看，别背结论。

## 小结

ORM 是对象与关系模型两个世界之间的翻译层：下行把方法调用译成 SQL，上行把行装回对象。它存在，是因为手写时代有两笔账——同一份数据结构两处维护；SQL 是字符串，拼错了运行时才炸。地图分三层：下层驱动连数据库、发行、收行；中层查询构建器链式攒条件、一步编译；上层管水合、脏跟踪、关联这些对象侧的活。门派两支：Active Record 让对象自己 save，Data Mapper 把存取交给 Repository。TypeORM 两派都教，小项目 AR 简单，大项目 DM 好维护。生态五个名字：knex 只有中层；Sequelize 与 TypeORM 三层通吃；Prisma 用 schema 文件生成客户端；Drizzle 贴着 SQL 长得轻。最要紧的一句：ORM 生成的 SQL 你仍然要看得懂——日志打得开，EXPLAIN QUERY PLAN 照样能用，N+1 与无索引查询它都不替你防。

你现在能做到：接到满屏 findMany 的仓库，先认出三层，再认出门派，然后用日志把任意一行调用翻回 SQL 对着看。

读完本章你该能回答：

- ORM 解决的是哪两笔手写 SQL 的旧账？各自的病根是什么？
- 地图三层各管什么？knex 缺的是哪层？
- Active Record 与 Data Mapper 对「谁来发 UPDATE」各怎么回答？怎么选？
- `include: { posts: true }` 背后发几条语句，怎么确认？
- 为什么说写得对和写得快是两道门？ORM 守的是哪道？

去向：手写 SQL 还剩最后一个顽疾——字符串拼接遇上用户输入会变成攻击，下一章拆 SQL 注入与参数化。Part 3 的造物路线，五章正好铺满地图；收官的第 14 章再拿这张地图对账——我们的 mini-ORM 与真实 ORM 差在哪：

| 章 | 造什么 | 对应地图哪层 |
| --- | --- | --- |
| 9 | schema 与 DDL 生成：用对象描述表 | 上层的半本词典 |
| 10 | 查询构建器：链式调用变 SQL | 中层 |
| 11 | 水合与脏跟踪：行变对象、只写改过的列 | 上层 |
| 12 | 关联加载与 N+1：批量补齐 user.posts | 上层 |
| 13 | 事务：多条语句捆绑成败 | 贯穿三层 |
