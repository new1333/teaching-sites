# 状态契约

`.course/` 是主智能体、角色智能体、续跑会话和终检脚本之间的唯一交接面。新产物使用 `schema_version: 2`。旧版数组或缺省字段可在首次续跑时读取，但下一次写入要归一化为本文件的形状。

## 状态文件

| 文件 | 必需 | 唯一写者 | 用途 |
|---|---:|---|---|
| `run.json` | 是 | 主智能体 | 事务指针、总状态、已完成/阻断章节 |
| `ingestion.json` | 是 | 主智能体或备课角色 | 输入拆解、能力依赖、repo 证据 |
| `calibration.json` | 是 | 主智能体 | 读者边界；跳过也要落盘 |
| `bible.json` | 是 | 主智能体 | 读者模型、术语、事实源、验证约定 |
| `outline.json` | 是 | 主智能体 | 课程 profile、章节 DAG、验收契约 |
| `rolling.json` | 是 | 主智能体 | 已提交章节的短摘要与状态 |
| `promises.json` | 是 | 主智能体 | 跨章承诺账 |
| `blueprint.json` | 仅并行 | 主智能体 | 冻结的并行写权与波次 |

`repo/`、`snapshots/`、临时输出和安装缓存不是状态事实，不提交。

## `run.json`

```ts
type Phase =
  | 'ingestion'
  | 'calibration'
  | 'bible'
  | 'outline'
  | 'chapters'
  | 'book-review'
  | 'assembly'
  | 'delivery'

type RunState = {
  schema_version: 2
  skill: 'vitepress-teaching-site'
  status: 'planning' | 'generating' | 'reviewing' | 'blocked' | 'degraded' | 'complete'
  phase: Phase
  language: string
  outline_revision: number
  next_chapter: number | null
  completed_chapters: string[]
  degraded_chapters: string[]
  blocked_chapters: string[]
  skipped_interactions: Array<'calibration' | 'outline-confirmation' | 'review'>
  last_commit: {
    kind: 'phase' | 'chapter' | 'book-review' | 'assembly'
    id: string
  } | null
}
```

`run.json` 是提交指针，不缓存大段内容。三个章数组是 rolling 状态的物化索引，由 final-check 对账。它永远最后写：指针落后时可以重放事务，指针超前会让续跑误以为产物已完成。

## `ingestion.json`

```ts
type IngestionState = {
  schema_version: 2
  kind: 'topic' | 'repo'
  label: string
  description: string
  features: Array<{
    id: string
    name: string
    summary: string
    reader_can: string
    evidence?: Array<{ path: string; why: string }>
  }>
  capabilities: {
    edges: Array<{ from: string; to: string }>
  }
  profile_hint: {
    archetype: string
    verification: string
    source_policy: 'zero-trace' | 'guided-walkthrough'
    reason: string
  }
  repo?: {
    url: string
    locked_ref: string
    license: { kind: string; note: string }
    source_map?: Array<{ path: string; one_liner: string; role: string }>
    execution: 'read-only' | 'sandboxed'
  }
  issues: string[]
}
```

能力边必须成 DAG。没有前置依赖的特性仍要出现在 `features`，不能靠 edge 反推全部节点。

## `calibration.json`

```ts
type CalibrationState = {
  schema_version: 2
  status: 'answered' | 'defaulted'
  audience: string
  known: string[]
  unfamiliar: string[]
  anchors: Array<{ concept: string; known_anchor: string }>
  decisions: string[]
  default_reason?: string
}
```

只保存归一化后的教学假设，不保存用户姓名、账号、逐字回答或其他个人信息。一次批量校准通常覆盖相邻知识、自评熟练度、使用场景和期望终点；每个问题都必须能改变一项课程决策。

## `bible.json`

```ts
type BibleState = {
  schema_version: 2
  reader_model: {
    known: string[]
    unfamiliar: Array<{
      concept: string
      why: string
      anchor: string
    }>
  }
  glossary: Array<{ term: string; en?: string; definition: string }>
  verification_conventions: Record<string, unknown>
  api_contract?: Array<{
    name: string
    introduced_in: string
    contract: string
  }>
  factual_claims: boolean
  authority_docs: Array<{
    title: string
    url?: string
    why: string
    as_of?: string
  }>
}
```

`factual_claims: true` 时 `authority_docs` 非空。定义、监管规则、协议行为、硬件行为和时间敏感数字都以这里的来源为核验入口；测试自洽不替代事实正确。概念首教章由 outline `new_concepts` 决定，最终领域义务由 profile `obligations` 决定，bible 不缓存这两份映射。

## `rolling.json`

```ts
type RollingState = {
  schema_version: 2
  chapters: Array<{
    n: number
    slug: string
    file: string
    status: 'complete' | 'degraded' | 'blocked'
    summary: string
    artifacts: string[]
    gates: Array<{ command: string; result: 'passed' | 'failed' }>
    review_blockers: number
  }>
}
```

一个 slug 只能有一条记录；重生成时原位替换，不追加第二条。`summary` ≤200 字，不写计划与作者意图，只写已建立概念、验证物变化和读者当前能力。

## `promises.json`

```ts
type PromiseState = {
  schema_version: 2
  promises: Array<{
    id: string
    from: string
    from_n: number
    target: string
    what: string
    status: 'open' | 'fulfilled' | 'moved'
    resolution?: string
    moved_to?: string
  }>
}
```

目标章生成前把全部 `open` 项注入写作任务。兑现后写 `fulfilled + resolution`；改期必须写 `moved + moved_to` 并新建目标承诺，不能只改 target 抹掉历史。

## `outline.json` 与 `blueprint.json`

outline 的唯一 schema 在 [`outline-schema.md`](outline-schema.md)。并行 blueprint 的唯一 schema 在 [`parallel-mode.md`](parallel-mode.md)。其他文件只引用，不复制字段定义。

## 事务与续跑

### 阶段事务

1. 写临时内容到目标文件旁的 `.tmp` 文件。
2. 解析/校验成功后替换正式文件。
3. 运行该阶段完成条件。
4. 最后更新 `run.json.last_commit` 与下一 phase。

### 章事务

1. 以已提交 companion + state 建快照。
2. 写验证物并过 gate。
3. 写正文并过 lint。
4. 评审并清零阻断。
5. 主智能体更新 rolling、promises。
6. 最后把 slug 加入 `run.json.completed_chapters`。

续跑时从 `run.json.last_commit` 的下一个事务开始。若指针指向的产物缺失或 gate 复跑失败，把该事务退回未完成；不删除更早的已验证状态。

## 失败传播

门槛在定向修复上限后仍失败：

1. 恢复本章快照。
2. rolling 写 `degraded`，记录失败命令；run 加入 `degraded_chapters`。
3. 沿 outline `depends_on` 计算传递闭包，未完成依赖章写入 `blocked_chapters`。
4. 只继续生成与失败章无依赖关系的分支。
5. 修复失败章后按拓扑顺序解锁并重跑依赖章。

占位页只用于让预览站可导航，不代表该章完成。只要 degraded/blocked 非空，最终状态最多是 `degraded`。

## 从第 N 章重生成

保留 N 之前的状态；恢复 N 前快照；删除 N 及其传递依赖章的 rolling 记录、验证物增量与已完成标记；重新按 DAG 生成。没有依赖 N 的独立后续章可以保留，但全书评审必须重跑。
