# repo-probe

只与 `guided-walkthrough` 配套。验证物是在锁定 commit 上运行的静态或最小运行探针。

## 安全边界

摄取阶段保持只读，不安装依赖或执行仓库生命周期脚本。探针优先用静态解析、grep、导出面检查和自建最小输入。确需运行目标仓库时，使用隔离环境、无宿主秘密、禁网络默认值，并在 ingestion 记录 `execution: sandboxed`。

## 循环

1. 确认 outline `input.ref` 是 commit SHA，clone HEAD 与它一致。
2. 写本章探针，断言正文将声称的机制。
3. 先观察空结果或预期失败，核对探针不是自证。
4. 调整探针/最小输入后转绿；记录关键输出。
5. 正文引用块标注 `owner/repo@sha:path`，与锁定文件逐字一致。
6. 评审复跑探针，并抽样逐字比对引用。

许可证、版权与署名 surfaces 必须在 profile obligations 中存在。许可不明或不适合引用时，回到 zero-trace，而不是弱化标注。

完成条件：探针全绿、每个机制断言有对应探针、引用与锁定 ref 一致。
