---
name: vitepress-teaching-site
description: Turn any technical topic — optionally anchored by a GitHub repo used only as author-side study material — into a complete VitePress teaching site focused on core principles. Outline first for user review, then chapter-by-chapter content in plain, jargon-free prose that explains every technical term at first mention, deep enough that the reader can explain the principles and build a minimal working implementation of them, with every hands-on chapter backed by a companion lab that must compile and pass self-written principle tests before prose is written. The finished site contains zero source-code references. Use whenever the user wants to turn a topic or repo into a tutorial, course, or teaching site ("把这个仓库背后的原理讲透", "帮我生成一个教学网站/课程", "用 VitePress 做一个讲 X 的课程", "generate a VitePress course/tutorial for X", "teach X from scratch"), or mentions building a teaching/course site with VitePress.
---

# VitePress 教学站点生成

输入是一句主题（topic），或一个 GitHub 仓库地址。产物是一门 `pnpm docs:dev` 直接可跑的 VitePress 课程，统一收纳在项目的 `courses/` 目录下；项目根另有聚合入口，`pnpm dev` 一条命令可预览全部课程。质量标准只有一条：**读者读完能讲清这个东西的核心原理，并亲手做出验证原理的最小实现**（例如学状态管理的读者能写出并解释一个几百行的最小 store 容器）——不是复刻任何源码，也不是 API 文档。

仓库输入只是**作者侧备课资料**：帮你把特性与原理拆对，产物中零仓库痕迹——不引源码、不列行数、不做「与真源码对照」、不改编官方测试。可以提真实库的公开概念与行为（「Vue 没有官方 isComputed」），但它的代码一行不进正文。

默认用中文写全部内容（质量机制是中文优先的）；用户明确要求其他语言时才切换，并跳过中文特有的 lint 规则。

**语言基调：说人话。** 全部正文面向「聪明、但没接触过这个领域」的读者：专业名词第一次出现，必须当场用一句大白话说清它是什么、拿来干嘛——只标英文原文不算解释；行话能不用就不用，能用日常词说清的概念不发明新词。读者读到某处停下来想「这词什么意思」却又找不到下文解释，就是写作事故——不能要求读者先查百科再回来上课。细则与机械检查见 `references/chapter-writing.md`（硬要求 5，及 lint 的 term-intro / jargon / long-sentence 检查）。

## 四条不可谈判的原则

1. **大纲先行，确认后才动笔。** 先产出结构化大纲——它是带验收项的数据契约，不是目录树——呈现给用户；有反馈就整纲重生成或单章改条目；确认后才进入逐章生成。用户明确说「别问我、直接生成」时可跳过确认。
2. **先代码后文。** 每个动手章（build 章）：先演进伴生实验场并让它通过双硬门槛（默认 `tsc --noEmit` + `vitest run`，形态按主题可换，不变量是机械验证），**再**基于真实代码变更写正文。长篇一致性靠外部机械信号背书，不靠模型自觉——禁止先写文后补码。
3. **一章一特性，痛点开章。** 每章只教一个特性；开章必须是一个具体到现象的真实 bug 故事（不是概念式铺垫）；章末伴生实验场有一个可运行的增量（里程碑）。
4. **滚动摘要前向传递。** 每章结束产出一则 ≤200 字的前情摘要（已建立的 API/概念、本章代码变更点、读者已能做什么），下一章生成时必须带上。这是全书连贯性的机制，不是可选项。并行模式下由蓝图的计划摘要预付、缝合审计按实际代码校准——机制等价（见 `references/subagents.md`）。

## 工作流总览

```
输入（repo URL / 主题句）
 → 阶段 0 备课【备课智能体·仅 repo 输入】：核心特性清单 + 能力依赖图   ← repo 输入在隔离上下文里读仓库（仅作者侧备课资料）/ topic 输入主智能体直接拆解，两路汇流
 → 阶段 0.5 读者校准（主）：自评问卷（一批问完、可跳过）→ 读者画像
 → 阶段 1 圣经（主）：读者模型 + 术语表 + 代码约定 + API 契约
 → 阶段 2 大纲（主）：CourseOutline（含实验场形态与规模）→ 【用户确认点】
 → 阶段 2.5 蓝图冻结（主，仅并行模式）：API 演进 / 概念首秀 / 计划摘要 / 文件所有权 / 波次
 → 阶段 3 逐章生成（主智能体编排，默认串行）：章写作智能体（测试红→实验场绿→双门槛→正文→lint）→ 评审智能体（新鲜眼）→ 阻断修订 → 滚动摘要
 → 阶段 3.5 全书评审（并行模式先做缝合审计）
 → 阶段 4 组装（主）：docs/ 由大纲数据 100% 渲染 → 单课 build 验证 → 聚合入口 sync + build 验证 → 交付
```

产物目录（用户指定，或默认 `./courses/{短 ASCII 名}-course/`）——**所有课程统一收纳在 `courses/` 下**，绝不散落在项目根：

```
courses/
└── {course}/                 # 单门课程，自成一体、可独立运行
    ├── docs/                     # VitePress 站点
    │   ├── index.md              # home 布局首页（hero = 标题/受众/终点里程碑）
    │   ├── about.md
    │   ├── .vitepress/config.mjs # nav/sidebar 由大纲数据 100% 生成，不扫文件系统
    │   └── 01-first-chapter.md   # 扁平章节文件：两位序号-ascii-slug.md
    ├── companion/                # 原理实验场（读者课程结束拥有的最小实验工程，逐章演进）
    │   ├── package.json          # typescript + vitest
    │   ├── tsconfig.json         # strict
    │   ├── src/
    │   └── tests/                # 验收测试，按章节进度渐进解锁
    ├── package.json              # vitepress@^1.6.4 + docs:dev / docs:build 脚本
    ├── README.md                 # 运行说明 + 章节目录 + 终点里程碑
    └── .course/                  # 管线状态：ingestion.json / calibration.json / outline.json / bible.json / rolling.json（并行模式另有 blueprint.json）
```

项目根是**聚合入口**（首门课程时创建一次，之后所有课程共用；脚手架与生成脚本见 `references/portal.md`）：

```
.
├── courses/                  # 全部课程；index.md 与 .vitepress/ 由 sync 脚本生成（gitignore）
├── scripts/portal-sync.mjs   # 扫描 courses/*-course → 生成聚合首页与聚合配置（提交）
├── package.json              # dev / build = 先 sync 再 vitepress dev|build courses
└── .gitignore                # 追加 /courses/index.md、/courses/.vitepress/
```

根目录 `pnpm dev` 启动聚合站：首页是全部课程的卡片列表，每门课挂在其 `/{课程名}/` 路径下；单门课程仍可 `cd courses/{course} && pnpm docs:dev` 独立预览。

`.course/` 下的 JSON 是管线状态：会话中断后凭它们续跑；用户要求「从第 N 章重生成」时，从 N 开始连锁重算到末章（滚动摘要依赖决定了重生成必须连带后续章）。

## 子智能体分工

主智能体是唯一编排者：持有全部用户交互（校准、大纲确认、交付汇报），调度三个全新上下文的角色智能体干活——交接全走 `.course/` 落盘状态，纪律文件给路径让子智能体自读。分工契约、spawn 模板、修订路由与并行模式见 `references/subagents.md`：

- **备课智能体**（阶段 0，仅 repo 输入）：clone 与读仓库全部隔离在它体内，主智能体不碰仓库文件。
- **章写作智能体**（阶段 3，每章一个）：整章「测试红 → 实验场绿 → 双门槛 → 正文 → lint」一次做完，产物落盘、摘要以草稿返回。
- **评审智能体**（每章 + 全书）：以「聪明、但没接触过这领域」读者的新鲜眼只读产物、不读过程自述——它是质量补偿，不是锦上添花。

子智能体失败时主智能体补位亲做，流程不断。

## 阶段 0 · 备课（摄取）

两条输入路汇流成同构数据：**可教学核心特性 + 能力依赖图（按学习顺序，越靠前越基础）**。特性多少不设配额——主题/仓库实际有多少个值得单独成章的核心原理，就拆多少个；特性数即章数之源（一章一特性），后续任何阶段不得为凑数反向增删特性。

- **仓库输入【备课智能体】**：主智能体 spawn 备课智能体，clone 与有节制地读（入口识别 → 关键文件 ≤18 个 → 特性抽取）全部在隔离上下文内完成，读法纪律见 `references/repo-ingestion.md`——备课的克制决定主智能体还有多少长跑预算。主智能体只接收 ingestion.json 与摘要，不直接读仓库文件。**仓库只到此为止**：clone 与备课笔记是作者侧资料，正文、测试、实验场命名一律零仓库痕迹。
- **主题输入**：直接把主题句拆解成同样的特性清单 + 依赖图，无仓库步骤。

产物落盘 `.course/ingestion.json`：`{ kind, label, description, features: [{ name, summary }], capabilities: { edges: [{ from, to }] } }`（edges 的 from 依赖 to，to 是更基础的能力）。

## 阶段 0.5 · 读者校准

audience 若只是首页文案，教学就只能靠猜。这一步把「作者猜读者会什么」变成「测出来」：从阶段 0 的概念清单推导一份自评问卷，向用户发问。先分清读者是谁：

- **用户就是读者**（「给我做个课程」）：直接问本人，答案即读者画像。
- **用户是作者、读者是公众**（做站给别人看）：请作者**代目标读者画像**回答——把隐含的受众假设逼成显式数据，本身就是价值。

问卷四原则：

1. **问已知，不问未知**：只问相邻的锚点知识（「写过汇编吗」「补码熟吗」），绝不问课程要教的东西——会了就不用来上课。
2. **每题对应一个教学决策**：答案必须能改变产物（某概念从默认已会变成需要教、锚点从 A 换成 B）。怎么答课程都一样的题，删掉。
3. **自评，不考试**：三档「能讲给别人 / 用过 / 没接触过」，不出题判卷——校准靠自报就够，摩擦小得多。
4. **一批问完、可跳过、有默认**：一次性列出，不逐题追问；用户跳过或说过「别问」时按 audience 保守默认（宁可多解释），永不阻塞。

题数宁少勿多：5-8 问是常见规模而非配额，每题都要过原则 2 的「答案能改变产物」检验，没有可问的就少问。产物落盘 `.course/calibration.json`，喂给阶段 1 的读者模型；阶段 2 向用户呈现大纲时把读者画像一并带出——大纲确认点顺便成为画像修正点，不多花一轮交互。

## 阶段 1 · 圣经（Bible）

一次性产出，之后每章生成都常驻参考。存 `.course/bible.json`：

- **读者模型**（来自阶段 0.5 校准答案；未校准按 audience 保守默认）：读者已知资产清单 + 陌生概念清单——每条含概念、为什么对这类读者陌生、锚点（挂到读者已知世界的类比）、首次教授章（大纲期落位）。它是每章生成的常驻参考，价值在「写下一章时被带进上下文」；**不是验收清单**——不设配额、不进 acceptance。
- **术语表**（条目数以课程实际要首教的术语为准，不设配额）：中文术语 + 英文 + 一句话**大白话**定义——定义本身要能让外行看懂，它就是正文首现解释直接要用的那句话；后续 lint 会检查术语是否在正文出现（检查参数连同读者模型的陌生概念一起传）。
- **代码约定**：伴生实验场的模块命名、目录结构、错误处理。命名服务于教学清晰——可以借用概念的自然名字（`storeToRefs`），但不与任何真实库的 API 面刻意对齐。
- **API 契约**：伴生实验场的公共导出面——模块路径、签名风格、语义约定（如「log 按新→旧返回」「默认分支 main」）、错误约定。开篇只定约定与前几章的核心导出，后续章的新导出随手记回、**只增不破**——它是全书导入面的单一事实源，没有它，各章测试会各自发明不兼容的导入面。

风格规则与章节骨架不进圣经——已固化在 `references/chapter-writing.md`，存两份只会漂移。

## 阶段 2 · 大纲 + 用户确认

产出 CourseOutline JSON：**章数、分部数、章型全部由内容决定**——备课拆出几个值得单独成章的核心特性就几章（一章一特性），分部按学习的自然阶段划分，每章按特性性质选 principle/build（需动手验证的用 build，纯理解的用 principle，比例不设规定）；每章带 pain_point / milestone / depends_on / acceptance 与 new_concepts（陌生概念落位），可选 appendices（glossary / reference-table / exercises），外加原理实验场的形态与规模。Schema、大纲规则与金样例见 `references/outline-schema.md`。验收测试不在此阶段预写——阶段 3 每章现写（先红后绿），渐进语义由红→绿机械背书，无需人工审计 import。

向用户呈现：分部章节表（`# | 章 | 类型 | 痛点 | 里程碑`）+ 终点里程碑 + 实验场形态与规模（语言/形态/预计行数，如「Go 的最小调度器，~300 行」）+ 读者画像一句话（校准确认的已知资产、按陌生处理的概念清单）——大纲确认点顺便成为画像修正点。反馈循环：整纲反馈 → 带反馈重生成整纲（反馈必须落实）；单章不满 → 只改该章条目。收敛不出可机械验证的原理实验形态时，按「何时不适用」与用户前置澄清，不要硬生成。确认后进入阶段 3；用户明确要求并行/提速时，先做阶段 2.5 蓝图冻结再开波次（见 `references/subagents.md` 并行模式一节）。

## 阶段 3 · 逐章生成（主智能体编排，默认串行）

每章（按全局序号）依次走四步循环；spawn 模板与失败降级见 `references/subagents.md`：

1. **spawn 章写作智能体**：整章一次做完——快照 → 写本章测试（先红，自设原理断言、不从任何官方/上游测试改编；`tests/` append-only，绝不动旧章测试）→ 演进伴生实验场（转绿）→ 双硬门槛（失败回灌最多 3 轮，仍败回滚快照、降级为占位章，**不中断全书**）→ 写正文（≥1200 字、上限不设；骨架=痛点开章→原理→渐进实验→验证→小结；new_concepts 按「陌生概念怎么教」四步处理；专业名词首现说人话；**零外部源码引用**）→ lint 脚本机械自检。门槛与写作细则见 `references/companion-and-gates.md` 与 `references/chapter-writing.md`。返回：产物路径 + rolling_summary 草稿 + 降级报告（如有）。写作智能体是全新会话，每次 spawn 先读 chapter-writing.md——原「每会话首读」纪律自动成立。
2. **spawn 评审智能体**：新鲜眼按三轴（概念教学最重 / 实现完整性 / 结构契约）评审本章落盘产物，产出阻断/建议清单（分级与格式见 `references/subagents.md`）。占位章跳过。
3. **阻断修订**：正文类主智能体亲自定向修（只修所指，修完重跑该章 lint）；代码类回灌章写作智能体。修订→复查最多 2 轮，仍未清零 → 保留正文、交付汇报点名。
4. **记录滚动摘要**到 `.course/rolling.json`（写作智能体的草稿；代码类修复后以修复版为准），进入下一章。

principle 章由写作智能体直接写正文（跳过代码四步，实现段落讲原理示意、可给最小伪码）。

## 阶段 3.5 · 全书评审（并行模式先做缝合审计）

全部章完成后，spawn 全书评审智能体（同样新鲜眼，范围=全部章 + outline + bible + 整个 companion）：概念链跨章核对、术语与 glossary 一致、读者成长线兑现、文风漂移；修订路由同阶段 3 第 3 步。并行模式在此前先由主智能体做缝合审计——蓝图计划摘要 vs 实际代码、API 演进表 vs 实际导出、概念首秀表 vs 实际正文，机械比对、现实是事实源（细则见 `references/subagents.md`）。

## 阶段 4 · 组装与验证

1. 生成 `docs/`：index.md 的 hero、config.mjs 的 nav/sidebar 全部由 `.course/outline.json` 渲染；声明了 appendices 时附录页一并渲染（glossary 直接由 bible 术语表生成）。模板与硬约束见 `references/vitepress-assembly.md`。
2. 终检：章文件数与大纲一致、每章 frontmatter title 与大纲一致、术语表条目全书出现过、companion 全量门槛通过（按形态执行）、**零仓库痕迹**（repo 输入时 grep 抽查 docs/ 与 companion/——无 clone 仓库的路径、无「与真源码对照」、无改编自官方测试的说法）、**数字事实核对**（正文中可验证的数字声明——「N 个用例」「累计 N」「~N 行」——与机械现实比对：vitest 输出、wc -l；不一致改文，现实是事实源）、**零输入体验**（形态允许时，终章的可运行产物自带课程自产的内置输入——测试 fixture 导出，访客不自备文件就能看到成果；形态不允许时在 README 写明）。
3. 课程内 `pnpm install && pnpm docs:build` 验证单课可构建。
4. 更新聚合入口：根脚手架（`package.json`、`scripts/portal-sync.mjs`、`.gitignore` 追加项）缺失则按 `references/portal.md` 创建——首门课程创建一次，之后只复用；跑 `node scripts/portal-sync.mjs`，再在根目录 `pnpm build` 验证聚合站可构建。脚手架与生成文件均提交，`courses/index.md`、`courses/.vitepress/` 是生成物不提交。
5. 汇报降级章与带病放行项（如有）及其原因；交付口径统一为：根目录 `pnpm dev` 看全部课程，`cd courses/{course} && pnpm docs:dev` 只看本课程。

## 何时不适用

- 用户要的是 API 参考、文档镜像或 Release Notes：不适用，这是教学站点生成器。
- 源仓库不可访问、或主题泛到收敛不出一条成型的特性主线：先与用户澄清再动手。
- 收敛不出可机械验证的原理实验形态（纯概念史、架构评述、需生产负载的性能实战等）：大纲期告知用户——要么转纯导读课（无实验场，质量标准明确降为「能理解」），要么承认本 skill 不适用；不要靠降级占位章硬生成。
