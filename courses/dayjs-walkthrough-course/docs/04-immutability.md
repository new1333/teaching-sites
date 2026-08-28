---
title: 不可变性：add/set 为什么返回新对象
---

# 不可变性：add/set 为什么返回新对象

先看一个每几周就有人提 issue 的场景：`const a = dayjs(); a.add(1, "day"); console.log(a.date())`——加了一天，a 却纹丝不动。第一次遇到的人多半以为撞了 bug；读完源码你会发现这不是 bug，是写进每个修改方法里的承诺，而且它的实现路径只有两个函数。

## 承诺先于实现

dayjs 的 README 特性清单第二条就是「Immutable」。所谓不可变实例（immutable instance，任何修改操作都返回新实例、原实例保持不变的约定）。这个承诺在时间处理场景里尤其值钱：日期常常同时被多个视图引用，如果 add 原地修改，一个倒计时的刷新可能悄悄改掉另一个报表的基准时间。先猜后跑：`a.add(1,'day')` 之后 a 的日期变不变？写代码前先写下你的答案，本章结尾的探针替你验证。

## set 的路径：克隆再改

```js
// iamkun/dayjs@0f6c19e:src/index.js
  $set(units, int) { // private set
    const unit = Utils.p(units)
    const utcPad = `set${this.$u ? 'UTC' : ''}`
    const name = {
      [C.D]: `${utcPad}Date`,
      [C.DATE]: `${utcPad}Date`,
      [C.M]: `${utcPad}Month`,
      [C.Y]: `${utcPad}FullYear`,
      [C.H]: `${utcPad}Hours`,
      [C.MIN]: `${utcPad}Minutes`,
      [C.S]: `${utcPad}Seconds`,
      [C.MS]: `${utcPad}Milliseconds`
    }[unit]
    const arg = unit === C.D ? this.$D + (int - this.$W) : int

    if (unit === C.M || unit === C.Y) {
      // clone is for badMutable plugin
      const date = this.clone().set(C.DATE, 1)
      date.$d[name](arg)
      date.init()
      this.$d = date.set(C.DATE, Math.min(this.$D, date.daysInMonth())).$d
    } else if (name) this.$d[name](arg)

    this.init()
    return this
  }

  set(string, int) {
    return this.clone().$set(string, int)
  }
```

公开的 `set` 只有一行：先 clone 再交给私有的 `$set` 去改。也就是说**修改发生在克隆体上**，原实例从头到尾没被碰过。`$set` 内部反而会原地操作 `this.$d`——命名时就宣告了它是 private，只有走完 clone 的克隆体才被允许进来。注意它尾部那句 `this.init()`：第 3 章埋的伏笔在这里兑现，改完底层 Date 必须重算全部缓存影子。

这段代码还有两处值得驻足的细节。其一，月/年分支先 `set(DATE, 1)` 再改值最后夹回月末：直接把 1 月 31 日 set 成 2 月会溢出成 3 月 3 日，先落到 1 号、改完月、再 `Math.min(this.$D, daysInMonth())` 夹住，语义就稳定了。其二，那行注释（clone is for badMutable plugin）透出生态的现实：官方甚至提供了把库改回可变的插件，内核为它留了缝。好的不可变实现连「违背自己」的出路都是显式的。

## add 的路径与 wrapper

```js
// iamkun/dayjs@0f6c19e:src/index.js
  add(number, units) {
    number = Number(number) // eslint-disable-line no-param-reassign
    const unit = Utils.p(units)
    const instanceFactorySet = (n) => {
      const d = dayjs(this)
      return Utils.w(d.date(d.date() + Math.round(n * number)), this)
    }
    if (unit === C.M) {
      return this.set(C.M, this.$M + number)
    }
    if (unit === C.Y) {
      return this.set(C.Y, this.$y + number)
    }
    if (unit === C.D) {
      return instanceFactorySet(1)
    }
    if (unit === C.W) {
      return instanceFactorySet(7)
    }
    const step = {
      [C.MIN]: C.MILLISECONDS_A_MINUTE,
      [C.H]: C.MILLISECONDS_A_HOUR,
      [C.S]: C.MILLISECONDS_A_SECOND
    }[unit] || 1 // ms

    const nextTimeStamp = this.$d.getTime() + (number * step)
    return Utils.w(nextTimeStamp, this)
  }
```

add 按单位分流：年月复用 set（自动继承月末夹持）；天与周走「日期数字加减」（跨月跨年由原生 Date 归一化，`d.date(d.date() + n)` 就是那个著名的技巧）；时分秒毫秒最直接——时间戳加完事。三条路的出口都是 `Utils.w(...)`，wrapper：

```js
// iamkun/dayjs@0f6c19e:src/index.js
const wrapper = (date, instance) =>
  dayjs(date, {
    locale: instance.$L,
    utc: instance.$u,
    x: instance.$x,
    $offset: instance.$offset // todo: refactor; do not use this.$offset in you code
  })
```

wrapper 把新值重新包回 dayjs，同时把旧实例的语言、utc 标记、插件口袋原样继承——这就是为什么 `zhCnDayjs.add(1,'day')` 仍然是中文实例。不可变的所有路径最终都汇到这一个函数：**新值 + 旧上下文 = 新实例**。

## 这份承诺的代价与边界

不可变不是免费的。每次 add 都克隆一个新实例、重算一遍八个缓存字段。单次调用里这点开销可以忽略，但在渲染千行的日历组件里，误用的链式调用会放大成上千次构造。dayjs 的应对不是放弃不可变，而是把选择权交给生态：badMutable 插件能把库改回原地修改、换取热路径性能——文档同时警告它违背一切既有假设。内核为它留的那行注释（clone is for badMutable plugin）就是这个立场的注脚：默认安全，显式越界。

还有一条隐形的边界值得点破：不可变承诺的是**实例**不变，不是世界不变。`dayjs()` 的结果永远停在出生那一刻，跨分钟的页面刷新要重新取现在。这不是缺陷而是语义：快照式的时间值，让每一帧渲染的数据来源都可追溯。理解这层，你就理解了 React 文档反复强调的「把 state 当快照对待」为什么也适用于日期值。

## 验证：亲手跑探针

```bash
cd companion && npm test   # ch04 组 7 条断言
```

行为断言覆盖 add/set 两个方向：原实例字段不变、新实例值已变、两者不是同一对象；结构断言确认 `set` 确实只有 `clone().$set` 一行、add 的天数路径确实经 wrapper。开头那个「先猜后跑」的答案也在里面——a 从未被改动，这行代码在 dayjs 里本来就「什么都没发生」。再补一个动手位：把探针里 add 的单位换成 month、日期换成 1 月 31 日。先按本章的月分支推演结果，再跑探针验证——不可变与月末夹持两个知识点会在同一题里同时出现。

## 小结与自查

不可变不是魔法，是纪律：公开 API 一律克隆后修改，私有 `$set` 才有原地权限；改完必 `init()` 刷缓存；出口必经 wrapper 继承上下文。年月的溢出夹持是分支里最容易踩的坑，也被同一段代码一并处理。

- 自查一（预测）：`dayjs('2026-01-31').add(1, 'month').format('YYYY-MM-DD')` 输出什么？

<details><summary>看答案</summary>

`2026-02-28`——add 月走 set 月，先落 1 号再夹回月末（回查 $set 的月分支）。

</details>

- 自查二：为什么 `$set` 敢原地改 `this.$d`，而公开 `set` 不敢？

<details><summary>看答案</summary>

`$set` 的 this 是公开 set 克隆出来的新实例，改的是无人引用的克隆体（回查「克隆再改」一节）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
