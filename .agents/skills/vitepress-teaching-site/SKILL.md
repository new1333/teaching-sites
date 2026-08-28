---
name: vitepress-teaching-site
description: Build or revise a VitePress course from a topic or repository. Use for tutorial/course/teaching-site requests, teaching a subject from scratch, turning a repo into a principle course, or producing a guided source walkthrough. Covers audience calibration, course profiling, evidence-backed chapters, review, and portal assembly.
---

# VitePress 教学站点

把一句主题或一个代码仓库变成可运行、可续写、可审计的 VitePress 课程。默认产物位于 `courses/{ascii-name}-course/`；语言跟随用户。课程终点由 profile 决定：读者应能**做出、读懂、算对或独立完成**目标任务，而不只是看过一组页面。

## 运行契约

1. **终点先于目录。** 先定义读者最终能完成什么、如何证明，再决定章节。每章只承担一个推进终点能力的特性。
2. **证据先于断言。** 会作出可检验断言的章节，先产出对应验证物并过门槛，再据此写正文；纯原理或复盘章也要有可判定的验收信号。
3. **状态先于记忆。** `.course/` 是唯一交接面。产物、门槛、评审和账本写盘后才算完成；聊天里的“已经做了”不算状态。
4. **判据先于配额。** 图、代码、比喻、练习与篇幅都由承重概念和验证信号决定。只保留有独立机理的防御阈值。
5. **一个事实一个家。** 本文件只编排；schema、角色、验证形态和组装规则各有唯一正本。进入某阶段时只读取路由表指定的文件。

## 开始或续跑

第一步读取 [`references/state-contracts.md`](references/state-contracts.md)，然后：

1. 解析课程目录。用户给路径时沿用；否则生成 `courses/{short-ascii-name}-course/`。
2. 若 `.course/run.json` 存在，先校验状态并从首个未完成事务续跑。已完成阶段只在其输入或用户要求变化时重算。
3. 若只有旧版状态文件，按 state contract 归一化后创建 `run.json`；保留已验证产物，不凭文件存在就猜“完成”。
4. 新课程先创建 `.course/run.json`，状态为 `planning / ingestion`。每个事务最后才更新它。

## 阶段路由

| 阶段 | 当前动作 | 必读正本 | 完成条件 |
|---|---|---|---|
| 0 · 摄取 | topic 拆特性；repo 做有界、只读备课 | repo 输入读 [`repo-ingestion.md`](references/repo-ingestion.md)；状态形状读 `state-contracts.md` | `ingestion.json` 可解析，特性与依赖边均可落到读者能力 |
| 0.5 · 校准 | 取得或保守推导读者已知/未知边界 | `state-contracts.md` 的 `CalibrationState` | `calibration.json` 已写；跳过原因显式，且不保存个人原话或身份信息 |
| 1 · 课程圣经 | 固定读者模型、术语、事实源与验证约定 | `state-contracts.md` 的 `BibleState` | `bible.json` 完整；有客观事实断言时存在权威来源 |
| 2 · profile + 大纲 | 选择课程形态并生成能力路径 | [`course-profiles.md`](references/course-profiles.md) + [`outline-schema.md`](references/outline-schema.md) | profile、章级验证解析与依赖 DAG 有效；用户确认或已记录“直接生成” |
| 3 · 逐章 | 验证物 → 正文 → 新鲜眼评审 → 记账 | [`chapter-writing.md`](references/chapter-writing.md) + [`verification-and-gates.md`](references/verification-and-gates.md) + 解析出的单一验证分支；使用 [`roles/chapter-writer.md`](references/roles/chapter-writer.md) 与 [`roles/reviewer.md`](references/roles/reviewer.md) | 本章 gate、lint、review 均通过；rolling 与 promises 已提交 |
| 3.5 · 全书 | 查跨章概念链、能力账与终态漂移 | `roles/reviewer.md` 的全书分支 | 无阻断 finding；所有承诺核销；无来历不明的验证物能力 |
| 4 · 组装 | 从 outline/bible 渲染站点并构建 | [`vitepress-assembly.md`](references/vitepress-assembly.md)；需要课程中心时再读 [`portal.md`](references/portal.md) | final-check、单课 build、聚合 build 全部通过 |

子智能体的调度、写权与修订路由只在需要委派时读取 [`subagents.md`](references/subagents.md)。并行生成仅在用户明确要求且通过资格检查时，再读取 [`parallel-mode.md`](references/parallel-mode.md)。

## 交互边界

- standard 课程在大纲前做一次批量读者校准，并把**大纲、profile、终点里程碑**放在同一个确认点。
- 用户说“直接生成/别问”时，采用保守读者画像与推荐 profile，分别在 `calibration.json` 和 `run.json` 记录跳过，不再制造确认轮次。
- lite 课程可跳过问卷，但质量门不减。
- 用户反馈整纲时重算 outline revision；只改一章时保持其他 slug 稳定。

## 章事务

每章严格按下面的提交顺序：

1. 从 outline 解析**唯一**验证模式；`mixed` 必须由章级 `verification` 消歧。
2. 写作角色完成验证物与正文，但不写全局账本。
3. 运行该模式 gate 与 chapter lint。
4. 评审角色只看落盘产物，给出阻断/建议。
5. 阻断修清后，主智能体一次性写 rolling、promises，再把本章记入 `run.json.completed_chapters`。

门槛失败时按依赖图传播：回滚本章验证物，标记本章 `degraded`；依赖它的未生成章节标记 `blocked`，不能伪装成“沿用上一章状态”继续写。独立分支可以继续。重新规划或修复后再解锁。存在 degraded/blocked 章节的课程可预览，但状态不是 `complete`。

## 产物边界

```text
courses/{course}/
├── docs/                 # VitePress 页面与课程内资产
├── companion/            # 验证物工程
├── .course/              # 已提交的管线状态；repo/、snapshots/ 等临时物除外
├── package.json
└── README.md
```

项目根的 `scripts/course-lint.mjs`、`scripts/course-final-check.mjs` 与 `scripts/portal-sync.mjs` 是运行时正本；reference 只描述契约，不内嵌脚本副本。

## 完成定义

只有同时满足以下条件，才把 `run.json.status` 写为 `complete`：

- outline 的每章均为 `complete`，无 degraded/blocked；
- 章级与全书评审无阻断项，promises 全部 fulfilled；
- `course-final-check`、单课 build、聚合 build 均以退出码 0 结束；
- README、首页、about、sidebar、附录与终点能力均从状态事实渲染且无死链；
- 交付说明只报告真实可运行命令与仍存在的限制。

任一条件未满足时，使用 `blocked` 或 `degraded`，准确列出阻断，不以“已完成”收尾。

## 不适用

- 用户要 API 参考、文档镜像或 release notes，而非教学路径。
- 输入无法访问且没有足够主题材料，或主题无法收敛成能力主线。
- 用户不接受任何可判定验证，而主题又只能做纯导读。`verification: none` 是可选的诚实降级，不是默认逃生口。
