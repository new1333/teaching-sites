# 章节写作纪律

**每会话首次动笔前读完本文件**——笔感基准和 lint 规则决定成稿质量；长时间中断或 lint 连续报警时再重读，不必每章读。

## 骨架（五段，圣经章节模板的展开）

痛点开章 → 原理（为什么这样设计）→ 渐进实验（引用伴生实验场的真实代码，讲演进思路）→ 验证（跑什么、看到什么）→ 小结

## 十一条硬要求

1. **开章 = 痛点场景**：把本章 spec 的 pain_point 写成具体到现象的真实 bug 故事，不要概念式描述。
2. **≥1200 字**（中文字符，不含代码块），上限不设——写满凑字反而降质，讲透即收。
3. 教**核心原理**：读者读完能讲清原理、写出原理级最小实现。**零外部源码引用**——示例代码只出自伴生实验场或自包含用法示例；不写「与真源码对照」段落。可以提真实库的公开概念与行为（「Vue 没有官方 isComputed」），但它的代码一行不进正文。
4. 中文与英文/数字之间加空格；短句；禁翻译腔。
5. 代码块标注语言；不用 HTML 标签；不写「本章小结」式重复标题。
6. frontmatter 写 `title:`（中文标题）。
7. 章末产出 **rolling_summary**（≤200 字：已建立的 API/概念、本章代码变更点、读者已能做什么）——写入 `.course/rolling.json`，下一章必带。
8. **判词句密度**：每章加粗判断 ≤8 处（含列表标签）。平实句是主体——重点句靠平实背景衬托，句句加粗等于没有加粗。箴言体是复盘文体，不是教学文体。
9. **闪前配额**：正文中「第 N 章（N＞本章）会……」预告每章 ≤3 处，只留「当下不讲清楚就无法理解」的；概念去向统一收在章末地图或小结，不在正文里逐个指路。回看（引用已写过的章）不受限。
10. **比喻登记**：每章常驻比喻 ≤2 个（贯穿全书的核心比喻记入 bible）；装饰性比喻一律改回技术名。禁用词默认含「集中营」——比喻要承重，不要猎奇，更不能失当。
11. **代码片段标注出处**：伴生实验场的代码片段首行注释写明文件与函数（`// src/store.ts · createSetupStore`），用法示例标 `// 用法示例`；拼合视图标「拼版」。全书核心函数首次登场时给一次全貌（含生长点注释），后续章节只贴增量——读者不该在从未见过全貌的文件里跟跳切镜头。

## 笔感基准（两段范文）

**痛点开章范文**（约 150 字）：

> 「周五上线的看板组件销毁后，定时器还在每秒拉一次数据——内存曲线一路向右上方走。这不是 React 或 Vue 的 bug，而是"组件状态"与"组件实例"被当成了同一个东西。这一章我们先亲手踩一遍这个坑，再看看 pinia 用什么结构把状态从组件树里拽出来。」
>
> 写作要点：从真实 bug 场景切入；先现象后原理；句子短；术语首次出现时中英并列；不用「我们可以看到」「值得注意的是」这类填充语。

**讲原理而非贴源码范文**（pinia 课程第 8 章开头节选）：

> ### 一解构就断连
>
> 你大概写过这样的代码：
>
> ```ts
> const store = useCounterStore()
> const { count, increment } = store   // 😈
> ```
>
> 页面上 `count` 纹丝不动了。这不是 bug，是你把「活的」东西拿成了「死的」快照。
>
> `store` 是 `reactive(...)` 返回的 Proxy。Proxy 的魔法只属于**这个代理对象本身**——你通过它读属性，它才会帮你建立依赖、通知更新。`const { count } = store` 是一次普通的属性读取：把当时的数字取出来，装进一个普通变量。从此这个变量与 store 再无关系。`increment` 倒是能用，因为它只是读了个函数引用——**丢响应性的从来只有数据，函数天然免疫**。
>
> 这个「数据会断、函数不会」的不对称，正是解法的全部线索：把每个数据字段包成一个 `ref`，解构时拿到的是 ref 对象——一个永远指向 store 内部字段的活引用；函数则原样透传。
>
> （随后给出十行实现 + 三行验证；结尾可以一句带过真实库的公开事实——「真 pinia 也用这一招探测」——但不引它的代码、不列它的行数。）

## lint 自检（写完一章后，机械执行）

别用眼睛扫——把下面的脚本存为 `.course/lint.mjs`，对每章跑 `node .course/lint.mjs docs/NN-slug.md <术语1> <术语2> ...`：

```js
import { readFileSync } from 'node:fs'
const md = readFileSync(process.argv[2], 'utf8')
const terms = process.argv.slice(3)
const text = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')  // 剥代码
const issues = []
const spacing = (text.match(/[\u4e00-\u9fff](?=[A-Za-z0-9])|[A-Za-z0-9](?=[\u4e00-\u9fff])/g) ?? []).length
if (spacing > 15) issues.push(`spacing: 中西文缺空格 ${spacing} 处`)
const passive = (text.match(/[\u4e00-\u9fff]*被[\u4e00-\u9fff]+/g) ?? []).length
if (passive > 12) issues.push(`passive: 被字句 ${passive} 处`)
for (const p of ['值得注意的?是', '我们?可以看到', '正如你(所)?看到(的)?', '需要指出的是']) {
  const n = (text.match(new RegExp(p, 'g')) ?? []).length
  if (n >= 3) issues.push(`translation-tone: 「${p}」出现 ${n} 次`)
}
const missing = terms.filter((t) => !text.includes(t))
if (missing.length > 3) issues.push(`terminology: ${missing.length} 条术语未出现：${missing.join('、')}`)
for (const b of md.match(/```[\w]*\n[\s\S]*?```/g) ?? [])
  if (/^(\/\/|\/\*|#)\s*(源码|source|from)/im.test(b.slice(3, 200)))
    issues.push('source-quote: 外部源码引用已禁用（零仓库痕迹）')
const bolds = (text.match(/\*\*[^*\n]+\*\*/g) ?? []).length
if (bolds > 8) issues.push(`bold-density: 加粗判断 ${bolds} 处（上限 8，含列表标签）`)
const cur = Number((process.argv[2].match(/(\d+)-/) ?? [])[1] ?? 0)
const fwd = [...text.matchAll(/第\s*(\d+)\s*章/g)].filter((m) => Number(m[1]) > cur).length
if (fwd > 3) issues.push(`forward-ref: 闪前「第 N 章」${fwd} 处（上限 3，去向收在章末地图）`)
for (const w of ['集中营']) if (text.includes(w)) issues.push(`metaphor: 禁用比喻词「${w}」`)
for (const b of md.match(/```\w*\n[\s\S]*?```/g) ?? []) {
  const lines = b.split('\n').length - 2
  if (lines > 12 && !/\/\/\s*(src\/|tests\/|用法示例|companion|拼版)/.test(b.slice(3, 300)))
    issues.push(`snippet-source: ${lines} 行代码块未标注出处（首行注释 src/… 或 用法示例）`)
}
const head = text.slice(0, 1500)
if (!['没有', '踩', '坑', 'bug', '报错', '崩溃', '泄漏', '失败', '丢失', '出错'].some((m) => head.toLowerCase().includes(m)))
  issues.push('pain-point: 开篇 1500 字内无痛点信号词')
console.log(issues.length ? issues.join('\n') : 'OK')
```

terminology 检查传术语表全部条目（容 3 条未出现）。后四项检查对应硬要求 8–11：判词密度、闪前配额、禁用比喻（黑名单按课程追加，如「陪葬」「水龙头」这类一次性铸币）、片段出处；source-quote 对应硬要求 3——零外部源码引用。未过 → **只修检测器指出的问题**，定向修订一轮，不重构内容、不动代码块。修订一轮即饱和——再修只会降质（负面经验：无外部信号的自我纠错会降质，负面清单单独使用无效，所以要靠正向模板字段 + 事后检测器这套组合）。

## 降级章的占位格式

```md
---
title: {章标题}
---

# {章标题}

::: warning 本章生成失败
实验场双硬门槛未过：编译 {通过/失败}；测试 {通过/失败}。

**原因摘要**：{最后一轮报错摘要，≤500 字}

可要求重新生成本章。
:::
```
