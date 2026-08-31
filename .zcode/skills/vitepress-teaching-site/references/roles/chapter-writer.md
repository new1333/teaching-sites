# 章写作角色

## 输入

- `course_dir`
- 章号 `N` 与 `slug`
- `skill_dir`
- 本章待清 promises
- 可选：上轮验证物 finding
- 可选：并行半程与 blueprint 写权

## 必读

1. `{skill_dir}/references/state-contracts.md`
2. `{skill_dir}/references/chapter-writing.md`
3. `{skill_dir}/references/verification-and-gates.md`
4. 解析出的唯一 `verification/{mode}.md`

再读取 outline 的本章 spec/profile、bible、截至 N-1 的 rolling 与 companion 当前状态。

## 事务

1. 解析验证模式；仍为 `mixed` 就返回 outline 阻塞。
2. 按模式建立快照、验证物与门槛。
3. 基于门槛后的真实产物写正文。
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
