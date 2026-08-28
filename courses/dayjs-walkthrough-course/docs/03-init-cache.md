---
title: init：为什么实例上挂满了 $ 变量
---

# init：为什么实例上挂满了 $ 变量

你已经会调用 `date()`、`month()`、`day()`，但可能没注意过：它们的返回值早在对象构造时就存好了。在调试器里展开一个 Dayjs 实例，你会看到一排 `$` 开头的字段——这一章讲它们从哪来、为什么这么设计，以及 `$` 前缀的私有约定。

## 构造函数的完整流水线

```js
// iamkun/dayjs@0f6c19e:src/index.js
class Dayjs {
  constructor(cfg) {
    this.$L = parseLocale(cfg.locale, null, true)
    this.parse(cfg) // for plugin
    this.$x = this.$x || cfg.x || {}
    this[IS_DAYJS] = true
  }

  parse(cfg) {
    this.$d = parseDate(cfg)
    this.init()
  }

  init() {
    const { $d } = this
    this.$y = $d.getFullYear()
    this.$M = $d.getMonth()
    this.$D = $d.getDate()
    this.$W = $d.getDay()
    this.$H = $d.getHours()
    this.$m = $d.getMinutes()
    this.$s = $d.getSeconds()
    this.$ms = $d.getMilliseconds()
  }
```

构造顺序四步：先定语言（`$L`，第三个参数 true 表示只解析不切全局默认）、再 parse（上一章的 parseDate + 本章的 init）、然后留一个扩展口袋 `$x`、最后打上 `$isDayjsObject` 鸭子标记。

init 是一次预计算缓存（precomputed cache，构造时把年月日等字段先算好存在实例上，getter 直接读）：把原生 Date 的八个字段一次读出、平摊到实例属性上。为什么不在每次 `date()` 时现算？因为 Date 的 getXxx 是方法调用，而后续 format、diff、startOf 全都要反复用这些字段——构造时算一次，之后全是属性读取。对一个「创建少、读取多」的日期对象，这笔账划算。

## $ 前缀与 getter 注册表

`$` 是库内不成文的私有约定：带 `$` 的是内部字段，插件可以碰（`this.$d` 就是插件的常客），但属于「知道你在做什么」的地带。而公开的 `year()/month()/date()` 是在文件末尾用一张注册表批量挂上的：

```js
// iamkun/dayjs@0f6c19e:src/index.js
const proto = Dayjs.prototype
dayjs.prototype = proto;
[
  ['$ms', C.MS],
  ['$s', C.S],
  ['$m', C.MIN],
  ['$H', C.H],
  ['$W', C.D],
  ['$M', C.M],
  ['$y', C.Y],
  ['$D', C.DATE]
].forEach((g) => {
  proto[g[1]] = function (input) {
    return this.$g(input, g[0], g[1])
  }
})
```

每个公开方法都是同一个模板：有入参就转 set、无入参读对应 `$` 字段——分派逻辑在 `$g(input, get, set)` 里。注意 `$W` 对应的公开单位是 `C.D`（day of week，`day()`）而 `$D` 对应 `C.DATE`（day of month，`date()`），两个「日」不要混。

## 缓存的一致性由谁维护

预计算缓存有个天然风险：底层 `$d` 变了，缓存忘了刷新怎么办？dayjs 的答案在 `$set` 的尾部——任何原地修改 `$d` 的路径，最后一行都是 `this.init()` 重算全部缓存。这是「一处修改、一处重算」的纪律：缓存不是数据，是 `$d` 的影子。你可以在第 4 章看到 `$set` 的完整实现时回头验证这一点。

另一个值得想清楚的对比是「为什么不写成惰性求值」——每次 `year()` 现调 `getFullYear()`。惰性永远不会脏，但 dayjs 的典型负载是「构造一次、format 一遍、diff 一遍」：一次 init 换后续全是属性读取，比八次方法调用加起来便宜。顺带一提，原生 Date 本身是可变对象（setMonth 之类原地改），所以第 1 章入口处「Date 入参复制一份」与本章的快照缓存，都是围绕同一个事实设防：底下的 Date 随时可能被人改，dayjs 用复制与快照把自己隔离在变化之外。

`this.$x = this.$x || cfg.x || {}` 这个扩展口袋也别放过：它是给插件放自定义状态的位置——utc 插件把时区偏移存在这里。内核不认识 `$x` 里的内容，只负责把口袋递给每一代克隆，于是插件状态也能跟着实例一起流转。

## 验证：亲手跑探针

- 先猜后跑：先猜 `d.$y === d.year()` 是 true 还是 false，再跑：

```bash
cd companion && npm test   # ch03 组 6 条断言
```

探针逐项断言 `$y/$M/$D/$W` 与对应 getter 相等，外加一个具体事实（2026-08-28 的 `$W` 是 5，周五）和注册表的结构断言。你也可以在 node 里 `Object.keys(dayjs())` 亲眼看那排 `$` 字段。
- 动手一问：`const d = dayjs(); d.$D` 与 `d.date()` 会不一致吗？想清楚读取时机再回答（答案：不会——同一个实例上，两者都来自它出生那一次 init 的快照；但两个 `dayjs()` 是两次构造，跨午夜边界时各自快照就不同了）。

## 一张实例的全景图

到这里可以给 Dayjs 实例画一张全景图了：`$d` 是唯一的事实源（原生 Date），`$y/$M/$D/$W/$H/$m/$s/$ms` 是它的影子快照，`$L` 记语言、`$x` 是插件口袋、`$isDayjsObject` 是出生证明。九个时间字段（$d 加八个缓存）之外，只剩 $L、$x、$isDayjsObject 三个元字段——没有缓存池、没有订阅表、没有隐藏的定时器。一个对象为何能被安全地到处传递？因为它的全部行为都由这九个字段决定，而前八章你看过的每一个机制（克隆、解析、缓存、不可变），都是在维护这九个字段的一致性。读源码读到「数得清的状态」这一步，这个库的骨架对你就再没有秘密了——剩下的只是行为怎么从这九个字段里长出来。

## 小结与自查

构造 = 语言 + 解析 + 缓存 + 标记四步；init 把八个时间字段预计算成 `$` 属性，公开 getter 是同一模板批量注册的读/写双面函数。这一章之后，实例的静态结构你就全认识了——下一章进入它最重要的行为承诺：任何修改都返回新对象。

- 自查一：`dayjs('2026-08-28').$M` 是多少？为什么不是 8？

<details><summary>看答案</summary>

7。原生 Date 月份从 0 起，`$M` 存的就是原生值；公开的 `month()` 返回同样口径（回查 init 一节）。

</details>

- 自查二（预测）：给 `dayjs().date(15)` 传了参数，它还返回数字吗？

<details><summary>看答案</summary>

不——传参即 set，返回新实例（回查 `$g` 分派与注册表一节）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
