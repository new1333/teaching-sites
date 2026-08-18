---
title: 要么全成，要么全不算：事务
---

# 要么全成，要么全不算：事务

## 转账转到一半，三千块没了

周五晚上十一点，转账接口上线。逻辑简单到不像有坑：alice 给 bob 转三千，第一步 UPDATE 扣 alice 的余额，第二步 UPDATE 给 bob 加上。第一晚跑了二十几笔都正常。周六凌晨服务器内存吃紧，进程崩了一次、自动重启——没人当回事，日志里只有一行冷冰冰的退出记录。周一对账，财务的脸是青的：有四笔转账，alice 的余额扣了，bob 那头没进账。三千、三千、三千、三千，一共一万二，在数据库里凭空消失。

排查一整夜，结论只有一句话：那四笔转账，恰好都撞在进程崩溃的时间窗里——第一步已经提交进库，第二步还没来得及发。代码没有写错哪个字，两步各自都是合法的 SQL。问题出在更根本的地方：**转账是一个动作，数据库却把它当成了两件独立的事各自记账**。第一步落库生效的那一瞬间，半截转账就成了既成事实，没有任何机制能把它收回来。

这不是写得细心就能躲开的坑——多步操作要么一起成功、要么一起当没发生过，这个「要么……要么……」需要数据库提供专门的机制。这一章就造它：事务（transaction）——把一串 SQL 捆成一个整体，全成或全不算。mini-ORM 的最后一块承重梁。

## 目标：db.tx(fn)

本章结束时，转账接口写成这样：

```ts
// 用法示例：本章结束后的写法
const receipt = db.tx((tx) => {
  tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 3000, fromId)
  tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', 3000, toId)
  return `转账 ${3000} 已入账`
})
```

fn 里发出的每一条语句都捆在同一个事务里：fn 正常返回，全部改动一次生效；fn 抛错，全部改动整体作废，错误原样向上抛。两条 UPDATE 各带 WHERE id = ?——按主键锁定那一行，金额走 ? 占位符进参数、不进模板（第 8 章的规矩在事务里原样适用）。回滚（ROLLBACK）——把事务里已做的改动全部撤销、退回事务开始前的那一刻——不再是你要记得写的 SQL，而是 API 替你兜住的底。

## 事务：把一串语句捆成一个整体

### 成因：一个动作，两步落库

为什么需要事务？因为「一个动作」和「一条 SQL」的尺寸对不上。转账是两步，下单是三步（扣库存、建订单、记账），删用户可能是一整串（删订单、删评价、删用户本体）。第 1 章讲过数据库是独立进程：你发一条 SQL，它执行一条、提交一条——每条语句落地生根，下一句与上一句之间没有任何纽带。进程在两步之间崩溃，第一步不认账地留在库里；就算不崩，第二步自己失败（比如违反第 3 章的约束），第一步也已经生效。关系模型管住了数据的形状——表、行、列各就各位；一串语句的成败捆绑，得另找机制。你需要的是一种手段：把这一串语句圈起来，对外只呈现两种结局——全做了，或者全没做。这就是事务，而它给的承诺有个专名：原子性（atomicity）——事务里的一串操作要么全发生、要么全没发生，不存在做一半。名字来自原子本义「不可分割」：数据库视角里，这个事务小到劈不开。

### 载体：BEGIN/COMMIT/ROLLBACK 三件套

事务的三件套是三条 SQL。BEGIN 宣布「从这里开始记账」：之后的改动先记在案，不真正生效。COMMIT 宣布「案上的全部生效」：一次落定。ROLLBACK 宣布「案上的全部作废」：退回分文未动的起点。

```text
BEGIN
  ├─ UPDATE accounts SET balance = balance - 3000 ...   ← 记在案
  ├─ UPDATE accounts SET balance = balance + 3000 ...   ← 记在案
COMMIT    ← 案上两条一次生效；换 ROLLBACK 则两条全作废
```

两句话记住边界。第一句：圈进来的才归事务管。事务不挑语句——SELECT（过滤、排序、分页、聚合函数配分组）也好，INSERT/UPDATE/DELETE 也好，只要在 BEGIN 与 COMMIT 之间、走同一个连接，全被捆住；圈外的一条不受牵连。第二句：事务也有它管不到的东西。第 3 章埋过一句旧话：在事务中途执行 PRAGMA foreign_keys 改外键开关，不报错、但无效。SQLite 官方文档写明：事务还开着时执行这条开关是空操作（no-op），要改得在没有未完结事务的时候。事务捆的是数据改动，不是连接上的一切行为。

### 演算：转账的两条路径各走一遍

alice 有 1000 块、bob 有 500 块，转账 300，两条 UPDATE 改的都是同一列：balance。成功路径：BEGIN，扣款 UPDATE 记在案——此刻数据库内部的 alice 已经是 700，只是没生效。加款 UPDATE 记在案，COMMIT——两条一次落定，库里 alice 700、bob 800。失败路径：BEGIN，扣款 UPDATE 记在案，进程在第二步之前崩了（或者第二步抛了错）——ROLLBACK，案上的扣款作废，库里 alice 1000、bob 500，分文未动。对照一下没有事务的同款现场：第一条 UPDATE 生效即是终局，alice 700、bob 500，三百块蒸发——开章那一万二的账就是这么来的。同一个失败，有没有事务，余额差出一整个「回到起点」。

### 锚点

git。commit 之前，工作区的改动随便做、可整体丢弃；commit 一出，全部生效成为历史。第 11 章讲脏跟踪时借用过暂存区，这一次借的是它最外层的那道门：**事务就是数据库的 commit 边界，ROLLBACK 就是 git 里那句还没 commit 所以随便撤**。

## 为什么长成回调式：错误传播就是回滚信号

三件套是 SQL 层的，手写也能用：BEGIN、跑语句、COMMIT。手写的经典事故长这样——fn 中途抛了错，异常向上飞，你的代码里没人发 ROLLBACK，也没人发 COMMIT。于是这个连接上，事务悬着：后续进来的每一条语句都落在这个未完结的事务里，直到某一次 COMMIT 把「半截转账」连着后来的一切一起提交。忘了收尾比忘了开始可怕得多，而且它不报错——悬着的事务安安静静地等下一次提交。

解法的形状由此确定：把「跑语句」包进回调，把「收尾」钉死在回调的出口。fn 正常返回，出口是 COMMIT；fn 抛错，出口是 ROLLBACK——异常控制流本身就当回滚信号用，catch 块里先回滚、再把同一个错误原样向上抛。这就是 db.tx(fn) 的全部设计：调用方拿 try/catch 接业务错误就好，回滚是 API 的义务，不是调用方的记性。契约三条：fn 正常返回则 COMMIT、返回值透传；fn 抛错则 ROLLBACK、同一个错误对象原样上抛；两条路走完，连接都干净——不悬账。

## 同一个连接：看得见与看不见

BEGIN 之后、COMMIT 之前的改动，自己看得见吗？看得见——同一个连接在事务里读，读到的是记在案的新值：扣款之后马上查，alice 就是 700。这也是转账内部逻辑的依据：先扣款、再查余额够不够、不够就抛错回滚，整套判断都在事务里完成。那别的连接看得见吗？看不见——未提交的改动只对开出这个事务的连接可见，别的连接读到的仍是旧值。这就是隔离（isolation）的雏形：多个连接同时读写时，谁也看不见谁的中间状态。隔离的完整章法（隔离级别那一套）本课程不实现，登记进差异清单；这里记住一句话够用：**在案不等于生效，自己可见、他人不可见**。

## 性能是副产品：第 6 章的欠条在此兑现

第 6 章讲索引与查询计划时，造 50 万行数据的脚本用过一个没解释的技巧：把插入包在 BEGIN 与 COMMIT 之间，脚本才跑得完。欠条现在兑。SQLite 官方文档写明：不加事务时，每条语句自动开一个事务、语句结束就提交——也就是每条语句独立提交一次。而提交是有真实成本的：默认设置下，SQLite 会等数据真正写到磁盘表面、确认安全后才承认事务完成。逐条提交，就是把这份等待付 N 次；包成一个事务，付一次，官方 FAQ 的原话是「提交事务的时间摊到里面全部语句上」。所以性能不是事务的设计目标，是它的副产品——正确性捆绑顺带把提交开销也捆绑了。诚实的补充：实验场是内存库，没有磁盘等待，差距只剩每条语句各自的事务开销；真机上（磁盘落盘等待）差距要大一个量级。文末的脚本可以亲手量一次。

## 亲手造：src/tx.ts

老规矩，测试先行：写 tests/transactions.test.ts，跑一次见红——报错是 Cannot find module '../src/tx'，src/tx.ts 还不存在。然后动手。

### 第一步：类型怎么长——DbWithTx 与一道两难

tx 要长在 db 句柄上，类型层先有个两难。直接给 Db 接口加一个必选的 tx 方法行不行？不行——第 11、12 章的 SQL 记账皮给 Db 手写了包装对象，只实现了 exec/run/all/get；接口一收紧，那些旧对象立刻不再满足 Db，旧章测试全红。而旧测试一个字都不许动。所以本章的选择是：Db 接口原封不动，tx.ts 另立一个超集类型 DbWithTx——Db 的全部能力，外加 tx；createDb 的返回类型从 Db 换成 DbWithTx（超集赋给 Db 永远成立，旧代码零感知）。只增不破，这一回破的不是运行时，是类型层——**给接口加必选成员，就是在改所有实现者的合同**。

```ts
// src/tx.ts —— 类型层：Db 不动，另立带 tx 的超集（原样节选）
/** 带事务的数据库句柄：Db 的全部能力外加 tx()——createDb 的返回类型（第 13 章起） */
export type DbWithTx = Db & {
  tx<T>(fn: (db: DbWithTx) => T): T
}
```

### 第二步：tx 本体——三件套加一面旗子

```ts
// src/tx.ts —— attachTx：给裸 Db 装上 tx，事务的全部家当（原样节选）
/** 给裸 Db 装上 tx：BEGIN/COMMIT/ROLLBACK 走 db 自身的 exec，不另开连接、不绕过包装 */
export function attachTx(inner: Db): DbWithTx {
  // 事务占用的是连接：连接一次只能开一个事务，这面旗子就是它的门锁
  let active = false
  const db: DbWithTx = {
    // 四个老方法原样转发给 inner：包装不换连接，外面再包记账皮也照常透传
    exec: inner.exec.bind(inner),
    run: inner.run.bind(inner),
    all: inner.all.bind(inner),
    get: inner.get.bind(inner),
    tx<T>(fn: (txDb: DbWithTx) => T): T {
      if (active) {
        throw new Error(
          'tx 不支持嵌套：上一个事务还没 COMMIT 或 ROLLBACK，同一个连接开不了第二个——真实 ORM 用 SAVEPOINT（保存点）实现嵌套，本课程从简不做，取舍登记在差异清单'
        )
      }
      active = true
      // BEGIN 之后、COMMIT 之前的改动只在案、未生效；fn 拿到的就是同一个 db，事务内的语句互相可见
      inner.exec('BEGIN')
      try {
        const result = fn(db)
        inner.exec('COMMIT')
        return result
      } catch (error) {
        // fn 抛错：全部作废，然后把同一个错误原样向上抛——调用方接住的还是它自己扔的那个
        inner.exec('ROLLBACK')
        throw error
      } finally {
        active = false
      }
    },
  }
  return db
}
```

逐行对账。开头四行把 exec/run/all/get 原样转发给 inner——包装不换连接，外面再包一层记账皮也照常透传。BEGIN 与 COMMIT/ROLLBACK 都走 inner.exec——db 自身的那扇门，不另开连接、不绕过包装；所以拿第 12 章那款记账皮包住 db 再 attachTx，BEGIN/COMMIT 会如实出现在账上（本章测试正是这么验的）。fn 拿到的参数就是 db 本尊：同一个连接，事务内的语句互相可见。COMMIT 之后把 fn 的返回值透传出去——泛型 T，回执、计数、什么都行。catch 块两步走：先 ROLLBACK，再 `throw error`——注意抛回去的是同一个错误对象，包装、改写、吞掉都不做，调用方的 catch 接得明明白白。finally 把旗子放下来：不管成败，连接回到干净态，下一个 tx 从零开始。

### 第三步：嵌套——从简，但要明说

tx 里再调 tx 行不行？SQLite 的回答是不行：单连接上，事务没结束就再 BEGIN，数据库直接报错「不能在事务里开事务」。真实 ORM 的通行解法是 SAVEPOINT（保存点）——在事务里立一个存档点，回滚可以只回到存档而不回到开头，嵌套事务由它模拟。本课程从简不做，但选择要喊出来：嵌套调用当场抛中文错误，把「不支持」写进错误消息，而不是让底层的英文报错糊在调用方脸上。取舍登记进差异清单。

### 第四步：createDb 组合——两行的事

db.ts 顶部多一行 `import { attachTx, type DbWithTx } from './tx'`，函数本体只改头尾两处——返回类型与末尾的包装：

```ts
// src/db.ts —— createDb 的现状：末尾包一层 attachTx（原样节选）
/** 打开一个只活在内存里的 SQLite 数据库：随建随毁，测试即开即跑；第 13 章起句柄上多了 tx */
export function createDb(): DbWithTx {
  const db = new DatabaseSync(':memory:')
  // 外键约束 SQLite 默认关闭，实验场统一手动打开（第 3 章讲它是怎么回事）
  db.exec('PRAGMA foreign_keys = ON')
  return attachTx({
```

那个对象里四个方法原样住着、一个没动（完整形态第 1 章见过，只是句尾的 } 换成了 })）。事务的全部实现住在 tx.ts，户口清楚；第 1 章正文引用的 createDb 代码块，已按当前形态同步回写。mini-ORM 这边一行都不用改：表句柄、查询构建器、水合实例内部用的都是同一个 db（同一个连接）。tx 开着，它们发出的每一条语句自然都在事务里——create、save、remove 全被捆住，本章测试有专测盯着。defineTable 那套也不受影响：schema 经类型映射译成列类型、生成 DDL 建表，是第 9 章的机制——事务捆语句，不碰表结构。

## 验证：把两条路径拍在桌上

先看失败路径——开章事故的机械复现，中途抛错、余额分文未动：

```ts
// tests/transactions.test.ts —— 失败路径（原样节选）
  it('第二步炸掉：第一条 UPDATE 已执行，事务后两边余额与转前一字不差', () => {
    const db = createDb()
    seedAccounts(db)
    expect(() =>
      db.tx((tx) => {
        tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 300, 1)
        throw new Error('给 B 加款前进程崩了')
      })
    ).toThrowError('给 B 加款前进程崩了')
    expect(balanceOf(db, 1)).toBe(1000)
    expect(balanceOf(db, 2)).toBe(500)
  })
```

第一条 UPDATE 明明执行了，事务后余额却与转前一字不差——ROLLBACK 干的。同一个错误消息也原样从 tx 里冒了出来。成功路径与之对称：transfer 两步走完，alice 700、bob 800，receipt 就是 fn 的返回值。同连接语义也有专测：事务里先扣款再查，读到未提交的 700；抛错回滚后再查，回到 1000。语句账则由「记账皮加 attachTx」的组合验证：BEGIN 打头、COMMIT 或 ROLLBACK 收尾、两条 UPDATE 夹在中间——三件套确实走了 db 自己的 exec。ORM 侧另有一组：create 与 save 进事务、中途抛错，插的行消失、改的名字还原——第 11 章的写操作被整体捆住。本章共 11 个断言。

## 见证它变绿

companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 105 passed (105)。第 1 到 12 章攒下的 94 个旧断言一个没伤，本章新增 11 个；src 多了 tx.ts，db.ts 长出两行组合，其余四个文件一行没动。只想跑本章：npx vitest run tests/transactions.test.ts。

不进实验场也能亲手看一次回滚。存成 try-tx.mjs，跑 node try-tx.mjs：

```js
// 用法示例：三件套亲手走一遍，存成 try-tx.mjs
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, balance INTEGER NOT NULL)')
db.exec("INSERT INTO accounts (name, balance) VALUES ('alice', 1000)")
db.exec("INSERT INTO accounts (name, balance) VALUES ('bob', 500)")
const show = () => db.prepare('SELECT name, balance FROM accounts ORDER BY id').all()

db.exec('BEGIN')
db.exec("UPDATE accounts SET balance = balance - 300 WHERE name = 'alice'")
console.log('事务内：', JSON.stringify(show()))
db.exec('ROLLBACK')
console.log('回滚后：', JSON.stringify(show()))

db.exec('BEGIN')
db.exec("UPDATE accounts SET balance = balance - 300 WHERE name = 'alice'")
db.exec("UPDATE accounts SET balance = balance + 300 WHERE name = 'bob'")
db.exec('COMMIT')
console.log('提交后：', JSON.stringify(show()))
```

真实输出：

```text
事务内： [{"name":"alice","balance":700},{"name":"bob","balance":500}]
回滚后： [{"name":"alice","balance":1000},{"name":"bob","balance":500}]
提交后： [{"name":"alice","balance":700},{"name":"bob","balance":800}]
```

三行输出就是三态：在案（700）、作废（1000）、生效（700 与 800）。再量一把第 6 章的欠条——同样两万条插入，逐条提交与包成一个事务：

```js
// 用法示例：事务的省，省在提交次数——存成 try-tx-speed.mjs，跑 node try-tx-speed.mjs
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec('CREATE TABLE logs (id INTEGER PRIMARY KEY, message TEXT)')
const insert = db.prepare('INSERT INTO logs (message) VALUES (?)')

let t = performance.now()
for (let i = 0; i < 20000; i++) insert.run(`msg-${i}`)
console.log(`2 万条逐条提交：${(performance.now() - t).toFixed(0)}ms`)

db.exec('DELETE FROM logs')
t = performance.now()
db.exec('BEGIN')
for (let i = 0; i < 20000; i++) insert.run(`msg-${i}`)
db.exec('COMMIT')
console.log(`2 万条包成一个事务：${(performance.now() - t).toFixed(0)}ms`)
```

这台机器上跑出 16ms 对 7ms——内存库里没有磁盘等待，差距只剩每条语句各自的事务开销，仍有两倍多；换成磁盘上的库，按官方文档「等数据真正落到磁盘表面才算提交」的说法，这个比值会悬殊得多。

## 小结

事务把一串 SQL 捆成一个整体：BEGIN 之后改动只在案、未生效，COMMIT 一次落定，ROLLBACK 整体作废——原子性就是这个「要么全成、要么全不算」。锚点是 git：commit 之前随便改、可整体回滚。db.tx(fn) 把收尾钉死在出口：fn 正常返回则 COMMIT 并透传返回值，抛错则 ROLLBACK 并把同一个错误原样上抛——悬着的半截事务这个经典事故，从 API 形状上被排除。同连接语义：在案的改动自己可见、他人不可见，隔离的完整章法留给差异清单。性能是副产品：不加事务时每条语句独立提交，SQLite 默认等数据落到磁盘才认账，包起来就把这笔等待从 N 次并成一次。类型层 Db 接口一字未动，DbWithTx 超集承载 tx——必选成员一进接口，所有旧实现者的合同都得改。嵌套从简不支持，中文错误明说，SAVEPOINT 登记差异清单。第 14 章收工对账，事务正是差距地图上「真实 ORM 还有哪些我们没有的事」的第一站。

你现在能做到：用 db.tx(fn) 把转账写成不可分割的整体。讲清 BEGIN/COMMIT/ROLLBACK 各管哪一段、为什么回调式能防住悬账事故，以及第 6 章那个 BEGIN/COMMIT 包插入为什么快。

读完本章你该能回答：

- 进程崩在扣款与加款之间，有事务和没事务，两种结局的余额各是什么？
- fn 抛错后，tx 做三件事的顺序是什么？调用方接住的是哪个错误对象？
- 事务里执行 PRAGMA foreign_keys 会怎样？回滚后开关状态是什么？为什么？
- 为什么不直接给 Db 接口加 tx 方法？DbWithTx 解决了什么？
- 两万条插入逐条提交与包成一个事务，差的那份开销是什么？内存库为什么差距小？
