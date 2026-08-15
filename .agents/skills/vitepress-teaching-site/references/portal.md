# 聚合入口（课程中心）

项目根是全部课程的聚合入口：`pnpm dev` 一条命令预览所有课程。课程自身零侵入——每门课仍是独立可跑的 VitePress 站点，聚合机制只发生在根目录。

## 机制

聚合站就是一个以 `courses/` 为 root 的 VitePress 站点（根 `package.json` 的 `dev`/`build` 即 `vitepress dev|build courses`）：

- **挂载**：rewrites 把每门课的 `docs/` 映射到 `/{课程名}/` 路径——`':course/docs/:path*': ':course/:path*'`（path-to-regexp 语法）。`courses/{course}/docs/01-x.md` → URL `/{course}/01-x`。
- **派生不双源**：聚合站的 nav/sidebar/课程卡片全部由各课程**已提交的** `docs/.vitepress/config.mjs` 派生（sync 脚本动态 import 后给 sidebar link 加 `/{课程名}` 前缀），不读 `.course/`（那是管线状态，可能缺席），也不另立 manifest——两份事实源必漂移。
- **生成物可再生**：`courses/index.md`（聚合首页）与 `courses/.vitepress/config.mjs`（聚合配置）由 sync 脚本生成、gitignore；`dev`/`build` 前置执行 sync，永远新鲜。

## 根脚手架（首门课程时创建一次，提交）

**`package.json`**：

```json
{
  "name": "teaching-sites",
  "private": true,
  "scripts": {
    "sync": "node scripts/portal-sync.mjs",
    "dev": "node scripts/portal-sync.mjs && vitepress dev courses",
    "build": "node scripts/portal-sync.mjs && vitepress build courses",
    "preview": "vitepress preview courses"
  },
  "devDependencies": { "vitepress": "^1.6.4", "vue": "^3.5.0" }
}
```

**`scripts/portal-sync.mjs`**（原样落盘，这是脚本正本）：

```js
// 扫描 courses/*-course，生成聚合站文件（courses/index.md 与 courses/.vitepress/config.mjs）。
// 数据唯一来源：各课程已提交的 docs/.vitepress/config.mjs。勿手改生成物——重跑本脚本即可。
import { readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const coursesDir = join(root, 'courses')

const courseNames = readdirSync(coursesDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.endsWith('-course'))
  .map((d) => d.name)
  .sort()

const courses = []
for (const name of courseNames) {
  const cfgPath = join(coursesDir, name, 'docs', '.vitepress', 'config.mjs')
  if (!existsSync(cfgPath)) {
    console.warn(`[portal] 跳过 ${name}：缺少 docs/.vitepress/config.mjs`)
    continue
  }
  const cfg = (await import(pathToFileURL(cfgPath).href)).default
  let chapterCount = 0
  const sidebar = (cfg.themeConfig?.sidebar ?? []).map((part) => ({
    ...part,
    items: (part.items ?? []).map((item) => {
      if (item.link?.startsWith('/')) {
        chapterCount++
        return { ...item, link: `/${name}${item.link}` }
      }
      return item
    }),
  }))
  if (existsSync(join(coursesDir, name, 'docs', 'about.md')))
    sidebar.push({ text: '关于本课', items: [{ text: '关于', link: `/${name}/about` }] })
  courses.push({
    name,
    title: cfg.title ?? name,
    description: cfg.description ?? '',
    sidebar,
    chapterCount,
  })
}

if (!courses.length) {
  console.error('[portal] courses/ 下没有可用课程（需 *-course/docs/.vitepress/config.mjs）')
  process.exit(1)
}

const j = JSON.stringify
// 先在普通代码里算好，模板里只留 ${j(...)} 插值——插值内写对象字面量会触发模板插值提前闭合
const nav = [{ text: '首页', link: '/' }, ...courses.map((c) => ({ text: c.title, link: `/${c.name}/` }))]
const sidebarMap = Object.fromEntries(courses.map((c) => [`/${c.name}/`, c.sidebar]))
const config = `// 由 scripts/portal-sync.mjs 生成，勿手改。改课程请改该课程自己的 config.mjs 后重跑 pnpm sync。
export default {
  title: '课程中心',
  description: '全部教学课程的聚合入口',
  ignoreDeadLinks: true,
  srcExclude: ['**/README.md', '**/companion/**', '**/.course/**'],
  rewrites: { ':course/docs/:path*': ':course/:path*' },
  themeConfig: {
    nav: ${j(nav)},
    sidebar: ${j(sidebarMap)},
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    docFooter: { prev: '上一章', next: '下一章' },
  },
}
`

const index = `---
layout: home
hero:
  name: 课程中心
  text: ${courses.length} 门从零实现的课程
  tagline: 根目录 pnpm dev 聚合预览；每门课程也可在 courses/ 下独立运行
features:
${courses
  .map(
    (c) => `  - icon: 📘
    title: ${JSON.stringify(c.title)}
    details: ${JSON.stringify(`${c.description}（${c.chapterCount} 章）`)}
    link: /${c.name}/
    linkText: 进入课程`,
  )
  .join('\n')}
---
`

mkdirSync(join(coursesDir, '.vitepress'), { recursive: true })
writeFileSync(join(coursesDir, '.vitepress', 'config.mjs'), config)
writeFileSync(join(coursesDir, 'index.md'), index)
console.log(`[portal] 已生成聚合站：${courses.map((c) => `${c.title}(${c.chapterCount} 章)`).join('、')}`)
```

**`.gitignore` 追加**（已有 pattern 不动）：

```gitignore
# 聚合站生成文件（pnpm sync 可再生）
/courses/index.md
/courses/.vitepress/
```

## 已知边界（无需修，知道即可）

- 课程内部写的站内**绝对**链接（如正文里的 `/about`）在聚合站里指向根路径会 404——所以课程内站内链接一律**相对**（首页模板已保证，见 `vitepress-assembly.md`）；残余绝对链接由 `ignoreDeadLinks: true` 兜底，翻章靠 sidebar（已带前缀）。课程间正文互链本来就不该有。
- 课程的 `docs/public/` 资源目录不会进聚合站（VitePress 只认一个 public）。本 skill 生成的课程不依赖 public 资源；若未来加了，sync 脚本需顺带拷贝到 `courses/public/{课程名}/`。
- 课程 config 的 `base: '/'` 保持不变——单课独立运行优先，聚合前缀由 rewrites + sidebar 前缀化解决。

## 验证（阶段 4 第 4 步）

1. `node scripts/portal-sync.mjs` 无报错，且输出列出的课程数 = `courses/` 下 `*-course` 目录数。
2. 根目录 `pnpm install && pnpm build` 成功；`courses/.vitepress/dist/` 下每门课都有 `/{课程名}/index.html` 与全部章 html。
3. `pnpm dev` 后：`/` 是课程卡片首页，点进任一课程 hero 正常、sidebar 翻章正常、本地搜索能搜到各课内容。
