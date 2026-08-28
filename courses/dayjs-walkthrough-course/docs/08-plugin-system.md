---
title: extend：三十多个插件共用的三个参数
---

# extend：三十多个插件共用的三个参数

最后一个故事场景：一个团队把 `dayjs.extend(plugin)` 写进了两个模块，程序跑得很好。第二次调用发生了什么？什么都没发生——而且这是对的。这一章读插件系统的全部实现（它真的只有七行）、三个参数各自的分量，以及一个真实插件的完整源码。给机器人开放两个接口随便装配件——三个参数就是这样的开放面。

## 七行核心：安装与幂等

```js
// iamkun/dayjs@0f6c19e:src/index.js
dayjs.extend = (plugin, option) => {
  if (!plugin.$i) { // install plugin only once
    plugin(option, Dayjs, dayjs)
    plugin.$i = true
  }
  return dayjs
}
```

extend 做的事：如果这个插件还没装过（看 `$i` 标记），就调用它——`plugin(option, Dayjs, dayjs` 三个参数——然后打上「已安装」标记。第二次 extend 同一个插件时 `$i` 已是真，整个 if 跳过：**幂等安装**（idempotent install，重复执行无副作用）由此而来。为什么需要幂等？因为插件通常在多个模块里各自 import 各自 extend，没有一个「中央注册处」协调顺序——没有幂等，week 方法会被挂两遍、locale 被注册两次。把去重做进安装器本身，使用方就完全不用操心顺序与重复。

顺带注意返回值是 dayjs 自己——extend 可以链着写：`dayjs.extend(a).extend(b)`。这里也兑现第 1 章埋的伏笔：工厂存进配置的 `cfg.args`（出生时的原始参数）正是插件重新解读的原料——utc 这类插件需要按「当时的原始入参」重建实例，而不是从已经解析好的字段往回猜。出生证明随 cfg 进了实例，插件此后随时可以查证。

## 三个参数：插件的全部能力面

`plugin(option, Dayjs, dayjs)` 这个函数签名就是插件协议。三个参数各给一种能力：

- **option**：使用方传入的配置（比如 utc 插件的偏移量偏好），插件自取；
- **Dayjs（类）**：插件拿到类，就能改它的原型——给所有实例加方法，这是绝大多数插件的全部工作；
- **dayjs（工厂）**：拿到工厂，就能在插件代码里造新实例（下面 weekOfYear 源码里的 `d(this)` 就是它）、也能访问工厂上挂的静态方法。

再对照入口处那三行工具装配：

```js
// iamkun/dayjs@0f6c19e:src/index.js
const Utils = U // for plugin use
Utils.l = parseLocale
Utils.i = isDayjs
Utils.w = wrapper
```

内核把 parseLocale、isDayjs、wrapper 挂到工具集上开放给插件。第 4 章那个「新值 + 旧上下文」的 wrapper，插件造实例时同样要用。至此你能完整说出一个插件能碰什么：类原型、工厂函数、工具集，仅此而已。权限清单这么短，生态却长出了 utc、timezone、relativeTime、duration 等几十个官方插件——接口越少，生态越稳。

## 一个真实插件的完整源码

weekOfYear 给实例挂 `week()`（一年中的第几周）。整包源码：

```js
// iamkun/dayjs@0f6c19e:src/plugin/weekOfYear/index.js
import { MS, Y, D, W } from '../../constant'

export default (o, c, d) => {
  const proto = c.prototype
  proto.week = function (week = null) {
    if (week !== null) {
      return this.add((week - this.week()) * 7, D)
    }
    const yearStart = this.$locale().yearStart || 1
    if (this.month() === 11 && this.date() > 25) {
      // d(this) is for badMutable
      const nextYearStartDay = d(this).startOf(Y).add(1, Y).date(yearStart)
      const thisEndOfWeek = d(this).endOf(W)
      if (nextYearStartDay.isBefore(thisEndOfWeek)) {
        return 1
      }
    }
    const yearStartDay = d(this).startOf(Y).date(yearStart)
    const yearStartWeek = yearStartDay.startOf(W).subtract(1, MS)
    const diffInWeek = this.diff(yearStartWeek, W, true)
    if (diffInWeek < 0) {
      return d(this).startOf('week').week()
    }
    return Math.ceil(diffInWeek)
  }

  proto.weeks = function (week = null) {
    return this.week(week)
  }
}
```

用协议读它：`c` 是类，取原型挂方法——两行完成注册。方法体全部用公开 API 写成：startOf、add、diff、$locale——没有一个 `$` 私有字段的硬依赖（唯一的 `d(this)` 造克隆，是给 badMutable 留的兼容）。算法也有可读的骨架：找到「年内第一个周起点」，算当前日差它几周，年末年末的跨年边界用 yearStart 与 12 月 25 日后的特判处理。一个插件该有的样子：站在内核的公开面上写功能，不掏内脏——你以后写第三方扩展时，这条纪律同样适用。

## 协议设计的对照练习

把 dayjs 的插件协议与两个常见方案对照，能看出取舍。方案一「选项对象」：extend({ install(cls) {} })——更正式，但多一层包装、树摇（tree-shaking，打包时删除无用代码）更差。方案二「继承子类」：class MyDayjs extends Dayjs。类型干净，但两个插件各继承一支就合不到一起。dayjs 选「函数直接改原型」：不加包装、天然可组合（都改同一个原型）、代价是类型系统需要在 d.ts 里 declare module 补声明（仓库 types/ 目录就是干这个的）。没有完美方案，只有对「2KB + 几十插件共存」这个目标的最优解。判断协议好坏的标准从来不是「能不能」，而是「生态长出来之后还稳不稳」。

顺带留意 extend 装在 dayjs 工厂上而不是 Dayjs 类上。使用方拿到的一手对象永远是工厂（你 import 的就是它），扩展入口放在最顺手的位置，也是协议可用性的一部分。

## 验证：亲手跑探针

```bash
cd companion && npm test   # ch08 组 7 条断言
```

探针验证：extend 之后 `$i` 标记为真、重复 extend 不重置、2026-01-01 的 week() 得 1、实例上真的出现了 week 方法；结构断言核对协议三参数、`$i` 幂等标记、插件取原型的写法。动手部分：extend 之前先试 `dayjs().week`——它是 undefined；装完再看。一个方法凭空出现在全部实例上，这六行就是全部原因。

## 小结与自查

插件系统 = 六行安装器 + 一份三个参数的权限清单 + 一套开放工具。幂等靠 `$i`，扩展靠改原型，稳定性靠「只用公开面」的插件写作纪律。到这里，dayjs 的内核与生态机制全部走读完毕——最后一章把整张地图串起来。

- 自查一（预测）：两个模块各自 `dayjs.extend(relativeTime)`，relativeTime 的函数体执行几次？

<details><summary>看答案</summary>

一次——第二次 extend 时 `$i` 为真，整段跳过（回查「六行核心」）。

</details>

- 自查二：为什么插件挂方法用 `c.prototype` 而不是给 dayjs 工厂挂？

<details><summary>看答案</summary>

挂原型让全部实例（含未来克隆）都有方法；挂工厂只等于加静态工具，实例上调用不到（回查「三个参数」）。

</details>

术语见[术语表](./glossary)；文件索引见[源码地图速查](./source-map)。
