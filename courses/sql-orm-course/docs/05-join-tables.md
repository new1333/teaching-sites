---
title: 两张表缝成一张：JOIN
---

# 两张表缝成一张：JOIN

## 双重循环拼两个接口，页面卡死 4 秒

订单列表页要展示「每笔订单 + 下单用户的名字」。订单接口和用户接口各返回一个数组：订单一万个、用户八千个。你在组件里写了最直觉的匹配代码：

```js
// 用法示例：双重循环按 userId 匹配——你大概也写过这段
for (const order of orders) {
  for (const user of users) {
    if (order.userId === user.id) {
      rows.push({ ...order, userName: user.name })
    }
  }
}
```

一万乘八千，八千万次比较，页面卡死 4 秒。你换成先按 id 建一个 Map 再查，快是快了，评审也过了。三个月后另一个人接手这个组件，读不懂为什么先要遍历一遍 users，删掉「多余」的预处理，改回了双重循环——卡死复发。这不是手气问题：匹配的意图（按 userId 配对）埋在循环的机械动作里，看代码的人无从知道哪一层是承重的。

病根和第 1 章那次 reduce 是同一个：数据躺在数据库里，你把它搬到浏览器再开手工作坊。匹配这件事，数据库有一等公民的写法——JOIN。第 3 章还立过一条伏笔：用户归 users 表、订单归 orders 表，外键把两边连起来。分表是为了不复制数据——订单里不抄用户名，用户改名就不用改一万行订单；可展示时终究要把两张表缝回一张。这一章就做这件事：JOIN 是什么、INNER 与 LEFT 差在哪、三张表怎么链着缝、条件写在 ON 还是 WHERE。

## JOIN：把「两数组按 id 匹配」搬进数据库

先立主角。JOIN（连接）——按连接条件把两张表的行配成对的 SQL 写法：左边每一行，去右边找条件成立的行，配上一对就输出一行。你手写的双重循环是它的直觉版，只是它在数据库里做，只把配好的行送过网线。

### 成因：分表存了，展示要合回来

第 3 章的答案已经写过：订单表里只存 user_id 这个外键，用户名留在 users 表。为什么不在订单里直接存用户名？因为那是数据的第二份拷贝——用户改名，一万行订单都得跟着改，漏一行就是脏数据。关系模型的分工是：每份数据住一张表（列的类型先讲好），表与表靠主键和外键互指；展示层要的「宽行」，查询时再缝。既然互指的原料数据库全都有，配对就没理由发生在数据库外面。至于它配对为什么快——users.id 是主键，主键背后有现成的目录，这个目录的故事留给讲索引的那一章。

### 载体：FROM、JOIN、ON 三个部件

```sql
SELECT u.name AS user_name, o.id AS order_id, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id;
```

三个部件各就各位：FROM users u 是左表；INNER JOIN orders o 写明右表和连接类型；ON u.id = o.user_id 是连接条件——什么算「配得上对」。连接条件几乎总是「外键 = 它指向的主键」：第 3 章 REFERENCES users(id) 指的那对列，ON 里原样写出。还有一个要点：JOIN 的结果仍是一张表——每行是配成的一对。所以 WHERE 筛选、ORDER BY 排序、LIMIT/OFFSET 分页、第 4 章的聚合函数与分组，在 JOIN 结果上照常叠加：先缝，再算。

### 演算：4 个用户对 4 笔订单，逐行配对

本章实验场的数据集，三张表全在这儿：

```text
// companion/tests/join-tables.test.ts · seed 灌入的三张表
users：1 Alice、2 Bob、3 Carol、4 Dave（Dave 没有任何订单）
products：1 键盘(300)、2 显示器(1200)、3 鼠标(90)，括号里是标价
orders：#1 Alice·键盘·300、#2 Bob·显示器·1200、#3 Bob·鼠标·90、#4 Carol·键盘·150（成交价）
```

照 ON u.id = o.user_id 配一遍：

```text
Alice(1) → 订单#1        一对一，出 1 行
Bob(2)   → 订单#2、#3     一对多，出 2 行（Bob 出现两次）
Carol(3) → 订单#4        出 1 行
Dave(4)  → 无            INNER：整行出局；LEFT：出 1 行，右表列补 NULL
```

INNER JOIN 出 4 行。两个容易被直觉带偏的点。其一，**JOIN 是配对，不是合并**：Bob 有两笔订单就在结果里出现两次，JOIN 结果的行数可以比任何一张表都多。其二，连接条件可以写别的比较，但「外键 = 主键」占了现实世界的九成九。这一段的机械证明在实验场：同一条 INNER JOIN 的结果，与手写双重循环拼出的行一行不差（实验场一节贴这段测试）。

### 锚点

两个接口各回一个数组、按 userId 匹配成一条——JOIN 就是这个匹配本身，只是发生在数据躺着的地方，还顺手定义好了配不上的行怎么处置。处置规则就是下一节。

## INNER 与 LEFT 的语义差：配不上的行怎么处置

INNER 与 LEFT 的语义差一句话说尽：配不上的行，INNER 把它丢掉，LEFT 把它保住、右边的列补 NULL。三条对着上面的行集逐条演算：

- INNER JOIN：只留两边都有的行。Dave 在右表配不上对，他那一行整个不出现在结果——丢的就是这些行。回看第 3 章的一个坑：外键开关关着时，订单里能插进孤儿行（user_id 指向不存在的用户）。用 INNER JOIN 缝表时，孤儿行同样配不上对、同样悄悄消失——报表行数莫名变少，常常不是 bug，是 JOIN 在替你筛。所以约束要开、缝表要数行，两件事一起做。
- LEFT JOIN：保左表全量。「LEFT」保的是写在 FROM 里的那张左表——users LEFT JOIN orders 保用户；写反成 orders LEFT JOIN users，保的就是订单。Dave 的行不丢，只是右边没有值可填：数据库在这一行的 orders 列上全部补 NULL。NULL 从哪来？不是任何一张表里存着的 NULL。它表达的是「配不上」这件事本身。实验场把 Dave 那一行的形状断言了下来：order_id、product_id、amount 三列全是 null。
- 行数关系：同一数据集、同一条件，LEFT JOIN 的行数 ≥ INNER JOIN，差额恰是无订单的用户数（这里 5 - 4 = 1，就是 Dave）。这个不等式是本章 milestone 的断言，也是你日后查数的口诀。

顺带一个写法事实：全称是 LEFT OUTER JOIN，OUTER 三个字母可写可不写。SQLite、MySQL、PostgreSQL 三家文档的语法里都标成可省略，日常写 LEFT JOIN 就够。

## 表别名与列名前缀：u 和 o 是谁

上面的查询里 users 写成了 u、orders 写成了 o——这就是表别名，写在 FROM 里给表起的短名：FROM users u（中间的 AS 可写可不写，表别名的习惯是省掉）。它管两件事。

其一，短。连接条件写 u.id = o.user_id，不必写 users.id = orders.user_id。三表链式时这个差别还要放大。

其二，消歧。users 和 products 都有 name 列。JOIN 之后结果这张「缝出来的表」里，光写 name 指谁？数据库不猜，直接报错：ambiguous column name（列名有歧义）。实验场有一条守护断言专门守这个报错。规矩一句话：**JOIN 查询里所有列都带表名前缀**——u.name、o.amount、p.price；输出名再交给第 4 章的老朋友 AS：SELECT u.name AS user_name。

## 三表链式 JOIN：缝好再缝

JOIN 的结果仍是一张表，于是可以继续 JOIN。orders 里还存着 product_id，指向 products 的主键——再缝一次，一行同时拿到「谁、买了什么、标价、成交价」：

```sql
SELECT u.name AS user_name, p.name AS product_name,
       p.price, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id
INNER JOIN products p ON o.product_id = p.id;
```

演算：4 笔订单出 4 行。Carol 那行标价 300、成交 150 并排出现——这正是分表的红利：键盘调价，不影响历史订单的成交价。链式还有个计件规律：每缝一表，行数要么不变（一对一），要么乘出多行（一对多）；也可能因为配不上而整行被丢——就是上一节 INNER 的处置规则。这里 4 用户缝出 4 行，其实是「丢了 Dave 一行、Bob 重复一行」相抵的巧合，不是天然相等。

链式 LEFT 换成保左表：users LEFT JOIN orders o ... LEFT JOIN products p ON o.product_id = p.id。Dave 在第一段就配不上，o 的列全是 NULL；第二段的连接条件里 o.product_id 是 NULL，而 NULL 与任何值比较都得未知（第 2 章的三值逻辑），第二段也配不上——Dave 的行一路保住，p 的列也全 NULL。全表 5 行，恰是订单数加一。实验场断言的正是这两个形状。

## ON 与 WHERE 的分工：LEFT JOIN 下不是一回事

规则一句话：**连接条件写 ON，筛选条件写 WHERE**——ON 参与配对，WHERE 筛的是拼好之后的行。INNER JOIN 下这一差无关紧要：条件写在 ON 还是 WHERE，结果一样。LEFT JOIN 下天差地别，值得一次演算。数据还是那 4 笔，条件取「成交价 ≥ 300」：

- 写进 ON：`LEFT JOIN orders o ON u.id = o.user_id AND o.amount >= 300`。条件参与配对：Alice 的 300、Bob 的 1200 配得上；Bob 的 90 不许配，但 Bob 另有大单可配，Bob 只出大单那行；Carol 唯一的 150 配不上，人还在，订单列换 NULL；Dave 本来就无单。结果 4 行：Alice(300)、Bob(1200)、Carol(NULL)、Dave(NULL)。
- 同一条件写进 WHERE：ON 只管配对，先老老实实拼出 5 行，WHERE 再逐行筛 o.amount >= 300——NULL ≥ 300 是未知（第 2 章），Dave 的补 NULL 行出局；90 与 150 两行也出局。结果 2 行，Carol 和 Dave 整行消失。

后一种写法有个要紧后果：对右表列的 WHERE 筛选，会把 LEFT JOIN 打回 INNER JOIN 的效果——保左表的承诺，被 WHERE 一票否决。选型口诀：要保左表全量、只摘掉右表不达标的关系，条件写 ON；若本意就是「两边都得达标」，直接写 INNER JOIN，语义更诚实。

## 方言：老式逗号写法与标准写法

JOIN ... ON 这套显式写法，是 SQL-92（1992 年定稿的那版 SQL 国际标准）定下的一统拼法。更老的代码里会见到逗号写法：

```sql
SELECT u.name, o.amount
FROM users, orders
WHERE users.id = orders.user_id;
```

PostgreSQL 手册写明：FROM a, b 等价于 CROSS JOIN——无条件连接，左表每行硬配右表每一行；匹配条件放进 WHERE，才等价于内连接。MySQL 手册同样把逗号写法列为内连接的等价形式。它有两个坑。其一，连接条件与筛选条件混在同一个 WHERE 里，读的人分不清哪句是「配对」、哪句是「过滤」——本章 ON 与 WHERE 的分工，老写法在语法上就没给你分开。其二，忘写 users.id = orders.user_id 这一句，得到的就是叉积（笛卡尔积——上面那句 CROSS JOIN 的学名）：4 × 4 = 16 行；放到开章那组数据上，一万乘八千就是八千万行——逗号写法忘条件，等于让数据库替你跑开章那个双重循环，连建 Map 索引的机会都不给你。外连接在老写法年代更是各说方言：Oracle 的 (+)、SQL Server 旧版的 *=，两家官方文档如今都把这类拼法标为不推荐或已移除。新代码一律 JOIN ... ON；老代码见着能认出即可。

## 亲手搭实验场

本章照旧不动 src——第 1 章的 db.ts 四方法足够，SQL 语法章的演进全在测试里。数据集三张表，外键都按第 3 章的规矩声明。

```ts
// tests/join-tables.test.ts —— 第 5 章（节选：数据集，seed 内的建表语句）
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      amount INTEGER NOT NULL
    );
  `)
```

4 位用户、3 种商品的插入与第 3 章同款，值得单看的是 4 笔订单——amount 故意让 Carol 以 150 成交，ON 与 WHERE 的演算全靠它：

```ts
// tests/join-tables.test.ts —— 第 5 章（节选：4 笔订单，seed 末段）
  // 成交价 amount 可以不等于标价：Carol 的键盘 150 成交——ON 与 WHERE 的分工演算靠这 4 笔可手数
  const orders: [number, number, number][] = [
    [1, 1, 300],
    [2, 2, 1200],
    [2, 3, 90],
    [3, 1, 150],
  ]
  for (const [user_id, product_id, amount] of orders) {
    db.run('INSERT INTO orders (user_id, product_id, amount) VALUES (?, ?, ?)', user_id, product_id, amount)
  }
```

然后是本章最有教学价值的一次见红。milestone 断言先按双重循环直觉写：JOIN 就是匹配，匹配只出配上的行，那么 LEFT JOIN 和 INNER JOIN 的行数理应相等——`expect(left.length).toBe(inner.length)`。跑 `npx vitest run`，红了：expected 5 to be 4。LEFT JOIN 多出一行，多的正是没有任何订单的 Dave。直觉错在哪？LEFT 的承诺是保左表全量：配不上的行不丢，换 NULL。修正断言为「LEFT ≥ INNER，差额 = 无订单的用户数」，转绿。

```ts
// tests/join-tables.test.ts —— 第 5 章（节选：行数差额断言，转绿后的形态）
  it('同一数据集：LEFT JOIN 行数 ≥ INNER JOIN 行数，差额正是无订单的用户数', () => {
    const db = createDb()
    seed(db)
    const inner = db.all('SELECT u.id FROM users u INNER JOIN orders o ON u.id = o.user_id')
    const left = db.all('SELECT u.id FROM users u LEFT JOIN orders o ON u.id = o.user_id')
    // 双重循环直觉版曾断言两数相等，实跑 5 对 4 见红：LEFT 保左表全量，Dave 多出一行
    expect(left.length).toBeGreaterThanOrEqual(inner.length)
    const orderUsers = new Set(db.all<Order>('SELECT user_id FROM orders').map((r) => r.user_id))
    const userless = db.all<User>('SELECT id FROM users').filter((u) => !orderUsers.has(u.id))
    expect(left.length - inner.length).toBe(userless.length)
  })
```

双重循环与 JOIN 的逐行对表，是「JOIN 就是那个匹配」的机械证明——SQL 的结果与手写循环拼出的行一行不差：

```ts
// tests/join-tables.test.ts —— 第 5 章（节选：与手写双重循环对表）
    const bySql = db.all<{ user_id: number; user_name: string; order_id: number }>(
      `SELECT u.id AS user_id, u.name AS user_name, o.id AS order_id
       FROM users u
       INNER JOIN orders o ON u.id = o.user_id
       ORDER BY u.id, o.id`
    )
    // 双重循环直觉版：外层订单、内层用户，user_id 对上号就拼一行——JOIN 在数据库里干的就是这个匹配
    const users = db.all<User>('SELECT id, name FROM users')
    const orders = db.all<Order>('SELECT id, user_id FROM orders')
    const byLoop: { user_id: number; user_name: string; order_id: number }[] = []
    for (const o of orders) {
      for (const u of users) {
        if (u.id === o.user_id) {
          byLoop.push({ user_id: u.id, user_name: u.name, order_id: o.id })
        }
      }
    }
    byLoop.sort((a, b) => a.user_id - b.user_id || a.order_id - b.order_id)
    expect(bySql).toEqual(byLoop)
```

同一文件里还有七条断言：INNER 只留两边都有的行（Dave 出局、Bob 出现两次）；Dave 那行右表三列全 null 的形状；u./p. 前缀加 AS 的三表链式查询（Carol 标价 300 成交 150 就断在那里）；裸写 name 报 ambiguous column name 的守护；链式 LEFT 的 5 行与 Dave 两段全 NULL；ON 版与 WHERE 版各一条，把上面那次演算钉死。

## 见证它变绿

老规矩，两道门槛，在 companion 目录下跑：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 41 passed (41)——前四章 32 条旧断言原样全绿（兼容哨兵），加上本章 9 条。ExperimentalWarning 照旧，不影响结果。

不进实验场也能亲手验证本章的一切。存成 try.mjs，跑 node try.mjs：

```js
// 用法示例：INNER、LEFT、链式、ON 与 WHERE 一次跑通，存成 try.mjs，node try.mjs 就能跑
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
db.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)')
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, product_id INTEGER, amount INTEGER)')
for (const name of ['Alice', 'Bob', 'Carol', 'Dave']) db.prepare('INSERT INTO users (name) VALUES (?)').run(name)
for (const [name, price] of [['键盘', 300], ['显示器', 1200], ['鼠标', 90]]) {
  db.prepare('INSERT INTO products (name, price) VALUES (?, ?)').run(name, price)
}
for (const [uid, pid, amount] of [[1, 1, 300], [2, 2, 1200], [2, 3, 90], [3, 1, 150]]) {
  db.prepare('INSERT INTO orders (user_id, product_id, amount) VALUES (?, ?, ?)').run(uid, pid, amount)
}
// 1) INNER：只留配上的 4 对——Dave 不在，Bob 两笔订单出现两次
const inner = db.prepare(`SELECT u.name AS name, o.id AS oid FROM users u
  INNER JOIN orders o ON u.id = o.user_id ORDER BY u.id, o.id`).all()
console.log(inner.map((r) => [r.name, r.oid]))    // [ ['Alice',1], ['Bob',2], ['Bob',3], ['Carol',4] ]
// 2) LEFT：5 行 = INNER 的 4 行 + Dave 一行；Dave 的订单列是 null
const left = db.prepare(`SELECT u.name AS name, o.id AS oid FROM users u
  LEFT JOIN orders o ON u.id = o.user_id ORDER BY u.id, o.id`).all()
console.log(left.length, left.at(-1))             // 5 { name: 'Dave', oid: null }
// 3) 链式：一行同时出用户名与商品名——Carol 标价 300、成交 150 并排
const chain = db.prepare(`SELECT u.name AS user_name, p.name AS product_name, p.price, o.amount
  FROM users u INNER JOIN orders o ON u.id = o.user_id
  INNER JOIN products p ON o.product_id = p.id ORDER BY o.id`).all()
console.log(chain.map((r) => [r.user_name, r.product_name, r.price, r.amount]))
// 4) 同一个 amount >= 300：写 ON 是 4 行（Carol、Dave 换成 null），写 WHERE 是 2 行
const onSide = db.prepare(`SELECT u.name AS name, o.id AS oid FROM users u
  LEFT JOIN orders o ON u.id = o.user_id AND o.amount >= 300 ORDER BY u.id, o.id`).all()
const whereSide = db.prepare(`SELECT u.name AS name, o.id AS oid FROM users u
  LEFT JOIN orders o ON u.id = o.user_id WHERE o.amount >= 300 ORDER BY u.id, o.id`).all()
console.log(onSide.map((r) => [r.name, r.oid]))     // [ ['Alice',1], ['Bob',2], ['Carol',null], ['Dave',null] ]
console.log(whereSide.map((r) => [r.name, r.oid]))  // [ ['Alice',1], ['Bob',2] ]
```

终端依次打出 4 对配好的行、5 和 Dave 的 null 行、四条「谁买了什么」、ON 版的 4 行与 WHERE 版的 2 行。把其中任何一句 SQL 换成上文别的写法，结论同法可验。

## 小结

JOIN 的语义是按连接条件配对：左表每行去右表找得上号的，配一对出一行；一对多时左行重复出现——JOIN 是配对，不是合并。INNER 与 LEFT 的语义差一句话：配不上的行，INNER 丢掉，LEFT 保住左表全量、右表列补 NULL。NULL 从「配不上」来，不从任何一张表来；LEFT 行数 ≥ INNER 行数，差额是无订单的左行数。表别名是 FROM 里的短名；JOIN 查询里所有列都带 u./o. 前缀，配 AS 起输出名，重名列直接报 ambiguous column name。三表链式 JOIN 就是缝好再缝，链式 LEFT 时 NULL 会沿链传到下一段的 ON。ON 参与配对，WHERE 筛拼好之后的行——LEFT JOIN 下对右表的 WHERE 筛选会把 LEFT 打回 INNER。方言一条：逗号写法等价内连接，但混了两类条件、忘条件即叉积；SQL-92 的 JOIN ... ON 是标准拼法。代码上本章只新增 tests/join-tables.test.ts，src 一行未动。

你现在能做到：把开章那组一万乘八千的双重循环改写成一句 INNER JOIN；在纸上对 4 × 4 的小数据集推出 INNER 与 LEFT 各出哪些行、NULL 补在哪；解释同一条件写 ON 与写 WHERE 时 4 行对 2 行的差别。

去向：JOIN 的配对为什么快、目录（索引）长什么样——第 6 章拆；ORM 怎么把这层翻译包起来——第 7 章给地图；关联加载该用 JOIN 还是两次批量查询——第 12 章的正题。RIGHT JOIN 与 FULL JOIN 本章不展开：它们与 LEFT 对称——RIGHT 保右表，FULL 两边都保。SQLite 自 3.39 版起也已支持，Node 内置的版本高于它，思路照搬、换个方向即可。

读完本章你该能回答：

- INNER JOIN 会丢掉哪些行？没有订单的用户是怎么从结果里消失的？
- LEFT JOIN 结果里的 NULL 是哪来的？它是某张表里存着的值吗？
- users LEFT JOIN orders 与 orders LEFT JOIN users，保的各是谁？
- 对右表的筛选条件写 ON 和写 WHERE，在 LEFT JOIN 下结果差在哪？
- 两张表都有 name 列时直接写 name 会怎样？老式逗号写法忘写匹配条件又会怎样？
