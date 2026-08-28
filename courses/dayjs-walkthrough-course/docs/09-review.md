---
title: 复盘：这张源码地图你现在走完了
---

# 复盘：这张源码地图你现在走完了

八章之前，你只是 dayjs 的使用者：会调 API、偶尔翻文档。现在你能定位它每个行为的实现行号、能解释每个「怪现象」的机制、能在 node 里亲手复现——把会的东西清点一遍，确认每一项都真的在你手里。

## 能力对账表

| 来自 | 你现在能独立做的事 |
|---|---|
| 第 1 章 | 画出工厂函数的四行逻辑，解释克隆防御与 `$isDayjsObject` 双保险 |
| 第 2 章 | 对任意输入说出 parseDate 走哪条分支，解释 null 为何显式判无效 |
| 第 3 章 | 列出实例的九个字段，解释预计算缓存与 `$` 私有约定 |
| 第 4 章 | 沿 set/add 两条路径指出克隆发生在哪一行，预测月末溢出的结果 |
| 第 5 章 | 用两个工厂解释 startOf 如何吃下八个单位，推算不同 weekStart 下的周对齐 |
| 第 6 章 | 手推 format 的一次 replace：字面量逃逸、查表、default 兜底的优先级 |
| 第 7 章 | 画出 L/Ls 注册表与 parseLocale 的回退链，区分全局与实例切换 |
| 第 8 章 | 背出插件协议三参数与 `$i` 幂等，读懂一个官方插件的完整源码 |

每一行的验证物都在伴生仓：`cd companion && npm test`，8 组共 53 条探针在锁定 ref（`iamkun/dayjs@0f6c19e`）的源码上跑，应当全绿。哪一行心虚，回那一章的「验证」小节重做一次。

## 八问自查

- 问题一（动手）：`dayjs('2026-01-31').add(1, 'month').format('YYYY-MM-DD')` 是什么？为什么？

<details><summary>看答案</summary>

`2026-02-28`。add 月复用 set 月，先落 1 号、改完月、再夹回月末（回查第 4 章 $set 的月分支）。

</details>

- 问题二：`dayjs(null)` 与 `dayjs(undefined)` 结果差在哪？

<details><summary>看答案</summary>

null 是 Invalid Date，undefined 是现在——parseDate 的前两条分支刻意分开（回查第 2 章）。

</details>

- 问题三（预测）：en 环境下 `dayjs('2026-08-30').startOf('week')` 与 zh-cn 环境下差几天？

<details><summary>看答案</summary>

差 6 天：en 周日起算得 08-30 当天，zh-cn 周一起算得 08-24（回查第 5 章 C.W 分支）。

</details>

- 问题四：`format('[YYYY]')` 为什么输出字面量 YYYY？

<details><summary>看答案</summary>

正则的方括号分支捕获内容、回调里 `$1` 优先返回（回查第 6 章三级短路）。

</details>

- 问题五：实例上调用 `month()` 不传参和传参，返回类型分别是什么？

<details><summary>看答案</summary>

数字与新实例——getter 注册表经 `$g` 分派，无参读 `$M` 缓存、有参转 set（回查第 3 章）。

</details>

- 问题六（动笔）：写出「dayjs('2026-08-28T18:00').format('A')」的输出并说明 meridiem 的兜底逻辑。

<details><summary>看答案</summary>

`PM`。语言包没提供 meridiem 时用内置 `hour < 12 ? 'AM' : 'PM'`（回查第 6 章）。

</details>

- 问题七：已加载 zh-cn、未加载 zh 时 `locale('zh-TW')` 得到什么？

<details><summary>看答案</summary>

取决于全局 L 与 zh 的注册状态：zh-TW 降级试 zh，若 zh 已注册则用 zh；若未注册则 l 为空、回落到全局默认 L——不是「保持实例原语言」。递归调用丢了 isLocal，这是实例切换唯一能影响全局的缝隙（回查第 7 章解析链细节，用探针跑一遍三种组合）。

</details>

- 问题八（预测）：插件里 `c.prototype.x = ...` 与 `dayjs.x = ...` 分别给谁用？

<details><summary>看答案</summary>

前者挂到全部实例（d().x()），后者只是工厂上的静态方法（dayjs.x()，实例调不到）（回查第 8 章）。

</details>

## 这门课的边界

本课程引用的全部源码出自锁定提交 `iamkun/dayjs@0f6c19e`，遵循 MIT 许可（Copyright (c) 2018-present, iamkun）；引用均为逐字摘录并标注出处，课程本身是独立的教学解读，与官方文档无关。上游仓库仍在演进，新版本的实现可能与本课引用行不同——以你 checkout 的版本为准，走读方法（跟着探针读、先猜后跑、找基本概念）比任何具体行号更长寿。

## 下一步

对任何一个新机制，你的走读套路已经成型：先跑探针看行为，再打开源码对行号，最后用「为什么这么设计」收尾。[源码地图速查](./source-map)给了你继续往下走的入口：utc、timezone、relativeTime 三大官方插件是天然的第二圈路线，每个都不过一两百行，而你已经握着读它们的全部钥匙。术语随时回[术语表](./glossary)。
