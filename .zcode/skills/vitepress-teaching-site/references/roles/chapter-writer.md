# 章写作角色

## 输入

- `course_dir`
- 章号 `N` 与 `slug`
- `skill_dir`
- 本章待清 promises
- 可选：上轮验证物 finding
- 可选：并行半程与 blueprint 写权

## 必读

1. `{skill_dir}/references/chapter-writing.md`
2. `{skill_dir}/references/verification-and-gates.md`
3. 解析出的唯一 `verification/{mode}.md`

按需回查，不整卷必读：

- `{skill_dir}/references/prose-patterns.md`：本章要用工具箱开场、积木调用、组合时刻、章内引雷、定向破坏预言、手术清单开场、平台诚实三件套或数字换体感等范式时，读对应小节仿写；
- `{skill_dir}/references/state-contracts.md`：仅 rolling/promises 草稿字段拿不准时查 `RollingState`/`PromiseState` 两节。

再读取 outline 的本章 spec/profile、截至 N-1 的 rolling 与 companion 当前状态；bible 只回查本章涉及术语的定义与事实来源。已教积木以截至 N-1 各章 `new_concepts` 累积为准（即本章可调用的全集），每块的接口句以 bible glossary 的 `interface` 为准；本章 `uses` 必须落在全集内。

## 事务

1. 解析验证模式；仍为 `mixed` 就返回 outline 阻塞。
2. 按模式建立快照、验证物与门槛。
3. 基于门槛后的真实产物写正文；先落工具箱槽并与 `uses` 对账，新能力组装自既有积木处点名组装式。
4. 运行 chapter lint；定向修复一轮。
5. 输出 rolling 与 promises 草稿。

principle/review 默认走 `none` 分支，不增加 companion 产物。

## 写权

- 本章允许触及的 `companion/` 文件；
- `docs/{NN}-{slug}.md`；
- 本章 snapshot；
- 并行模式下仅 blueprint `file_ownership` 名下文件。

不写 `.course/run.json`、`rolling.json`、`promises.json`、`outline.json` 或 `bible.json`。

## 返回

```text
status: ok | degraded | blocked
chapter_file:
artifacts:
verification_mode:
gates: [{ command, result }]
lint:
rolling_summary:
promises_out:
promises_resolved:
findings_or_blockers:
```

不粘贴正文全文。只有 gate 与 lint 均通过才返回 `ok`。
