---
title: 一个引号引发的越权：SQL 注入与参数化
---

# 一个引号引发的越权：SQL 注入与参数化

## 一个引号，登进管理员账号

周五晚上，测试同学发来一条消息：「你们的登录接口能进任意账号，包括管理员。」你不信。他让你自己试：打开登录页，用户名一栏原样输入 admin' --（一个英文单引号、两个减号），密码栏随手敲 123456，回车——页面跳进了管理员后台。

你翻出后端代码。登录查询把用户名和密码直接拼进 SQL 字符串，再交给数据库。密码明明是错的，为什么放行？答案只有两个字：引号。你输入的那个引号改写了整条 SQL 的结构，密码检查消失了。

这就是 SQL 注入（SQL injection）——用户输入经字符串拼接混进了 SQL 语句，数据库把它当成自己语句的一部分照常执行。第 1 章埋过一张欠条：「拼字符串会闯安全大祸，后面的章节专门拆这个雷」；第 2 章又补了一张：「WHERE 里的用户输入别拼进 SQL 字符串」。两张欠条今天一起兑现。

## 数据是怎么变成代码的

### 成因：一条通道里的两种话

后端想对数据库说的话是代码——SQL；用户想在输入框里说的话是数据——比如他的名字。拼字符串这件事，把两种话塞进了同一条文本。数据库不管哪一段出自谁，它只认最终拼出来的整串字符，按语法从头解析。**于是数据有机会爬进代码的位置**：一个引号可以终止字符串，两个减号可以开注释——这些本来是给写 SQL 的人用的语法，现在输入框里的人也能用。

锚点你已经自带了：XSS——前端那个「用户输入变成了页面里执行的代码」。SQL 注入就是数据库世界的 XSS，病根一模一样：数据没有自己的通道，爬进了代码的位置。前端的药是 textContent 与框架默认转义；数据库的药这一章后面给出。

### 载体：两句 SQL 的结构对照

把登录查询的模板与拼好后的句子逐字摆出来。⟨⟩ 是模板里等着填值的坑：

```text
模板（你心里的句子）：
SELECT id, name, password FROM users WHERE name = '⟨name⟩' AND password = '⟨password⟩'

拼好（数据库实际收到的整句，payload 填进 name 坑）：
SELECT id, name, password FROM users WHERE name = 'admin' --' AND password = '随便填的密码'
```

不看字符看骨架，两句的结构差在这里：

```text
意图：WHERE 条件一 AND 条件二    ← 两个条件都成立，才放行一行
实际：WHERE 条件一 --…          ← 条件二住进了注释：句子骨架被改写
```

### 演算：跟着 payload 逐字符走一遍

payload（攻击载荷——攻击者精心构造的那串输入）admin' --，一共九个字符（含空格）。每个字符在数据库眼里各干了一件事：

```text
a d m i n  普通文本，恰好是 admin 账号的名字
'          字符串的结束引号：闭合了模板写下的那个开引号
（空格）    词法分隔符
--         行注释的开始：从这里到行尾，全部忽略
（余下）    模板自己的 ' AND password = '…… 整段成了注释内容
```

数据库最终只解析到 `WHERE name = 'admin'`。手工执行：admin 行的条件一成立，放行；alice、bob 行的条件一不成立，出局。结果恰好只有 admin 这一行——连本该拦住它的密码条件带返回值，一起交了出去。**改写的不是数据，是语句的骨架**：这就是注入与普通错误输入的本质区别，写错的名字只会查不到行，改写骨架的名字能改写规则。

## 还能偷什么：恒真与拖库

### 恒真：一个条件放行全表

换搜索框场景，模板是 `WHERE name = '⟨关键词⟩'`。输入 ' OR '1'='1：

```text
模板：  WHERE name = '⟨关键词⟩'     ← 注意模板自带的收尾引号
拼好：  WHERE name = '' OR '1'='1'
逐段判：name = ''   没人叫空名字，对谁都假
        '1' = '1'   恒真
        OR          一边真，整句真 → 对全表每一行放行
```

引号的账要对齐：payload 开头的引号闭合了模板的开引号，payload 末尾的 1 与模板的收尾引号正好拼成第二个 '1'——攻击者连模板长什么样都算进去了。第 2 章你学 WHERE 是为了筛行，注入者借同一个 WHERE 让条件恒真：表里 3 行，一次全漏。「某公司一个搜索框丢几千万条用户数据」的事故，原理骨架就是这一行。

### 拖库：UNION 把别的列搬进结果集

UNION 把两条 SELECT 的行上下接起来，只要两边列数相同。输入 x' UNION SELECT id, password FROM users --：

```text
拼好：SELECT id, name FROM users WHERE name = 'x'
      UNION SELECT id, password FROM users --'
```

第一个条件查不到人，不要紧；UNION 把第二个 SELECT 的行接在下面，password 列顶替了 name 列的位置。接口照常返回「用户列表」，每行的「名字」其实是那个账号的密码——连主键带口令整列拖走。

### 前面学的那些，都拦不住注入

- 主键、外键与约束（第 3 章）：守的是写入的数据合不合法。注入改的是语句结构——门卫没坏，门换了。
- 聚合函数与分组（第 4 章）：报表查询一样能注入，聚合出来的是攻击者要的口径。
- 索引与查询计划（第 6 章）：索引解决「怎么找行快」，注入改的是「按什么条件找」。EXPLAIN QUERY PLAN 给你看的计划，正是那条已经被改了骨架的语句。
- 排序与分页（第 2 章）：LIMIT ? OFFSET ? 的两个数字是值，可以走占位符；但 ORDER BY 的列名不是值——列名怎么安全地动态化，第 10 章的查询构建器用白名单回答。

前七章攒下的家底——关系模型、筛选、约束、聚合、JOIN——没有一样拦得住注入。它不在数据库的执行层，而在你拼字符串的那一行；药也得从那一行下。

## 删库梗的真相：一条 prepare 只编一条语句

那幅著名漫画你多半见过：妈妈给儿子取名 Robert'); DROP TABLE Students; --，学校的学生表一夜消失。这个梗要如实讲：**在我们这条路上，它不会发生**。

依据是官方文档。SQLite 官方对 prepare 系列函数写明：这类函数「只编译 zSql 里的第一条语句」，余下的是未编译的尾巴；Node 的 node:sqlite 文档写 prepare 是「把一条 SQL 编译成 prepared statement」，正是 sqlite3_prepare_v2() 的包装。我们的 db.run/all/get 全走 prepare——注入进去的第二条语句从未编译，更谈不上执行。exec 是另一个通道：文档写它「允许一次或更多条语句」执行，是给建表脚本这类批语句用的。

所以梗的真相是挑通道：把拼了用户输入的 SQL 塞给 exec 这样的批语句通道，DROP TABLE 就真的执行。三十秒验证，存成 try-drop.mjs 跑 node try-drop.mjs：

```js
// 用法示例：电影梗在 exec 通道是真的
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
db.exec("INSERT INTO users (name) VALUES ('admin')")
const keyword = "x'; DROP TABLE users; --"  // 搜索框里敲进来的「关键词」
db.exec(`SELECT id FROM users WHERE name = '${keyword}'`)  // exec 一次可跑多句
try {
  db.prepare('SELECT count(*) AS c FROM users').get()
} catch (e) {
  console.log('表没了：' + e.message)  // 打印：表没了：no such table: users
}
```

现实里对应的坑：不少数据库驱动提供多语句开关（如 MySQL 连接的 multipleStatements）。开了它，拼接漏洞的破坏面就从偷数据扩大到删库。实验场的规矩从第 1 章起就没变过：run/all/get 只收参数化的 SQL，exec 只喂我们自己写的建表脚本，永远不碰用户输入。

## 参数化查询：模板与数据分进两条通道

### 成因：与其给危险字符打补丁，不如物理分开

拼接派也有补救，叫转义：把输入里的引号改成两个引号再拼，让「看起来像语法」的字符失效。它的问题是机制性的：通道还是同一条，只是先把危险字符包起来。要包全，得背熟每一处规则——字符串里的引号一种，LIKE 里的百分号与下划线一种，各家数据库还有方言差异。漏掉任何一处，全盘破功。**转义是拼接派的创可贴**：贴住最常见的伤口，没有改变伤口存在的原因。

参数化查询（parameterized query）换思路：SQL 模板里放 ? 占位符——句子里预先挖好的空位，真值从另一条通道单独传。数据从头到尾不参加 SQL 的解析，想变成语法，没有入场券。

### 载体：两条通道

```text
拼接版（一条通道，输入与语法同流）：
  "… WHERE name = '" + 用户输入 + "' AND password = '" + 密码 + "'"

参数版（两条通道）：
  模板通道（先解析）：SELECT … WHERE name = ? AND password = ?
                                        ↑ 结构里登记过的空位
  参数通道（后绑定）：[ "admin' --", "随便填的密码" ]   ← 永远只是两个字符串值
```

### 演算：同一个 payload，走参数通道

数据库先把模板解析定型：WHERE name = ?1 AND password = ?2（?1、?2 是数据库内部给空位编的号，你写的仍是两个 ?）。两个 ? 是结构里登记好的空位，骨架此刻定死。然后把 "admin' --" 整串绑到 ?1——注意是整串，引号和减号一个不少，它们只是字符串里的九个字符。逐行判：admin 的名字是五个字符的 admin，不等于九个字符的 payload，条件一不成立，出局；全表判完，0 行。密码条件全程在场，一次也没被跳过。

实验场还做了一个更直白的验证：把 payload 当作用户名，参数化地插进表里，再按名字查回来——整串原样入库、原样返回。在参数通道眼里没有 payload，只有一个比较倔的字符串。

### 锚点：信封与信

信封与信封里的字：信封（SQL 模板）先定死，装进什么信（参数）都只是内容，字再像地址，也变不成信封本身。一句话收住，后面全用技术名。

## 预编译语句：第 1 章的 prepare 回来了

参数化查询的底层机制叫预编译语句（prepared statement）——先把 SQL 模板交给数据库解析定型，之后反复填参数执行的机制。词面上眼生，代码上你第 1 章就在用：db.run/all/get 的底层就是 prepare 加参数绑定。

```ts
// src/db.ts —— run/all/get 三个方法：底层都是 prepare + 按序绑定（第 1 章登场，原样节选）
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
```

读一遍执行路径：prepare(sql) 先把模板编译成结构，此刻 ? 只是登记过的空位；随后的 .run(...params)、.all(...params) 只往空位里塞值。Node 官方文档对这套机制的安全收益写得直白：参数提供对 SQL 注入攻击的防护。机制上的「为什么防得住」一句话说清：**不是把危险字符拦住，而是让输入根本不参加解析**。占位符按出现顺序绑定——第 1 章定下的规矩：? 有几个，参数传几个，按序对号。

把第 7 章的分层地图接上：ORM 生成的 SQL 默认全部走参数绑定——这是 ORM 顺手送的安全福利。第 10 章我们写自己的查询构建器时，生成的每一句也会带着 ? 和参数数组出厂。

## 亲手复现：从乐观期望到红

本章实验场不新增 src——db 的四个方法足够上演全部剧情；新增的是注入复现与防御的测试。测试里并排放两个版本的登录：

```ts
// tests/sql-injection.test.ts —— 两个版本的登录：同一件事的两种写法（原样节选）
/** 拼接版登录：把用户输入直接拼进 SQL 字符串——本章的反面教材 */
function loginConcat(db: Db, name: string, password: string): User | undefined {
  const sql = `SELECT id, name, password FROM users WHERE name = '${name}' AND password = '${password}'`
  return db.get<User>(sql)
}

/** 参数化版登录：SQL 模板挖好 ?，用户输入单独走参数通道 */
function loginParameterized(db: Db, name: string, password: string): User | undefined {
  return db.get<User>(
    'SELECT id, name, password FROM users WHERE name = ? AND password = ?',
    name,
    password
  )
}
```

写测试的第一步是先立乐观期望：密码是错的，拼接版应该查不回任何行。跑 npx vitest run——红的。返回的偏偏是 admin 那一行，连密码原文一起带出来。攻击者眼里的事实就是这样，直觉以为的安全并不存在。把断言改成如实记录攻击得手，再补参数版的对照：

```ts
// tests/sql-injection.test.ts —— 同一 payload 的两种命运（原样节选）
    // 密码明明是错的，拼接版却返回了 admin 那一行——攻击得手
    expect(loginConcat(db, "admin' --", '随便填的密码')).toEqual({ id: 1, name: 'admin', password: 'S3cret!' })
    // 同一 payload 走参数化：整串只是 name 的比对值，一个用户都不匹配
    expect(loginParameterized(db, "admin' --", '随便填的密码')).toBeUndefined()
```

同一 payload，两种命运。另外几个复现各盯一个经典面：' OR '1'='1 断言拼接版倒出全表 3 行、参数版 0 行；UNION payload 断言密码列顶替名字列混进结果集；删库 payload 单独一条——经 run 的 prepare 通道，注入的第二条语句从未执行，表完好无损。梗与真相各归各位。

## 见证它变绿

老地方，companion 目录下：

```bash
npx tsc --noEmit && npx vitest run
```

全绿的样子：Tests 47 passed (47)。第 1 到 5 章攒下的 41 个旧断言一个没伤，本章新增 6 个；src 一行未动——注入不是数据库的新功能，是旧知识的重新组合。

不进实验场也能复现本章核心。存成 try.mjs，跑 node try.mjs：

```js
// 用法示例：三十秒复现——拼接版被攻破、参数化版安然无恙
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(':memory:')
db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, password TEXT)")
db.exec("INSERT INTO users (name, password) VALUES ('admin', 'S3cret!')")
const payload = "admin' --"
// 拼接版：引号闭合模板、行注释吞掉密码检查
const concat = db.prepare(`SELECT id, name FROM users WHERE name = '${payload}' AND password = '${'随便填'}'`).get()
console.log('拼接版登录结果:', concat)  // { id: 1, name: 'admin' } —— 进去了
const safe = db.prepare('SELECT id, name FROM users WHERE name = ? AND password = ?').get(payload, '随便填')
console.log('参数化版登录结果:', safe)  // undefined —— 拦住了
```

两行输出并排看：同一条 SQL 意图、同一个 payload、同一个错的密码——拼接版进去了，参数版拦住了。

## 小结

两张欠条兑现完毕。SQL 注入的病根：拼字符串让数据爬进了代码的位置。逐字符看，一个引号闭合模板、两个减号开注释，密码检查就此消失；恒真条件倒全表，UNION 把密码列搬进结果集，exec 通道里删库梗是真的——攻击面全部长在「模板与数据同流」这一处。药是参数化查询：占位符挖空、参数走另一条通道，输入不参加解析；它的底层就是第 1 章起一直在用的预编译语句——prepare 先定型结构，参数后绑定；转义只是拼接派的创可贴。

你现在能做到：在测试里复现注入与防御，逐字符讲清一个 payload 改写了什么骨架，说清参数化为什么是机制性防御。

读完本章你该能回答：

- admin' -- 的每个字符分别干了什么？最终那条 SQL 只剩哪个条件？
- ' OR '1'='1 为什么能放行全表？它的首尾引号各与模板的哪个引号配对？
- '; DROP TABLE 在 run/all/get 下为什么不会得手？换成 exec 呢？
- 参数化防注入的机制一句话是什么？为什么转义不算机制性防御？
