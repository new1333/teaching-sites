# 伴生实现与双硬门槛

## 伴生实现是什么

`companion/` 是**读者课程结束时拥有的示例工程**——摄取阶段蒸馏出的核心特性的从零实现（如 pinia-mini ≈300 行）。**它是蒸馏核心，不是仓库的复刻**：面对 Kubernetes、PyTorch 这类大型仓库，伴生实现的是特性清单构成的最小内核（mini-scheduler、带 autograd 的 mini-tensor），规模几百行。它是全书的共享状态：每章演进一次，正文的实现段落引用它的真实代码。

为什么先代码后文：长篇课程的一致性无法靠模型记忆或长上下文保证——门槛命令和测试是外部硬信号，代码连续性由它们背书。所以每个 build 章都是两次生成：**先演进伴生实现并过门槛，再基于真实代码变更写正文**。

## 形态按主题选（不变量：每章有机械可验证的增量）

| 形态 | 适用 | 双硬门槛示例 |
|---|---|---|
| library（默认） | 库 / 框架内核 | `tsc --noEmit` + `vitest run`；Go 等价物 `go vet` + `go test ./...` |
| cli-golden | CLI、解析器、构建工具 | 构建 + golden 输出比对（固定输入 → 比对输出文件） |
| config-validate | Nginx / Terraform / k8s 配置类 | `nginx -t` / `terraform validate` / `kubectl apply --dry-run=client` |
| dom-test | 浏览器组件、可视化 | 构建 + DOM 断言（vitest + jsdom / testing-library） |

不变量只有一条：**门槛是外部的、机械的，过了才写正文**。语言跟随主题的自然语言。形态与规模写进大纲的 `companion` 字段、随章节表一并确认；若任何形态都收敛不出，按 SKILL.md「何时不适用」与用户前置澄清，不要硬生成。

## 脚手架（阶段 2 确认后、第一章之前建好）

以默认 library 形态（TS + vitest）为例；其他形态用等价脚手架（go.mod、Makefile 等），门槛命令按上表。

`companion/package.json`：

```json
{
  "name": "companion",
  "private": true,
  "type": "module",
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`companion/tsconfig.json`：`strict: true`、`target/module: ESNext`、`moduleResolution: bundler`、include `src` 与 `tests`。建好后跑一次 `npm install`（后续章不再装）。

## 每章门槛循环（build 章）

1. **快照**：复制 `companion/src` 到 `.course/snapshots/pre-ch-{N}/`（失败回滚点）。
2. **写本章测试（红）**：现写 `companion/tests/{slug}.test.ts`，断言该章 milestone 的**行为**；先跑一次，必须失败——这就是渐进语义的机械证明，无需人工审计 import。`tests/` 是 append-only：只新增本章测试，绝不动旧章测试；旧章测试持续全绿，就是公共 API 向后兼容的哨兵。
3. **演进代码**，纪律：
   - 文件级变更、增量演进——不重写与本章无关的文件；
   - 不改 `tests/` 里旧章的测试文件（测试由管线管理）；
   - 遵守圣经的代码约定，与既有文件风格/命名一致；
   - 溯源文件（从 clone 里读该章 relevant_files，≤4 个，各截 ~12k 字符）是「**思想参考而非逐行照抄**」。
4. **双硬门槛**（cwd = `companion/`，按形态执行对应命令）：先确认本章新测试已转绿，再全量跑一遍——全部测试必须通过。
5. 失败：把报错尾部（门槛命令全量输出 + 测试最后 ~50 行）作为下一轮修复的输入，回到步骤 3。**最多 3 轮**。
6. 3 轮仍败：**回滚快照** → 本章降级为占位章（正文写为 `::: warning` 块，含失败原因摘要与重试指引）→ 滚动摘要注明「伴生实现保持上一章形态」→ **继续下一章，不中断全书**。

## 测试写法要点（写「红」测试时的自检）

- 每个 build 章一个 `tests/{slug}.test.ts`；只依赖伴生实现自身，不依赖网络、不 sleep 等待；
- 断言 milestone 的**行为**（调用什么、得到什么），不断言实现细节；
- **行为 vs 实现细节的边界**：只断言公共 API 的输入/输出承诺（能写进文档的行为）；不断言内部存储格式、文本布局。若某个内部行为本身就是教学承诺（如「对象落盘是压缩的」），先把它写进圣经的 API 契约，再按契约断言；
- 渐进语义由第 2 步的「先红」机械保证：写出来先跑、看到红，才开始实现。

## 断点续跑与单章重生成

- 每章完成即落盘：章 md、`.course/rolling.json`（每章滚动摘要 + 是否降级 + 章文件名）。会话中断后从未完成的章继续。
- 「从第 N 章重生成」：恢复第 N-1 章的快照/滚动摘要，删去第 N..末章的测试文件，重跑 N..末章（后续章依赖前章滚动摘要，必须连锁重算）。
