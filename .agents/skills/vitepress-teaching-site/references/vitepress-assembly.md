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

**`docs/index.md`**（home 布局，hero 由大纲渲染）：

```md
---
layout: home
hero:
  name: {outline.title}
  text: {outline.audience}
  tagline: 读完本课程，{outline.final_milestone.what_reader_built}
features:
  - icon: ⚡
    title: {第 1 章标题}
    details: {第 1 章 goal，截 80 字}
  # ... 最多前 12 章
---
```

**`docs/about.md`**：一段课程由来 + 章节数（完成数）+ 输入（仓库地址或主题句）。

**`docs/.vitepress/config.mjs`**：

```js
export default {
  title: '{outline.title}',
  description: '{outline.audience}',
  base: '/',
  ignoreDeadLinks: true,
  themeConfig: {
    nav: [{ text: '首页', link: '/' }, { text: '关于', link: '/about' }],
    sidebar: [ /* 每个分部一项： */
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

包含：怎么跑（`pnpm install && pnpm docs:dev`；伴生实现 `cd companion && npm install && npm test`）、章节目录、终点里程碑。

## 终检清单（交付前逐条过）

1. `docs/` 章文件数 = 大纲章数；文件名序号连续。
2. 每章 frontmatter title 与大纲一致。
3. 术语表条目全书出现过（容 3 条未出现，与 lint 同规）。
4. `companion/` 全量门槛通过（按伴生形态执行对应命令；tests/ 应含全部 build 章的测试）。
5. `pnpm install && pnpm docs:build` 构建成功。
6. 向用户汇报：站点路径、预览命令、降级章清单（如有）。
