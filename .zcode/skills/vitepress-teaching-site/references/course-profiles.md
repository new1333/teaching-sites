# 课程形态

Profile 只回答“这门课如何把终点能力证出来”。章节内容仍由 ingestion 的特性与依赖图决定。

## Schema

```ts
type VerificationMode =
  | 'code-lab'
  | 'canvas-app'
  | 'worksheet'
  | 'observation'
  | 'repo-probe'
  | 'none'

type CourseProfile = {
  archetype:
    | 'principle-reimpl'     // 做出验证原理的最小实现
    | 'source-walkthrough'   // 独立读懂并讲解锁定源码
    | 'knowledge-path'       // 独立演算与判断
    | 'skill-training'       // 独立完成操作
  verification: VerificationMode | 'mixed'
  source_policy: 'zero-trace' | 'guided-walkthrough'
  code_density: 'full' | 'collapsed' | 'minimal'
  obligations: Array<{
    kind: 'timeliness' | 'compliance' | 'legal' | 'ethics'
    note: string
    surfaces: string[]
  }>
  presentation: {
    visual: 'none' | 'static-asset' | 'interactive'
  }
  scale: 'lite' | 'standard'
}
```

## 判定顺序

1. **先定终点。** 读者最终是实现、走读、演算判断，还是完成操作？
2. **再定证据。** 什么产物能让读者和评审都判断“真的会了”？
3. **再定来源政策。** repo 是作者备课材料，还是课程教学对象？
4. **最后定呈现。** 受众能承受多少代码，视觉载体是否承担概念或验证信号？

| 终点/内容 | 推荐 archetype | 推荐 verification |
|---|---|---|
| 框架、算法、运行时原理的最小重实现 | `principle-reimpl` | `code-lab` |
| 渲染、音频、图形或交互结果 | `principle-reimpl` / `skill-training` | `canvas-app` |
| 数值、统计、费率、决策路径 | `knowledge-path` | `worksheet` |
| 工具操作、现场观察、流程训练 | `skill-training` | `observation` |
| 锁定版本的真实仓库走读 | `source-walkthrough` | `repo-probe` |
| 只有解释与复盘，没有诚实的可判定产物 | 按终点选择 | `none` |

`mixed` 只表示课程包含多种模式，不是可执行模式。每个 build/walkthrough 章必须在 outline 写一个具体 `verification`。

## 保守准入下限（defaulted 校准用）

用户跳过校准时，保守画像按定案 archetype 套用这里的准入下限，不即兴发明；允许上浮（更保守），不允许下探。判定口径：每条都能回答「这个读者能否独立做 X」。

| archetype | 保守准入下限 |
|---|---|
| `principle-reimpl` | 能读懂并修改现成代码；未从零实现过该领域的同类系统；命令按步骤可执行 |
| `source-walkthrough` | 能用该语言读写中等长度单文件；会查官方文档；未读过万行级仓库 internals |
| `knowledge-path` | 能做四则与百分比运算、跟纸笔或表格演算；不假设专业数学训练 |
| `skill-training` | 按文档完成过基础安装与配置；遇到报错会检索；不假设命令行肌肉记忆 |

混合终点取各下限的交集；术语一律按首现即外行处理。archetype 定案与 ingestion hint 不一致时，重套下限并回填 `calibration.json` 的 `default_reason`。

## 章级验证解析

```text
principle/review 且未显式声明 verification → none
chapter.verification 已声明                 → 使用该模式
profile.verification 是具体模式             → 继承该模式
profile.verification = mixed                → outline 无效，必须给本章消歧
```

写作、lint、评审与 final-check 必须使用同一解析结果。不得把 `mixed` 直接传给验证流程。

## 来源政策

- **zero-trace**：repo 只用于作者侧备课。正文与验证物不引用目标仓库代码；公开概念和经权威来源核实的行为可以讲。
- **guided-walkthrough**：repo 是教学对象。锁定 commit SHA，源码引用标注 `owner/repo@sha:path` 并逐字核对；许可证与署名义务写入 obligations。

topic 输入沿用 `zero-trace`，含义是“没有外部源码引用面”。

## 代码密度

- `full`：编程读者需要完整追踪承重实现。
- `collapsed`：长代码默认折叠，但里程碑依赖路径保持展开。
- `minimal`：正文只保留能解释结论的最小切片；完整实现留在 companion 或附录。

代码密度控制阅读负担，不改变来源一致性和门槛。

## 领域义务

| kind | 触发 | 常见 surface |
|---|---|---|
| `timeliness` | 规则、税率、价格或政策会变化 | `docs/about.md` + 事实首现章 |
| `compliance` | 金融、医疗、法律等受监管表达 | 首页、速查表、收尾章 |
| `legal` | 许可证、版权、授权边界 | about + 首次引用处 |
| `ethics` | 双用途、安全或敏感操作 | about + 相关操作章 |

每个 surface 写真实相对路径，final-check 查存在性；措辞是否足够由评审判断。没有领域义务时使用空数组。

## 流程规模

- `lite`：通常是单点主题或不超过约 5 个教学特性。主智能体直做，可跳过问卷；状态、门槛、评审和构建仍完整。
- `standard`：需要完整校准、角色隔离或长篇连续性的课程。

规模由 ingestion 的特性和风险决定；已经进入 standard 生成的课程不在中途降档。

## 篇幅与认知曲线

课程形状包含篇幅曲线，规划时与认知预算一起看：

- 中后段的视野章、收尾章允许压缩，但 outline 必须声明压缩意图与最低回收义务——哪些主线在场内收口、哪些显式移交附录或 exercises；“三题塞一章”式静默换挡不允许。
- 相邻教学章篇幅骤降过半时，评审按“换挡未声明”提问；前松后紧同样算形状缺陷。
- 单章 new_concepts 超过 5 个属密度预警，由 chapter-writing.md 的密度预算接管。

## 完成条件

Profile 完成不是字段填满，而是：

- archetype 与 final milestone 的动词一致；
- 每个 build/walkthrough 章能解析到一个具体验证模式；
- source policy 与输入用途一致；
- obligations 的每个 surface 可落盘；
- code density 与读者模型匹配。
