---
title: startOf/endOf：单位对齐的两个工厂
---

# startOf/endOf：单位对齐的两个工厂

一个会让人愣住的现象：`startOf("week")` 在英文环境把周日对齐回当天，切到中文语言包、同一行代码却回到周一——同一函数，两种答案。这不是国际化 bug，而是 week 这个月份之外的单位天然依赖「一周从哪天开始」的约定。这一章读 startOf/endOf 的实现，看它如何用两个工厂函数吃下所有单位。

## 单位对齐：日历运算的地基

单位对齐（unit alignment，把日期推到某单位边界——周初、月初、年首——的操作）听起来抽象，但 isSame、diff、日历渲染全都踩在它上面。判断「是不是同一周」就是比较两人的 startOf('week')。看实现主干：

```js
// iamkun/dayjs@0f6c19e:src/index.js
  startOf(units, startOf) { // startOf -> endOf
    const isStartOf = !Utils.u(startOf) ? startOf : true
    const unit = Utils.p(units)
    const instanceFactory = (d, m) => {
      const ins = Utils.w(this.$u ?
        Date.UTC(this.$y, m, d) : new Date(this.$y, m, d), this)
      return isStartOf ? ins : ins.endOf(C.D)
    }
    const instanceFactorySet = (method, slice) => {
      const argumentStart = [0, 0, 0, 0]
      const argumentEnd = [23, 59, 59, 999]
      return Utils.w(this.toDate()[method].apply( // eslint-disable-line prefer-spread
        this.toDate('s'),
        (isStartOf ? argumentStart : argumentEnd).slice(slice)
      ), this)
    }
    const { $W, $M, $D } = this
    const utcPad = `set${this.$u ? 'UTC' : ''}`
    switch (unit) {
      case C.Y:
        return isStartOf ? instanceFactory(1, 0) :
          instanceFactory(31, 11)
      case C.M:
        return isStartOf ? instanceFactory(1, $M) :
          instanceFactory(0, $M + 1)
      case C.W: {
        const weekStart = this.$locale().weekStart || 0
        const gap = ($W < weekStart ? $W + 7 : $W) - weekStart
        return instanceFactory(isStartOf ? $D - gap : $D + (6 - gap), $M)
      }
      case C.D:
      case C.DATE:
        return instanceFactorySet(`${utcPad}Hours`, 0)
      case C.H:
        return instanceFactorySet(`${utcPad}Minutes`, 1)
      case C.MIN:
        return instanceFactorySet(`${utcPad}Seconds`, 2)
      case C.S:
        return instanceFactorySet(`${utcPad}Milliseconds`, 3)
      default:
        return this.clone()
    }
  }

  endOf(arg) {
    return this.startOf(arg, false)
  }
```

先看目录结构再抠细节。`endOf` 只有一行——它就是 `startOf(arg, false)`，第二个参数把同一个 switch 的语义从「对齐到头」翻成「对齐到尾」。一个 switch 服务两个 API，靠的是每个分支里的 `isStartOf` 三元。

两个工厂各管一类单位。`instanceFactory` 管年、月、周这类「日期级」单位：直接 `new Date(年, 月, 日)` 造出对齐后的日期，参数分别是年初（1 月 0 日）/月末（0 日下月即当月末）——注意月末用的是「下个月第 0 天」这个原生技巧，天然落在当月最后一天，不用查表。`instanceFactorySet` 管时、分、秒、毫秒这类「时刻级」单位：把 `[0,0,0,0]`（头）或 `[23,59,59,999]`（尾）按单位切掉几位，apply 到对应的 set 方法上——`slice(0)` 清到毫秒、`slice(1)` 清到秒、以此类推。两个工厂最后都经 `Utils.w(...)` 包装，第 4 章的 wrapper 再次出现：新值、旧上下文。

## week 为什么有两种答案

最上面的谜底在 `case C.W` 分支。`weekStart` 取自当前语言包（`$locale().weekStart || 0`），en 没配这项、默认 0（周日），zh-cn 配了 1（周一）。gap 的算法处理跨界：如果今天的星期序号小于周起点（比如周三遇到以周一为起点的表），加 7 再减——保证「往回退 gap 天」一定落在本周第一天。于是 2026-08-30 这个周日：en 表里它就是本周第一天，对齐回自己；zh-cn 表里它属于下一周的末尾区域，往前退 6 天到周一 08-24。同一函数、两种答案，答案都正确，因为「一周」本身就是个约定。

顺带看一个可爱的复用：

```js
// iamkun/dayjs@0f6c19e:src/index.js
  daysInMonth() {
    return this.endOf(C.M).$D
  }
```

一个月有多少天？把日期推到本月最后一天，读日期数字。「下月第 0 天」的技巧换了个姿势再次出现——好代码里的技巧会被用第二次。

## 一个 switch 的复利

回头数一数这个 switch 服务的面孔：startOf 与 endOf 两个公开 API；isSame、isBefore、isAfter 三个比较方法全部建在它之上——比较就是对齐后比大小；daysInMonth 也来借道。八个单位的分支、两个工厂、一个布尔翻转——dayjs 用一个函数扛起了整个「日历语义」层。这是小库源码最值得反复看的一类结构：**找到一个足够基本的概念（对齐），把所有上层运算都折叠到它上面**。你以后设计任何领域工具，先找这个概念，比先列 API 清单有用得多。

顺带留意 default 分支的 `return this.clone()`：遇到不认识的单位不抛错、原样克隆返回——和第 2 章「无效是值不是异常」的错误哲学一脉相承。整库的口味在这类小决定里高度一致，这也是读完整源码比读文档多出来的东西：你开始能预测它下一个函数会怎么写。

## 验证：亲手跑探针

```bash
cd companion && npm test   # ch05 组 7 条断言
```

探针覆盖：月初对齐、daysInMonth 借 endOf、endOf 的一行实现，以及 en 与 zh-cn 两种周对齐答案——2026-08-30 分别得到 08-30 与 08-24；结构断言核对 weekStart 与 daysInMonth 两处源码形态。动手部分：在 node 里把 2026-08-30（周日）分别用两种语言包 startOf('week')，亲眼看到那 6 天的差距从哪来。再往深一步：isSame(other, 'week') 的结果会不会也随语言包翻转？先按「比较就是对齐后比大小」推一遍，再用两个跨周日期验证——这一题直接检验你是否真的理解了 switch 之上的折叠结构。推演时记住顺序：先对齐、再比较。把这个顺序讲给别人听一遍，能讲清就懂了。讲不清就回到那张 switch 表再看一遍——这也是走读课与刷 API 文档最大的不同：你要的是能复述机制，不是记住签名。

## 小结与自查

startOf 是一张按单位分流的 switch：日期级单位用「造新日期」工厂，时刻级单位用「参数切片」工厂；endOf 是 startOf 的第二人格；week 的答案藏在语言包的 weekStart 里。加上第 4 章的 wrapper，你已经看完这个库全部的「造实例」路径。

- 自查一（预测）：`dayjs('2026-08-28T15:00').startOf('day').format('HH:mm')` 是什么？

<details><summary>看答案</summary>

`00:00`——日属于时刻级对齐，切片到毫秒全清零（回查 instanceFactorySet）。

</details>

- 自查二（动笔）：zh-cn 语言包下，周四的 `startOf('week')` 往回退几天？

<details><summary>看答案</summary>

3 天——weekStart=1，gap = 4 − 1 = 3（回查 C.W 分支的 gap 算式）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
