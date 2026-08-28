---
name: vitepress-teaching-site
description: Turn any topic — a coding principle, a non-coding knowledge domain (investing, statistics, photography), or a GitHub repo to be read and explained — into a complete VitePress teaching site. A course profile decides the verification form (code lab, worksheet with answer-checking scripts, observation task lists, repo probes, canvas apps) so every chapter's prose is backed by mechanical verification artifacts that must pass their gates before prose is written. Outline first for user review (form + profile confirmed together), then chapter-by-chapter content in plain, jargon-free prose that explains every technical term at first mention, with quota-free quality rules (no "every chapter must have N of X"). Use whenever the user wants to turn a topic or repo into a tutorial, course, or teaching site ("把这个仓库背后的原理讲透", "帮我生成一个教学网站/课程", "用 VitePress 做一个讲 X 的课程", "讲讲怎么读某某仓库", "做一个股票/统计入门课", "generate a VitePress course/tutorial for X", "teach X from scratch"), or mentions building a teaching/course site with VitePress.
---

# VitePress 教学站点生成

输入是一句主题（topic），或一个 GitHub 仓库地址。产物是一门 `pnpm docs:dev` 直接可跑的 VitePress 课程，统一收纳在项目的 `courses/` 目录下；项目根另有聚合入口，`pnpm dev` 一条命令可预览全部课程。质量标准只有一条：**读者读完达到课程的终点能力**——终点随课程原型（archetype）而变：原理重实现课是「能讲清核心原理，并亲手做出验证原理的最小实现」；知识路径课是「能独立演算与判断」（学股票课的读者能自己算净值、判断费率陷阱，而不是写出实现）；源码走读课是「能独立读懂并讲解该库的机制」；技能训练课是「能独立完成操作」。共同的下限：不是 API 文档，也不是复刻任何源码。

## 三条公理（v4 的宪法，写规则前先过这三关）

1. **不变量与形态细则分层。** 每条规则必须二选一标注：**不变量**（跨一切课程形态必须成立，如「承重概念必须教透」「正文断言与机械现实一致」「零死链」）或**形态细则**（只对某课程形态生效，如「code-lab 双硬门槛」「worksheet 答案可核对」）。细则层不得冒充不变量——这是通用性的机制保证：非编程课程不受代码课细则管辖，但逃不掉任何不变量。
2. **判据化，禁配额。** 任何「每章必须 N 个 X」式配额（可视化组件、图示、比喻、自查题数的「必须达到」侧）不得进入任何规则。一切「加东西」的决策只回答一个问题：**不加它，本章的验证信号或承重概念会不会塌**。数值上限（加粗 ≤8、闪前 ≤3 这类防御性阈值）不是配额，保留且可按课程调参。反噬教训引 issues/010：pain-point 信号词催生硬造踩坑故事、term-intro 句式催生全书模板化——**检测意图，别催生模板**。
3. **先验证物后文。** 写正文之前必须先存在该课程形态的**机械验证物**——测试也好、答案核对脚本也好、探针输出也好、可判定任务清单也好——正文数字与断言一律以验证物输出为事实源。代码只是验证物的一种；「先代码后文」是本公理在 code-lab 档的特例。

## 仓库输入的两档政策

- **zero-trace（默认）**：仓库只是**作者侧备课资料**——帮你把特性与原理拆对，产物零仓库痕迹：不引源码、不列行数、不做「与真源码对照」、不改编官方测试。可以提真实库的公开概念与行为（「Vue 没有官方 isComputed」），但它的代码一行不进正文。
- **guided-walkthrough（走读课）**：仓库是**教学对象本身**——「解读这个仓库」是合法课程。此档源码可进正文，受硬约束管辖：大纲期锁定 ref（commit SHA）为全书唯一事实源；引用代码块标注 `owner/repo@sha:path` 且逐字一致（机械比对）；读者用探针脚本亲手验证；标注源码许可证，许可不友好即降回 zero-trace 并告知用户。细则见 `references/repo-ingestion.md` 与 `references/verification-and-gates.md`。

默认用中文写全部内容；用户明确要求其他语言时切换，并跳过中文特有的 lint 规则（`--lang en`），跨语言通用规则照跑。

**语言基调：说人话。** 全部正文面向「聪明、但没接触过这个领域」的读者：专业名词第一次出现，必须当场用一句大白话说清它是什么、拿来干嘛——只标英文原文不算解释；行话能不用就不用，能用日常词说清的概念不发明新词。读者读到某处停下来想「这词什么意思」却又找不到下文解释，就是写作事故——不能要求读者先查百科再回来上课。细则与机械检查见 `references/chapter-writing.md`（硬要求 2，及 lint 的 term-intro / jargon / long-sentence 检查）。

## 四条不可谈判的原则

1. **大纲先行，确认后才动笔。** 先产出结构化大纲——它是带验收项的数据契约，不是目录树——连同**课程形态画像（profile）**一并呈现给用户；有反馈就整纲重生成或单章改条目；确认后才进入逐章生成。用户明确说「别问我、直接生成」时可跳过确认。
2. **先验证物后文（公理 3 的执行版）。** 每个动手章：先演进本章的验证物并让它通过对应门槛（code-lab 是 `tsc --noEmit` + `vitest run`；worksheet 是答案核对脚本；repo-probe 是探针全绿；observation 是任务清单可判定性——形态菜单见 `references/verification-and-gates.md`），**再**基于真实产物写正文。长篇一致性靠外部机械信号背书，不靠模型自觉——禁止先写文后补验证物。
3. **一章一特性，钩子开章。** 每章只教一个特性；开章是一个具体到现象的钩子——bug 故事、公开事故、现象观察、「已能什么 vs 还差什么」四选一（大纲 `hook.kind` 声明），验收只看「具体到现象」，不再强制「必须是 bug」；章末验证物有一个可运行的增量（里程碑）。
4. **滚动摘要前向传递，承诺有账。** 每章结束产出一则 ≤200 字的前情摘要（已建立的概念、本章验证物变更点、读者已能做什么），下一章生成时必须带上；向前章开出的每条承诺（「第 N 章细算」）登记 `.course/promises.json`，目标章生成时注入清账、全书评审机械核销。这是全书连贯性的机制，不是可选项。并行模式下由蓝图的计划摘要预付、缝合审计按实际产物校准——机制等价（见 `references/subagents.md`）。

## 工作流总览

```
输入（repo URL / 主题句）
 → 阶段 0 备课【备课智能体·仅 repo 输入】：核心特性清单 + 能力依赖图 + profile_hint（walkthrough 档另附源码地图/许可核查）
 → 阶段 0.5 读者校准（主；lite 档跳过按保守默认）：自评问卷（一批问完、可跳过）→ 读者画像
 → 阶段 1 圣经（主；lite 档精简为术语表+验证约定）：读者模型 + 术语表 + 代码/验证约定 + API 契约 + 权威文档清单 + obligations 推导
 → 阶段 2 大纲 + profile（主）：CourseOutline（含 profile 与验证物形态）→ 【用户确认点：章节表 + 形态画像一并确认】
 → 阶段 2.5 蓝图冻结（主，仅并行模式）
 → 阶段 3 逐章生成（主智能体编排，默认串行；lite 档主智能体直做）：章写作智能体（验证物红→绿→门槛→正文→lint）→ 评审智能体（新鲜眼，轴 2 按验证形态实例化）→ 阻断修订 → 滚动摘要与承诺记账
 → 阶段 3.5 全书评审（并行模式先做缝合审计）：含承诺账核销与能力对账
 → 阶段 4 组装（主）：docs/ 由大纲数据 100% 渲染 → final-check 脚本 + 单课 build 验证 → 聚合入口 sync + build 验证 → 交付
```

产物目录（用户指定，或默认 `./courses/{短 ASCII 名}-course/`）——**所有课程统一收纳在 `courses/` 下**，绝不散落在项目根：

```
courses/
└── {course}/                 # 单门课程，自成一体、可独立运行
    ├── docs/                     # VitePress 站点
    │   ├── index.md              # home 布局首页（hero = 标题/受众/终点里程碑；obligations 声明槽）
    │   ├── about.md
    │   ├── .vitepress/config.mjs # nav/sidebar 由大纲数据 100% 生成，不扫文件系统
    │   └── 01-first-chapter.md   # 扁平章节文件：两位序号-ascii-slug.md
    ├── companion/                # 验证物工程（读者课程结束拥有的最小验证工程，逐章演进——形态随 profile）
    │   ├── package.json          # 按形态：typescript+vitest / 核对脚本 / 探针脚本 / 资产生成脚本
    │   ├── src/ (tests/ | fixtures/ | probes/)
    ├── package.json              # vitepress@^1.6.4 + docs:dev / docs:build 脚本
    ├── README.md                 # 运行说明 + 章节目录 + 终点里程碑
    └── .course/                  # 管线状态（outline/bible/rolling/calibration/promises 五个 JSON 随课程提交，
                                   #   snapshots/repo 等可再生物 gitignore——issues/011 P2-9 可审计性）
```

项目根是**聚合入口**（首门课程时创建一次，之后所有课程共用；脚手架与生成脚本见 `references/portal.md`）：

```
.
├── courses/                  # 全部课程；index.md 与 .vitepress/ 由 sync 脚本生成（gitignore）
├── scripts/portal-sync.mjs   # 扫描 courses/*-course → 生成聚合首页与聚合配置（提交）
├── scripts/course-lint.mjs   # 章级 lint（提交，仓库级共享——不再内嵌进各课程漂移）
├── scripts/course-final-check.mjs   # 终检仪器化（提交）
├── package.json              # dev / build = 先 sync 再 vitepress dev|build courses（纯聚合站语义，课程级依赖装各课程内）
└── .gitignore                # 追加 /courses/index.md、/courses/.vitepress/；捞出 .course/ 五个关键 JSON
```

根目录 `pnpm dev` 启动聚合站：首页是全部课程的卡片列表，每门课挂在其 `/{课程名}/` 路径下；单门课程仍可 `cd courses/{course} && pnpm docs:dev` 独立预览。**用于新仓库**时，`scripts/` 下三个脚本与 `.gitignore` 追加项随根脚手架一并原样落盘（正本在本仓库 scripts/，skill 引用一律指向 `scripts/*.mjs`）。

`.course/` 下已提交的 JSON 是管线状态：会话中断后凭它们续跑；用户要求「从第 N 章重生成」时，从 N 开始连锁重算到末章（滚动摘要依赖决定了重生成必须连带后续章）。

## 课程形态层（profile）——通用性的机制

同一套流程骨架服务全部课程形态，形态差异全部收进 **CourseProfile**（schema、验证形态总表、样例映射、lite 档、领域义务槽见 `references/course-profiles.md`）：

- **archetype**（学习终点）：principle-reimpl / source-walkthrough / knowledge-path / skill-training；
- **verification**（验证物形态）：code-lab / canvas-app / worksheet / observation / repo-probe / mixed / none；
- **source_policy**（仓库政策）：zero-trace（默认）/ guided-walkthrough；
- **code_density**（正文代码密度）：full / collapsed / minimal；
- **obligations**（领域义务，可空）：timeliness / compliance / legal / ethics——金融课的合规声明、时效声明在这个槽位有家，纯技术课不强加仪式；
- **scale**（流程档位）：lite（≤5 章：减流程环不减质量门）/ standard。

profile 在阶段 0 由备课产出建议值（`profile_hint`），阶段 2 随大纲一并呈现确认（大纲确认点本就确认验证物形态，扩展为确认 profile——**不新增交互轮次**），落盘 `outline.json` 顶层；lint 与 final-check 从这里读参数。profile 是「预设起点 + 可覆盖维度」，不是封闭分类——未知主题走 mixed 并在大纲期与用户把每个维度定下来。

## 子智能体分工

主智能体是唯一编排者：持有全部用户交互（校准、大纲与 profile 确认、交付汇报），调度三个全新上下文的角色智能体干活——交接全走 `.course/` 落盘状态，纪律文件给路径让子智能体自读。分工契约、spawn 模板、修订路由与并行模式见 `references/subagents.md`：

- **备课智能体**（阶段 0，仅 repo 输入）：clone 与读仓库全部隔离在它体内，主智能体不碰仓库文件。
- **章写作智能体**（阶段 3，每章一个）：整章「验证物红 → 绿 → 门槛 → 正文 → lint」按 profile 形态一次做完，产物落盘、摘要与承诺草稿随返回。
- **评审智能体**（每章 + 全书）：以「聪明、但没接触过这领域」读者的新鲜眼只读产物、不读过程自述；三轴中的「实现完整性」按验证形态实例化——它是质量补偿，不是锦上添花。

**lite 档不 spawn 子智能体**（主智能体直做全部角色），质量门照跑。子智能体失败时主智能体补位亲做，流程不断。

## 阶段 0 · 备课（摄取）

两条输入路汇流成同构数据：**可教学核心特性 + 能力依赖图（按学习顺序，越靠前越基础）+ profile_hint**。特性多少不设配额——主题/仓库实际有多少个值得单独成章的核心原理，就拆多少个；特性数即章数之源（一章一特性），后续任何阶段不得为凑数反向增删特性。

- **仓库输入【备课智能体】**：clone 与有节制地读（入口识别 → 关键文件 ≤18 个 → 特性抽取）全部在隔离上下文内完成，读法纪律见 `references/repo-ingestion.md`。主智能体只接收 ingestion.json 与摘要，不直接读仓库文件。备课智能体同时备好两种政策的料：`profile_hint`（走读可行性判断）+ `locked_ref`（commit SHA）；walkthrough 档另附源码地图与许可证核查结论。
- **主题输入**：直接把主题句拆解成同样的「特性清单 + 依赖图 + profile_hint」，无仓库步骤。

产物落盘 `.course/ingestion.json`：`{ kind, label, description, features: [{ name, summary }], capabilities: { edges: [{ from, to }] }, profile_hint?, locked_ref?, source_map?, license? }`。

## 阶段 0.5 · 读者校准（lite 档跳过，按 audience 保守默认）

audience 若只是首页文案，教学就只能靠猜。这一步把「作者猜读者会会什么」变成「测出来」：从阶段 0 的概念清单推导一份自评问卷，向用户发问。先分清读者是谁：

- **用户就是读者**（「给我做个课程」）：直接问本人，答案即读者画像。
- **用户是作者、读者是公众**（做站给别人看）：请作者**代目标读者画像**回答——把隐含的受众假设逼成显式数据，本身就是价值。

问卷四原则：**问已知，不问未知**（只问相邻锚点知识，绝不问课程要教的东西）；**每题对应一个教学决策**（答案必须能改变产物，怎么答课程都一样的题删掉）；**自评，不考试**（三档「能讲给别人 / 用过 / 没接触过」）；**一批问完、可跳过、有默认**（永不阻塞）。题数宁少勿多：5-8 问是常见规模而非配额。产物落盘 `.course/calibration.json`（随课程提交），喂给阶段 1 的读者模型；会话中断续跑时可继承上轮校准结论，但**不得静默跳过**——跳过要在交付汇报点名「本课未校准，按保守默认画像」。阶段 2 呈现大纲时把读者画像一并带出。

## 阶段 1 · 圣经（Bible）

一次性产出，之后每章生成都常驻参考。存 `.course/bible.json`（lite 档精简为术语表 + 验证约定两项）：

- **读者模型**（来自校准答案；未校准按 audience 保守默认）：已知资产清单 + 陌生概念清单——每条含概念、为什么陌生、锚点、首次教授章。它是常驻参考不是验收清单——不设配额、不进 acceptance。
- **术语表**：中文术语 + 英文 + 一句话**大白话**定义；glossary 附录页由它渲染，且必须 ⊇ 全书全部 new_concepts（final-check 对账）。
- **代码/验证约定**：验证物工程的模块命名、目录结构、错误处理；命名服务于教学清晰，不与任何真实库刻意对齐。
- **API 契约**（code-lab 档）：验证物公共导出面——单一事实源，只增不破。
- **权威文档清单（门槛必填——011 P0-2）**：凡正文将出现客观事实断言的课程（OS/协议/运行时/硬件/监管规则——编程课与非编程课同规），清单必配（硬件文档、协议规范、语言标准、监管文件、权威数据源）；final-check 与评审查存在性，缺失即阻断。纯主观工程实践类主题可缺省，但要在大纲期明示「本课无客观事实断言」。
- **obligations 推导**：问一句「这个领域有没有不做就会被下架/教坏人的表述义务」——有则按四类登记（schema 见 course-profiles.md），无则空缺，**空缺合法**。

风格规则与章节骨架不进圣经——已固化在 `references/chapter-writing.md`，存两份只会漂移。

## 阶段 2 · 大纲 + profile + 用户确认

产出 CourseOutline JSON（schema 见 `references/outline-schema.md`）：**章数、分部数、章型、钩子形态全部由内容决定**——备课拆出几个值得单独成章的核心特性就几章（一章一特性），每章带 hook / milestone / depends_on / acceptance 与 new_concepts，可选 appendices 与 length_exempt 豁免。**profile 随大纲一并产出与确认**：archetype / verification / source_policy / code_density / obligations / scale 六个维度 + 验证物形态与规模——呈现为一句话形态画像（「非编程知识课 · 演算核对验证 · 代码默认折叠 · 含合规义务」），用户纠正即反馈循环。

向用户呈现：分部章节表（`# | 章 | 类型 | 钩子 | 里程碑`）+ 终点里程碑 + 形态画像 + 读者画像一句话。反馈循环：整纲反馈 → 带反馈重生成整纲（反馈必须落实）；单章不满 → 只改该章条目；profile 纠正 → 同路。收敛不出该形态的机械验证物时，按「何时不适用」与用户前置澄清，不要硬生成。确认后进入阶段 3；并行模式先做蓝图冻结（见 `references/subagents.md`）。

## 阶段 3 · 逐章生成（主智能体编排，默认串行）

每章（按全局序号）依次走四步循环；spawn 模板与失败降级见 `references/subagents.md`：

1. **spawn 章写作智能体**：整章一次做完——快照 → 验证物先行（红：测试/题目答案/探针断言/任务清单先写先跑）→ 演进转绿 → 门槛（按 profile 形态，失败回灌最多 3 轮，仍败回滚快照、降级为占位章，**不中断全书**）→ 按五槽位骨架写正文（开章钩子 → 原理 → 演练 → 验证（读者动作，验证物输出两侧可见）→ 收束（小结 + 自查）；新概念按四步教；承重概念分级；承诺面=交付面；事实断言对照权威文档；术语首现说人话；**标注 `src/…` 的内容与验证物终态一致**）→ lint 机械自检（`node scripts/course-lint.mjs …`，带 `--pain` 传钩子现象词）。若本章有待清承诺（promises.json 中 target= 本章），spawn 时注入逐条清账。门槛与写作细则见 `references/verification-and-gates.md` 与 `references/chapter-writing.md`。
2. **spawn 评审智能体**：新鲜眼按三轴（概念教学最重 / 实现完整性按验证形态实例化 / 结构契约）评审本章落盘产物，文验收条目逐条回查回报兑现状态，产出阻断/建议清单。占位章跳过。
3. **阻断修订**：正文类主智能体亲自定向修（只修所指，修完重跑该章 lint）；验证物类回灌章写作智能体。修订→复查最多 2 轮，仍未清零 → 保留正文、交付汇报点名。
4. **记录滚动摘要与承诺账**到 `.course/rolling.json` / `.course/promises.json`（写作智能体的草稿；修复后以修复版为准），进入下一章。

principle / review 章由写作智能体直接写正文（跳过验证物四步；review 章按声明豁免字数下限）。

## 阶段 3.5 · 全书评审（并行模式先做缝合审计）

全部章完成后，spawn 全书评审智能体（同样新鲜眼，范围=全部章 + outline + bible + 整个验证物工程）：概念链跨章核对、术语与 glossary 一致、读者成长线兑现、文风漂移、**正文↔验证物全书全量比对**、**数字与门槛命令实测一致**、**acceptance 全书回查**、**承诺账核销**（promises.json 逐条 fulfilled，悬空承诺即阻断）、**能力对账**（终章能力清单与验证物产物互相对账——来历不明的超纲产物是账本违约）、**附录对账与互链无死结**；修订路由同阶段 3 第 3 步。并行模式此前先由主智能体做缝合审计（细则见 `references/subagents.md`）。

## 阶段 4 · 组装与验证

1. 生成 `docs/`：index.md 的 hero（含 obligations 呈现槽）、config.mjs 的 nav/sidebar 全部由 `.course/outline.json` 渲染；声明了 appendices 时附录页一并渲染（glossary 直接由 bible 术语表生成）。代码密度按 profile.code_density 渲染（collapsed 档长块 `<details>` 折叠）。模板与硬约束见 `references/vitepress-assembly.md`。
2. **终检：先跑 `node scripts/course-final-check.mjs courses/{course}`**（机械项全部脚本对账：章数/frontmatter/hero/glossary= bible/术语覆盖/标注块与验证物终态逐字 diff/死链/promises 核销/obligations surfaces/仓库痕迹政策/降级章/门槛实跑 + 数字断言比对）；脚本外人工项（构建、附录语义、acceptance 与能力对账、零输入体验、资产清白）按 `references/vitepress-assembly.md` 终检清单逐条过。
3. 课程内 `pnpm install && pnpm docs:build` 验证单课可构建。
4. 更新聚合入口：根脚手架（`package.json`、`scripts/*.mjs` 三个脚本、`.gitignore` 追加项）缺失则按 `references/portal.md` 创建——首门课程创建一次，之后只复用；跑 `node scripts/portal-sync.mjs`，再在根目录 `pnpm build` 验证聚合站可构建。脚手架与生成文件均提交，`courses/index.md`、`courses/.vitepress/` 是生成物不提交；**`.course/` 五个关键 JSON 随课程提交**。
5. 汇报降级章与带病放行项（如有）及其原因；交付口径统一为：根目录 `pnpm dev` 看全部课程，`cd courses/{course} && pnpm docs:dev` 只看本课程。

## 何时不适用

- 用户要的是 API 参考、文档镜像或 Release Notes：不适用，这是教学站点生成器。
- 源仓库不可访问、或主题泛到收敛不出一条成型的特性主线：先与用户澄清再动手。
- 收敛不出任何机械或可判定的验证物（纯概念史、架构评述、需生产负载的性能实战）：
  - 可转**纯导读课**（`verification: none`）——合法形态，但质量标准**如实降级为「能理解」**、必须在 profile 确认时向用户言明降级，终检与评审按降级口径执行；
  - 用户不接受降级，就承认本 skill 不适用。
  - 判据：连「可判定的任务清单」都写不出来（observation 是最轻的验证形态）才算 none——别把「没有代码实验场」误判成「没有验证物」。知识课的演算核对、实操清单都是验证物。
- 走读课（guided-walkthrough）：**在适用面内**——仓库可访问、许可友好（或引用在豁免内）、能锁定 ref 即可；许可不友好时降回 zero-trace 并告知用户，不是拒做。
