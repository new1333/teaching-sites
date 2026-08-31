# 复刻沉浸式翻译：双语对照引擎的原理与实现

一门原理重实现课：把「沉浸式翻译」这类双语对照工具的核心引擎拆开教、动手重做。读完你拥有约 1000 行 TS（含 4 个 fixture 模板；引擎本体 633 行）+ 44 行扩展壳的最小双语引擎，8 个测试文件 / 74 项测试全绿，可装进 Chrome 在真实页面离线演示双语对照。

- **主线问题**：原文纹丝不动的页面上，译文是怎么逐段长出来的——还跟得上无限滚动？
- **读者画像**：会写 TypeScript 与原生 DOM、想亲手复刻双语翻译工具的开发者

## 怎么跑

两条路：

1. **聚合站**（推荐）：项目根 `pnpm dev`，从课程中心进入本课程。
2. **单课**：本目录内 `pnpm install && pnpm docs:dev`。

### 验证物工程（companion/）

```bash
cd companion
npm install
npm run typecheck   # tsc --noEmit，零报错
npm test            # vitest run，8 个测试文件 / 74 项测试全绿
```

每章一个可跑 demo（正文验证槽的「亲手开机」）：

```bash
npm run demo:extract   # 第 2 章：打印「引擎眼中的页面」——14 个可译块
npm run demo:render    # 第 3 章：两条渲染路线对照 + 幂等 + 14→28 引信
npm run demo:engine    # 第 4 章：createEngine().run() 一键整页双语 + 503 降级
npm run demo:inline    # 第 5 章：译文里的 strong/a/code 结构并排对照
npm run demo:content   # 第 6 章：被排除区域 vs 选中正文区
npm run demo:batch     # 第 7 章：请求账单——37 块 → 3 单，二次 0 请求
npm run demo:observe   # 第 8 章：追加 3 段只见 3 个新译文，引信拆除
npm run demo:shell     # 第 9 章：manifest 原文 + 壳的 jsdom 预演
```

### 装进 Chrome（第 9 章的亲手开机）

```bash
cd companion && npm run build:ext   # esbuild 打包 → extension/dist/content.js（14KB）
```

然后 `chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」→ 选 `companion/extension/` 目录 → 打开任一英文页面，译文自动逐段出现（离线假翻译器，零密钥零费用）。逐步指引见第 9 章验证槽。

## 章节目录

| # | 章 | 里程碑 |
|---|---|---|
| 1 | 整页替换 vs 双语对照：两种翻译世界观 | 无代码，一张部件图 |
| 2 | 可译块：找到直接持有文字的节点 | extractBlocks 抽出 14 个可译块 |
| 3 | 双语渲染：原文纹丝不动，译文插到下面 | renderBilingual 幂等插入译文节点 |
| 4 | 翻译服务抽象：引擎不认识任何 API | createEngine().run() 一键整页双语 |
| 5 | 内联格式保留：译文里的加粗和链接 | 占位标记法，结构逐节点保留 |
| 6 | 主内容识别：别把额度花在导航栏上 | 密度启发式选中正文容器（14→10 块） |
| 7 | 批量、去重与缓存：翻译的经济学 | 重复段落只请求一次、二次运行零请求 |
| 8 | 动态内容：别让译文生译文 | observer 增量翻译 + 防自触发 |
| 9 | 装进浏览器：从 jsdom 到真实页面 | extension/ 壳，Chrome 里亲眼验证 |

附录：[术语表](docs/glossary.md) · [节点分类速查表](docs/node-cheatsheet.md) · [与真实产品的差异清单](docs/divergence.md)

## 终点里程碑

读完本课程，你拥有一个双语对照引擎（见开头家底）+ 可装进 Chrome 的扩展壳，离线可演示。验证方式：全链路测试全绿；浏览器加载扩展后，任意英文页面逐段出现对照译文。

## 管线状态

`.course/` 下的 outline / bible / rolling / calibration / promises 五个 JSON 随课程提交，是生成管线的事实源；`companion/.course/snapshots/` 等可再生状态不入库。
