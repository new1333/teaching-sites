---
id: 001
title: 地图：vitepress-teaching-site skill v3 优化
status: closed
labels: [wayfinder:map]
---

## Destination

vitepress-teaching-site skill 下一版（v3）的改动方案全部定稿：2026-08-17 第三轮课程评审（nes-emulator-ts-course）反推出的每一类质量缺口，都决定「采纳与否、落进哪份 reference、如何验收」，改完按站位偏好 grep 复查——拿到定稿即可开工改 skill，无遗留决策。

## Notes

- 域：课程生成 skill 的规范修订。改动对象全部在 `.agents/skills/vitepress-teaching-site/`（SKILL.md + references/ 七份）。
- 证据基线：第三轮评审三份报告存 `issues/assets/`（round3-ch1-4.md / round3-ch5-8.md / round3-ch9-12-appendices.md），含 file:line 级证据。最重指控已经主智能体抽查复核，全部坐实：companion/public/roms/super-mario.nes 版权 ROM 残留、第 7 章「$2004 读也推进指针」（nesdev 明文相反，代码与测试同错）、第 3 章镜像「低 13 位」位算术错误、第 8 章幽灵代码（companion 无 ntBase，renderBackground 是滚动相机版）、全书零图片、`pnpm dev` 试机台仅 about.md 提及。
- 站位偏好（每张工单都适用，来自用户既有约束）：
  - **skill 必须可移植、与产物无关**——不引用任何具体课程/仓库名（含脚手架模板），内联自包含示例合法；改完 grep 复查。
  - **不设内容量硬配额**——章数/字数/代码块数/知识点数等一律不设上下限；只允许有独立机理的数字（质量下限、lint 阈值、排版与上下文预算约束）。修复「太简短」不得走「涨字数下限」的路。
  - **说人话基调不可倒退**。
- 本地 tracker 约定（本仓库未配 issue tracker，按 wayfinder 默认走本地 markdown）：`issues/` 一文件一工单；frontmatter 的 `status` / `labels` / `blocked-by` 即状态、标签、阻塞边；关闭 = `status: closed` + 决议写入正文 `## 决议` 节 + 回填本地图「Decisions so far」。

## Decisions so far

- [调研：VitePress 实时结果方案](004-vitepress-live-result-research.md) — 三层组合：内置演示组件为主力（markdown 即 SFC，构建期 import 伴生仓代码，零外部依赖）+ 静态产物兜底 + 外部 playground 仅作外链；iframe/手写 URL 必须 withBase；CLI/配置类课程降级。详证 `issues/assets/research-vitepress-live-result.md`。
- [覆盖面对齐](002-coverage-vs-promise.md) — 标题不得承诺不教的面（大纲规则 1）+ 硬要求 13「承诺面=交付面」静默缩水即阻断 + 评审轴 1 覆盖核对；不设配额。
- [自包含演示](003-self-contained-demos.md) — 硬要求 14：承重知识点至少一种不进实验仓的载体（REPL/数值演算/结构表），首章标准不得静默放弃。
- [可感知成果](005-perceivable-milestone.md) — 验证段「亲手开机」指引 + 打包资产内嵌（相对路径图片 / script setup 导入音频；禁 public 绝对路径，聚合站不拷贝课程 public）；资产必须由实验场真实代码产出；形态不允许则降级声明。
- [正文↔伴生仓一致性闸门](006-prose-companion-sync-gate.md) — 门槛循环第 7 步一致性闸门 + 重构回写义务 + 硬要求 12 重写（出处真实/禁占位分支/拼版·教学示意标注）+ lint snippet-missing/placeholder 机械检查 + 评审全量比对。
- [验收双轨制](007-acceptance-two-tracks.md) — 不拆 schema：acceptance 条目自明判据类型（仓/文两轨），评审逐条回查文验收，未兑现即阻断；终检全书回查。
- [事实核查与简化清单](008-fact-check-and-divergence.md) — 圣经「权威文档清单」（测试自洽不算事实证据，硬要求 15）+ appendices 新 kind divergence 差异清单 + 终检附录对账。
- [验证小节与终检扩展](009-verify-section-and-final-check.md) — 验证段双门槛两侧可见；数字脚本核对禁手写；终检 11 项扩 15 项（一致性/回查/对账/资产清白/双构建资产）。
- [lint 反噬修正](010-lint-backfire-fixes.md) — pain-point 改 --pain 传大纲现象词；term-intro 放宽到段落内；判词/闪前不动；新 lint 已在真实课程回归验证。

**执行注记（超出原「仅定稿」目的地）**：全部决议已直接落地到 skill 文件（SKILL.md + 6 份 references），并以 nes-emulator-ts-course 的全量修复作为回归验证（12 章事实错误/幽灵代码/覆盖缺口/零交互全部修复，双门槛 117/117 绿，单课与聚合双构建通过，版权 ROM 清除）。目的地已达成并执行完毕。

## Not yet specified

（已清空：两项迷雾均随决议落地而消解——①是否需要试跑课程回归：nes-emulator-ts-course 的修复本身就是一次全流程回归验证；②评审智能体漏检根因：三轴清单已补覆盖/一致性/事实三块判定项，机械闸门补上 lint 盲区。）

## Out of scope

- **nes-emulator-ts-course 课程本身的修订**——7 处事实/算术错误（$2004 读推进、镜像低 13 位、VBlank 240 vs 241、sprite0 边界表述、「七个格子」计数、SP=$FD「没有教材敢解释」、开放总线「通常是 0」）、3 处幽灵代码、渲染/精灵/音频章补图补可听载体、终章接入试机台指引、删除 companion/public/roms/super-mario.nes、清理超纲的 tests/13、14——那是课程工作不是 skill 工作，要做另起一张图。其中 **super-mario.nes（版权物）与 $2004（教错硬件且代码同错）建议无论地图进度如何都尽快单独处理**。
- 并发章节生成方案——已在 subagents.md 并行模式一节落地，不重开。
