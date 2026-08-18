---
title: 查询的艺术：WHERE、排序与分页
---

# 查询的艺术：WHERE、排序与分页

## 翻到第 8 页，白屏了

订单后台的列表页，第一版是这么写的：接口一把把全部 3 万行订单拉回浏览器，筛选用 filter，排序用 sort，翻页用 slice——查询的活全在浏览器里手写。前两页挺流畅；QA 翻到第 8 页，标签页先是卡死，内存曲线拉满，然后白屏。你以为是渲染的事，上了虚拟列表，好了一点，翻到第 30 页照样白。

后端同学看了一眼接口，问了一句让你愣住的话：「你们为什么不用 WHERE 和 LIMIT？」——你甚至不知道这两样东西加上 ORDER BY，能把筛选、排序、分页三件活全替你干了。你把 3 万行原料整个搬过来，在浏览器里开了家手工作坊；而数据库——第 1 章那位管家——本来就把这些当作日常业务。

第 1 章的关系模型给了数据形状，CREATE TABLE、INSERT、SELECT 跑通了最小闭环，但那句 SELECT 只会「全都要」。这一章给 SELECT 装上三样工具：WHERE 筛行、ORDER BY 定序、分页（LIMIT/OFFSET）切页。沿途还有一块暗礁——NULL 的比较规则，它会让你的条件悄悄漏行。

## 声明式：只说要什么，不说怎么做

### 成因：活该谁来干

先问一个根本问题：筛选这件事，为什么不该前端干？两个硬理由。第一，数据在数据库手里，它比你更了解这份数据怎么存放——比如哪一列建了目录、能抄近路少翻多少行（目录这回事，讲索引的那一章再拆）。第二，数据不在浏览器手里：你要 filter，就得先把行搬过网线。3 万行搬过来只为筛掉 2.99 万行，**搬运本身就是最大的浪费**。所以 SQL 干脆定下一种分工：你只描述要什么——什么条件、什么顺序、要几行；怎么找，交给数据库。这类只描述结果、不描述步骤的写法，叫声明式（declarative）——只说要什么、不说怎么做；你日常写的逐步下达指令的代码，则是命令式（imperative）。

### 载体：两种写法摆在一起

拿列表页第 2 页那件事对照：只看已支付、按支付时间倒序、每页 7 行。浏览器里的命令式三连：

```js
// 用法示例：浏览器里的命令式三连——每步都真的执行在你搬来的数据上
const all = (await (await fetch('/api/orders')).json())  // 3 万行全搬回来
const page = all
  .filter((o) => o.status === 'paid')                    // 筛
  .sort((a, b) => b.paid_at - a.paid_at)                 // 排
  .slice(7, 14)                                          // 切页
```

数据库里的声明式一句：

```sql
SELECT * FROM orders        -- * 表示所有列全要
WHERE status = 'paid'      -- 筛
ORDER BY paid_at DESC      -- 排
LIMIT 7 OFFSET 7           -- 切页
```

三行对三行，逐词对应：filter 对 WHERE，sort 对 ORDER BY，slice 对 LIMIT/OFFSET。差别只有一个：左边的每一步都真的执行在你搬来的数据上；右边三句只是描述，执行发生在数据库那边，**穿过网线的只有最终那 7 行**。

### 演算：算一笔搬运账

3 万行，一行订单约 200 字节，JSON 序列化再算上键名重复，粗算 6 MB 起；解析成 3 万个 JS 对象，堆内存还要再翻几倍。用户只看第一页的 7 行，你已经付了全款。声明式那句只搬 7 行，约 1.4 KB——四千多倍的差距。白屏的元凶从来不是 slice 写错了：那 3 万个对象躺在内存里一直不走，翻页又只往上堆新页面的行、不卸旧页面的，攒到第 8 页，内存先撑不住了。

### 锚点：CSS 选择器

声明式你天天在写：CSS 选择器。`.order.paid` 说的是「要哪些元素」，一个字都没说怎么找——遍历顺序、匹配算法都是浏览器的事。SQL 之于表，就是选择器之于 DOM。

## WHERE：把 filter 搬回数据库

先立实验数据：7 笔订单，金额有两笔并列，note 有四行是 NULL——本章每个结果都能对着这张表手数出来。

```text
表 orders
┌────┬───────┬──────────┬────────┬──────────┐
│ id │ buyer │ status   │ amount │ note     │
├────┼───────┼──────────┼────────┼──────────┤
│ 1  │ Alice │ paid     │ 1200   │ 加急     │
│ 2  │ Bob   │ pending  │ 300    │ NULL     │
│ 3  │ Carol │ paid     │ 750    │ 发票已开 │
│ 4  │ Dave  │ refunded │ 300    │ NULL     │
│ 5  │ Eve   │ paid     │ 300    │ NULL     │
│ 6  │ Frank │ pending  │ 90     │ 电话催付 │
│ 7  │ Grace │ paid     │ 1200   │ NULL     │
└────┴───────┴──────────┴────────┴──────────┘
```

WHERE 后面写条件。比较运算符 =、!=（也可写 <>）、>、<、>=、<=，跟 JS 几乎一致；AND、OR、NOT 组合条件，优先级同样是 AND 高于 OR——拿不准就加括号，跟 JS 一样。比如 `status = 'paid' AND amount >= 300`：对 7 行逐行问这句话，留下第 1、3、5、7 行。基本面之外是三个新面孔：

- IN——一列候选值里有没有它，等价一串 OR 但更好读：`status IN ('paid', 'refunded')` 留下 1、3、4、5、7。
- BETWEEN——闭区间，两端都算数。SQLite 官方文档写明 `x BETWEEN y AND z` 等价于 `x >= y AND x <= z`：`amount BETWEEN 300 AND 750` 留下 2、3、4、5，300 与 750 两端的行都在。
- LIKE——模糊匹配。模式串里 % 匹配任意长度的任意内容（含空串），_ 恰好一个字符：`buyer LIKE 'A%'` 是「A 开头」，查出 Alice；`buyer LIKE '_ob'` 是「三个字符、后两个是 ob」，查出 Bob；`note LIKE '%发票%'` 是「含发票两个字」，查出第 3 行。

方言——同一条 SQL 在各家数据库里的细微差异——先标一处：LIKE 对大小写的态度各家不同。SQLite 官方文档写明默认只对 ASCII 字母不区分大小写——`'a' LIKE 'A'` 为真，超出 ASCII 的字母（如 æ 与 Æ）则区分；MySQL 在默认的字符比较规则下同样不区分；PostgreSQL 的 LIKE 区分大小写，不区分的版本另叫 ILIKE。跨库时这是常踩的坑，依据都在各家官方手册里。

还有一条此刻就立的规矩：WHERE 里的值若来自用户输入（搜索框、筛选器），别把值拼进 SQL 字符串，继续用第 1 章的 ? 占位符传参。拼字符串为什么闯大祸，讲注入的那一章专门拆。

## ORDER BY：把 sort 搬回数据库

ORDER BY 后面跟列和方向：`ORDER BY amount DESC, id ASC`——先按金额降序，金额并列时按 id 升序。方向词每列各自带，ASC 是默认可省略。对着表数一遍：两笔 1200 并列，id 小的 1 排在 7 前面；然后是 750 的 3；三笔 300 按 id 排 2、4、5；最后是 90 的 6——顺序是 1、7、3、2、4、5、6。

第二列为什么不能省？**排序必须让任何两行都分得出先后**——数学上叫「全序」。业务列常有并列——两笔 1200、三笔 300——并列的行谁先谁后，SQL 不承诺。分页偏偏经不起这种含糊：这一页末尾和下一页开头要是换了顺序，同一行会翻着翻着重复出现，或者永远漏掉。常用配方是业务列在前、主键兜底在后——主键全表唯一，是最后的并列裁决者。

NULL 在排序里的位置顺带交代：SQLite 与 MySQL 都把 NULL 当作比任何值都小——升序排最前、降序排最后；PostgreSQL 默认相反，把 NULL 当最大、升序排最后，还提供 NULLS FIRST/LAST 让你明说。又一处迁移时要留神的方言差异。

## LIMIT/OFFSET：把 slice 搬回数据库

LIMIT n 表示只取前 n 行，OFFSET m 表示先跳过前 m 行。为什么要分页、在数据库这头分——搬运账在上一节算过了。写法就是一个公式：

```text
OFFSET = (页码 − 1) × 每页行数
LIMIT  = 每页行数
```

子句生效顺序是 WHERE → ORDER BY → LIMIT/OFFSET：先筛、再排、最后切——顺序错了切出来的就不是页。拿上一节排好的 1、7、3、2、4、5、6 演算，每页 3 行：第 1 页 OFFSET 0，得 1、7、3；第 2 页 OFFSET 3，得 2、4、5；第 3 页 OFFSET 6，只剩 6 一行；第 4 页 OFFSET 9，翻过了头，得到空数组。锚点就是 slice：`slice((页码 - 1) * 3, 页码 * 3)`——起点行号一样，只是这次切在数据库那边。

方言差异在这里最出名：MySQL 支持两种写法——`LIMIT n OFFSET m`，以及逗号版 `LIMIT m, n`，含义是「跳过 m 行、再取 n 行」。`LIMIT 3, 4` 在 MySQL 里是跳 3 取 4，跟 SQLite/PostgreSQL 的 `LIMIT 4 OFFSET 3` 一回事，两个数字的位置别记混。SQL 标准的写法是 `OFFSET m ROWS FETCH NEXT n ROWS ONLY`，SQL Server 与 Oracle 用它，知道即可。

## NULL 三值逻辑：比较结果不止真假

最后是那块暗礁。note 列允许为空——「没有备注」不是「备注是空字符串」，更不是「备注是 0」。SQL 用 NULL 表示这一格没有值，并且明确规定：NULL 不是任何一个具体的值。值既然未知，拿它做比较，结果也就断不了真假。

### 成因：为什么不干脆当 false

你可能想：查不出就查不出，`NULL = '加急'` 当 false 处理不就完了？不行，算一笔反面账。假设 UNKNOWN 就是 FALSE，那么 `NOT (note = '加急')` 会把 FALSE 取反成 TRUE——note 为空的 4 行全被当成「备注不是加急」查了出来。可「不知道备注是什么」和「备注不是加急」是两回事：把「不知道」冒充成「知道不是」，答案就是错的。所以 SQL 标准（SQLite 文档注明这条沿用 SQL92 标准）规定了两件事：任何值与 NULL 的比较结果是第三个值 UNKNOWN（未知），不是 FALSE；WHERE 只放行结果为 TRUE 的行——UNKNOWN 和 FALSE 一样挡在门外。这套真、假、未知三档的比较规则，就是 NULL 三值逻辑（three-valued logic）。

### 载体：三值真值表

```text
NOT：TRUE 出 FALSE   FALSE 出 TRUE   UNKNOWN 出 UNKNOWN

AND：谁「更假」听谁的（档位 FALSE < UNKNOWN < TRUE）
     见 FALSE 直接 FALSE；没有 FALSE 但有 UNKNOWN 出 UNKNOWN；全 TRUE 才 TRUE
     —— FALSE AND UNKNOWN 是 FALSE，不是 UNKNOWN

OR：谁「更真」听谁的
    见 TRUE 直接 TRUE；没有 TRUE 但有 UNKNOWN 出 UNKNOWN；全 FALSE 才 FALSE
```

### 演算：一行一行判

拿 orders 表的条件 `note = '加急'` 逐行判：第 1 行 note 是 '加急'，TRUE；第 3、6 行是别的字符串，FALSE；第 2、4、5、7 行 note 是 NULL，UNKNOWN——不是 FALSE。四条结论随之而来：

- `WHERE note = '加急'`：只有第 1 行。WHERE 只放行 TRUE。
- `WHERE NOT (note = '加急')`：第 3、6 行。NULL 行取反仍是 UNKNOWN，进不来——未知的行在正反两个问题下都保持未知。
- `WHERE note = NULL`：0 行。想查空值的人常这么写，可 NULL = NULL 同样比不出真假，还是 UNKNOWN。
- `WHERE note IS NULL`：2、4、5、7。IS NULL 专门问「这一格是不是没有值」，不走比较，直接给真假。

混合条件再看一条：`WHERE note = '加急' OR status = 'pending'`。第 1 行 TRUE OR FALSE，出 TRUE；第 2 行 UNKNOWN OR TRUE，也出 TRUE——OR 见真即真，未知也救得回来；第 4、5、7 行 UNKNOWN OR FALSE，还是 UNKNOWN，进不来。逐行判完，结果 1、2、6。AND/OR 与 NULL 混在一起时，就拿真值表对行数。

口诀：**查空用 IS NULL，查非空用 IS NOT NULL；= NULL 永远查不出任何行**——连 NULL 行自己都查不出。

### 锚点：NaN

像 NaN：`NaN === NaN` 是 false，「没有值」的东西参与寻常比较，得不到寻常真假。SQL 只是更进一步，把「比不出」明确立为第三档 UNKNOWN。IS NULL 则相当于 `Number.isNaN`——不比大小，专门验「是不是这个特殊状态」。

## 亲手搭实验场

本章不动 src——db.ts 的四个方法足够承载一切 SELECT，SQL 语法章的演进全在测试里。先立数据集：

```ts
// tests/where-order-limit.test.ts —— 第 2 章：WHERE、排序、分页与 NULL 三值逻辑（节选：数据集）
type Order = { id: number; buyer: string; status: string; amount: number; note: string | null }

/** 7 笔订单：金额有两笔并列、note 有四行为空——本章断言全靠这组数据可手算 */
function seedOrders(db: Db): void {
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      buyer TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT
    );
  `)
  const rows: [string, string, number, string | null][] = [
    ['Alice', 'paid', 1200, '加急'],
    ['Bob', 'pending', 300, null],
    ['Carol', 'paid', 750, '发票已开'],
    ['Dave', 'refunded', 300, null],
    ['Eve', 'paid', 300, null],
    ['Frank', 'pending', 90, '电话催付'],
    ['Grace', 'paid', 1200, null],
  ]
  for (const [buyer, status, amount, note] of rows) {
    db.run('INSERT INTO orders (buyer, status, amount, note) VALUES (?, ?, ?, ?)', buyer, status, amount, note)
  }
}
```

然后是本章最有教学价值的一次见红。先按直觉写「= NULL」的断言，期望它查出 note 为空的 4 行，也就是 [2, 4, 5, 7]。跑 `npx vitest run`，红了：期望 `[ 2, 4, 5, 7 ]`，实际 `[ ]`。直觉撞上了 SQL 标准——这正是本章要你带走的事实，先用红的方式见一面。修正认知后，断言改为同时锁住两个行为：= NULL 查不出，IS NULL 查得出；再补一条 NOT 的断言，把三值逻辑钉死。

```ts
// tests/where-order-limit.test.ts —— 第 2 章（节选：NULL 断言，转绿后的形态）
  it('= NULL 查不出空值行，IS NULL 才查得出', () => {
    const db = createDb()
    seedOrders(db)
    // 直觉写法：note = NULL 比较结果是「未知」，WHERE 只放行为真的行 → 0 行
    const eqNull = db.all<Order>('SELECT id FROM orders WHERE note = NULL ORDER BY id')
    expect(eqNull).toEqual([])
    const isNull = db.all<Order>('SELECT id FROM orders WHERE note IS NULL ORDER BY id')
    expect(isNull.map((r) => r.id)).toEqual([2, 4, 5, 7])
  })

  it('三值逻辑：note 为空的行连 NOT (note = ?) 也查不出', () => {
    const db = createDb()
    seedOrders(db)
    const negated = db.all<Order>(
      "SELECT id FROM orders WHERE NOT (note = '加急') ORDER BY id"
    )
    // 行 1 为真取反出局；行 3、6 为假取反入选；NULL 行取反仍是未知，同样进不来
    expect(negated.map((r) => r.id)).toEqual([3, 6])
  })
```

分页断言把公式变成代码——`page(n)` 里那行 `(n - 1) * pageSize` 就是 OFFSET 公式，翻过头得到的空数组也是行为的一部分。

```ts
// tests/where-order-limit.test.ts —— 第 2 章（节选：分页断言）
  it('LIMIT/OFFSET 分页：每页 3 行，翻页结果正确', () => {
    const db = createDb()
    seedOrders(db)
    const pageSize = 3
    const page = (n: number) =>
      db.all<Order>(
        'SELECT id FROM orders ORDER BY amount DESC, id ASC LIMIT ? OFFSET ?',
        pageSize,
        (n - 1) * pageSize
      )
    expect(page(1).map((r) => r.id)).toEqual([1, 7, 3])
    expect(page(2).map((r) => r.id)).toEqual([2, 4, 5])
    expect(page(3).map((r) => r.id)).toEqual([6])
    expect(page(4)).toEqual([])
  })
```

同一文件里还有四条断言：比较运算与 AND/OR、IN 与 BETWEEN 的闭区间、LIKE 的 % 与 _、ORDER BY 的多列与方向——上文原则段落的逐条落地，全部可对着那张 7 行表手数出来。

## 见证它变绿

老规矩，两道门槛，在 companion 目录下跑：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 12 passed (12)——第 1 章的 5 个旧断言原样全绿（它们守着第 1 章的行为，不被后面的改动悄悄弄坏），加上本章 7 个新断言。启动时那行 ExperimentalWarning 还会打出来，第 1 章说过，不影响任何结果。

不进实验场也能亲手验证本章的一切。存成 try.mjs，跑 node try.mjs：

```js
// 用法示例：筛、排、切、NULL 一次跑通，存成 try.mjs，node try.mjs 就能跑
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, buyer TEXT, amount INTEGER, note TEXT)')
const seed = [['Alice', 1200, '加急'], ['Bob', 300, null], ['Carol', 750, null]]
for (const [buyer, amount, note] of seed) {
  db.prepare('INSERT INTO orders (buyer, amount, note) VALUES (?, ?, ?)').run(buyer, amount, note)
}
// 按金额降序切第 2 页（每页 1 行）：跳过 1200 那笔，取到 750
const page2 = db
  .prepare('SELECT id FROM orders ORDER BY amount DESC, id ASC LIMIT ? OFFSET ?')
  .all(1, 1)
console.log(page2.map((r) => r.id))              // [ 3 ]
const eqNull = db.prepare('SELECT id FROM orders WHERE note = NULL').all()
const isNull = db.prepare('SELECT id FROM orders WHERE note IS NULL').all()
console.log(eqNull.map((r) => r.id), isNull.map((r) => r.id))   // [] [ 2, 3 ]
```

终端打出 `[ 3 ]` 和 `[] [ 2, 3 ]`：分页切中了 750 那笔；`note = NULL` 一无所获，`note IS NULL` 查出两行空备注。分页与 NULL 的结论都能用这个文件复现；把其中的 SQL 换成上文任何一句，其余结论同法可验。

## 小结

三件活从浏览器搬回了数据库。WHERE 管筛——比较、IN、BETWEEN、LIKE；ORDER BY 管排——多列、各带方向、主键兜底。LIMIT/OFFSET 管切页，公式是 OFFSET = (页码 − 1) × 每页行数。写法的哲学是声明式——只说要什么，怎么找交给数据库。NULL 三值逻辑记三句：与 NULL 比较得 UNKNOWN；UNKNOWN 进不了 WHERE，连 NOT 也救不回；查空只能 IS NULL。代码上本章只新增 tests/where-order-limit.test.ts，src 一行未动——第 1 章的地基够用，这正是薄封装的意义。

你现在能做到：对一张 7 行的表，先在纸上推出任何一条「筛、排、切」查询的结果，再写进测试核对；看到 = NULL 查不出数据时，能说出为什么。

去向：改数据的 UPDATE/DELETE 与守门的约束在第 3 章；WHERE 为什么能不从头翻到尾——索引与查询计划——在第 6 章；WHERE 里的用户输入怎么安全传值，第 8 章拆注入与参数化。

读完本章你该能回答：

- 声明式与命令式差在哪？用 filter/slice 对照 WHERE/LIMIT 各说一句。
- 每页 3 行、第 2 页的 OFFSET 是几？公式怎么来的？
- = NULL 为什么查不出 NULL 行？`NOT (note = '加急')` 能查出 note 为空的行吗？
- MySQL 的 `LIMIT 3, 4` 是什么意思？
- ORDER BY 为什么常在业务列后面再跟一个主键列？
