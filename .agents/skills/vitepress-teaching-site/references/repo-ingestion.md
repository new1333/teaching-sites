# 仓库备课（repo 输入）

执行者：**备课智能体**（隔离上下文，spawn 模板见 `subagents.md`）——本文件的克制纪律因此多一层意义：它同时保护主智能体的长跑上下文预算。

目标：**不读全仓库**，产出「核心特性清单 + 能力依赖图」。特性数不设配额——仓库实际有多少个值得单独成章的核心原理，就拆多少个；特性数即章数之源。

定位先钉死（v4，两档政策——由大纲期确认、落盘 profile.source_policy）：

- **zero-trace（默认）**：仓库是**作者侧备课资料**，只用于把特性与原理拆对。产物零仓库痕迹——正文不引源码、不列行数、不做「与真源码对照」；测试不从官方/上游测试改编；实验场 API 不刻意对齐真实库。原理重实现课维持此档。
- **guided-walkthrough（走读课）**：仓库是**教学对象本身**。「解读这个仓库」是合法课程场景——此档下源码进正文，但受硬约束管辖（见下）。备课智能体在两档下都要做基础备课，walkthrough 档多产出一项源码地图。

备课智能体无法判断该走哪档（那是大纲期与用户的决定）——默认按 zero-trace 纪律读仓库，同时在 ingestion.json 附 `profile_hint`（如「该仓库文档完善、模块边界清晰，适合 source-walkthrough + repo-probe」或「核心价值在可重实现的原理，适合 principle-reimpl + code-lab」），供阶段 2 判定 profile 参考。

## 步骤

1. **获取源码**：`git clone --depth 1 https://github.com/{owner}/{repo}.git`（无 git 环境时下载 `https://codeload.github.com/{owner}/{repo}/tar.gz/{ref}` 并解包、剥掉顶层目录）。clone 目录保留在产物目录旁边（`.course/repo/`）——zero-trace 档仅供阶段 3 拿不准原理真实行为时按 relevant_files 查阅；walkthrough 档它是全书引用的锁定 ref 本体，**记录 clone 时的 commit SHA 一并写入 ingestion.json**（`locked_ref`），大纲期以它为 `input.ref` 的事实源。
2. **读元信息**：README 前 ~3000 字 + package.json（monorepo 再读 packages/*/package.json）。
3. **入口识别**（manifest 驱动，优先级 `exports > main > module > index`）：
   - `bin` 字段 → CLI 项目
   - `engines.vscode` / `contributes` → VSCode 扩展
   - pnpm-workspace.yaml / lerna.json / turbo.json / nx.json → monorepo，每个包独立入口
   - 超过 30% 文件含 `{{}}` 占位符 → **模板项目**：教「README + 结构模式」，不逐文件精读
4. **建 L0 结构图**：目录级树（排除 node_modules / dist / build / tests / fixtures / examples / docs / media / lockfile / minified），控制在 ~8000 字符内。超大仓库（>10k 文件）降级为「目录 + 文件数」聚合，只列前 80 个目录。
5. **选 L1 关键文件**（≤18 个）：入口文件及其同目录文件 + 启发式入口（文件名含 index / main / cli / server / app，+src/ 目录 +3 分，浅路径 +2 分）+ src 根层文件。全文读，单文件超过 ~12k 字符截断。
6. **抽特性清单**：从 L0 + L1 提取**可教学核心特性**（数量由仓库实际的核心原理决定，不设配额），每个一句话中文说明 + 支撑文件路径（evidence，路径必须真实存在）。同时产出能力依赖图：`edges: [{from, to}]`，from 依赖 to，to 是更基础的能力。**清单按学习顺序排序：越靠前越基础**。
7. **自检**：每个特性能落到「读者学完后能做什么」。太泛（如「高性能」）要拆；太细（如某个 helper 函数）要并；拆与并的裁判是内容与读者，不是数字。

## walkthrough 档附加产物（profile 判定为 guided-walkthrough 时启用；备课期即可预产，主流程不变）

在基础产物之上追加三项（同写 ingestion.json）：

1. **`locked_ref` 锁定**：commit SHA。全书引用以它为唯一事实源——大纲期写进 `input.ref`，正文引用块标注 `owner/repo@sha:path`，final-check 机械比对逐字一致。clone 后如果 upstream 有新提交，不追——锁定即锁定。
2. **源码地图**：`source_map: [{ path, one_liner, role }]`——入口清单（manifest 驱动的全部入口）+ 推荐走读顺序（按学习路径排序，即「先读什么才读得懂下一个」）+ 每文件一句话（它是什么、为什么值得读）。规模 ≤30 个文件；走读顺序直接变成大纲的章节依赖图——走读课的「学习顺序」就是「依赖顺序」。
3. **许可证核查**：读 LICENSE / COPYING / package.json.license。结论三选一写进 ingestion.json（`license: { kind, note }`）：
   - 宽松（MIT/Apache/BSD 等）→ walkthrough 可行，正文标注许可与署名；
   - 无许可证或传染性协议（GPL 系，取决于引用方式）且超出合理引用豁免 → **降回 zero-trace 并在返回中告知**（issues/012 风险边界：许可不友好不硬走读）；引用粒度与署名义务写进大纲 obligations（kind: legal）。
   - 不确定 → 返回中标记疑点，大纲期与用户澄清后再定。

## 主题输入（topic）的汇流

主题输入没有仓库步骤：直接把主题句拆解成同样的「特性清单 + 依赖图」（按学习顺序，一句话中文说明）。两条路汇流成同构数据，后续阶段完全一致——主题课程的 relevant_files 留空，无备课索引。

特性拆解示例（主题「从零写一个 Markdown 解析器」）：分词与行级预处理 → 块级结构（段落/标题/列表）→ 行内语法（强调/代码）→ 链接与图片 → 嵌套结构与递归 → HTML 透传与转义 → 测试策略与模糊测试。
