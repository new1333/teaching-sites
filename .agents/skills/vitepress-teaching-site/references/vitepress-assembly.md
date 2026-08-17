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

**hero 长度硬约束**：`text` ≤30 字、`tagline` 全长 ≤50 字（=「读完本课程，」+ `what_reader_built` ≤40 字）。超限时先回改 `outline.json` 的 `audience` / `final_milestone.what_reader_built` 再重渲染——压缩成「产物名+规模+一个验证信号」，砍掉特性枚举，是改写不是机械截断；大纲是单一事实源，不在模板里另造一版短文案。

**站内链接一律相对（`./NN-slug`）**：课程在聚合站挂载于 `/{课程名}/` 前缀下（见 `references/portal.md`），绝对路径 `/NN-slug` 会指到聚合站根部 404；相对链接在单课（首页 `/`）与聚合（首页 `/{课程名}/`）两种上下文都解析正确。首页如此，正文里链向站内页面同理。

**`docs/about.md`**：一段课程由来 + 章节数（完成数）+ 输入（仓库地址或主题句）。

**附录页**（大纲声明 `appendices` 时才有，文件 `docs/{slug}.md`）：`glossary` 由 bible 术语表渲染成「术语 / 英文 / 一句话定义」表格，零额外写作；`reference-table` 收读者要反复翻查的承重数据（指令表、寄存器表、时序表、语法表——别让它们散落正文），表内条目必须与实现一致（未实现的位/项要么不列、要么标注「本课程未实现」）；`exercises` 是练习路线页（内容见 `references/companion-and-gates.md`），指引读者回看的正文段落必须真实存在——指向不存在小节的引用是阻断项；`divergence` 是差异清单页（正文每处「本课程简化为…」的集中登记：简化项 + 未实现项，各注正文出处），由管线汇总正文声明生成、与速查表互相对账。正文提及任何附录一律用站内相对链接（`./{slug}`），纯文字「见附录」不算引用。sidebar 末尾追加「附录」分部收录。

## 正文内嵌资产（可感知成果）

渲染、音频、可视化类课程的正文应让读者**直接看到/听到**里程碑产物，而不是只读文字断言。机制与约束：

- **图片**：markdown 相对路径引用（`![alt](assets/x.png)`），资产放 `docs/assets/`——由 vite 打包，自动带 base 前缀，单课与聚合站两种上下文都正确。**不要放 `docs/public/` 用绝对路径 `/x.png`**：聚合站构建不拷贝课程的 public/，绝对路径在聚合站必坏。
- **音频等媒体**：raw HTML 标签的 `src` 不经 vite 处理——用 `<script setup>` 导入资产再绑定（`import url from './assets/x.wav'` + `<audio controls :src="url">`），同样获得打包与 base 处理。
- 资产必须由伴生实验场的真实代码现场产出（写一个可重跑的生成脚本放 companion 内，README 记录再生成命令）——图和声音永远来自读者将亲手复现的实现，不手造、不外采。
- 形态不允许的课程（纯 CLI、纯配置）不硬造内嵌资产：正文给「亲手运行」指引即可，可感知性降级要在 README 写明。

**`docs/.vitepress/config.mjs`**：

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

包含：怎么跑（两条路——项目根 `pnpm dev` 从聚合站进入，或本课程内 `pnpm install && pnpm docs:dev` 单独预览；伴生实验场 `cd companion && npm install && npm test`）、章节目录、终点里程碑。

## 终检清单（交付前逐条过）

1. `docs/` 章文件数 = 大纲章数（附录页不计入）；文件名序号连续；附录页与大纲 `appendices` 一一对应（如有）。
2. 每章 frontmatter title 与大纲一致。
3. `docs/index.md` 有章入口：hero actions 与每张 feature 卡都带相对 `link`（`./NN-slug`），无绝对路径站内链接。
4. hero 长度：`text` ≤30 字、`tagline` 全长 ≤50 字；超限回改 `outline.json` 对应字段后重渲染。
5. 术语表条目全书出现过（容 3 条未出现，与 lint 同规）。
6. `companion/` 全量门槛通过（按实验场形态执行对应命令；tests/ 应含全部 build 章的测试）。
7. **数字事实核对（脚本执行，不靠肉眼）**：正文中可验证的数字声明（「N 个用例」「累计 N」「~N 行」）与机械现实比对——vitest 输出、`wc -l`；不一致改文，现实是事实源。验证小节的用例数由管线从门槛命令输出注入，手写数字一律视为待核对占位。
8. **正文↔代码一致性**：全书正文标注 `src/…` 的代码块与 companion 终态全量比对（重构回写是否漏网）；lint 的 snippet-missing 全章通过。
9. **acceptance 全书回查**：大纲验收条目（含文验收）逐条核对兑现，未兑现项要么修文要么改大纲——两头不一致是事故。
10. **附录对账**：速查表与实现一致（未实现项有标注）；差异清单登记了正文声明的全部简化；正文↔附录互链为站内相对链接、无死结、无指向不存在小节的引用。
11. **零输入体验**（问一句，不是开关）：形态允许时，终章的可运行产物自带课程自产的内置输入（测试 fixture 导出），访客不自备文件就能看到成果；不允许（需真实密钥/数据集）时在 README 写明。
12. **companion 资产清白**：无大纲外的测试文件与产物；无版权输入物（public/ 或资源目录里不得出现外部下载的受版权文件——终检 grep 一遍资源目录）；实验场对外承诺（如「零外部输入」）与仓库内容一致。
13. `pnpm install && pnpm docs:build` 构建成功；正文内嵌资产（如有）在单课与聚合两种构建下路径正确。
14. 聚合入口：根脚手架缺失则按 `references/portal.md` 创建；`node scripts/portal-sync.mjs` 成功，根目录 `pnpm build` 构建成功。
15. 向用户汇报：课程路径（`courses/{course}/`）、聚合预览命令（根目录 `pnpm dev`）、单课预览命令、降级章清单（如有）。
