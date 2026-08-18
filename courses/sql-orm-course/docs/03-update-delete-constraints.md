---
title: 改数据不翻车：UPDATE、DELETE 与约束
---

# 改数据不翻车：UPDATE、DELETE 与约束

## 一句 UPDATE，12 万行

周五下午五点五十，客服来问能不能把一笔测试订单改成退款。同事在终端里敲下回车：

```sql
UPDATE orders SET status = 'refunded';
```

屏幕安静地吐出一个数字：120000。WHERE 忘了写，目标成了全表——12 万行订单在同一毫秒全部变成 refunded。数据库没有撤销键，DBA（数据库管理员，管数据库的人）从前一夜的备份往外抠当天的增量，抠到半夜三点。

同一个月还有第二起。有人清退测试账号，把 users 里的行删了，订单一行没动。月底报表一跑，一堆订单的 user_id 指向已经不存在的用户——这种指向落空的行，业内叫它孤儿（orphan）：有订单之身，无用户可指。报表按用户聚合，这些行全成了对不上账的悬案。

两起事故一个病根：**写操作没有守门员**。SELECT 写错了，顶多是查回错的数据、看错一眼；UPDATE 和 DELETE 写错了，动的是数据本身，而且说一不二。这一章做两件事：把第 2 章的 WHERE 带进写操作，学会读数据库递回的回执——changes 计数；再把「守门」从应用代码下沉到数据库层，认识三位守门员：主键（primary key）——一行的身份证号；外键（foreign key）——指向另一张表某行的指针；约束（constraint）——写在表定义里的规则。第 1 章还欠着两张字条：createDb() 里那句 PRAGMA foreign_keys = ON 是干什么的、id 的自动发号怎么发——本章一并兑现。

## UPDATE 与 DELETE：WHERE 换了个职责

第 2 章给 SELECT 装上了 WHERE、ORDER BY 与 LIMIT/OFFSET——筛选、排序、分页三件套。写操作的三件套是 UPDATE、DELETE 和 changes：

```sql
UPDATE users SET age = 30 WHERE id IN (2, 3);   -- 只动 id 为 2、3 的两行
UPDATE users SET age = 30;                      -- 省略 WHERE：全表都是目标
```

UPDATE 的三段：表名；SET 列 = 值，多列用逗号隔开，如 SET age = 30, name = 'Dave'；WHERE 条件。WHERE 的写法与第 2 章完全通用——比较、IN、LIKE、AND/OR，一个不换。变的是职责：SELECT 里 WHERE 决定「回给你哪些行」，UPDATE 与 DELETE 里 WHERE 决定「对哪些行动手」。第 2 章那句声明式的「只说要什么」，到这里变成「只对谁动手」。

要害在那个默认：WHERE 可以省，**省略不是「不改」，而是「全都改」**。JS 里没有哪个数组方法默认作用于全体，你必须显式写 forEach；SQL 的写操作相反——全表是默认，收窄要靠你亲手写 WHERE。12 万行事故，就是这一个默认的代价。动手前的老习惯：先把同一句条件交给 SELECT 数一遍——SELECT COUNT(*) FROM orders WHERE id = 42——数字对得上心意，再把 SELECT 换成 UPDATE。

DELETE 同构：

```sql
DELETE FROM orders WHERE user_id = 2;   -- 只删 Bob 的订单
DELETE FROM orders;                     -- 省略 WHERE：清空整张表
```

删的是行，表这个「房子」连同形状都还在；连房子一起拆的是 DROP TABLE，两回事，别混。

### changes：写操作递回的回执

第 1 章 run 的返回值 RunResult 里有个 changes——这条语句实际改动的行数。上面那句带 WHERE 的 UPDATE，changes 是 2；全表那句，在 3 行的表上是 3，在 12 万行的表上是 120000。它有三个用法。接口层向调用方报「影响 n 行」；防御上，changes = 0 常说明 WHERE 写歪了、没碰上任何行，值得停下来看一眼；教学上，它让「到底改了几行」变成可以断言的行为。INSERT 的 changes 恒为 1，另带 lastInsertRowid——新插入行拿到的号。号从哪来？往下看。

## 主键与自动发号：一行的永久地址

### 成因：行要一个不漂移的定位符

JS 里对象有引用身份：两个内容一样的对象并不相等，变量拿着的是「那一个」的引用。数据库的行是躺在表里的值，没有引用可拿。那「改某一行」靠什么指认？下标吗？不行：数组 splice 掉一个元素，后面的全体前移，昨天记着的 user_id = 3，今天就指到别人了。关系模型从第一天就配了解法：给每行发一个主键——全表唯一、不许为空的身份号。SQL 标准把主键规定成 UNIQUE 加 NOT NULL 的合体，一行一号、一号一行。第 2 章排序拿它当并列时的裁决者，本章 UPDATE 和 DELETE 拿它锁行，后面 JOIN 拿两边的键配对——它是全书出场率最高的一个词。

### 载体：INTEGER PRIMARY KEY 是 rowid 的别名

SQLite 官方文档写明：每张表背后都有一个隐藏的行号列 rowid（本课程用不到的 WITHOUT ROWID 表除外）；建表时某列若声明成 INTEGER PRIMARY KEY，这列就是 rowid 的别名——同一个数，两个名字。实验场的 users 表：

```text
表 users（id INTEGER PRIMARY KEY）—— id 与隐藏行号 rowid 是同一个数
┌────┬───────┬───────────────────┬─────┐
│ id │ name  │ email             │ age │
├────┼───────┼───────────────────┼─────┤
│ 1  │ Alice │ alice@example.com │ 18  │   ← rowid 1
│ 2  │ Bob   │ bob@example.com   │ 18  │   ← rowid 2
│ 3  │ Carol │ carol@example.com │ 18  │   ← rowid 3
└────┴───────┴───────────────────┴─────┘
```

INSERT 不写 id（或明确给 NULL）时，数据库替你发号。这就是自动递增（AUTOINCREMENT/rowid）——「自动递增」说的是这整套发号行为。rowid 是底下真正发号的那个行号列；AUTOINCREMENT 则是一个可选关键字，什么时候才需要它，马上见分晓。第 1 章说过发号规则是「拿现有最大号加一」。SQLite 官方文档的准确表述是：新行拿到的 rowid，比插入之前表里最大的 rowid 大 1。要咬文嚼字的是「表里」两个字——算的是当时还躺在表里的行。

### 演算：被删走的号，会再发出去

拿上面的表算三步。第一步，删掉 id = 3 那行，表里剩 1、2，最大号是 2。第二步，插一行不给 id——新号 = 2 + 1 = 3。第三步，查回来，新用户 Dave 拿着 3 号上岗。**Carol 的旧号，原样发给了下一任**。此刻任何存过「3 号是 Carol」的地方——日志、缓存、另一个服务里的外键——全部指错人。默认发号规则只保证「不撞车」，不保证「不复用」。

要保证不复用，就在 id 后面再加关键字：id INTEGER PRIMARY KEY AUTOINCREMENT。SQLite 官方文档对它的定位说得很克制：这个关键字的目的就是防止已删除行的 rowid 复用、让号只增不减。实现方式是额外维护一张 sqlite_sequence 内部表，记下这张表史上发到过的最大号，新号永远比它大。文档同时写明它带来额外的 CPU、内存与磁盘开销，结论是「通常不需要」——除非应用必须保证新发的号从未在本表用过（比如号本身要对外当凭证），否则应该留在默认行为。方言标注：MySQL 的同款拼法是 AUTO_INCREMENT；PostgreSQL 是 SERIAL，或 SQL 标准的 GENERATED ... AS IDENTITY。机制同类，关键字各异。

### 锚点

数组下标会随删除漂移；主键是永不漂移的下标，配了 AUTOINCREMENT 之后，还是永不复用的下标。这里跟第 1 章对个账：第 1 章说主键「全表唯一、永不复用」——那是身份证号应守的本分；SQLite 的默认发号只保证不撞车，不替你保证不复用，要兑现这四个字得亲手加上 AUTOINCREMENT。

## 外键：数据库替你验指针

### 成因：字段名约定不是执法者

前端关联两份数据的日常写法：orders.map(o => users.find(u => u.id === o.user_id))。它靠一个约定成立——user_id 里存的确实是某个用户的 id。可约定没有执法者：删用户的人不知道有订单指着它，写订单的人也不查用户还在不在，月底报表才发现指向落空。第二起事故就是这么进来的。解法只有一个方向：让数据库守在写入与删除的门口——所有语句都得过这道门，没有绕行的旁路。

### 载体：REFERENCES 子句

```sql
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  item TEXT NOT NULL,
  amount INTEGER NOT NULL
);
```

REFERENCES users(id) 声明：这一列的每个值，必须是 users 表 id 列里真实存在的号。被指向的 users.id 正是主键——外键指向的几乎永远是主键，「外」字说的就是「本表之外的键」。

### 演算：两种拦截

开关开着时（开关马上讲），两类语句当场抛错。其一，插孤儿：INSERT INTO orders (user_id, ...) VALUES (999, ...)——users 里没有 999，抛 FOREIGN KEY constraint failed，这行进不了表。其二，删还有订单指着的用户：DELETE FROM users WHERE id = 2——Bob 名下还有订单，同样抛错。想删 Bob，先安置他的订单：删掉，或者改挂到别的用户名下。数据库还能把外键配成「父行消失时自动处理子行」——ON DELETE 后面跟级联删除等动作，本课程不展开，动作清单在 SQLite 官方文档里一表俱全。

### 开与关：PRAGMA foreign_keys 的行为差

兑现第一张欠条。SQLite 官方文档写明：外键约束默认关闭——为了兼容这条机制诞生之前的存量数据库，这个默认一直没改；要用，就得每个连接手动执行 PRAGMA foreign_keys = ON。第 1 章 createDb() 里那句带注释的开关，说的就是它。开与关的差别是断崖式的：开着，上面两种拦截都会发生；关着，REFERENCES 子句形同虚设——孤儿插得进去，删用户畅通无阻。另两条官方事实顺带交代：开关只影响之后的语句，已经进表的孤儿不会倒查补删；在事务中途改这个开关不报错、但无效。本课程的测试都在事务外跑，事务的章法后面有专门的一章。方言标注：PostgreSQL 的外键建了就强制，没有这样的开关；MySQL 的默认存储引擎 InnoDB（管数据怎么存的那一层）同样强制。SQLite 是「要手动开」的例外，跨库迁移时这里最容易踩空。

### 锚点

对象里的 userId 是个指针；外键是指针加上一位验针员——指空的当场报错，而不是等到报表那天才对不上账。

## 约束：把校验写进表定义

### 成因：数据的入口有无数个

前端校验长这样：提交前 if (email.includes('@'))。它守在表单那一个入口。可同一张表的数据还从导入脚本、后台工具、同事手敲的 SQL 进来——每个入口都得记得写同一句校验，漏一处，脏数据入库。主键与外键其实是约束家族里管定位与管指向的两个大件；这一节补齐另外三个小件。它们共同的立意只有一条：**规则写进表定义，执法发生在写入那一刻，不分入口**。

### 载体：三个列级关键词

NOT NULL——这列必须有值；UNIQUE——这列的值全表不得重复；DEFAULT 18——插入不给这列时自动补 18。它们与类型写在同一条列定义里：email TEXT NOT NULL UNIQUE。一张表的「家规」至此凑齐五条：定位（主键）、指向（外键）、非空、唯一、默认。

### 演算：三条语句三种下场

对着 users 表（name TEXT NOT NULL、email TEXT NOT NULL UNIQUE、age INTEGER DEFAULT 18）各来一句。name 给 NULL：NOT NULL constraint failed: users.name，语句失败，一行都没进。email 用 Alice 已占的值：UNIQUE constraint failed: users.email，同样拦下。age 压根不写：安静进表，查回来 age 是 18——DEFAULT 是唯一「不拦反帮」的约束。注意报错时机：都发生在写入那一刻，整条语句作废，不存在半行进表。

### 锚点

像 TS 的类型检查：非法数据在进门那一步拦下，而不是运行到一半才炸。区别只有一件事——TS 拦的是代码，约束拦的是数据。

## 亲手搭实验场

本章 src 一行不动——db.ts 的四个方法加上那句外键开关，恰好承载本章全部，SQL 语法章的演进都在测试里。数据集两张表：

```ts
// tests/update-delete-constraints.test.ts —— 第 3 章：UPDATE、DELETE 与约束（节选：数据集）
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type User = { id: number; name: string; email: string; age: number | null }
type Order = { id: number; user_id: number; item: string; amount: number }

/** 3 位用户：邮箱各不相同、age 不给值走默认——主键/UNIQUE/NOT NULL/DEFAULT 断言全靠这组数据 */
function seedUsers(db: Db): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age INTEGER DEFAULT 18
    );
  `)
  const rows: [string, string][] = [
    ['Alice', 'alice@example.com'],
    ['Bob', 'bob@example.com'],
    ['Carol', 'carol@example.com'],
  ]
  for (const [name, email] of rows) {
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', name, email)
  }
}

/** 3 笔订单：两笔属于 Bob、一笔属于 Alice——外键与写操作断言靠这两张表的配合 */
function seedOrders(db: Db): void {
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      item TEXT NOT NULL,
      amount INTEGER NOT NULL
    );
  `)
  const rows: [number, string, number][] = [
    [1, '键盘', 300],
    [2, '显示器', 1200],
    [2, '鼠标', 90],
  ]
  for (const [user_id, item, amount] of rows) {
    db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', user_id, item, amount)
  }
}
```

然后是本章最有教学价值的一次见红。断言先立：外键开着时，插一笔 user_id = 999 的孤儿订单应当抛错。初稿的建表语句里，user_id 那列只写了 INTEGER NOT NULL——按直觉，外键检查既然是数据库的开关，开了就该拦。跑 `npx vitest run`，红了：期望抛错，实际那行安静地插了进去。病根正是本章的知识点：**开关只对声明过的外键执法**——PRAGMA 打开的是执法意愿，REFERENCES 才是法律条文本身；表定义里没写，开关开了也无从执法。给 user_id 补上 REFERENCES users(id)，再跑，绿。开关的两种状态，后来都进了正式断言：

```ts
// tests/update-delete-constraints.test.ts —— 第 3 章（节选：外键两态，转绿后的形态）
  it('外键开着（createDb 默认）：插孤儿订单、删有订单的用户，都被拦', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    expect(() =>
      db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', 999, '孤儿单', 1)
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() => db.run('DELETE FROM users WHERE id = ?', 2)).toThrow(
      /FOREIGN KEY constraint failed/
    )
  })

  it('PRAGMA foreign_keys = OFF：同样的孤儿订单能插进去，删用户也畅通无阻', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    db.exec('PRAGMA foreign_keys = OFF')
    const orphan = db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', 999, '孤儿单', 1)
    expect(orphan.changes).toBe(1)
    expect(db.run('DELETE FROM users WHERE id = ?', 2).changes).toBe(1)
    // Bob 已删，他的两笔订单成了指向空气的孤儿行——这正是第 3 章开头那场报表事故的机制
    const dangling = db.all<Order>('SELECT id FROM orders WHERE user_id = ?', 2)
    expect(dangling.map((r) => r.id)).toEqual([2, 3])
    // 开关只影响之后的语句，重新打开后外键检查恢复
    db.exec('PRAGMA foreign_keys = ON')
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1)
  })
```

发号机制的断言把「复用与否」钉死——同一组操作，两种表定义，两种结局。

```ts
// tests/update-delete-constraints.test.ts —— 第 3 章（节选：发号与复用）
  it('默认发号 = 现有最大 rowid + 1：删走最大号后，新行会复用被删的号', () => {
    const db = createDb()
    seedUsers(db)
    expect(db.run('DELETE FROM users WHERE id = ?', 3).changes).toBe(1)
    const again = db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'Dave', 'dave@example.com')
    expect(Number(again.lastInsertRowid)).toBe(3)
  })

  it('AUTOINCREMENT：记住史上最大号，删了也不复用，只增不减', () => {
    const db = createDb()
    db.exec('CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL)')
    db.run("INSERT INTO tags (label) VALUES ('red')")
    db.run("INSERT INTO tags (label) VALUES ('green')")
    const top = db.run("INSERT INTO tags (label) VALUES ('blue')")
    expect(Number(top.lastInsertRowid)).toBe(3)
    expect(db.run('DELETE FROM tags WHERE id = ?', 3).changes).toBe(1)
    const next = db.run("INSERT INTO tags (label) VALUES ('black')")
    expect(Number(next.lastInsertRowid)).toBe(4)
  })
```

同一文件里还有八条断言。UPDATE 带 WHERE、不带 WHERE、无命中，changes 分别是 2、3、0；DELETE 两连核对计数与余量；主键去重抛错，加上 NOT NULL、UNIQUE、DEFAULT 各一条——上文原则段落的逐条落地。

## 见证它变绿

老规矩，两道门槛，在 companion 目录下跑：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 24 passed (24)——第 1 章的 5 条、第 2 章的 7 条旧断言原样全绿，加上本章 12 条。旧断言守着前两章的行为，不被后面的演进悄悄弄坏，这是实验场的兼容哨兵。启动时那行 ExperimentalWarning 照旧，第 1 章说过，不影响结果。

不进实验场也能亲手验证本章的一切。存成 try.mjs，跑 node try.mjs：

```js
// 用法示例：拦截、回执、发号复用一次跑通，存成 try.mjs，node try.mjs 就能跑
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id))')
for (const name of ['Alice', 'Bob', 'Carol']) {
  db.prepare('INSERT INTO users (name) VALUES (?)').run(name)
}
// 1) 插孤儿：当场报错，这行进不了表
try {
  db.prepare('INSERT INTO orders (user_id) VALUES (?)').run(999)
} catch (e) {
  console.log(e.message)   // FOREIGN KEY constraint failed
}
// 2) 写操作回执：UPDATE 改中 2 行，DELETE 删掉 1 行
console.log(db.prepare('UPDATE users SET name = ? WHERE id > ?').run('Renamed', 1).changes)  // 2
console.log(db.prepare('DELETE FROM users WHERE id = ?').run(3).changes)                     // 1
// 3) 删走最大号再插：新行复用了 3 号
db.prepare('INSERT INTO users (name) VALUES (?)').run('Dave')
console.log(db.prepare('SELECT id FROM users WHERE name = ?').get('Dave').id)                // 3
```

终端依次打出 FOREIGN KEY constraint failed、2、1、3：孤儿被拦在门外；UPDATE 与 DELETE 的 changes 如实报数；删走最大号之后，新插的行拿回了 3 号。把 users 的建表语句换成带 AUTOINCREMENT 的版本再跑第 3 段，同一个 3 会变成 4——复用与不复用，一个关键字之差。本章每个结论，都能用这个文件独立复现。

## 小结

写操作三件套：UPDATE 换值、DELETE 删行、changes 报数。WHERE 从「筛什么」变成「动谁」，省略它就是全表——动手前先 SELECT COUNT(*) 数一遍。主键是行的永久地址：INTEGER PRIMARY KEY 即 rowid 别名，自动发号默认「现有最大号加一」，删走最大号会把号再发出去；AUTOINCREMENT 防复用，但通常不需要。外键用 REFERENCES 声明，拦孤儿、拦还有订单指着的用户；SQLite 默认关，每个连接要 PRAGMA foreign_keys = ON——第 1 章的伏笔至此兑现。NOT NULL、UNIQUE、DEFAULT 把校验写进表定义，写入那一刻执法，不分入口。

你现在能做到：带 WHERE 与 changes 断言地改数删数；解释删掉最大 id 后新行为什么拿到同一个号；说清外键开关两态各自放行什么；给一张表配齐定位、指向、非空、唯一、默认五种家规。

去向：让数据库替你算报表的聚合与分组在第 4 章；第 5 章把外键声明的两张表缝成一张——JOIN；mini-ORM 动工后，第 9 章会用对象定义生成 CREATE TABLE，本章这些约束都变成 schema 里的字段。

读完本章你该能回答：

- UPDATE 省略 WHERE 时目标是什么？动手前怎么用 SELECT 预检？
- 删掉 users 的最大 id 再插一行，新行的 id 是几？为什么？怎么杜绝复用？
- 外键开着时，哪两类语句会被拦？SQLite 里让外键生效要做哪两件事？
- 只开 PRAGMA、不写 REFERENCES，会发生什么？
- NOT NULL、UNIQUE、DEFAULT 各在什么时刻出手？
