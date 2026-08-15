---
name: vitepress-teaching-site
description: Turn any GitHub repository or technical topic into a complete VitePress teaching site — outline first for user review, then chapter-by-chapter content deep enough that the reader could re-implement the thing from scratch, with every hands-on chapter backed by a companion implementation that must compile and pass tests before prose is written. Use whenever the user wants to turn a repo or topic into a tutorial, course, or teaching site ("把这个仓库变成教程站", "帮我生成一个教学网站/课程", "用 VitePress 做一个讲 X 的课程", "generate a VitePress course/tutorial for X", "teach X from scratch"), or mentions building a teaching/course site with VitePress.
---

# VitePress 教学站点生成

输入是一个 GitHub 仓库地址，或一句主题（topic）。产物是一座 `pnpm docs:dev` 直接可跑的 VitePress 教学站点。质量标准只有一条：**读者读完能从零重新实现这个东西**（例如学 pinia 的读者能写出自己的 pinia-mini），而不是对源码的生硬解读。

默认用中文写全部内容（质量机制是中文优先的）；用户明确要求其他语言时才切换，并跳过中文特有的 lint 规则。

## 四条不可谈判的原则

1. **大纲先行，确认后才动笔。** 先产出结构化大纲——它是带验收项的数据契约，不是目录树——呈现给用户；有反馈就整纲重生成或单章改条目；确认后才进入逐章生成。用户明确说「别问我、直接生成」时可跳过确认。
2. **先代码后文。** 每个动手章（build 章）：先演进伴生实现并让它通过双硬门槛（默认 `tsc --noEmit` + `vitest run`，形态按主题可换，不变量是机械验证），**再**基于真实代码变更写正文。长篇一致性靠外部机械信号背书，不靠模型自觉——禁止先写文后补码。
3. **一章一特性，痛点开章。** 每章只教一个特性；开章必须是一个具体到现象的真实 bug 故事（不是概念式铺垫）；章末伴生实现有一个可运行的增量（里程碑）。
4. **滚动摘要前向传递。** 每章结束产出一则 ≤200 字的前情摘要（已建立的 API/概念、本章代码变更点、读者已能做什么），下一章生成时必须带上。这是全书连贯性的机制，不是可选项。

## 工作流总览

```
输入（repo URL / 主题句）
 → 阶段 0 摄取：特性清单（8-15 个）+ 能力依赖图      ← repo 读仓库 / topic 直接拆解，两路汇流
 → 阶段 1 圣经：术语表 + 风格 + 代码约定 + 章节模板
 → 阶段 2 大纲：CourseOutline（含伴生形态与规模）→ 【用户确认点】
 → 阶段 3 逐章生成（严格串行）：写本章测试（先红）→ 演进伴生实现（转绿）→ 双硬门槛 → 写正文 → lint → 滚动摘要
 → 阶段 4 组装：docs/ 由大纲数据 100% 渲染 → vitepress build 验证 → 交付
```

产物目录（用户指定，或默认 `./{短 ASCII 名}-course/`）：

```
{course}/
├── docs/                     # VitePress 站点
│   ├── index.md              # home 布局首页（hero = 标题/受众/终点里程碑）
│   ├── about.md
│   ├── .vitepress/config.mjs # nav/sidebar 由大纲数据 100% 生成，不扫文件系统
│   └── 01-first-chapter.md   # 扁平章节文件：两位序号-ascii-slug.md
├── companion/                # 伴生实现（读者课程结束拥有的示例工程，逐章演进）
│   ├── package.json          # typescript + vitest
│   ├── tsconfig.json         # strict
│   ├── src/
│   └── tests/                # 验收测试，按章节进度渐进解锁
├── package.json              # vitepress@^1.6.4 + docs:dev / docs:build 脚本
├── README.md                 # 运行说明 + 章节目录 + 终点里程碑
└── .course/                  # 管线状态：outline.json / bible.json / rolling.json
```

`.course/` 下的三个 JSON 是管线状态：会话中断后凭它们续跑；用户要求「从第 N 章重生成」时，从 N 开始连锁重算到末章（滚动摘要依赖决定了重生成必须连带后续章）。

## 阶段 0 · 摄取

两条输入路汇流成同构数据：**8-15 个可教学核心特性 + 能力依赖图（按学习顺序，越靠前越基础）**。

- **仓库输入**：clone 后有节制地读（入口识别 → 关键文件 ≤18 个 → 特性抽取）。读法纪律见 `references/repo-ingestion.md`——摄取阶段的克制决定了后面 10 章还有没有上下文可用。
- **主题输入**：直接把主题句拆解成同样的特性清单 + 依赖图，无仓库步骤。

产物落盘 `.course/ingestion.json`：`{ kind, label, description, features: [{ name, summary }], capabilities: { edges: [{ from, to }] } }`（edges 的 from 依赖 to，to 是更基础的能力）。

## 阶段 1 · 圣经（Bible）

一次性产出，之后每章生成都常驻参考。存 `.course/bible.json`：

- **术语表**（8-15 条）：中文术语 + 英文 + 一句话定义；后续 lint 会检查术语是否在正文出现。
- **代码约定**：伴生实现的模块命名、目录结构、错误处理、与真实源码的对齐方式。
- **API 契约**：伴生实现的公共导出面——模块路径、签名风格、语义约定（如「log 按新→旧返回」「默认分支 main」）、错误约定。开篇只定约定与前几章的核心导出，后续章的新导出随手记回、**只增不破**——它是全书导入面的单一事实源，没有它，各章测试会各自发明不兼容的导入面。

风格规则与章节骨架不进圣经——已固化在 `references/chapter-writing.md`，存两份只会漂移。

## 阶段 2 · 大纲 + 用户确认

产出 CourseOutline JSON：8-12 章、2-4 分部、principle:build ≈ 3:7、每章带 pain_point / milestone / depends_on / acceptance，外加伴生实现的形态与规模。Schema、硬性规则与 pinia 金样例见 `references/outline-schema.md`。验收测试不在此阶段预写——阶段 3 每章现写（先红后绿），渐进语义由红→绿机械背书，无需人工审计 import。

向用户呈现：分部章节表（`# | 章 | 类型 | 痛点 | 里程碑`）+ 终点里程碑 + 伴生形态与规模（语言/形态/预计行数，如「Go 的 mini-scheduler，~400 行」）。反馈循环：整纲反馈 → 带反馈重生成整纲（反馈必须落实）；单章不满 → 只改该章条目。收敛不出任何可机械验证的伴生形态时，按「何时不适用」与用户前置澄清，不要硬生成。确认后进入阶段 3。

## 阶段 3 · 逐章生成（严格串行）

对每章（按全局序号）依次执行：

1. **写本章测试（红）**：为当前章现写 `companion/tests/{slug}.test.ts`，断言 milestone 行为；先跑一次，必须失败——这就是渐进语义的机械证明。`tests/` 是 append-only：只新增本章测试，绝不动旧章测试。
2. **演进伴生实现（绿）**：快照 companion（失败回滚点）→ 按章 spec + 前情滚动摘要 + 溯源文件演进伴生实现 → 跑双硬门槛（新测试转绿 + 旧章测试全量通过）→ 失败把报错回灌重试（最多 3 轮）→ 仍败则回滚快照、本章降级为占位章，**不中断全书**。形态菜单、脚手架与门槛细则见 `references/companion-and-gates.md`。
3. **写正文**：≥1200 字、上限不设，骨架=痛点开章→原理→渐进实现（引用伴生实现的真实代码）→验证→小结；源码引用 ≤10 行且只用于对照思想。写作纪律与笔感基准见 `references/chapter-writing.md`——**每会话首次动笔前读一次**（长时间中断或 lint 连续报警再重读，不必每章读）。
4. **lint 自检**：按 `references/chapter-writing.md` 的六条检测规则机械执行（用脚本，别用眼睛），未过则定向修订一轮。
5. **记录滚动摘要**到 `.course/rolling.json`，进入下一章。

principle 章跳过步骤 1-2，实现段落讲原理示意（可给最小伪码）。

## 阶段 4 · 组装与验证

1. 生成 `docs/`：index.md 的 hero、config.mjs 的 nav/sidebar 全部由 `.course/outline.json` 渲染。模板与硬约束见 `references/vitepress-assembly.md`。
2. 终检：章文件数与大纲一致、每章 frontmatter title 与大纲一致、术语表条目全书出现过、companion 全量门槛通过（按形态执行）。
3. 跑 `pnpm docs:build` 验证可构建；成功后告诉用户 `pnpm docs:dev` 即可预览。
4. 汇报降级章（如有）及其原因。

## 何时不适用

- 用户要的是 API 参考、文档镜像或 Release Notes：不适用，这是教学站点生成器。
- 源仓库不可访问、或主题泛到收敛不出 8 个特性：先与用户澄清再动手。
- 收敛不出可机械验证的伴生最小形态（纯概念史、架构评述、需生产负载的性能实战等）：大纲期告知用户——要么转 principle 为主的导读课（明确质量标准从「能重实现」降为「能理解」），要么承认本 skill 不适用；不要靠降级占位章硬生成。
