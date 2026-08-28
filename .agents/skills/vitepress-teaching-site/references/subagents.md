# 子智能体分工

主智能体是唯一编排者，三个角色智能体在全新上下文里干活。本文是分工契约：spawn 模板、交接规则、修订路由、并行模式。总则四条：

1. **用户交互永不外包。** 校准问卷、大纲与 profile 确认、交付汇报只发生在主智能体——子智能体无法与用户对话，触达用户的任务派不出去。
2. **交接靠落盘，不靠转述。** 子智能体之间零共享上下文：一切前向信息走 `.course/` 状态文件与产物文件。spawn prompt 只给路径与任务参数，纪律文件（本 skill 的 references）给路径让它自读——prompt 里复述纪律必漂移。`{skill_dir}` 指本 skill 所在目录，主智能体加载本文件时已知。
3. **全新上下文是特性。** 章写作智能体没有前章记忆，恰好逼它只依赖滚动摘要与圣经——读者拿到书时也没有你的记忆。评审智能体的新鲜眼同理。别替子智能体「补上下文」，把它该知道的写进状态文件才是正事。
4. **失败就补位。** 子智能体产物缺失或返回异常 → 重 spawn 一次 → 仍败主智能体亲自补位该步（失去上下文隔离，流程不断）。

**lite 档例外**：profile.scale = lite 时**不 spawn 子智能体**——主智能体直做全部角色（备课直拆、逐章自写自检、以本文件的纪律自审）。质量门不减：lint、final-check、验证物门槛、评审三轴照跑，只是执行者合并为主智能体。

## 角色一 · 备课智能体（阶段 0，仅 repo 输入）

价值：仓库阅读是全流程最大的上下文吞噬者，隔离它——主智能体不碰任何仓库文件，长跑预算从阶段 0 就开始省。topic 输入没有仓库步骤，不 spawn，主智能体直接拆解。

```
你是备课智能体。对仓库 {repo_url} 做作者侧备课，产出「可教学核心特性清单 + 能力依赖图」。
1. 读 {skill_dir}/references/repo-ingestion.md，严格按其步骤执行；clone 落在 {course_dir}/.course/repo/。
2. 产物写 {course_dir}/.course/ingestion.json（schema 见该文件，特性按学习顺序排序）；
   必附 profile_hint（该仓库更适合 zero-trace 备课还是 guided-walkthrough 走读，一句话理由）；
   记录 clone 时的 commit SHA 为 locked_ref。
3. 若仓库许可友好且结构适合走读：追加源码地图（source_map：入口清单 + 推荐走读顺序 + 每文件一句话，≤30 文件）
   与许可证核查结论（license: { kind, note }）；许可不友好或不确定 → 不产源码地图，在返回中标记。
4. 只返回：特性数与每特性一行要点、profile_hint、拆解取舍疑点（如有）、许可疑点（如有）、仓库不可访问等阻塞（如有）
   ——不复述仓库内容。
红线：walkthrough 是否成立由大纲期与用户决定，你只备好两种可能的料。
```

主智能体只信落盘的 ingestion.json；返回含阻塞 → 按 SKILL.md「何时不适用」与用户澄清。

## 角色二 · 章写作智能体（阶段 3，每章一个）

职责：整章一次做完——快照 → 本章验证物先行（红）→ 演进转绿 → 门槛 → 正文 → lint → 占位降级（如需）。门槛循环按 profile.verification 实例化（`verification-and-gates.md`）。文件写权：`companion/` 内本章的测试/探针/fixture 与源文件、`docs/{NN}-{slug}.md`、本章快照目录、（并行模式）blueprint `file_ownership` 名下的文件。**不写** `.course/rolling.json`、`.course/outline.json` 与 `.course/promises.json`——滚动摘要与本章新开承诺以草稿形式随返回交主智能体记账，一个文件一个写者。

```
你是章写作智能体，生成第 {N} 章（slug: {slug}）。课程目录 {course_dir}。
1. 先读 {skill_dir}/references/chapter-writing.md（写作硬要求 + lint）与 {skill_dir}/references/verification-and-gates.md（门槛循环）。
2. 本章 spec：{course_dir}/.course/outline.json 里 slug 为 {slug} 的章（hook / milestone / new_concepts / acceptance 全在里面）
   与顶层 profile（archetype / verification / source_policy / code_density / obligations）。
3. 常驻参考：{course_dir}/.course/bible.json（读者模型、术语表、代码约定、API 契约）；前情：{course_dir}/.course/rolling.json（截至第 {N-1} 章）。
   承诺账：本章若有待清账承诺（promises.json 中 target= 本章的条目）——{主智能体在此逐条列出}——正文必须兑现或显式改期。
   {repo 输入·zero-trace 加：备课 clone 在 .course/repo/，拿不准原理真实行为时按 spec.relevant_files 查阅（≤4 个），不照抄代码、不改编测试。}
   {repo 输入·guided-walkthrough 加：备课 clone 在 .course/repo/（锁定 ref），正文引用其代码必须标注 owner/repo@{locked_ref}:path 且逐字一致。}
4. 动手章整章执行门槛循环（按 profile.verification 的形态）：快照 → 验证物先行并跑出红 → 演进转绿 → 门槛（失败回灌最多 3 轮，
   仍败回滚快照、本章写为占位章、不中断）→ 按硬要求写正文（骨架五槽位；演练槽形态随 profile）→ lint 机械自检（未过定向修一轮）：
   node scripts/course-lint.mjs {course_dir} docs/{NN}-{slug}.md <术语...> --new <本章新术语...> --pain <hook.phenomena...>
   principle/review 章跳过验证物四步，直接写正文（review 章按 outline 的 length_exempt 豁免字数下限）。
5. 只返回：status（ok / degraded）、章文件与验证物文件路径、门槛与 lint 结果、rolling_summary 草稿（≤200 字，degraded 时注明
   「验证物保持上一章形态」）、本章新开承诺草稿（promises_out）、偏差与疑点。不贴正文全文。
```

**修订回灌**（评审代码类/验证物类阻断项，或并行模式波末复核发现破坏时）：同模板追加一节「上轮阻断/破坏项：{findings 逐条}——只修所指问题；波及 API 或后章语义时在返回里说明；修完重跑门槛与 lint，重出 rolling_summary 草稿」。

## 角色三 · 评审智能体（每章 + 全书）

新鲜眼纪律——本角色的全部价值：

- spawn prompt 只给路径与章号。**绝不附带**写作智能体的返回报告、主智能体评语或任何过程自述：评审只对落盘产物负责，喂了过程自述就等于把作者的盲区一起喂了进去。
- 立场 = 圣经读者模型里那个「聪明、但没接触过这个领域」的读者。它不知道作者想说什么，只知道纸上写了什么。
- 存疑自己跑：门槛命令与核对/探针脚本自己执行、引用的代码与数字自己打开——评审验证，不采信。

三轴（按重量排序；轴 2 按 profile.verification 实例化）：

1. **概念教学**（最重，跨形态不变量）：spec 的 new_concepts 是否按四步（成因→载体→演算→锚点）真教了；**承重概念分级**——本章结论/里程碑依赖的概念（无论大纲是否声明）是否逃过了一句话兜底、成因是否过了反事实检验（「如果不这样会怎样」答不出却写了「因为」即阻断，伪成因禁绝）；其余专业名词首现是否当场一句人话——首现段念给外行听、复述不出大意即阻断；读者模型陌生清单里的前置概念是否被默认已会。**承诺面对齐**：本章以标题、总表、开篇承诺列出的每一项在正文有着落，静默缩水即阻断；**待清承诺**：主智能体注入的 promises.json 清账项逐条核对兑现状态。**自包含载体**：承重知识点有 REPL 片段或数值演算兜底。**自查军规**：自查题不得正文原句可抄、题干不含答案、每问有答案锚点/<details>。**文验收回查**：spec acceptance 里的正文教学类条目逐条核对，回报兑现/部分/未兑现——未兑现即阻断。
2. **实现完整性**（按验证形态实例化——不变量是「正文断言与机械现实一致」）：
   - code-lab：正文引用的实验场代码真实存在且与当前形态逐字一致（全量比对，非抽查——教学注释差异除外）；出处标注与省略/占位纪律；milestone 与 milestone_verify 兑现；测试断言行为而非实现细节；双硬门槛自跑通过。
   - canvas-app：typecheck+test+build 自跑；资产再生成脚本两次运行输出一致；演示组件 import 的是实验场产物而非平行手抄；**测试输出不算可感知面**——正文有读者能看到/听到的成果呈现。
   - worksheet：答案核对脚本自跑全绿；正文承重数字与导出脚本输出一致（抽 3 处手工复算）；题目答案唯一且与 fixture 一致。
   - observation：任务清单逐条过可判定性——现象描述具体到可对照，无「感受一下」类模糊条目；依赖不可复现环境的任务有环境声明。
   - repo-probe：探针脚本自跑全绿；正文引用块标注 owner/repo@sha:path 且与锁定 ref 逐字一致（抽 3 块全字比对）；每个机制断言有对应探针。
   - 全形态共通·**事实断言**：「真机/规范如此」类断言与**承重概念首现定义**是否对照过圣经权威文档清单（涉事实断言的课程该清单必配，缺失即阻断）——测试自洽不作为事实正确的证据；**故事可以虚构，物理不可以**。
3. **结构契约**：开章钩子具体到现象（四形态任一，不再是「必须是 bug」）；一章一特性；出处纪律（zero-trace：零外部源码引用；walkthrough：引用与锁定 ref 逐字一致）；骨架五槽位齐全、验证槽含读者动作与「先猜后跑」。

产出：findings 列表，每条 `轴 | 位置（原文引文或 file:line） | 为什么是问题 | 修法建议`，首行注明阻断/建议各几条。**阻断** = 事实错误、承诺教的概念没教、读者会卡死、契约违背；**建议** = 文风与更优解。无阻断就写「无阻断」，不硬凑。

```
你是评审智能体，评审第 {N} 章（slug: {slug}）。课程目录 {course_dir}。
1. 先读 {skill_dir}/references/chapter-writing.md——硬要求是你的评审基准；{skill_dir}/references/verification-and-gates.md——门槛与验证形态。
2. 输入只有落盘产物：{course_dir}/docs/{NN}-{slug}.md；{course_dir}/companion/（本章验证物及其触及的实现）；spec（outline.json 该章条目与顶层 profile）；{course_dir}/.course/bible.json；{course_dir}/.course/rolling.json（截至第 {N-1} 章，供前情核对）；{course_dir}/.course/promises.json（target= 本章的待清承诺，如有）。
3. 按三轴评审；轴 2 按 profile.verification 实例化；机械项自己跑（门槛/核对/探针命令，lint 脚本带 --pain 传该章钩子现象词）。
4. 只出 findings 报告（分级与格式如上），不改任何文件。
```

**全书评审**（阶段 3.5，全书完成后一次）：同立场换范围——输入为全部章 md + outline.json + bible.json + 整个 companion，查跨章问题：概念链（第 M 章用到的概念在第 <M 章真的教过且首现解释过——不是在摘要里出现过就算）；术语一致性（glossary 页 = bible 条目集，final-check 机械对账；条目 vs 正文实际用法）；读者成长线（final_milestone 的终点能力逐章建立、终点兑现——终点措辞随 archetype）；文风漂移（判词密度、比喻、闪前跨章看更明显）；**正文↔验证物一致性全书全量比对**（重构回写是否漏网——见 verification-and-gates「重构回写义务」）；**数字核对**（正文里的用例数/累计数/行数与门槛命令实测输出一致，禁止手写数字漂移；README/index/about/终章盘点段为重点核对对象）；**acceptance 全书回查**；**承诺账核销**（promises.json 全部条目逐条核销——fulfilled 或显式改期并已在新目标章兑现，悬空承诺即阻断）；**能力对账**（终章「你已经能 X」的每项能力在正文与验证物里真实建立过——nes-ts 式「tests 里有 14 个文件而全书只教了 12 章」的来历不明产物是账本违约）；**附录对账**（速查表与实现一致、差异清单登记了全部声明的简化、正文↔附录互链无死结、无指向不存在小节的引用）。同样只出报告。

## 修订路由（评审之后）

- **正文类阻断**：主智能体亲自定向修——只修所指、不重构（chapter-writing.md「修订一轮即饱和」原则同样适用），修完重跑该章 lint；补教概念时同步补 bible 术语表。
- **验证物类阻断**（代码/答案/探针/资产）：回灌章写作智能体（模板见角色二）；修复若波及 API 或后章语义，滚动摘要以修复后版本为准。
- **复查只验已指出项**。修订→复查最多 2 轮，仍未清零 → 保留正文、逐条记入交付汇报——带病放行必须点名，不静默。
- **建议项**：主智能体裁量采纳。
- 占位章跳过评审；用户明确要求跳过评审时，逐章与全书评审一起省略、交付汇报注明。

## 并行模式（用户明确要求时才启用）

默认串行：滚动摘要逐章涌现，每章踩在前章真实状态上。并行用速度换这份保真，补偿机制是蓝图冻结 + 缝合审计 + 必经评审——三者缺一就不开并行。重生成语义与串行相同（快照回滚、从 N 章连锁重算），只是以波次为单位重跑。

### 阶段 2.5 · 蓝图冻结（主智能体，大纲确认后立即做）

把串行模式里逐章涌现的前向信息一次性预演，落盘 `.course/blueprint.json`：

| 字段 | 内容 | 冻结时解决的冲突 |
|---|---|---|
| `api_plan` | 每章一条 API 增量（新导出/语义变化），把圣经 API 契约的 append-only 演进预演到底 | 越线发明——各代码线智能体只许实现自己那条 |
| `concept_first` | 术语/概念 → 首教章（outline new_concepts ∪ bible 陌生清单） | 同一概念两个章都想首教 → 挪到更早章 |
| `planned_summaries` | 每章计划滚动摘要（按 milestone 与 api_plan 预写） | 正文线的「前情」统一用它，缝合时对账 |
| `promises_plan` | 每章计划开出的承诺（与 promises.json 预演对账） | 两个章开出同一承诺、承诺目标章错位 |
| `file_ownership` | 验证物源文件 → 章 | 两章碰同一文件 → 挪章、拆文件或划界，写码期零冲突靠它 |
| `waves` | 按 depends_on 拓扑分层，波内章互无验证物依赖 | —— |

蓝图是大纲的衍生物：大纲重生成 → 蓝图连锁重算。全 principle 课程走 lite 蓝图——只留 `concept_first` / `planned_summaries`，无代码线，正文线直接全并行。

### 验证物线（波次并行）

每波同时 spawn 该波全部章的**验证物半程**（角色二模板，任务改为「只做快照 → 验证物先行红 → 演进转绿 → 门槛」，文件只碰 `file_ownership` 名下）。波内并行、门槛各自跑；**波末主智能体全量门槛复核一次**——并行写码的竞态与交叉破坏在此兜底，破坏项进定向修复轮（回灌模板）。末波通过，验证物线收官。companion 演进天然分不出所有权（全书就是同一个文件长成）→ 验证物线整线退化串行、正文线照常全并行——蓝图冻结时不许为拆所有权而拆文件，教学清晰优先于并行度。

### 正文线（全并行）

全部章的**正文半程**并行 spawn（任务改为「只写正文 + lint」）：前情用 `planned_summaries` 截至本章、概念首秀用 `concept_first`、引用读收官后的最终态验证物。正文不碰验证物，零冲突。

### 缝合审计（阶段 3.5 前半，主智能体机械比对）

- `planned_summaries` vs 实际验证物 → rolling.json 重写为真实摘要（现实是事实源）。
- `api_plan` vs 验证物实际导出 → 漂移则修代码，或改蓝图并记录。
- `concept_first` vs 正文实际首现 → 解释落错章则挪或补。
- `promises_plan` vs promises.json 实际登记 → 漏登补登、错位改期。
- **正文↔验证物引用全量比对**（并行各章写的正文引用的是收官后终态，比对确认无漂移；重构回写义务见 verification-and-gates.md）。
- 全量门槛复跑。

后半照常全书评审。
