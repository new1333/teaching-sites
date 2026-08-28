---
title: dayjs() 是个工厂：入口与实例
---

# dayjs() 是个工厂：入口与实例

你大概写过一百遍 `dayjs()`，但有没有注意过一个细节：往它里面再传一个 Dayjs 对象，它不报错、也不原样还你——而是克隆一个新的还你。这个细节是整个库的入口设计，也是我们走读的第一站。本课全部引用出自锁定版本 `iamkun/dayjs@0f6c19e`（源码遵循 MIT 许可，课程为独立教学解读，非官方文档），你 checkout 同一提交就能逐行对上。跑之前先认识一件事：src 里的 `import * as C from './constant'` 不带 .js 扩展名——这是写给 rollup 这类打包器的源码（食材），npm 包才是做好的菜。node 原生 ESM 不解析这种写法，所以伴生仓的探针带了一个 resolve hook（probes/register.mjs）：补扩展名、把语言包自引的 dayjs 指回源码本体。

## 工厂函数：藏住 new 的那一层

`dayjs` 不是类，是一个普通函数——工厂函数（factory function，不暴露 new、用普通函数创建并返回对象的封装方式）。看它的完整实现：

```js
// iamkun/dayjs@0f6c19e:src/index.js
const dayjs = function (date, c) {
  if (isDayjs(date)) {
    return date.clone()
  }
  // eslint-disable-next-line no-nested-ternary
  const cfg = typeof c === 'object' ? c : {}
  cfg.date = date
  cfg.args = arguments// eslint-disable-line prefer-rest-params
  return new Dayjs(cfg) // eslint-disable-line no-use-before-define
}
```

四行有效代码做了三件事。第一件是**克隆防御**：入参已经是 Dayjs 实例就返回它的克隆。为什么不给原对象？因为调用方拿到它之后可能连续操作，如果返回原对象，两处引用就会指向同一个可变状态。实例底下的原生 Date 本身是可变的——clone 路径经 `new Date(date)` 复制隔离，防的就是它（此处源码无注释，按复制路径推断）。克隆让每个调用方拿到自己的副本，就像银行流水只增不改、要改就开新条目。第二件是组装配置对象 `cfg`：把日期放进 `cfg.date`，第二个参数（locale、utc 等配置）合并进来。第三件才是 `new Dayjs(cfg)`——把脏活留给类，门口只留一个干净的函数脸。

判断「入参是不是 Dayjs」用的是 `isDayjs`：

```js
// iamkun/dayjs@0f6c19e:src/index.js
const IS_DAYJS = '$isDayjsObject'

// eslint-disable-next-line no-use-before-define
const isDayjs = d => d instanceof Dayjs || !!(d && d[IS_DAYJS])
```

这里有个值得学的细节：`instanceof Dayjs` 之外还看 `d[IS_DAYJS]` 标记——鸭子类型标记（duck typing flag，用对象上的标志属性判断类型，不依赖 instanceof）。为什么两套？因为插件生态里可能出现多个 dayjs 副本，跨副本的 `instanceof` 会失灵，而实例构造时挂上的 `$isDayjsObject` 属性永远在。你在类的构造函数末尾能看到 `this[IS_DAYJS] = true` 这行——标记是在出生时打上的。

## 为什么是工厂而不是直接导出类

把 `new Dayjs(cfg)` 藏进函数里有三层好处。第一层是 API 面更小：使用者只需要认识 `dayjs(...)` 一个入口，类的名字、构造细节都不进文档。第二层是为克隆防御留了位置：如果用户直接 `new`，入口的 `isDayjs` 分支就无处安放。第三层是历史经验：moment 也是工厂入口（`moment()`），后来者沿用这个形状，迁移成本最低。设计一个库的「门脸」时，函数比类更容易在日后加逻辑——这一课适用于任何你要写的工具库。

还有一个容易被扫过去的细节：`cfg.args = arguments` 把原始参数原样存进了配置。为什么留着？因为 utc 等插件需要在已知「当时的原始入参」的前提下重新解析——工厂把出生证明一并塞给实例，后续的重新解读不必猜。你会在第 8 章插件协议里再遇到它。

## 为什么值得 clone 防御

做个反事实：如果 `dayjs(existing)` 直接返回原对象会怎样？下面的代码就会踩坑：

```js
// 用法示例
const a = dayjs('2026-08-28')
const b = dayjs(a).add(1, 'day')
// 若不克隆：b 与 a 是同一个对象，add 若原地修改，a 也被改了
```

克隆防御保证「重新包装」是无损且无副作用的——这是后面第 4 章不可变性的第一块砖。

## 验证：亲手跑探针

- 先猜后跑：先猜 `dayjs(existing) === existing` 是 true 还是 false，写下猜测再跑：

```bash
cd companion && npm test   # ch01 组 5 条断言
```

探针在锁定 ref 的源码上直接跑（探针带一个 resolve hook 直连锁定源码，不经任何转写），其中两条行为断言分别验证「克隆不等于原对象」「克隆与原对象值相等」，三条结构断言验证工厂里真的存在 `isDayjs` 分支与 `new Dayjs(cfg)` 出口。你也可以开一个 node 会话亲手试任意输入，命令可照抄：在 companion 目录运行 `node --import ./probes/register.mjs --input-type=module -e "import d from '../.course/repo/src/index.js'; console.log(d('2026-08-28').format('YYYY-MM-DD'))"`——register.mjs 会替你解决上面的扩展名问题。

- 进阶一问：`dayjs()` 不传参数时走哪条分支？去 `parseDate` 里找答案——那是下一章的主角。

## 走读方法：三问打开任何入口函数

以后你遇到任何库的入口，都可以用这三问快速打开它，dayjs 这个工厂就是示范：一问「输入有几种」：工厂先用 isDayjs 分流，再用 cfg 统一包装——输入面被刻意收敛成一个配置对象。二问「输出生下来带什么」：构造函数里语言、时间、扩展口袋、类型标记四件套，实例的基因全部在此。三问「重复调用会发生什么」：克隆防御给出明确答案——无副作用。带着答案去读后面的章节，你会发现 dayjs 的每个设计都不是孤立的口味，而是互相咬合的齿轮。

## 小结与自查

入口是一个工厂函数：Dayjs 入参走克隆防御，其余入参组装成 cfg 后交给 `new Dayjs(cfg)`；类型判断用 `instanceof` 加 `$isDayjsObject` 标记双保险，跨副本也认得。下一章沿着 `cfg.date` 往里走：parseDate 如何把四类输入统一成原生 Date。

- 自查一（预测）：`dayjs(dayjs('2026-08-28')).format('YYYY-MM-DD')` 输出什么？

<details><summary>看答案</summary>

`2026-08-28`——克隆的值与原对象相等（回查「克隆防御」一节的两条探针断言）。

</details>

- 自查二：为什么 isDayjs 不能只靠 `instanceof`？

<details><summary>看答案</summary>

插件生态可能出现多个 dayjs 副本，跨副本 instanceof 失灵；出生时打上的 `$isDayjsObject` 属性不依赖原型链（回查 isDayjs 一节）。

</details>

术语定义见[术语表](./glossary)，全书文件索引见[源码地图速查](./source-map)。
