# 并行模式

并行只优化等待时间，不改变课程语义。用户未明确要求时使用串行。

## 资格检查

同时满足才开启：

1. outline 已确认，feature DAG 与章级 verification 已解析；
2. companion 文件能按章节划分独占写权；
3. 波内章节没有直接/传递依赖；
4. 生成资产没有共享输出文件、全局计数器或不稳定排序；
5. 主智能体能在每波后运行全量门槛。

任一项不成立，相应验证物线退回串行。不要为并行度拆坏教学上本应聚合的模块。

## `blueprint.json`

```ts
type BlueprintState = {
  schema_version: 2
  outline_revision: number
  concept_first: Record<string, string>       // concept -> chapter slug
  api_plan: Array<{
    chapter: string
    additions: string[]
    semantic_changes: string[]
  }>
  planned_summaries: Record<string, string>
  promises_plan: Array<{ from: string; target: string; what: string }>
  file_ownership: Record<string, string[]>     // chapter slug -> exclusive paths/globs
  waves: string[][]                            // topological layers
}
```

所有章只能实现自己 `api_plan` 与 `file_ownership` 的范围。共享文件出现于两个章即 blueprint 无效。

## 执行

### 验证物线

逐波进行；波内 writer 只做验证物半程。全部返回后，主智能体运行 companion 全量门槛。

- 全绿：提交该波，再开始下一波。
- 交叉破坏：按 file ownership 定位责任章，定向回灌。
- 两轮仍无法隔离：恢复波前快照，该波及后续改为串行。

### 正文线

等全部验证物终态冻结后再并行。writer 只写自己的章和 lint；前情来自 blueprint planned summaries，概念首教来自 concept_first。

## 缝合审计

全书评审前由主智能体完成：

1. 实际 API 与 `api_plan` 对账；
2. 实际首教章与 `concept_first` 对账；
3. 真实验证物重写 rolling summaries；
4. promises 实际登记与计划对账；
5. 正文引用与 companion 终态全量比对；
6. 全量门槛重跑。

现实与 blueprint 冲突时以现实为调查起点：修实现或提升 outline revision，不能静默改 blueprint 掩盖漂移。

## 失败传播

某章 degraded 后，取消同波中依赖关系判断失效的结果，按 outline DAG 标记传递依赖为 blocked。独立波可继续。课程完成条件与串行相同。
