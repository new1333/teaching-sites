# 子智能体编排

本文只定义调度、写权与修订路由。角色行为的唯一正本在 `references/roles/`：

- [`roles/ingestion.md`](roles/ingestion.md)
- [`roles/chapter-writer.md`](roles/chapter-writer.md)
- [`roles/reviewer.md`](roles/reviewer.md)

主智能体始终持有用户交互与 `.course/` 全局账本。

## 默认串行

1. repo 输入可委派 ingestion；topic 输入由主智能体直接拆解。
2. 每章启动一个 chapter writer，输入只有路径、章号/slug 和待清承诺。
3. writer 返回并落盘后，启动独立 reviewer。评审 prompt 不携带作者报告或主智能体结论。
4. 主智能体按 finding 类型修订/回灌。
5. 阻断清零后，主智能体提交 rolling、promises 与 run 指针，再进入下一章。
6. 全章完成后启动一次 full-book reviewer。

lite 课程可由主智能体执行同一角色契约，不减少任何完成条件。

## 交接原则

- prompt 只传路径、范围和本次待处理清单；规则给文件路径让角色自读。
- 状态靠落盘，不靠聊天转述。
- writer 不写 rolling、promises、outline、bible、run。
- reviewer 只读，不改文件。
- 一个文件在一个事务中只有一个写者。

## 修订路由

| finding | 负责者 | 完成信号 |
|---|---|---|
| 正文解释、结构、术语、承诺 | 主智能体定向修 | chapter lint + reviewer 指出项复查 |
| 验证物、代码、答案、探针、资产 | 原 writer 回灌 | 对应模式 gate + lint |
| outline/profile 契约错误 | 主智能体回到阶段 2 | revision 增加，受影响章按 DAG 重算 |
| 跨章终态漂移 | 主智能体列受影响章，writer/主智能体修 | 全量引用闸门 + full-book review |

每次复查只验证已指出项和修复引入的直接影响。两轮仍有阻断时，把章标为 degraded 并按 state contract 传播 blocked；不把已知阻断包装成“带病完成”。

## 角色失败

角色无产物、返回异常或越权写文件：

1. 丢弃该事务未提交改动并恢复快照；
2. 用同一角色契约重试一次；
3. 再失败由主智能体执行该角色；
4. 仍失败按门槛失败处理。

## 并行

默认不开。用户明确要求并行时，先读取 [`parallel-mode.md`](parallel-mode.md) 做资格检查；无法划分独占写权的 companion 线保持串行，正文线也必须等验证物终态冻结。
