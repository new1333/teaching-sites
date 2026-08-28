# 课程形态层（Course Profile）

同一套流程骨架，服务从「coding 原理课」到「非编程知识课」「仓库走读课」的全部形态。机制保证只有一条——**不变量与形态细则分层**（SKILL.md 公理 1）：骨架的每根承重梁必须是跨形态不变量，形态差异全部收进本文件定义的 profile，由大纲期判定、用户确认、落盘 `outline.json` 顶层。

profile 是**预设起点 + 可覆盖维度**，不是封闭分类：未知主题走 `mixed` 并在大纲期与用户把每个维度定下来；schema 缺失字段走缺省修润（宽松校验原则不变）。

## Schema

```ts
CourseProfile = {
  archetype: 'principle-reimpl' | 'source-walkthrough' | 'knowledge-path' | 'skill-training'
    // 学习终点：做出最小实现 | 独立读懂并讲解该库机制 | 独立演算与判断 | 独立完成操作
  verification: 'code-lab' | 'canvas-app' | 'worksheet' | 'observation' | 'repo-probe' | 'mixed' | 'none'
    // 机械验证物形态（见下表）。none = 纯导读，合法但质量标准如实降级为「能理解」，且必须经用户确认
  source_policy: 'zero-trace' | 'guided-walkthrough'   // 仓库源码可否进正文，默认 zero-trace（见 repo-ingestion.md）
  code_density: 'full' | 'collapsed' | 'minimal'
    // 正文代码密度档位：full 现行默认 | collapsed 超过 ~10 行的代码块默认折叠（<details> 包裹）| minimal 只保留承重最小切片
    // 受众是非程序员时默认 collapsed 或 minimal（实测教训：代码占到全书四成篇幅，非程序员读者的负担陡增）
  obligations?: { kind: 'timeliness' | 'compliance' | 'legal' | 'ethics', note: string, surfaces: string[] }[]
    // 领域义务（见下节），空缺合法——不给纯技术课强加仪式
  presentation?: { visual?: 'none' | 'static-asset' | 'interactive' }
    // 可视化能力开关。判据驱动：只是能力声明，不是使用配额——用不用、用几个，只回答
    // 「不加它本章的验证信号或承重概念会不会塌」（SKILL.md 公理 2）
  scale: 'lite' | 'standard'   // 流程档位，见下文 lite 档
}
```

## 验证形态总表

「先验证物后文」（公理 3）在每种形态下的化身。不变量跨形态成立：**每章有一个机械或可判定的验证信号；验证段的「双门槛两侧可见」泛化为「验证物输出两侧可见」**。

| 形态 | 机械验证物（先于正文存在） | 适用 | 双硬门槛等价物 |
|---|---|---|---|
| code-lab | 测试 + 实现（四变体：library / cli-golden / config-validate / dom-test） | 库/框架/内核原理重实现 | `tsc --noEmit` + `vitest run`（等价物按变体，不变） |
| canvas-app | 可运行页面工程 + 由实验场代码现场产出的资产 | 渲染/音频/可视化 | typecheck + test + build + 资产再生成脚本（两次运行输出一致） |
| worksheet | 题目 fixture + 唯一数值答案 + 核对脚本；正文全部承重数字由脚本导出 | 数值/演算/决策类知识课（股票、统计、金融） | 答案核对脚本通过 + 正文数字与脚本输出一致（export-docs 守门） |
| observation | 验证任务清单：每条写明读者操作 + 应看到的具体现象（可判定描述） | 实地操作/工具使用/现象观察 | 任务清单过「可判定性」审查：现象具体到可对照，不写「感受一下」（lint 的 observation 检查 + 评审核对） |
| repo-probe（配 guided-walkthrough） | 探针脚本：在锁定 ref 上跑 grep/断言/最小运行 | 源码走读课 | 探针脚本全绿 + 引用代码块与 repo 逐字一致（lint/final-check 机械比对） |

各形态的门槛循环细节见 `verification-and-gates.md`。

## 判定与确认流程

1. **阶段 0 备课产出建议值**：repo 输入由备课智能体在 ingestion.json 附 `profile_hint`（如「该仓库适合 source-walkthrough + repo-probe」）；topic 输入由主智能体从主题句推导。
2. **阶段 2 随大纲呈现确认**：大纲确认点本就确认实验场形态，扩展为确认 profile 全字段（呈现为一句话画像：「非编程知识课 · 演算核对验证 · 代码默认折叠 · 含合规义务」）——**不新增交互轮次**。
3. **落盘**：`outline.json` 顶层 `profile` 字段；lint 与 final-check 从这里读 `source_policy / verification`，大纲确认后全文流程按 profile 实例化。
4. 用户纠正 profile 判定 = 大纲反馈的一种，带反馈重出大纲即可；**判定被频繁纠正说明判定面不清晰**，观测指标记录之。

## 样例映射（现有 12 门课为校准集）

| 课程 | archetype | verification | code_density | obligations |
|---|---|---|---|---|
| pinia 原理课 | principle-reimpl | code-lab | full | — |
| webgl 图形课 | principle-reimpl | canvas-app | full | — |
| A 股投资课 | knowledge-path | mixed（worksheet + observation） | collapsed→minimal | compliance + timeliness |
| 仓库解读课 | source-walkthrough | repo-probe | full | legal（许可证） |
| 摄影入门课（假设） | skill-training | observation | minimal | — |

校准语义：现有课程是 profile 的金样例语料库——形态选择面大，生成才稳；每个 profile 配一门金样例对冲。

## 领域义务槽（obligations）

领域特有义务（合规、时效、法律、伦理）需要一个表达位置，否则金融课的免责声明无家可归。bible（阶段 1 推导）与 outline（落盘 + surfaces 指定呈现面）各有 obligations 槽位，四类：

| kind | 触发 | 落点（surfaces 指定，final-check 查存在性） |
|---|---|---|
| timeliness | 事实随时间变化（交易规则、税率、价格政策） | about.md 落「内容时效」声明 + 正文断言处「以 X 为准（截至 YYYY-MM）」+ 权威文档清单联动 |
| compliance | 受监管领域表述义务（金融/医疗/法律） | 收尾章标准声明 + 速查表头部 + 首页 hero 下方，措辞按领域惯例 |
| legal | 法律边界（内幕消息、版权、许可证） | 相关章首现处一句边界声明 |
| ethics | 安全/双用途主题 | about.md 声明授权使用前提 |

义务由大纲期从主题推导——备课与大纲各问一句「这个领域有没有不做就会被下架/教坏人的表述义务」，答不出就空缺，**空缺合法**。生成期 obligations 逐项落 surface；final-check 机械查 surfaces 文件存在性，措辞到位与否由评审轴核对。

## 流程档位 scale

- **lite**（≤5 章或单点主题）：跳过校准问卷（按 audience 保守默认画像）、bible 精简为术语表 + 验证约定两项、不 spawn 子智能体（主智能体直做全部角色）。**质量门不减**：lint、final-check、验证物门槛、评审轴照跑——lite 减的是流程环，不是质量门。
- **standard**：现行全流程（校准问卷、完整 bible、三角色子智能体、串行逐章）。

判定同样在大纲期给建议值、随大纲确认。已按 standard 跑到一半的课程不降档。
