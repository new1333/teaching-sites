# Repo 摄取

目标是用有限上下文得到**可教学特性、能力依赖与证据路径**，不是把仓库读完。产物形状见 [`state-contracts.md`](state-contracts.md) 的 `IngestionState`。

## 安全与来源

- clone 到 `{course_dir}/.course/repo/`，立即记录 commit SHA。
- 摄取阶段只读：不安装依赖、不执行 package lifecycle、构建脚本或仓库二进制，不读取宿主凭据。
- 运行探针只在大纲选择 guided-walkthrough 后进行；优先静态探针，确需执行时使用隔离环境并记录 `execution: sandboxed`。
- 读取 LICENSE/COPYING/package metadata。许可不明时保留疑点，不把“公开可见”当成可再分发。

## 有界步骤

1. **元信息**：README 入口段、manifest、workspace 配置、许可证。
2. **入口图**：按 manifest 的 exports/bin/main/module 与框架约定识别运行入口；monorepo 先列包边界。
3. **L0 结构**：排除依赖、构建物、minified、fixture 与媒体，生成目录级地图。超大仓库只保留聚合目录与文件数。
4. **L1 证据**：选择能解释入口和核心机制的关键文件，通常不超过 18 个；单文件只读与机制相关的范围。
5. **特性**：每项写稳定 id、中文名、一句机制、读者学完能做什么、真实证据路径。
6. **依赖图**：edge `from` 依赖 `to`；按拓扑顺序检查每个特性是否能独立成一个教学推进。
7. **profile hint**：给 archetype、verification、source policy 与理由；最终由主智能体在大纲期决定。

预算是保护上下文的上限，不是读满目标。已有足够证据支撑全部特性时停止继续翻仓库。

## 两种来源政策的备料

### zero-trace

证据路径只供作者核实。后续正文不引用目标源码，companion 测试也从教学契约独立设计。

### guided-walkthrough 候选

仅当许可证和结构适合时，额外产出：

- `repo.locked_ref`：完整 commit SHA；
- `repo.source_map`：入口、推荐阅读顺序、文件角色；
- `repo.license`：许可与署名义务；
- 能用静态或隔离探针确认的机制清单。

source map 按理解依赖排序，不按目录遍历。许可证不友好、不确定或引用范围失控时，建议 zero-trace 并写明原因。

## 模板/生成器仓库

若主要内容是占位模板或生成产物，把教学单元提升到“模板参数、生成阶段、约定与扩展点”，不逐文件讲重复输出。

## 完成条件

- `ingestion.json` 符合 schema v2；
- 每个 feature 有 `reader_can` 和至少一个可核实依据（topic 输入可用权威资料而非路径）；
- feature ids 唯一，依赖边只引用现有 id，图无环；
- repo ref 与实际 clone HEAD 一致；
- profile hint 说明取舍而非只给标签；
- 阻塞与许可证疑点进入 `issues`。
