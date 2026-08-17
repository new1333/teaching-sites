---
id: 001
title: 地图：vitepress-teaching-site skill v3 优化
status: open
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

- [调研：VitePress 实时结果方案](004-vitepress-live-result-research.md) — 三层组合：内置全局演示组件为主力（markdown 即 SFC，构建期 import companion 代码，零外部依赖）+ public/ 静态产物兜底 + 外部 playground 仅作外链；iframe/手写 URL 必须 withBase；CLI/配置类课程降级为静态产物+外链。详证 `issues/assets/research-vitepress-live-result.md`。

## Not yet specified

- v3 改动落定后，是否需要一门小规模试跑课程做回归验证——改动面大则必要、小则可免；等各工单决议后才知道改动面多大。
- 评审智能体的三轴清单为何在实跑中漏掉幽灵代码与覆盖缺口——是 spawn 纪律执行走样还是清单本身缺项；006/007 的决议会间接回答一部分，剩余的待那些决议落地后再看是否仍需单独工单。

## Out of scope

- **nes-emulator-ts-course 课程本身的修订**——7 处事实/算术错误（$2004 读推进、镜像低 13 位、VBlank 240 vs 241、sprite0 边界表述、「七个格子」计数、SP=$FD「没有教材敢解释」、开放总线「通常是 0」）、3 处幽灵代码、渲染/精灵/音频章补图补可听载体、终章接入试机台指引、删除 companion/public/roms/super-mario.nes、清理超纲的 tests/13、14——那是课程工作不是 skill 工作，要做另起一张图。其中 **super-mario.nes（版权物）与 $2004（教错硬件且代码同错）建议无论地图进度如何都尽快单独处理**。
- 并发章节生成方案——已在 subagents.md 并行模式一节落地，不重开。
