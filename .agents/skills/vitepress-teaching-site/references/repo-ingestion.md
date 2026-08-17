# 仓库备课（repo 输入）

目标：**不读全仓库**，产出「核心特性清单 + 能力依赖图」。特性数不设配额——仓库实际有多少个值得单独成章的核心原理，就拆多少个；特性数即章数之源。

定位先钉死：仓库是**作者侧备课资料**，只用于把特性与原理拆对。产物零仓库痕迹——正文不引源码、不列行数、不做「与真源码对照」；测试不从官方/上游测试改编；实验场 API 不刻意对齐真实库。备课阶段的克制还决定了后面各章还有没有上下文可用。

## 步骤

1. **获取源码**：`git clone --depth 1 https://github.com/{owner}/{repo}.git`（无 git 环境时下载 `https://codeload.github.com/{owner}/{repo}/tar.gz/{ref}` 并解包、剥掉顶层目录）。clone 目录保留在产物目录旁边（如 `.course/repo/`）——仅供阶段 3 拿不准原理真实行为时按 relevant_files 查阅，是备课资料不是引用素材。
2. **读元信息**：README 前 ~3000 字 + package.json（monorepo 再读 packages/*/package.json）。
3. **入口识别**（manifest 驱动，优先级 `exports > main > module > index`）：
   - `bin` 字段 → CLI 项目
   - `engines.vscode` / `contributes` → VSCode 扩展
   - pnpm-workspace.yaml / lerna.json / turbo.json / nx.json → monorepo，每个包独立入口
   - 超过 30% 文件含 `{{}}` 占位符 → **模板项目**：教「README + 结构模式」，不逐文件精读
4. **建 L0 结构图**：目录级树（排除 node_modules / dist / build / tests / fixtures / examples / docs / media / lockfile / minified），控制在 ~8000 字符内。超大仓库（>10k 文件）降级为「目录 + 文件数」聚合，只列前 80 个目录。
5. **选 L1 关键文件**（≤18 个）：入口文件及其同目录文件 + 启发式入口（文件名含 index / main / cli / server / app，+src/ 目录 +3 分，浅路径 +2 分）+ src 根层文件。全文读，单文件超过 ~12k 字符截断。
6. **抽特性清单**：从 L0 + L1 提取**可教学核心特性**（数量由仓库实际的核心原理决定，不设配额），每个一句话中文说明 + 支撑文件路径（evidence，路径必须真实存在）。同时产出能力依赖图：`edges: [{from, to}]`，from 依赖 to，to 是更基础的能力。**清单按学习顺序排序：越靠前越基础。**
7. **自检**：每个特性能落到「读者学完后能做什么」。太泛（如「高性能」）要拆；太细（如某个 helper 函数）要并；拆与并的裁判是内容与读者，不是数字。

## 主题输入（topic）的汇流

主题输入没有仓库步骤：直接把主题句拆解成同样的「特性清单 + 依赖图」（按学习顺序，一句话中文说明）。两条路汇流成同构数据，后续阶段完全一致——主题课程的 relevant_files 留空，无备课索引。

特性拆解示例（主题「从零写一个 Markdown 解析器」）：分词与行级预处理 → 块级结构（段落/标题/列表）→ 行内语法（强调/代码）→ 链接与图片 → 嵌套结构与递归 → HTML 透传与转义 → 测试策略与模糊测试。
