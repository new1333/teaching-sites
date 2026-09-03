# 大纲契约

大纲是课程能力路径的单一事实源。nav、sidebar、章文件、验证模式与终点文案都由它派生；正文和组装期不另造一份短标题或能力清单。

## Schema v2

```ts
type VerificationMode =
  | 'code-lab'
  | 'canvas-app'
  | 'worksheet'
  | 'observation'
  | 'repo-probe'
  | 'none'

type CourseOutline = {
  schema_version: 2
  title: string
  audience: string                       // ≤30 字；原样进入 hero text
  driving_question?: string
  input: {
    kind: 'repo' | 'topic'
    ref: string                          // repo walkthrough 必须是 owner/repo@commitSHA
  }
  profile: CourseProfile                 // 正本见 course-profiles.md
  companion: {
    form: string
    language: string
    scope: string
    commands: Record<string, string>     // 如 typecheck/test/build/export/probes
  }
  parts: Part[]
  appendices: Appendix[]
  final_milestone: {
    what_reader_built: string            // ≤40 字；原样进入 hero tagline
    verify: string
  }
}

type Part = {
  title: string
  chapters: Chapter[]
}

type Chapter = {
  slug: string                           // 小写 ASCII + 连字符，≤50 字符
  title: string
  goal: string
  type: 'principle' | 'build' | 'review' | 'walkthrough'
  feature_id?: string                    // teaching 章对应 ingestion feature.id
  reviews?: string[]                     // review 章复盘的 feature ids
  verification?: VerificationMode       // mixed 的 build/walkthrough 章必填
  hook: {
    kind: string
    point: string
    phenomena: string[]
  }
  new_concepts: string[]                 // 本章提供的积木（provides）：首次正式教授的概念，进 bible glossary 并配接口句
  misconceptions: string[]
  structure?: string
  milestone?: string
  milestone_verify?: string
  relevant_files: Array<{ path: string; why: string }>
  length_exempt?: boolean
  promises_out: Array<{ target: string; what: string }>   // 作者侧规划账：目标章生成时对账，不写成读者可见欠账
  depends_on: string[]                   // 章级 DAG：失败传播用
  uses: string[]                         // 积木级对账：本章正文调用的既有积木，须已由更早章 new_concepts 提供或在读者已知边界内
  acceptance: Array<{
    kind: 'gate' | 'prose' | 'source' | 'experience'
    criterion: string
  }>
}

type Appendix = {
  slug: string
  title: string
  kind: 'glossary' | 'reference-table' | 'exercises' | 'divergence' | 'source-map'
}
```

旧版 string[] acceptance 可读取；v2 新写入统一使用带 `kind` 的对象，评审由此区分机械验收与正文验收。旧 outline 缺 `uses` 时按空数组读取，重写大纲时补齐。

## 大纲算法

1. 从 ingestion 的 feature DAG 做拓扑排序。
2. 每个教学 feature 映射到一个 principle/build/walkthrough 章；需要跨 feature 对账时才增加 review 章。
3. 按学习阶段分 part，不改变拓扑顺序。
4. 为每章解析验证模式，补齐 milestone、reader signal 与 acceptance。
5. 为每章列 `uses`：正文真正调用的既有积木；`new_concepts` 即本章提供的积木。提供在前、调用在后——不能调用未定义的函数。
6. 校验全部依赖（章级 `depends_on` 与积木级 `uses`）、来源政策、术语首教章和终点能力。

## 硬规则

### 特性覆盖

- 每个 ingestion feature id 恰好由一个 teaching 章的 `feature_id` 承担。
- review 章只复盘 `reviews` 指定的已教 feature，不引入新主特性。
- 标题、goal、开篇承诺与 acceptance 的覆盖面一致；装不下一章时拆 feature，而不是在正文静默缩水。

### 学习顺序

- `depends_on` 只指向更早 slug，且覆盖该章真正需要的全部前置能力。
- DAG 中失败章的传递依赖会被阻断，因此依赖不能只写“主要前置”。
- `uses` 只能引用更早章节 `new_concepts` 已提供的积木，或校准 `known` 边界内的能力——它驱正文的工具箱槽与自包含 lint；`depends_on` 驱失败传播，两者由大纲保持一致，不互相替代。
- walkthrough 的顺序来自 source map 的理解依赖，不按目录顺序抄文件。

### 钩子

`hook.point` 写读者可观察的具体现象；`kind` 开放。bug、公开事故、现象观察、能力缺口都可用。`phenomena` 提取 1-4 个能在开篇真实出现的词，供 lint 对齐意图。

### 验证

- principle/review 未声明时解析为 `none`。
- build/walkthrough 必须解析为具体模式。profile 是 `mixed` 时，章级 `verification` 必填。
- 具体模式章必填 `milestone` 与 `milestone_verify`：前者写验证物增量，后者写读者如何看到、听到、算出或检查结果。
- 测试输出可以证明机械正确，不能冒充本来可感知的画面、声音或操作成果。

### 概念

- `new_concepts` 只列本章首次正式教授的概念，必须进入 bible glossary。
- `misconceptions` 只写真有代表性的错误直觉；正文要用验证物、反例或演算证伪。
- 章依赖的承重概念即使漏写在 `new_concepts`，正文仍必须教透；大纲评审应先修漏项。

### 来源

- repo 输入的 `relevant_files.path` 必须在锁定 clone 中存在。
- zero-trace 下它只供作者核实，不进入正文。
- guided-walkthrough 下它是可引用对象；`input.ref` 必须锁定 commit SHA。
- topic 输入使用空数组。

### Acceptance

每章至少包含：

1. 一个 `gate` 或 `experience` 判据，说明本章验证信号如何判定；
2. 一个 `prose` 判据，说明必须真正教会什么；
3. 一个 `source` 判据，落实 zero-trace 或锁定源码一致性。

判据写可观察结果，不写“内容完整”“讲解清楚”。

### Hero 与 slug

- `audience` ≤30 字。
- `final_milestone.what_reader_built` ≤40 字，写“产物/能力 + 规模或边界 + 一个验证信号”。
- slug 由 ASCII 词归一为小写连字符，≤50 字符；中文只进 title。

## Mixed 示例

```json
{
  "slug": "unknown-price",
  "title": "未知价法：今天买，按哪天净值算",
  "goal": "会判定任意下单时刻对应的交易日",
  "type": "build",
  "feature_id": "unknown-price",
  "verification": "observation",
  "hook": {
    "kind": "observation",
    "point": "上午下单，晚上确认净值却不是下单时屏幕上的数",
    "phenomena": ["下单", "确认净值"]
  },
  "new_concepts": ["未知价法", "T 日"],
  "misconceptions": ["下单时看到的净值就是成交价"],
  "milestone": "一张可判定的交易日任务清单",
  "milestone_verify": "给出 4 个时刻，读者先猜再逐项核对结算日",
  "relevant_files": [],
  "promises_out": [],
  "depends_on": ["unit-nav"],
  "uses": ["单位净值"],
  "acceptance": [
    { "kind": "experience", "criterion": "4 个任务均包含操作与唯一可对照结果" },
    { "kind": "prose", "criterion": "用抢跑反例解释未知价法存在的约束" },
    { "kind": "source", "criterion": "规则截至日期与权威来源在正文首现处可见" }
  ]
}
```

## 呈现与反馈

确认点一次呈现：形态画像、读者画像、主线问题、章节表、终点里程碑和验证物范围。整纲反馈增加 `run.json.outline_revision` 并重算受影响派生物；单章反馈保持其余 slug 稳定。

## 完成条件

- JSON 可解析且 `schema_version = 2`；
- feature 覆盖无漏项/重项，review 引用均有效；
- depends_on 是有向无环图且只向后引用已出现章节；
- `uses` 的每个条目都有来历：更早章的 `new_concepts` 或校准 `known`，无“调用了未提供的积木”；
- 每章能解析到唯一验证模式；
- mixed 章全部显式消歧；
- acceptance、source policy、hero 长度与 final milestone 均有效。
