---
title: parseDate：四类输入，一条路径
---

# parseDate：四类输入，一条路径

上一章你看到工厂把输入装进 `cfg.date` 就交给了类；类构造时第一件事就是把它变成原生 Date。这里有一个每个人都撞过的现象：`dayjs("2026-8-28")` 能解析，`dayjs("2026年8月28日")` 得到 Invalid Date——分水岭是一条正则。读完本章你会知道任何输入走哪条分支、为什么 null 的设计是故意的。

## 四条分支，从上到下

```js
// iamkun/dayjs@0f6c19e:src/index.js
const parseDate = (cfg) => {
  const { date, utc } = cfg
  if (date === null) return new Date(NaN) // null is invalid
  if (Utils.u(date)) return new Date() // today
  if (date instanceof Date) return new Date(date)
  if (typeof date === 'string' && !/Z$/i.test(date)) {
    const d = date.match(C.REGEX_PARSE)
    if (d) {
      const m = d[2] - 1 || 0
      const ms = (d[7] || '0').substring(0, 3)
      if (utc) {
        return new Date(Date.UTC(d[1], m, d[3]
          || 1, d[4] || 0, d[5] || 0, d[6] || 0, ms))
      }
      return new Date(d[1], m, d[3]
        || 1, d[4] || 0, d[5] || 0, d[6] || 0, ms)
    }
  }

  return new Date(date) // everything else
}
```

四个 if 自上而下：**null 直接变无效**（`new Date(NaN)`）；**undefined 走「今天」**（`Utils.u` 是 undefined 判断）；**原生 Date 复制一份**（`new Date(date)`，防外部引用改动）；**字符串先过正则**。全都不中，最后一行 `new Date(date)` 兜底——数字时间戳、以及原生构造函数能理解的一切，都从这里进。

两个设计点值得停下。其一，null 被显式判为无效而不是交给兜底：`new Date(null)` 会得到 1970 年 1 月 1 日——一个「合法但错误」的时间，比 Invalid Date 危险得多；库选择在这里就把错拦下。其二，字符串分支的条件是 `!/Z$/i.test(date)`——带 Z 结尾的 ISO 串（含时区）跳过正则，直接交给原生 `new Date`，因为时区语义正则拆不准。这就是正则解析回退（regex parse fallback，字符串先用正则拆字段，拆不动交给 new Date 兜底的分层策略）。

## 那条分水岭正则

```js
// iamkun/dayjs@0f6c19e:src/constant.js
export const REGEX_PARSE = /^(\d{4})[-/]?(\d{1,2})?[-/]?(\d{0,2})[Tt\s]*(\d{1,2})?:?(\d{1,2})?:?(\d{1,2})?[.:]?(\d+)?$/
```

按捕获组读：四位年、可选的月、可选的日、可选的时分秒与毫秒，分隔符只认 `-` `/` 和空白。所以 `2026-08-28`、`2026/8/28` 都能拆开，而 `2026年8月28日` 一个字符都对不上——`match` 返回 null，落进兜底的 `new Date("2026年8月28日")`，多数引擎给出 Invalid Date。注意拆完后的 `d[2] - 1`：正则捕的是「8 月」的人类月份，原生 Date 的月份从 0 数，减一就在这一行完成。

## 逐组读那条正则

把 REGEX_PARSE 的捕获组排开看，它其实是一张「人类日期写法」的宽容清单：

```text
组1  (d{4})        年       必填
组2  (d{1,2})?     月       可选，1-2 位
组3  (d{0,2})      日       可选，0-2 位
组4-6 (d{1,2})?    时/分/秒  各可选
组7  (d+)?         毫秒     可选
分隔 [-/] 与 [Tt 或任意空白] 都接受，冒号点号可有可无
```

三个换算细节藏在匹配之后：月份减一（人类 8 月 → 引擎 7）；毫秒 `substring(0, 3)` 截到三位（防止用户写一长串微秒）；缺省的日补 1、时分秒补 0——`d[3] || 1` 这类兜底让 "2026" 直接成为 2026 年 1 月 1 日。

对比一下前辈 moment 的教训有助于理解这条正则为什么刻意收紧：moment 时代大量「看着像日期」的字符串交给浏览器原生解析，不同引擎给出不同结果，跨浏览器 bug 由此而来。dayjs 的选择是：正则明确能拆的才拆，拆不动的一律走原生兜底、行为与引擎一致——宁可 Invalid Date，不要静默猜错。分层解析的每一层都只做自己有把握的事。

再看一眼那条正则里最不起眼的一个决定：毫秒组用 `(\d+)?` 收一串数字，再截前三位。为什么不在正则里直接限定三位？因为合法写法太多——`0.1`、`123`、`123456` 都会出现，正则写得越窄误杀越多；收宽再截断，宽容与精确各占一半。库源码里这类「在哪一层收紧」的取舍随处可见，读的时候多问一句「为什么是这一层」，比背下正则本身有用得多。下一次你自己写字符串解析，同样要在正则、手工拆分、引擎兜底之间画线——dayjs 的画法已被千万级下载量验证过。

## 验证：亲手跑探针

- 先猜后跑：先猜 `dayjs("2026-8-28").format('YYYY-MM-DD')` 与 `dayjs(new Date("2026-08-28T10:00:00")).isValid()` 的结果，再跑：

```bash
cd companion && npm test   # ch02 组 7 条断言
```

探针验证了四条分支各走各路：null 无效、无参即今天、两种分隔符都进正则、原生 Date 入参有效；结构断言确认 REGEX_PARSE 定义在 constant.js、兜底行原样存在。想亲眼看分支，可以在 node 里把各种字符串喂给锁定源码，用 `isValid()` 观察结果。
- 动手：构造一个「正则能匹配但语义奇怪」的输入（比如 `"2026"`），猜猜它解析成什么，再验证。

## 从 Invalid Date 到错误哲学

这一章还藏着 dayjs 的错误哲学：不抛异常，把无效当作一种值带着走。isValid() 返回 false、format 输出 "Invalid Date" 字符串、toJSON 给 null——无效状态渗透到每个出口。但任何一条路径都不会因为一个坏输入中断整个页面。对一个被嵌在渲染链路里的日期库，这是务实的选择；对比「一错就 throw」的库，代价是你必须记得在边界处问一句 isValid。读库时留意这类「错误也是 API 的一部分」的设计，比记住任何单个函数更有迁移价值。你以后写的每个工具函数都要在抛与不抛之间做选择，dayjs 给出了可辩护的答案：携带，而非中断。

## 小结与自查

parseDate 是一个漏斗：null 拦下、undefined 给今天、Date 复制、字符串先正则后兜底、其余全交原生构造。Invalid Date 不是异常而是值——库的设计哲学是不抛错、把无效状态带在身上。下一章看构造函数里 parse 之后的另一半：init 把 Date 的字段摊平缓存到实例上。

- 自查一（预测）：`dayjs("2026-08-28T10:00:00Z")` 走正则分支还是兜底分支？

<details><summary>看答案</summary>

兜底——Z 结尾被 `!/Z$/i.test(date)` 排除在正则之外，直接交原生构造（回查「四条分支」一节）。

</details>

- 自查二：为什么 null 不交给 `new Date(date)` 兜底处理？

<details><summary>看答案</summary>

`new Date(null)` 是 1970-01-01，合法但错误；显式返回 `new Date(NaN)` 让无效尽早暴露（回查 null 分支旁的设计点）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
