---
id: 004
title: 调研：VitePress 下「实时看到运行结果」的可移植方案
status: closed
labels: [wayfinder:research]
blocked-by: []
---

# 调研：VitePress 下「实时看到运行结果」的可移植方案

## Question

VitePress ^1.6 下，「读者在课程站里实时看到运行结果」有哪些可移植实现方案，各自的构建/维护成本与约束是什么？——为 005（可感知成果写进 skill）提供事实输入。

调研范围：
1. 官方机制：markdown 里直接用自定义 Vue 组件、client-only 渲染、主题扩展——成本与限制；
2. 内嵌可运行 demo 的现成方案：demo 容器插件、iframe 嵌外部 playground（TypeScript playground / StackBlitz / CodeSandbox 等）的可用形态；
3. 静态产物：截图 / GIF / 音频文件在 VitePress 里的引用与聚合站兼容性；
4. 关键约束：聚合站把每门课挂载在 `/{课程名}/` base 前缀下（单课 base `/`），上述方案哪些会被 base 前缀弄坏；
5. 与四种 companion 形态（library / cli-golden / config-validate / dom-test）的适配面——哪些课程形态天然有可上屏产物、哪些只能退静态截图或外部 playground；
6. 同类教学站（如官方文档站的交互示例）怎么做的，作为参照。

产出：方案对比表 + 按可移植性/成本的推荐排序，写入 `issues/assets/research-vitepress-live-result.md`。

## 决议

调研完成（2026-08-17），完整报告：`issues/assets/research-vitepress-live-result.md`（八方案对比表 + 逐条发现 + 来源）。核心结论：

1. **主力 = skill 内置一套可复用全局演示组件**（方案 C）：VitePress 的 markdown 即 Vue SFC，`enhanceApp` 注册 `<demo-canvas>` / `<demo-audio>` 类组件，浏览器 API（canvas/AudioContext）在 `onMounted` 里安全运行（官方 SSR 规则）；真代码从 companion 纯 TS 模块**构建期 import** 打进 bundle。零外部依赖、离线可用、base 安全。
2. **兜底 = `public/` 静态产物**（方案 A）：markdown 相对路径与 `/x.png` 由官方自动加 base 前缀；大 GIF/音频放 public/ 避免被 inline 拖慢构建。
3. **外部 playground 仅作外链，不内嵌**（方案 G/H）：中文网络下 StackBlitz/CodeSandbox 依赖的境外 CDN 常不可达；TS Playground `#code/` 压缩链接零维护成本，可作「点出去练」。
4. **「玩到」级（键盘/手柄/多文件）用自包含 demo HTML + iframe**（方案 D），注意 iframe `src` 必须 `withBase()`，相对路径会被客户端路由深度弄坏。
5. 关键坑：组件内手写资源 URL 不被自动加前缀，必须 `withBase()`；社区 demo 容器插件已停更（2023），VitePress 1.x 官方无 playground 容器，`@vue/repl` 活跃但仅适合教 Vue 的课程。
6. 纯 CLI / 纯配置类课程明确降级：静态产物 + 外链，不硬造交互。

本工单关闭；[可感知成果（005）](005-perceivable-milestone.md)解除阻塞，进入前沿。
