# 大纲 Schema 与硬性规则

大纲是数据契约不是目录树——组装期的 sidebar/nav、章文件名全由它渲染。产出后存 `.course/outline.json`；圣经内容只存 `.course/bible.json`，大纲不重复携带（防双份漂移）。验收测试不预写——阶段 3 每章现写（先红后绿），渐进语义由红→绿机械背书。

## Schema

```ts
Term = { term: string /* 中文术语 */, en?: string /* 英文原文 */, definition: string /* 一句话定义 */ }

CourseOutline = {
  title: string                    // 课程名（中文可）
  audience: string                 // 一句话受众画像，≤30 字（原样渲染为首页 hero 大字号 text）
  driving_question?: string        // 读者视角的一句主线大问题，全书回答它（渲染进 about.md 开头；
                                   //   各章收束可自然回指，终章必须收口）。收敛不出就省略，不硬造
  input: { kind: 'repo' | 'topic', ref?: string }   // repo: owner/name@ref（zero-trace 档仅作者侧备课；
                                   // guided-walkthrough 档 ref 必须锁定到 commit SHA，全书引用的唯一事实源）
  profile: CourseProfile           // 课程形态层，schema 见 references/course-profiles.md——阶段 2 随大纲一并确认
  companion: {                     // 验证物工程形态与规模，随大纲一并确认；形态菜单见 verification-and-gates.md
    form: string                   // 'code-lab:library' | 'canvas-app' | 'worksheet' | 'observation' | 'repo-probe' | 'mixed'...
    language: string               // 工具链，如 TypeScript+vitest / Go+go test / 纯计算脚本+核对脚本
    scope: string                  // 验证核心原理的最小工程 + 预计规模（如「最小调度器，~300 行」「22 道可核对演算题」）
  }
  parts: Part[]                    // 按学习的自然阶段划分，几个由内容决定
  appendices?: { slug: string, title: string, kind: 'glossary' | 'reference-table' | 'exercises' | 'divergence' }[]
                                   // 可选：读者要反复翻查的承重数据、术语表页（= bible 术语条目集，final-check 对账）、
                                   // 练习路线、差异清单（正文每处「本课程简化为…」集中登记）——有就给它们一个家，没有就不建
  final_milestone: { what_reader_built: string /* ≤40 字：终点能力+规模+一个验证信号——原样渲染为 hero tagline */, verify: string }
}
```

```ts
Part = { title: string, chapters: Chapter[] }

Chapter = {
  slug: string          // 强烈建议：纯 ASCII、≤50 字符（= 章文件名；中文只进 title）
  title: string         // 中文标题
  goal: string          // 一句话目标
  type: 'principle' | 'build' | 'review' | 'walkthrough'
                        // principle 纯理解；build 动手验证；review = part 末概念对账章（前情回顾 + 概念对账 + 自查，
                        //   可声明 length_exempt）；walkthrough = 走读章（guided-walkthrough 档，走读顺序即学习路径）。
                        //   profile 决定可用集，比例不设规定
  hook: {               // 开章钩子（pain_point 是它的 bug-story 特例，仍兼容读取）
    kind: string        // 常见：'bug-story' | 'real-incident' | 'observation' | 'ability-gap'，可自定义——
                        //   验收从不看 kind，只看 point 具体到现象
    point: string       // 具体到现象的开章场景
    phenomena: string[] // 现象关键词（写作期自动传给 lint --pain——检测与 spec 对齐）
  }
  pain_point?: string   // 兼容字段：等价于 hook { kind: 'bug-story', point: pain_point }
  new_concepts?: string[]     // 本章首次教授的陌生概念（应出自 bible 读者模型的陌生清单）——写作提示，不作验收项
  misconceptions?: string[]   // 本章要证伪的读者既有误解（「你可能以为 X」句式，读者视角）——最强深度装置之一，
                              //   写法见 chapter-writing.md「误区证伪」；没有天然误区就省略，不硬造
  structure?: string          // 五槽位不合身时声明替代结构（一句话，如「两种方案对比 → 取舍推演 → 自查」），
                              //   评审按声明验收；缺省即默认五槽位骨架
  milestone?: string          // 动手章必填：章末验证物的可运行增量。语义随 profile：code-lab=实验场增量；
                              // worksheet=一组可核对答案的题目；observation=一项完成的实操任务；repo-probe=一组全绿探针
  milestone_verify?: string   // 怎么验证里程碑达成——能写成读者可感知的验证（看到画面/听到声音/看到输出）
                              // 就不要只写机械验证；**测试输出不算可感知面**；读者感知不到时（纯内部机制）
                              // 才写测试级验证
  relevant_files?: { path: string, why: string }[]
                              // zero-trace 档：作者侧备课索引（生成期校验存在性），正文与测试零仓库痕迹；
                              // guided-walkthrough 档：正文逐字引用对象（标注 owner/repo@sha:path 与其对应）
  length_exempt?: boolean     // review/总览章可声明：免除字数参考线提示（1200 字只是参考线，lint 全局只提示不阻断）
  promises_out?: { target: string /* 章 slug */, what: string }[]
                              // 本章向后续章开出的承诺（并入 .course/promises.json，目标章生成时注入清账项）
  depends_on: string[]  // 前置章 slug，只允许指向更早的章（无前向依赖）
  acceptance: string[]  // 少量可判定的验收项，至少含「本章验证信号通过」（验证信号 = profile 对应验证物；
                        // zero-trace 档另含「零外部源码引用」，guided-walkthrough 档替换为「引用代码块与锁定 ref 逐字一致」）。
                        // 每条自明判据类型：仓验收（机械命令可判）与文验收（正文教学兑现，评审逐条回查）——
                        // 写了却没人查，等于没写
}
```

`new_concepts` 与 `appendices` 是思考提示不是硬性规则：前者的价值在大纲期想清楚「这章第一次教什么」、随 spec 进入该章生成的上下文——不设配额、不进 acceptance（但 glossary 页必须 ⊇ 全部 new_concepts，final-check 对账）；后者按需声明，课程没有查表型承重数据就不建。

## 八条大纲规则

1. **一章一特性，章数由特性数决定**：备课拆出几个值得单独成章的核心特性就几章——不设上下限，不为凑数拆章，也不为省事并章；分部按学习的自然阶段划分，几个由内容决定。内容多就多几章，这是特性，不是问题。**标题不得承诺本章不教的面**：标题、开篇总表、「一次讲清」式承诺列出的每一项都必须有正文着落——知识点超载时拆章或降标题承诺。
2. **章型按特性性质选，可用集由 profile 决定**：需要动手验证的用 build，纯理解的用 principle，part 末的概念对账用 review（不硬塞——没有对账价值的 part 末不设），走读课的机制章用 walkthrough。比例不设规定（原理密集的主题 principle 多些是常态）。没有 source-mapping 章型——zero-trace 档不做源码对照。
3. 每章必填 **hook**（`kind + point + phenomena`）——具体到现象（「周五上线的组件销毁后，定时器还在每秒拉一次数据」「某年某月某交易所熔断那几分钟」），不是概念式描述。kind 开放（四种常见形态之外可自定义），验收只看「具体到现象」。
4. 动手章必填 **milestone + milestone_verify**：章末验证物多出什么可运行的东西、怎么验证（可感知优先；测试输出不算可感知面）。
5. **depends_on 只能指向更早的章**——无前向依赖，保证干净渐进主线。走读课的走读顺序就是学习路径（备课源码地图直接变成章节依赖图）。
6. **relevant_files 的路径必须原样存在**于 clone 的仓库里——zero-trace 档它是作者侧备课索引；guided-walkthrough 档它是正文引用对象（引用须逐字一致）。topic 输入无 clone，relevant_files 留空。
7. acceptance 少而可判定（通常 3-5 条就够），至少含「本章验证信号通过」与出处纪律项（zero-trace 档「零外部源码引用」/ walkthrough 档「引用与锁定 ref 逐字一致」）；条目写清判据类型（仓验收机械命令可判 / 文验收由评审逐条回查），两轨都要有人签字，完成信号不得只有验证转绿。
8. **final_milestone 写清读者终态**：读完拥有什么、怎么验证——终点能力随 archetype（做出最小实现 / 读懂机制 / 算对判断 / 会操作）。**长度硬约束：`what_reader_built` ≤40 字、`audience` ≤30 字**——产物名+规模+一个验证信号就够，禁止把各章特性排比成清单塞进去。原因：这两个字段原样渲染为首页 hero 的大字号 text/tagline，超长首页排版就垮。

## slug 与宽松校验

- slug 规则：小写 ASCII + 连字符，`[^a-z0-9]+` 归一为 `-`，≤50 字符。中文只进 title（Windows 路径长度 / 编码 / ZIP 三类坑）。
- **schema 是建议不是枷锁**：缺失字段走缺省修润（slug 缺省从 title 生成 ASCII、type 未知回落 principle、hook 缺失回落 pain_point、profile 缺失回落 code-lab + zero-trace 全默认），不因 schema 拒绝重来。发现问题记入 issues 顺手修掉。

## 金样例（以状态管理原理课为校准用例；校准集含非 coding 映射，见 course-profiles.md 样例映射表）

课程结构：3 原理 + 8 实验 = 11 章、3 分部；依赖链严格线性；profile：`principle-reimpl / code-lab:library / zero-trace / full`；主线问题「一份组件外的状态，怎么一步步长成完整的状态管理库？」；实验场 = 最小 store 容器 ≈300 行；最终里程碑「通过课程自设的原理断言测试（约 35-40 个）」。（这些数字只是本例课程从它的特性清单自然得出的结果，不是任何课程的目标值——别的主题该几章就几章。）

章节表节选（呈现给用户用这种格式，profile 一句话画像一并带出）：

> 形态画像：原理重实现课 · code-lab 验证（TS+vitest）· 代码全展开 · 无领域义务

| # | 章 | 类型 | 钩子 | 里程碑 |
|---|---|---|---|---|
| 1 | 状态管理的四种尝试与它们的极限 | principle | props 钻孔 / 共享态的 SSR 困境（observation） | 无代码，一张依赖图 |
| 3 | createPinia：一个挂在 app 上的容器 | build | 状态散落各组件，没有统一的家（bug-story） | `createPinia()` 可 `app.use` |
| 8 | storeToRefs：解构不丢响应性的秘密 | build | `const { count } = store` 一解构就断连（bug-story） | 实现 storeToRefs，解构后仍响应 |
| 11 | activePinia：一个应用一个容器 | principle | SSR 高峰期用户间状态串号（real-incident） | 无代码，事故时序推演 |

（表内 principle 章的「里程碑」列填「无代码，一张图/示意」之类的说明，JSON 里则省略 milestone 字段。）

单个 Chapter 的 JSON 形态（第 8 章）：

```json
{
  "slug": "store-to-refs",
  "title": "storeToRefs：解构不丢响应性的秘密",
  "goal": "理解 Proxy 读取语义与 toRef 活引用，实现 storeToRefs",
  "type": "build",
  "hook": { "kind": "bug-story", "point": "const { count } = store 一解构就断连，且只有数据断、函数不断", "phenomena": ["解构", "断连"] },
  "milestone": "storeToRefs(store) 返回 refs 化视图，解构后仍响应",
  "milestone_verify": "章末三行断言通过，页面计数器实时更新（可感知）",
  "relevant_files": [{ "path": "packages/pinia/src/storeToRefs.ts", "why": "备课：拿不准真实库如何处理解构断连时参考" }],
  "depends_on": ["define-store", "state-and-getters"],
  "acceptance": [
    "本章验证信号通过：示例代码在实验场中可编译、断言全绿（硬信号一票否决）",
    "含「没有 storeToRefs 时的痛点」段落",
    "零外部源码引用：示例代码全部出自实验场或自包含用法示例"
  ]
}
```

## 用户反馈的两种改法

- **整纲反馈**（「build 章太多了」「先讲 X 再讲 Y」「这不是编程课，代码折叠掉」）：带着上一版大纲 + 反馈重新生成整纲，反馈必须逐条落实；保持已合格章节的 slug 不变（下游测试文件按 slug 关联）。profile 判定被纠正也走这条路——高频纠正说明判定面不清晰，把判定依据写进下一版大纲的呈现文案。
- **单章条目**（「第 5 章钩子不真实」）：只重写该章条目，其余不动。
