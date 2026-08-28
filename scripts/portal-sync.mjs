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
  const sidebar = (cfg.themeConfig?.sidebar ?? []).map((part) => {
    const isAppendix = part.text === '附录' // 附录分部不计入章数
    return {
      ...part,
      items: (part.items ?? []).map((item) => {
        if (item.link?.startsWith('/')) {
          if (!isAppendix) chapterCount++
          return { ...item, link: `/${name}${item.link}` }
        }
        return item
      }),
    }
  })
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
// GitHub Pages 项目级站点部署在 /<repo>/ 子路径下，资源 base 必须含该前缀。
// 仅在显式设置 PAGES_BASE 时写入（CI 构建注入），本地 dev/build 不设则保持根路径。
const pagesBase = process.env.PAGES_BASE?.trim()
const baseLine = pagesBase ? `  base: '${pagesBase}',\n` : ''
// 先在普通代码里算好，模板里只留 ${j(...)} 插值——插值内写对象字面量会触发模板插值提前闭合
// 课程标题较长且会持续增加，平铺在 nav 会溢出屏幕，故收纳进一个下拉菜单
const nav = [
  { text: '首页', link: '/' },
  { text: '全部课程', items: courses.map((c) => ({ text: c.title, link: `/${c.name}/` })) },
]
const sidebarMap = Object.fromEntries(courses.map((c) => [`/${c.name}/`, c.sidebar]))
const config = `// 由 scripts/portal-sync.mjs 生成，勿手改。改课程请改该课程自己的 config.mjs 后重跑 pnpm sync。
export default {
${baseLine}  title: '课程中心',
  description: '全部教学课程的聚合入口',
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

// 聚合站默认回退 DefaultTheme，课程在自身 theme/index.ts 注册的全局组件（如 KLineChart）
// 会全部静默失效（标签原样输出、浏览器丢弃）。这里把各课程 theme 的 enhanceApp 串起来统一注册。
const themed = courses.filter((c) =>
  existsSync(join(coursesDir, c.name, 'docs', '.vitepress', 'theme', 'index.ts')),
)
const camel = (name) => name.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase())
let themeLog = ''
if (themed.length) {
  const themeTs = `// 由 scripts/portal-sync.mjs 生成，勿手改。改课程组件请改该课程自己的 theme/index.ts 后重跑 pnpm sync。
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
${themed.map((c) => `import ${camel(c.name)} from '../../${c.name}/docs/.vitepress/theme/index'`).join('\n')}

const courseThemes: Theme[] = [${themed.map((c) => camel(c.name)).join(', ')}]

export default {
  extends: DefaultTheme,
  enhanceApp(ctx) {
    for (const theme of courseThemes) theme.enhanceApp?.(ctx)
  },
} satisfies Theme
`
  mkdirSync(join(coursesDir, '.vitepress', 'theme'), { recursive: true })
  writeFileSync(join(coursesDir, '.vitepress', 'theme', 'index.ts'), themeTs)
  themeLog = `；已聚合 ${themed.length} 个课程组件包（${themed.map((c) => c.name).join('、')}）`
}

mkdirSync(join(coursesDir, '.vitepress'), { recursive: true })
writeFileSync(join(coursesDir, '.vitepress', 'config.mjs'), config)
writeFileSync(join(coursesDir, 'index.md'), index)
console.log(
  `[portal] 已生成聚合站：${courses.map((c) => `${c.title}(${c.chapterCount} 章)`).join('、')}${themeLog}`,
)
