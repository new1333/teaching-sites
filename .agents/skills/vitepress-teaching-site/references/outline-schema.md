# 大纲 Schema 与硬性规则

大纲是数据契约不是目录树——组装期的 sidebar/nav、章文件名全由它渲染。产出后存 `.course/outline.json`；圣经内容只存 `.course/bible.json`，大纲不重复携带（防双份漂移）。验收测试不预写——阶段 3 每章现写（先红后绿），渐进语义由红→绿机械背书。

## Schema

```ts
Term = { term: string /* 中文术语 */, en?: string /* 英文原文 */, definition: string /* 一句话定义 */ }

CourseOutline = {
  title: string                    // 课程名（中文可）
  audience: string                 // 一句话受众画像
  input: { kind: 'repo' | 'topic', ref?: string }   // repo: owner/name@branch（仅作者侧备课）；topic: 主题句
  companion: {                     // 原理实验场形态与规模，随大纲一并确认；形态菜单见 companion-and-gates.md
    form: 'library' | 'cli-golden' | 'config-validate' | 'dom-test'
    language: string               // 工具链，如 TypeScript+vitest / Go+go test
    scope: string                  // 验证核心原理的最小实验工程 + 预计规模（如「最小调度器，~300 行」）；是原理验证不是复刻
  }
  parts: Part[]                    // 2-4 个分部
  final_milestone: { what_reader_built: string, verify: string }
}

Part  = { title: string, chapters: Chapter[] }

Chapter = {
  slug: string          // 强烈建议：纯 ASCII、≤50 字符（= 章文件名；中文只进 title）
  title: string         // 中文标题
  goal: string          // 一句话目标
  type: 'principle' | 'build'
  pain_point: string    // 必填：「没有 X 时」的真实 bug 场景，具体到现象
  milestone?: string          // build 章必填：章末实验场的可运行增量
  milestone_verify?: string   // build 章必填：怎么验证里程碑达成
  relevant_files?: { path: string, why: string }[]   // repo 输入：作者侧备课索引（生成期校验存在性）；正文与测试零仓库痕迹
  depends_on: string[]  // 前置章 slug，只允许指向更早的章（无前向依赖）
  acceptance: string[]  // 3-5 条可判定验收项（含「实验场门槛通过」）
}
```

## 八条硬性规则

1. **一章一特性**，共 8-12 章（默认 clamp(特性数, 8, 12)），分部 2-4 个。
2. 章型配比 **principle : build ≈ 3 : 7**；没有 source-mapping 章型——源码对照已从课程哲学中移除。「≈」是指导不是硬门槛——与「一章一特性」或章数上限冲突时的让位顺序：**特性完整性 > 章数上限(12) > 配比**（3 原理 + 8 实验这种 3:8 是可接受的）。
3. 每章必填 **pain_point**——「没有 X 时」的真实 bug 场景，具体到现象（「周五上线的组件销毁后，定时器还在每秒拉一次数据」），不是概念式描述。
4. build 章必填 **milestone + milestone_verify**：章末实验场多出什么可运行的东西、怎么验证。
5. **depends_on 只能指向更早的章**——无前向依赖，保证 Crafting Interpreters 式的干净渐进主线。
6. **relevant_files 的路径必须原样存在**于 clone 的仓库里——它是作者侧备课索引（生成期拿不准某条原理的真实行为时去读），不是成稿引用源码的义务，正文与测试零仓库痕迹。topic 输入无 clone，relevant_files 留空。
7. acceptance 3-5 条，可判定，至少含「实验场门槛通过」与「零外部源码引用」。
8. **final_milestone 写清读者终态**：读完拥有什么（如「一个 ~300 行的最小 store 容器」）、怎么验证（如「通过课程自设的原理断言测试」）。

## slug 与宽松校验

- slug 规则：小写 ASCII + 连字符，`[^a-z0-9]+` 归一为 `-`，≤50 字符。中文只进 title（Windows 路径长度 / 编码 / ZIP 三类坑）。
- **schema 是建议不是枷锁**：缺失字段走缺省修润（slug 缺省从 title 生成 ASCII、type 未知回落 principle），不因 schema 拒绝重来。发现问题记入 issues 顺手修掉。

## 金样例（以状态管理原理课为校准用例，输入可以是主题句，也可以是某状态管理库的仓库——后者仅作备课）

课程结构：3 原理 + 8 实验 = 11 章、3 分部；依赖链严格线性；实验场形态 library（TypeScript + vitest，最小 store 容器 ≈300 行）；最终里程碑「通过课程自设的原理断言测试（约 35-40 个）」。

章节表节选（呈现给用户用这种格式）：

| # | 章 | 类型 | 痛点 | 里程碑 |
|---|---|---|---|---|
| 1 | 状态管理的四种尝试与它们的极限 | principle | props 钻孔 / 共享态的 SSR 困境 / 前辈方案的模板代码 | 无代码，一张依赖图 |
| 3 | createPinia：一个挂在 app 上的容器 | build | 状态散落各组件，没有统一的家 | `createPinia()` 可 `app.use` |
| 8 | storeToRefs：解构不丢响应性的秘密 | build | `const { count } = store` 一解构就断连 | 实现 storeToRefs，解构后仍响应 |
| 11 | activePinia：一个应用一个容器 | principle | SSR 高峰期用户间状态串号 | 无代码，事故时序推演 |

（表内 principle 章的「里程碑」列填「无代码，一张图/示意」之类的说明，JSON 里则省略 milestone 字段。）

单个 Chapter 的 JSON 形态（第 8 章）：

```json
{
  "slug": "store-to-refs",
  "title": "storeToRefs：解构不丢响应性的秘密",
  "goal": "理解 Proxy 读取语义与 toRef 活引用，实现 storeToRefs",
  "type": "build",
  "pain_point": "const { count } = store 一解构就断连，且只有数据断、函数不断",
  "milestone": "storeToRefs(store) 返回 refs 化视图，解构后仍响应",
  "milestone_verify": "章末三行断言通过",
  "relevant_files": [{ "path": "packages/pinia/src/storeToRefs.ts", "why": "备课：拿不准真实库如何处理解构断连时参考" }],
  "depends_on": ["define-store", "state-and-getters"],
  "acceptance": [
    "示例代码在实验场中可编译、断言通过（硬信号一票否决）",
    "含「没有 storeToRefs 时的痛点」段落",
    "零外部源码引用：示例代码全部出自实验场或自包含用法示例"
  ]
}
```

## 用户反馈的两种改法

- **整纲反馈**（「build 章太多了」「先讲 X 再讲 Y」）：带着上一版大纲 + 反馈重新生成整纲，反馈必须逐条落实；保持已合格章节的 slug 不变（下游测试文件按 slug 关联）。
- **单章条目**（「第 5 章痛点不真实」）：只重写该章条目，其余不动。
