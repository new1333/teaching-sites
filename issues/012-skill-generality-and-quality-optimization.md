---
id: 012
title: skill v4 优化方案：主题通用化、去死板化、质量机械化
status: closed
labels: [skill-redesign]
blocked-by: []
---

# 012 · vitepress-teaching-site v4 优化方案

- 日期：2026-08-27
- 审查对象：`.agents/skills/vitepress-teaching-site/`（SKILL.md + 7 个 references）+ `.zcode/agents/` 三角色定义 + `courses/` 下全部 12 门课程产物
- 输入材料：issues/001–011（尤其 010 lint 反噬、011 教学目的评审）、`courses/a-share-investing-course/REVIEW-2026-08-19.md`（全书质量审查报告）
- 目标（用户口径）：**提高输出质量；提高通用性**（同一 skill 既要做 coding 仓库解读课，也要做股票学习路径这类非编程知识课）；**去掉死板硬性要求**（任何「每章必须有 N 个可视化组件」式的配额制规则）

---

## 一、审查结论：三条主线

### 1. 通用性问题——skill 的「主题中立」是表面上的，骨架是单主题的

skill 文本大量使用了主题中立措辞（「形态按主题可换」「不设配额」），但**流程骨架的每一根承重梁都是 coding 课的**：

| 位置 | coding 偏置 | 非 coding 主题的后果（实证） |
|---|---|---|
| 质量标准总纲 | 「亲手**做出**验证原理的**最小实现**」 | 股票课读者的终点应是「能独立演算/判断」，不是「写出实现」 |
| 原则 2 先代码后文 | 唯一可信的机械信号 = 测试红绿 + 双硬门槛 | 知识课被迫造一个 TS 实验场给非程序员读者看 |
| companion 形态表 | library / cli-golden / config-validate / dom-test，全是代码 | a-share 被迫走 library 形态 |
| 「何时不适用」 | 收敛不出代码实验场 → 「质量标准**明确降级**为能理解」或拒做 | 知识课是二等公民：要么硬套代码范式，要么降级 |
| 章节骨架第三段 | 「渐进实验（引用伴生实验场的真实代码）」 | 非编程读者的系统性负担：a-share 评审实录「多章代码占 40–45% 篇幅」，作者事后手工把 127 处大段代码块改为默认折叠 |
| 零仓库痕迹（一刀切） | repo 只能当作者侧备课资料 | **「仓库解读课」被整体排除在适用面外**——而这是用户明确要支持的场景 |
| lint | 中文专用规则硬编码（中英空格/被字句/80 字长句/黑话黑名单） | 非中文课程 lint 近乎空转 |

a-share 课是最佳证据：它最终质量不低（评审 4.2/5），但走的全是**规则外手工路径**——自研 echarts 可视化组件体系（5 个 Vue 组件 + theme 注册，skill 零规范）、手工折叠代码块、手工补合规声明。一门课的成功靠的是作者补救而不是 skill 支持。

### 2. 死板问题——配额与固定形态已产生实测反噬

- issues/010 已记录并修复了一轮（pain-point 信号词催生硬造踩坑故事、term-intro 句式催生「中文（english——解释）」全书模板化）。教训成文：**检测意图，别催生模板**。
- 仍存留的死板点：五段骨架固定、开章必须是 bug 故事（011 P2-8 实证「22/22 章全是第二人称亏损剧本」「收尾/对照章凑数开章」）、章型只有 principle/build 二值（复习章、走读章没有位置）、≥1200 字下限对总览/复习章强制灌水、acceptance 必含「实验场门槛通过」（无实验场时空转）。
- 用户点的「每章必须有 N 个可视化组件」式的规则目前 skill 里**没有**——但这正是要立住的护栏：本轮新增任何机制时不得引入这类配额（见第二节公理 2）。

### 3. 质量问题——机械背书只覆盖代码面（011 的核心发现，本轮全盘吸收）

011 的结论：第一性原则「长篇一致性靠外部机械信号背书，不靠模型自觉」**只对代码兑现了**；散文面（承诺、数字、事实断言、术语覆盖）与读者动作面（自查、练习、亲手开机）几乎全靠自觉，系统性失守。给了脚本的检查执行率接近 100%，没给脚本的十几项终检实际只做了 3 项。另据本次核实：**12 门课的 `.course/` 管线状态零提交**（.gitignore 整目录排除），lint.mjs 无任何已提交副本——可审计性归零（011 P2-9 成立且更严重）。

---

## 二、设计公理（写进 SKILL.md 顶部，v4 的宪法）

1. **不变量与形态细则分层。** 每条规则必须二选一标注：**不变量**（跨一切课程形态必须成立，如「承重概念必须教透」「正文断言与机械现实一致」「零死链」）或**形态细则**（只对某课程形态生效，如「build 章双硬门槛」「worksheet 答案可核对」）。细则层不得冒充不变量——这是通用性的机制保证。
2. **判据化，禁配额。** 任何「每章必须 N 个 X」式配额（可视化组件、图示、比喻、自查题数、章字数上下限中的「必须达到」侧）不得进入 skill。一切「加东西」的决策只回答一个问题：**不加它，本章的验证信号或承重概念会不会塌**。数值上限（加粗 ≤8、闪前 ≤3 这类防御性阈值）不是配额，保留且可按课程调参。反噬证据引 issues/010。
3. **先验证物后文（原则 2 的泛化）。** 写正文之前必须先存在该课程形态的**机械验证物**——测试也好、答案核对脚本也好、探针输出也好——正文数字与断言一律以验证物输出为事实源。这条从「先代码后文」升级为跨形态不变量，代码只是验证物的一种。

---

## 三、改造 A：课程形态层（course profile）——通用性的主菜

在阶段 0 备课产出建议值、阶段 2 随大纲一并呈现给用户确认（大纲确认点本就确认实验场形态，扩展为确认 profile，不新增交互轮次）。落盘进 `outline.json` 顶层。

### Schema（草案）

```ts
CourseProfile = {
  archetype: 'principle-reimpl' | 'source-walkthrough' | 'knowledge-path' | 'skill-training'
    // 学习终点：做出最小实现 | 独立读懂并讲解该库机制 | 独立演算与判断 | 独立完成操作
  verification: 'code-lab' | 'canvas-app' | 'worksheet' | 'observation' | 'repo-probe' | 'mixed' | 'none'
    // 机械验证物形态（见下表）；none = 纯导读，合法但质量标准如实降级并经用户确认
  source_policy: 'zero-trace' | 'guided-walkthrough'   // 仓库源码可否进正文（默认 zero-trace）
  code_density: 'full' | 'collapsed' | 'minimal'       // 正文代码密度档位（a-share 的 127 处手工折叠 → 配置化）
  obligations?: { kind: 'timeliness' | 'compliance' | 'legal' | 'ethics', note: string, surfaces: string[] }[]
    // 领域义务（见改造 C），空缺合法
  presentation?: { visual?: 'none' | 'static-asset' | 'interactive' }  // 可视化能力开关，判据驱动（见改造 E-9）
  scale: 'lite' | 'standard'                            // 流程档位（lite 减流程环不减质量门，见下）
}
```

### 验证形态总表（companion-and-gates.md 形态表的泛化）

| 形态 | 机械验证物（先于正文存在） | 适用 | 双硬门槛等价物 |
|---|---|---|---|
| code-lab（现行） | 测试 + 实现 | 库/框架/内核原理重实现 | `tsc --noEmit` + `vitest run`（不变） |
| canvas-app（011 P1-5） | 可运行页面工程 + 由实验场代码现场产出的资产 | 渲染/音频/可视化 | typecheck + test + build + 资产再生成脚本 |
| worksheet（新） | 题目 fixture + 唯一数值答案 + 核对脚本；正文全部承重数字由脚本导出 | 数值/演算/决策类知识课（股票、统计、金融） | 答案核对脚本通过 + 正文数字与脚本输出一致（export-docs 守门，a-share 已验证的模式） |
| observation（新） | 验证任务清单：每条写明读者操作 + 应看到的具体现象（可判定描述） | 实地操作/工具使用/现象观察 | 任务清单过「可判定性」审查：现象描述具体到可对照，不写「感受一下」 |
| repo-probe（新，配 guided-walkthrough） | 探针脚本：在锁定 ref 上跑 grep/断言/运行输出，正文断言与探针输出一致 | 源码走读课 | 探针脚本全绿 + 引用代码块与 repo 逐字一致（机械比对） |

**不变量**（跨形态）：每章有一个机械或可判定的验证信号；验证段的「双门槛两侧可见」泛化为「验证物输出两侧可见」。

### 样例映射（用现有 12 门课做校准集）

| 课程 | archetype | verification | code_density | obligations |
|---|---|---|---|---|
| pinia 原理课 | principle-reimpl | code-lab | full | — |
| webgl 图形课 | principle-reimpl | canvas-app | full | — |
| A 股投资课 | knowledge-path | worksheet + observation（mixed） | collapsed→minimal | compliance + timeliness |
| 仓库解读课（新场景） | source-walkthrough | repo-probe | full | legal（许可证） |
| 摄影入门课（假设） | skill-training | observation | minimal | — |

### 流程档位 scale

- **lite**（≤5 章或单点主题）：跳过校准问卷（默认画像）、bible 精简为术语表 + 验证约定、不 spawn 子智能体（主智能体直做）。**质量门不减**：lint、final-check、验证物门槛照跑。
- **standard**：现行全流程。

---

## 四、改造 B：仓库解读课合法化（source_policy）

现 skill 把「零仓库痕迹」写成不分场景的宪法，直接排除了「解读这个仓库」这一用户明确要的场景。v4 改为两档政策：

- **zero-trace**（默认，= 现行为）：repo 仅作者侧备课，产物零仓库痕迹。原理重实现课维持此档。
- **guided-walkthrough**（新）：repo 是**教学对象本身**。规则：
  1. 大纲期锁定 ref（commit SHA），全书引用以它为唯一事实源；
  2. 正文代码块**必须**标注 `owner/repo@sha:path`，且与该 ref 逐字一致——final-check 机械比对（这是「先验证物后文」在走读课的化身）；
  3. 走读顺序 = 学习路径（备课智能体的源码地图直接变成章节依赖图）；
  4. 读者验证 = repo-probe：checkout 锁定 ref、跑探针脚本（grep 断言/日志检查/最小运行），「亲眼看到」优先于「听我转述」；
  5. 义务：标注源码许可证；许可不友好（无许可证/传染性协议且超出引用豁免）时降回 zero-trace 并告知用户；
  6. 仍然一章一个可讲清的机制，「导读」不等于「逐文件流水账」。

备课智能体（course-ingestion）在 walkthrough 档多产出一项：源码地图（入口清单 + 推荐走读顺序 + 每文件一句话），其余流程不变。

## 五、改造 C：领域义务槽（obligations）

a-share 评审 P0-1（全书零合规声明）暴露的缺口：**领域特有义务在 skill 里无表达位置**。v4 在 bible 与 outline 增加 obligations 槽位，四类：

| kind | 触发 | 落点（surfaces 指定） |
|---|---|---|
| timeliness | 事实随时间变化（交易规则、税率、价格政策） | about.md 落「内容时效」声明 + 正文断言处「以 X 为准（截至 YYYY-MM）」+ 权威文档清单联动 |
| compliance | 受监管领域表述义务（金融/医疗/法律） | 收尾章标准声明 + 速查表头部 + 首页 hero 下方，措辞按领域惯例 |
| legal | 法律边界（内幕消息、版权、许可证） | 相关章首现处一句边界声明 |
| ethics | 安全/双用途主题 | about.md 声明授权使用前提 |

义务由大纲期从主题推导（备课/大纲各问一句「这个领域有没有不做就会被下架/教坏人的表述义务」），空缺合法——不给纯技术课强加仪式。

## 六、改造 D：去死板清单（逐条规则审计）

| 现规则 | 反噬/不适用证据 | v4 改为 |
|---|---|---|
| 骨架五段固定，第三段「渐进实验引用实验场代码」 | 非编程主题无实验可引 | **五槽位制**：开章钩子 / 原理 / 演练（code-lab 代码、worksheet 跟算、observation 实操任选）/ 验证（读者动作）/ 收束（小结 + 自查）。槽位必填，槽内形态随 profile |
| 开章必须「真实 bug 故事」 | 011 P2-8：22/22 亏损剧本预支、收尾章凑数开章 | hook.kind 四选一：bug-story / real-incident（公开事故、市场现象）/ observation（现象观察）/ ability-gap（已能什么 vs 还差什么）。验收 = 钩子具体到现象，不再是「必须是 bug」 |
| 章型只有 principle/build | 复习章、走读章无位置 | 扩为 principle / build / review（part 末概念对账，011 P2-7）/ walkthrough。profile 决定可用集 |
| 每章 ≥1200 字 | 总览/review 章强制灌水 | 默认 1200 字下限保留给 teaching 章；review/总览章可在 outline 声明豁免；lint 按声明检查（字数是防御下限不是目标值，维持「讲透即收」） |
| acceptance 必含「实验场门槛通过」 | 无实验场课程空转 | 「本章验证信号通过」，验证信号 = profile 对应验证物 |
| lint 中文规则硬编码 | 非中文课近零检查 | `--lang zh/en` 参数化：中文规则仅 zh；跨语言通用规则（出处真实、承诺账、数字一致、死链）全语言生效 |
| 问卷/bible/子智能体全量流程 | 小课过重 | scale: lite 档（减流程环不减质量门） |
| 零仓库痕迹一刀切 | 走读课被拒 | source_policy 两档（改造 B） |
| milestone_verify / 亲手开机绑定实验场 | 知识课无实验场 | 验证物随 profile；「可感知」判定细则收窄（011 P1-5：测试输出不算可感知面） |
| lint.mjs 以文本形式内嵌在 reference、落到被 gitignore 的 `.course/` | 12 门课零已提交副本，逐课漂移 | 脚本上移为仓库级共享资产：`scripts/course-lint.mjs`（提交），skill 指令改为 `node scripts/course-lint.mjs <course_dir> <章文件> --lang --profile --pain ...`；reference 只留变更说明 |

---

## 七、改造 E：质量机械化（吸收 011 全部 P0/P1 与可落地 P2）

优先级与 011 第五节一致，此处只列与本方案合并后的最终形态：

1. **final-check 仪器化（011 P1-6，最高 ROI）**：`vitepress-assembly.md` 内置 `scripts/course-final-check.mjs` 脚本文本（仓库级提交）。机械可查项全部入脚本：`src/` 标注块与验证物终态逐字 diff、正文数字与门槛命令输出比对、glossary 页 = bible 条目集、hero 长度、附录互链存在性、章数与 frontmatter、（walkthrough 档）引用代码块与 repo@sha 比对。原则成文：「凡能脚本化的对账不得留给自觉」。
2. **prose 事实守门（011 P0-2）**：权威文档清单从按需改门槛必填（涉事实断言的课程，final-check 查存在性，缺失即阻断）；硬要求 15 扩面到承重概念首现定义与痛点故事内技术断言（「故事可以虚构，物理不可以」）；a-share 的 export-docs 守门模式写入 skill 明文——**正文承重数字由脚本导出、守门断言随导出脚本走**（worksheet 形态的天然门槛）。
3. **承诺账本（011 P0-3）**：闪前承诺登记 `.course/promises.json`，目标章生成时注入清账项，全书评审机械核销；终检第 12 条从「资源清白」升级为「能力对账」。
4. **主动学习默认化（011 P0-1）**：自查从「可选不设配额」改为默认（teaching 章小结 ≥2 问，其中 ≥1 问预测/动手型——注意这是判据化的质量军规而非内容配额：军规约束的是**题的质量**——不得正文原句可抄、题干不含答案、附答案锚点/`<details>` 折叠）；验证段必含第二人称读者动作 + 至少一处「先猜后跑」。
5. **承重概念分级（011 P1-4）**：硬要求 5 分级——承重概念（结论/里程碑依赖的，无论大纲是否声明）不适用一句话兜底，至少「成因 + 载体」两步；成因须过反事实检验（「如果不这样会怎样」），答不出就诚实写「未见公开解释，按真机照抄」，禁伪成因。
6. **可感知成果硬语义（011 P1-5）**：milestone_verify 明文「测试输出不算可感知面」；canvas-app 形态落地；演示组件必须 import 实验场/数据脚本（webgl 的平行手抄组件是反面教材）；hero 措辞与读者可运行产物一致回查。
7. **回顾节奏（011 P2-7）**：骨架加「前情」槽（≤150 字或 ≤8 条，半数提问式）；术语表 ⊇ 全部 new_concepts（final-check 对账）；part 末 review 章合法化。
8. **状态落盘（011 P2-9）**：`outline.json / bible.json / rolling.json / calibration.json / promises.json` 从 .gitignore 捞出随课程提交；snapshots/repo/ 继续忽略。校准「可继承上轮结论，不得静默跳过」。
9. **可视化配方（a-share 反哺，判据驱动）**：新增 references 条目或 vitepress-assembly 附录「可视化与交互组件配方」：echarts 主题组件模式（theme/index.ts 全局注册 + 数据由脚本产出 + `width:100%` 响应式 + 聚合站 base 兼容 + 大依赖动态导入分包）。**明确不设任何使用配额**——用不用、用几个，只回答「不加它验证信号或承重概念会不会塌」；profile.presentation.visual 只是能力开关。

## 八、文件级改动映射

| 文件 | 改动 |
|---|---|
| `SKILL.md` | 顶部加三公理；质量标准句泛化（终点随 archetype：做出/读懂/算对/会操作）；原则 2 → 先验证物后文；阶段 0/2 加 profile 判定与确认；「何时不适用」改写（走读课入适用面；纯导读 verification:none 合法化并如实标注）；引用 issues/010 反噬教训 |
| `references/course-profiles.md`（新增） | profile schema、验证形态总表、样例映射、lite 档定义 |
| `references/companion-and-gates.md` → 更名 `verification-and-gates.md` | 形态表扩为五行；worksheet/observation/repo-probe/canvas-app 的门槛循环等价物；「先产物后文」 |
| `references/chapter-writing.md` | 五槽位骨架；十五条硬要求重排为「不变量 / 形态细则」两组并按 011 扩面（1/5/10/12/13/15）；自查军规；前情槽；lint 参数化说明（脚本本体移出） |
| `references/outline-schema.md` | profile 字段；章型四值；hook 字段（kind + 现象词）；milestone 语义随 profile；review 章合法；字数豁免声明位 |
| `references/repo-ingestion.md` | walkthrough 档附加产物（源码地图/ref 锁定/许可证核查）；zero-trace 降为默认政策而非宪法 |
| `references/subagents.md` | spawn 模板带 profile 参数；评审轴 2 按验证形态实例化；承诺账注入机制 |
| `references/vitepress-assembly.md` | final-check.mjs 脚本正文；可视化配方；obligations 呈现槽位（免责/时效声明落点）；代码折叠开关（code_density 渲染） |
| `references/portal.md` | 基本不动；补可视化组件进聚合站的构建约束 |
| `.zcode/agents/course-*.md`（3 个） | profile 感知（writer 按验证形态执行门槛循环；reviewer 轴 2 实例化；ingestion 支持 walkthrough 附加产物） |
| `scripts/course-lint.mjs`、`scripts/course-final-check.mjs`（新增，提交） | lint 上移 + 参数化；终检仪器化 |
| `.gitignore` | 捞出 `.course/` 五个关键 JSON（P2-9） |

## 九、分批落地与回归验证

- **批次 1（地基，先行）**：三公理入宪 + 去死板快改（骨架槽位化、hook 四形态、章型扩展、acceptance 措辞）+ 脚本上移（lint/final-check）+ 状态落盘。不引入新概念，先修实测反噬。
- **批次 2（通用性主菜）**：course profile 层 + 验证形态泛化 + obligations + lite 档；重写受影响的 references 与子智能体定义。
- **批次 3（能力扩展）**：source-walkthrough（仓库解读课）+ 可视化配方 + canvas-app。
- **回归课**（每批至少一门，沿 011 第五节的观测指标）：
  1. 非 coding 知识课一门（如「基金净值与费率」worksheet+observation）——验证通用性主路径；
  2. 仓库解读课一门（中型库，guided-walkthrough + repo-probe）——验证新场景；
  3. 原理重实现课小规模冒烟——防止改坏现行为。
- 观测指标新增：profile 判定被用户纠正率（高说明判定面不清晰）、code_density 与受众匹配度（对照 a-share 评审的「40% 代码负担」基线）、承诺账核销率、终章数字一致率、自查题「可抄出答案」比例。

## 十、风险与边界

- **形态枚举变成新的死板**：profile 是「预设起点 + 可覆盖维度」而非封闭分类；未知主题走 mixed 并在大纲期与用户定，schema 缺失字段走缺省修润（现有宽松校验原则不变）。
- **走读课版权**：许可证核查前置，不友好即降级 zero-trace；引用粒度与署名义务写进 walkthrough 细则。
- **选择面变大 → 生成不稳定**：每个 profile 配金样例（现有 12 门课就是校准语料库）；profile 随大纲显式呈现给用户确认。
- **不做什么**：不改 portal 聚合机制与已交付课程；不给纯技术课强加义务槽仪式；不设任何内容配额；不动已被 010 验证有效的 lint 检测意图原则。

---

## 十一、实施记录（2026-08-28 落地）

三个批次全部落地，文件级改动与第八节映射一一对应：

**批次 1（地基）**
- `scripts/course-lint.mjs`（新增，提交）：从 chapter-writing.md 内嵌脚本上移并参数化——`--lang zh|en`（中文规则仅 zh，通用规则全语言）、`--source-policy`（读 outline.profile）、`--verification`（observation 任务清单可判定性检查）、min-chars 按 outline 的 `type=review`/`length_exempt` 自动豁免、`--pain` 对齐大纲 hook.phenomena/pain_point、闪前承诺输出 promise-info。正本在仓库 scripts/，reference 只留用法与变更说明（不再内嵌文本——内嵌即双源即漂移）。
- `scripts/course-final-check.mjs`（新增，提交）：终检仪器化——章数/序号/slug/附录页对账、frontmatter title、hero 长度与首页链接、glossary 页 = bible 条目集、术语覆盖（容 3）、`src/`/`tests/` 标注块与验证物终态逐字 diff（剥注释行后连续切片比对，拼版豁免）、站内相对链接与资产死链、promises 核销、obligations surfaces 存在性、权威文档清单存在性（`authority_docs` 缺失且未声明 `factual_claims:false` 即阻断）、zero-trace 抽查 / walkthrough 引用路径核对、降级章占位、伴生 typecheck/test 实跑 + README/index/about/终章的测试数与行数断言比对（ANSI 剥离后解析）。
- `.gitignore`：`.course/` 整目录忽略改为 `**/.course/*` + 五个关键 JSON negation（outline/bible/rolling/calibration/promises）；实测三门含 `.course/` 的既有课程（nes-ts / nginx-internals / vision-rag）的管线 JSON 浮出为可提交，snapshots/repo/lint.mjs 继续忽略。

**批次 2（通用性主菜）**
- `references/course-profiles.md`（新增）：profile schema、五行验证形态总表、判定与确认流程（阶段 0 建议 → 阶段 2 一并确认，零新增交互）、12 门课样例映射、obligations 四类表、lite 档（减流程环不减质量门）。
- `companion-and-gates.md` → `verification-and-gates.md`（更名+重写）：五形态门槛循环各就各位（code-lab 四变体 / canvas-app 资产再生成门槛 / worksheet export-docs 守门 / observation 可判定性审查 / repo-probe 探针先红后绿）、「先验证物后文」、重构回写义务泛化到答案/图表数据、练习可行性门槛。
- `references/chapter-writing.md`（重写）：五槽位骨架（钩子/原理/演练/验证/收束 + 可选前情槽）+ hook 四形态；十五条硬要求重排为**不变量组 / 形态细则组**并按 011 扩面——承重概念首现定义入检（2）、出处真实 + walkthrough 标注形态（4）、承诺面（5）、「故事可以虚构，物理不可以」+ 承重数字由脚本导出（7）、闪前承诺账（8）、字数豁免声明（12）；承重概念分级（反事实检验、禁伪成因）；自查三军规（不可抄/不含答案/附锚点）与验证段读者动作 + 先猜后跑；lint 段改为仓库脚本用法。
- `references/outline-schema.md`（重写）：`profile` 顶层字段、章型四值（principle/build/**review**/**walkthrough**）、`hook { kind, point, phenomena }`（pain_point 兼容）、milestone 语义随 profile、`length_exempt`、`promises_out`、acceptance 措辞改「本章验证信号通过」+ 出处纪律项按 source_policy 二选一。

**批次 3（能力扩展）**
- `references/repo-ingestion.md`：zero-trace 降为默认政策；walkthrough 档附加产物（locked_ref 锁定、源码地图 ≤30 文件 + 走读顺序 = 依赖图、许可证三选一核查，不友好降回 zero-trace）；ingestion 附 `profile_hint`。
- `references/subagents.md`（重写）：三角色 spawn 模板全部带 profile 参数（writer 按验证形态实例化门槛循环 + 待清承诺注入 + promises_out 返回；reviewer 轴 2 按五形态实例化；ingestion 备两种政策的料）；lite 档不 spawn 子智能体；蓝图加 `promises_plan`；全书评审加承诺核销与能力对账。
- `references/vitepress-assembly.md`（重写）：终检改为「先跑脚本再过人工项」；可视化配方（echarts 主题注册/数据由脚本产出/width:100%/base 兼容/动态导入分包，明文不设配额）；obligations 呈现槽（hero 下方/about 时效/速查表头部/收尾章/章首现处）；code_density 三档渲染（collapsed 用 `<details>`，承重块不折叠）。
- `references/portal.md`：可视化与重依赖课程聚合三约束（依赖装课程目录/动态导入/主题收敛在课程内）。
- `SKILL.md`（重写）：三公理入宪；质量标准句泛化（终点随 archetype）；原则 2 → 先验证物后文、原则 3 → 钩子四形态、原则 4 加承诺账；仓库两档政策前置；profile 专节；权威文档清单门槛必填；校准「可继承不得静默跳过」；「何时不适用」重写——走读课入适用面、`verification: none` 合法化并如实降级；frontmatter description 扩到非编程课与走读课触发面。
- `.zcode/agents/` 三角色定义同步 profile 感知（含 lint 命令改仓库脚本路径）。

**回归冒烟（第九节回归课的机械先行部分）**
- lint：pinia / webgl / nes / vision-rag / nginx / js-gui / a-share 各抽首章全量跑通——旧规则行为保持（长句/黑话/判词/闪前照报），新机制生效（webgl 首章全绿；vision-rag 自动从 outline 读 pain_point 现象词；全部课程输出 promise-info）。合成用例覆盖 walkthrough 标注检查、review 自动豁免、observation 可判定检查、`--lang en` 跳过中文规则。
- final-check：a-share 全量（含门槛实跑）正确解析 18 文件/430 测试全绿，并实测抓到两个真实问题——companion `tsc --noEmit` 预存报错（expectancy-risk.test.ts 的 `ok` 未定义）、README 行数断言漂移（pinia 约 400 行 vs 实测 685）；合成 walkthrough 课验证 glossary 对账 / promises 核销 / obligations surfaces / 引用路径核对各分支。
- 语法与交叉引用：两脚本 `node --check` 通过；`companion-and-gates` 旧名残留仅存于更名说明一处。

**与方案的一处偏离**：E-1 原文「vitepress-assembly.md 内置 final-check.mjs 脚本文本」落地为「脚本正本在仓库 scripts/（提交），reference 只留用法与变更说明」——与改造 D 对 lint 的处置对齐，避免 reference 与 scripts/ 双源漂移（这正是本 issue 要消灭的病）；跨仓库使用时按 SKILL.md 指令随根脚手架原样复制三个脚本。

**后续（回归课计划，随下一批课程生成执行）**：① 非 coding 知识课一门（worksheet+observation）验通用性主路径；② 仓库解读课一门（guided-walkthrough + repo-probe）验新场景；③ 原理重实现课小规模冒烟防回归。观测指标照第九节新增五项记录。

---

## 十二、回归课执行记录（2026-08-28，两门课全流程跑通 v4 管线）

### 回归课 1 · fund-nav-fees-course（非 coding 知识课，通用性主路径）

- **profile**：knowledge-path / mixed（worksheet + observation）/ zero-trace / code_density collapsed / obligations compliance+timeliness / standard，10 章 3 部 + 3 附录。
- **验证物**：零依赖 Node 纯函数求解器（11 函数）+ 9 个 fixture 文件 + doc-claims 守门（41→55 条正文承重数字逐条与脚本输出比对）。先红（37 条全红：求解器缺失）→ 转绿 → 最终 **95/95 全绿**。
- **守门实绩**：10 章全部过 `scripts/course-lint.mjs`（ch03/ch08 加跑 `--verification observation` 的任务清单可判定性检查）；`scripts/course-final-check.mjs` 全量通过（含门槛实跑与数字断言比对）；单课 build + 聚合 build 通过。
- **评审（course-reviewer，新鲜眼全书）**：首轮 8 阻断 + 11 建议——含**三处真实事实错误**（外扣法 2017→2007；2026-01 施行的销售费用新规三档赎回费与「全额计入基金财产」未吸收；销服费持有满一年停收自 2027-01 执行）。经 WebSearch 对照证监会/新华网信源核实后全量修订（数字级联：ch05/ch09 对账单按 0.25% 档全部重算并同步 fixture/claims/正文/速查表/glossary/差异清单/README）。二轮复查：6/8 清、2 部分残留 + 4 回写漏网（147.78 残句、1369 天与封顶矛盾等）→ 全部清零，final-check/lint/构建复跑全绿。
- **机制首次实跑**：obligations surfaces（hero 下方声明/about 时效/速查表头部/收尾章/章首现处，final-check 查存在性）；承诺账（11 条登记→目标章兑现→全部 fulfilled，final-check 核销）；worksheet 的 export-docs 模式（verified-numbers 再生成）；「未校准」按规范在 about 与交付口径点名。

### 回归课 2 · dayjs-walkthrough-course（仓库解读课，新场景）

- **profile**：source-walkthrough / repo-probe / guided-walkthrough / full / obligations legal（MIT）/ standard，9 章 3 部 + 2 附录；锁定 ref `iamkun/dayjs@0f6c19e`，许可证核查 MIT 通过。
- **验证物**：ESM resolve hook（补源码无扩展名导入 + 裸包名自引映射）直连锁定 ref 源码的探针总线——8 组 53 条（行为断言跑真实源码 + 结构断言核对源码形态）。先红实录（真实红→绿）：CRLF 检出差、fallback 场景构造错、断言顺序错三类 5 条红，逐条定位修正后 **53/53 全绿**。
- **守门实绩**：9 章全部过 lint（guided-walkthrough 档：引用块须标 `owner/repo@sha:path` 且核对锁定 ref 路径）；final-check 通过（walkthrough 分支：引用路径存在性 + 门槛实跑 + 18 个引用块逐字比对——评审侧独立抽 4 块全字比对一致）；双构建通过，聚合站收录 14 门课程。
- **评审（course-reviewer）**：首轮 5 阻断 + 12 建议——含**两处机制级错误**（format 的 QQ/null 两层成因写反、fallback 递归丢 isLocal 可污染全局）、一处承诺违约（cfg.args 闪前未兑现）、一处不可照抄的验证命令、一处可证伪的快照结论；机械比对另确认全部引用逐字一致。全部修复后复查：5 阻断清 4、1 部分（验证槽命令相对路径多一级，`../../` 应为 `../`）+ 1 处 README 引文不精确——两处已修并实测命令照抄跑通（输出 2026-08-28），lint/探针/final-check/构建复跑全绿。
- **顺手修复的共享资产缺陷**：final-check 死链扫描误判源码 `$d[name](arg)` 为 markdown 链接——改为先剥代码块再扫（对全部课程生效）。

### 五项观测指标实测

| 指标 | 结果 |
|---|---|
| profile 判定被用户纠正率 | 0/0（两课均自主回归运行、无用户确认轮；判定依据已随大纲 profile 呈现文案留档） |
| code_density 与受众匹配度 | 知识课（collapsed/非程序员）全书代码块字符占比 **9.3%**，走读课（full/工程师）28.6%；对照 a-share 评审实录的「多章 40–45% 代码篇幅负担」基线（a-share 全书现测 21.7%，口径为全书平均 vs 评审时峰值），collapsed 档把非程序员负担压到个位数量级——配置化目标达成 |
| 承诺账核销率 | 课 1：11/11 fulfilled；课 2：6/6 fulfilled（final-check 机械核销通过） |
| 终章数字一致率 | 课 1：doc-claims 55 条含终章对账单 8 数字与 README 计数，脚本比对 0 不一致；课 2：53 探针 + 18 引用块逐字比对 0 不一致——两课 100% |
| 自查题「可抄出答案」比例 | 0/38（两课自查全部为预测/动手/换情境型，题干均不含正文原句可抄答案，各问附 `<details>` 折叠答案与回查锚点；lint 自查三军规口径 + 评审核对） |

### 回归结论

v4 的三块主菜在真实课程上各就各位：**通用性**（知识课未造代码实验场即走完全流程，worksheet/observation 的门槛等价物实际可用）；**新场景**（走读课从 ingest 的 ref 锁定/源码地图到探针/逐字比对全链路成立）；**质量机械化**（lint/final-check 在两门课上抓出真问题——评审员另抓出 5+8 条事实/机制错误，其中新规时效类错误若无权威清单核对纪律将被放过）。评审智能体两轮均产出实质阻断，「新鲜眼 + 机械项自跑」的组合在非 coding 与走读两种新形态下同样有效。
