# VitePress 组装

nav/sidebar 由 `.course/outline.json` **100% 渲染生成，不扫文件系统**——降级章在数据里有标记，sidebar 才能置灰。

## 版本与根 package.json

锁 **vitepress ^1.6.4**（1.x 稳定线；2.0 alpha 不用）。课程根目录：

```json
{
  "name": "{course-name}",
  "private": true,
  "scripts": {
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  },
  "devDependencies": { "vitepress": "^1.6.4", "vue": "^3.5.0" }
}
```

## docs/ 结构

**`docs/index.md`**（home 布局，hero 由大纲渲染。**首页必须有章入口**——home 布局不显示 sidebar，hero actions 与 feature 卡片链接是首页仅有的入口，缺了读者就进不去章节）：

```md
---
layout: home
hero:
  name: {outline.title}
  text: {outline.audience}
  tagline: 读完本课程，{outline.final_milestone.what_reader_built}
  actions:
    - theme: brand
      text: 开始阅读
      link: ./{首章 NN-slug}
    - theme: alt
      text: 课程介绍
      link: ./about
features:
  - icon: ⚡
    title: {第 1 章标题}
    details: {第 1 章 goal，截 80 字}
    link: ./{本章 NN-slug}
    linkText: 进入本章
  # ... 每章一张卡，随章数走（章特别多时可视排版酌情精简，无固定上限）；每张卡都必须带 link
---
```

**hero 长度硬约束**：`text` ≤30 字、`tagline` 全长 ≤50 字（=「读完本课程，」+ `what_reader_built` ≤40 字）。超限时先回改 `outline.json` 的 `audience` / `final_milestone.what_reader_built` 再重渲染——压缩成「产物名+规模+一个验证信号」，砍掉特性枚举，是改写不是机械截断；大纲是单一事实源，不在模板里另造一版短文案。hero 措辞与读者可运行产物一致回查（canvas-app 档：写了「你会看到画面」就必须真有可看的画面）。

**站内链接一律相对（`./NN-slug`）**：课程在聚合站挂载于 `/{课程名}/` 前缀下（见 `references/portal.md`），绝对路径 `/NN-slug` 会指到聚合站根部 404；相对链接在单课（首页 `/`）与聚合（首页 `/{课程名}/`）两种上下文都解析正确。首页如此，正文里链向站内页面同理。

**`docs/about.md`**：一段课程由来 + 章节数（完成数）+ 输入（仓库地址或主题句）。

### obligations 呈现槽（profile.obligations 声明时渲染）

领域义务不靠作者记性，按 outline `profile.obligations[].surfaces` 指定的位置渲染（final-check 机械查 surfaces 存在性，措辞到位由评审轴核对）：

- **hero 下方声明**（compliance 常用）：index.md frontmatter 之后、features 之前一段短声明（如「本课程内容仅用于学习交流，不构成投资建议」）——首页可见，不是藏在 about 里。
- **about.md「内容时效」段**（timeliness）：声明「内容截至 YYYY-MM，X 类事实以 {权威来源} 为准」。
- **速查表头部**（声明了 reference-table 附录且受监管领域）：表格前一行声明。
- **收尾章标准声明**（compliance）：最后 teaching 章的收束槽后附一段。
- **相关章首现处**（legal/ethics）：一句边界声明（「本课程仅讨论授权范围内的用途」）。

## 附录页（大纲声明 `appendices` 时才有，文件 `docs/{slug}.md`）

- `glossary` 由 bible 术语表渲染成「术语 / 英文 / 一句话定义」表格，零额外写作；**条目集必须 ⊇ 全书全部 new_concepts**（final-check 机械对账，011 P2-7——首教过的概念在术语页找不到，是读者的死链）。
- `reference-table` 收读者要反复翻查的承重数据（指令表、寄存器表、费率表、参数表——别让它们散落正文），表内条目必须与实现一致（未实现的位/项要么不列、要么标注「本课程未实现」）。
- `exercises` 是练习路线页（内容见 `references/verification-and-gates.md`），指引读者回看的正文段落必须真实存在——指向不存在小节的引用是阻断项。
- `divergence` 是差异清单页（正文每处「本课程简化为…」的集中登记：简化项 + 未实现项，各注正文出处），由管线汇总正文声明生成、与速查表互相对账。

正文提及任何附录一律用站内相对链接（`./{slug}`），纯文字「见附录」不算引用。sidebar 末尾追加「附录」分部收录。

## 正文内嵌资产（可感知成果）

渲染、音频、可视化类课程的正文应让读者**直接看到/听到**里程碑产物，而不是只读文字断言。机制与约束：

- **图片**：markdown 相对路径引用（`![alt](assets/x.png)`），资产放 `docs/assets/`——由 vite 打包，自动带 base 前缀，单课与聚合站两种上下文都正确。**不要放 `docs/public/` 用绝对路径 `/x.png`**：聚合站构建不拷贝课程的 public/，绝对路径在聚合站必坏。
- **音频等媒体**：raw HTML 标签的 `src` 不经 vite 处理——用 `<script setup>` 导入资产再绑定（`import url from './assets/x.wav'` + `<audio controls :src="url">`），同样获得打包与 base 处理。
- 资产必须由验证物的真实代码现场产出（写一个可重跑的生成/导出脚本放 companion 内，README 记录再生成命令；worksheet 档的图表数据同规——固定种子、两次运行逐字节一致，正文数字一律以导出输出为事实源）——图和声音永远来自读者将亲手复现的实现，不手造、不外采。
- 演示组件必须 `import` 验证物/数据脚本的产物，**禁止平行手抄**（webgl 的平行手抄组件是反面教材——演示与实验场两套代码，演进即漂移）。
- **测试输出不算可感知面**（011 P1-5）：可感知 = 读者能看到画面/听到声音/看到曲线/算出可核对的数。
- 形态不允许的课程（纯 CLI、纯配置、纯导读）不硬造内嵌资产：正文给「亲手运行」指引即可，可感知性降级要在 README 写明。

## 可视化与交互组件配方（判据驱动，不设使用配额）

a-share 课反哺的现成模式（自研 echarts 组件体系：5 个 Vue 组件 + theme 注册，skill 零规范时代的作者补救，v4 收编为配方）。**用不用、用几个，只回答一个问题：不加它，本章的验证信号或承重概念会不会塌**（公理 2）；profile.presentation.visual 只是能力开关，不是使用义务。

- **主题统一**：`docs/.vitepress/theme/index.ts` 全局注册图表组件与 echarts 主题（一次注册，全课程一致配色），组件放 `docs/.vitepress/theme/components/`。
- **数据由脚本产出**：组件的 props 吃 `docs/assets/data/*.json`——由 companion 的导出脚本生成（固定种子），正文不手写图表数据；数据变了重跑导出，图随事实走。
- **响应式**：容器 `width: 100%`，图随版心伸缩；不写死像素宽。
- **聚合站 base 兼容**：数据文件走 `docs/assets/data/`（vite 打包带 base 前缀）；组件内不拼接绝对路径。
- **大依赖动态导入分包**：echarts 这类重依赖在组件内 `import()` 动态加载（或按需注册 `echarts/core` + 所需 chart/component）——首屏不吞几百 KB，聚合站多课程共存时尤其重要（依赖安装在课程目录内，见 `references/portal.md` 的聚合构建约束）。
- 组件名与 props 语义服务教学（`KLineChart`、`LineChart`），不追通用图表库的 API 面。

## 代码密度渲染（profile.code_density）

- `full`（默认，编程课）：代码块全展开——现行行为。
- `collapsed`：超过 ~10 行的代码块默认折叠——``` 围栏外包一层 `<details>`：

  ````md
  <details>
  <summary>src/store.ts · createSetupStore（26 行，点击展开）</summary>

  ```ts
  // src/store.ts · createSetupStore
  ...
  ```

  </details>
  ````

  summary 写出处摘要；折叠的是**篇幅**，不是**承重逻辑**——被硬要求判定为承重的代码块（milestone 依赖路径）保持展开，折叠仅用于「跟随阅读可选」的长块。lint 的 snippet 系检查照常穿透 `<details>` 执行。
- `minimal`（非编程读者）：正文只保留承重最小切片（≤10 行），长实现移附录或直接指向 companion 仓——演练槽以跟算/实操/图表为主形态。

## **`docs/.vitepress/config.mjs`**

```js
export default {
  title: '{outline.title}',
  description: '{outline.audience}',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [ /* 每个分部一项；大纲声明 appendices 时末尾再追加 { text: '附录', items: [...] }： */
      {
        text: '{part.title}',
        collapsed: false,
        items: [ /* 每章一项： */
          { text: '{idx}. {章标题}{降级则加「（未完成）」}', link: '/{NN-slug}.md', /* 降级章加 disabled: true */ }
        ],
      },
    ],
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
```

## 章文件与后处理

- 文件名：`{两位序号}-{ascii-slug}.md`（如 `08-store-to-refs.md`）；slug ≤50 字符、纯 ASCII——中文文件名在 Windows 路径长度、编码和 ZIP 三处都出过坑。
- 每章写完后过一遍后处理：整文被 ``` 围栏包裹的剥掉一层；指向不存在 `.md` 的内站死链改回纯文本（`ignoreDeadLinks: true` 只是兜底）。
- frontmatter `title:` 与大纲章标题一致（终检项）。

## README.md（课程根）

包含：怎么跑（两条路——项目根 `pnpm dev` 从聚合站进入，或本课程内 `pnpm install && pnpm docs:dev` 单独预览；验证物工程 `cd companion && npm install && npm test`）、章节目录、终点里程碑、（如有）资产再生成命令、（observation/纯导读）可感知性降级说明。

## 终检（仪器化，011 P1-6：凡能脚本化的对账不得留给自觉）

**第一步，跑脚本**（仓库级共享资产，提交；用于新仓库时与 lint 脚本一并原样复制进目标仓库 `scripts/`）：

```bash
node scripts/course-final-check.mjs courses/{course}            # 全量（含伴生门槛实跑 + 数字断言比对）
node scripts/course-final-check.mjs courses/{course} --skip-gates   # 快速（跳过门槛实跑）
```

机械覆盖（脚本已对账，不再靠肉眼）：章文件数/序号/slug/附录页与大纲一致；frontmatter title；hero 长度与首页链接相对化及死链；glossary 页 = bible 条目集；术语全书出现（容 3）；`src/` `tests/` 标注块与验证物终态逐字 diff（拼版豁免）；站内相对链接与资产死链；promises.json 核销；obligations surfaces 存在性；zero-trace 抽查（github blob/tree 链接、`.course/repo` 痕迹）/ walkthrough 引用路径存在性；降级章占位核验；伴生 typecheck/test 实跑 + README/index/about/终章的测试数与行数断言比对（现实是事实源——a-share 终章「430 vs 404」式漂移由它拦住）。

**第二步，脚本外人工项**（机械做不了或成本不划算，逐条过）：

1. `pnpm install && pnpm docs:build` 构建成功；正文内嵌资产（如有）在单课与聚合两种构建下路径正确（脚本验死链，构建验打包）。
2. 附录**语义**对账（脚本验互链，语义靠人）：速查表与实现一致（未实现项有标注）；差异清单登记了正文声明的全部简化；无指向不存在小节的引用。
3. acceptance 全书回查：大纲验收条目（含文验收）逐条核对兑现，未兑现项要么修文要么改大纲——两头不一致是事故。
4. **能力对账**（终检升级语义，011 P0-3）：终章「你已经能 X」的每项能力、README 的终点里程碑，在正文与验证物里真实建立过；验证物里存在而全书无章节教学来历的产物（超纲测试、来历不明模块）是账本违约。
5. **零输入体验**（问一句，不是开关）：形态允许时，终章的可运行产物自带课程自产的内置输入（测试 fixture 导出），访客不自备文件就能看到成果；不允许（需真实密钥/数据集）时在 README 写明。
6. 验证物资产清白：无大纲外的测试文件与产物；无版权输入物（public/ 或资源目录里不得出现外部下载的受版权文件——grep 一遍资源目录）；实验场对外承诺（如「零外部输入」）与仓库内容一致。
7. 聚合入口：根脚手架缺失则按 `references/portal.md` 创建；`node scripts/portal-sync.mjs` 成功，根目录 `pnpm build` 构建成功。
8. 向用户汇报：课程路径、聚合与单课预览命令、降级章清单、带病放行项（如有）及其原因；交付口径统一为：根目录 `pnpm dev` 看全部课程，`cd courses/{course} && pnpm docs:dev` 只看本课程。

> 变更说明（v4）：终检清单的机械项已全部收进 `scripts/course-final-check.mjs`（脚本本体以仓库 `scripts/` 为正本，本文件不再内嵌脚本文本——内嵌文本在 12 门课里零已提交副本、逐课漂移，issues/011 P2-9）；清单余下的是机械做不了的语义与构建项。
