#!/usr/bin/env node
// companion/scripts/e2e-ch4.mjs · gate:ch4 —— 预取与资源提示门槛
// 自起构建产物服务器 → 断言：①页头导航的预取策略以 data-prefetch 标注出现在首页/列表页 HTML
// ②关键资源 preload 提示在位且指向真资源（本页渲染容器 + CSS 引用同在）
// ③被裁剪路由（no-prefetch）无预取标记：既无启用策略标注，Nuxt 自带的 <link rel=prefetch>
//   （实测为错误页分块，与路由预取无关）也不指向任何路由分块
// ④编译产物里策略真的连线（策略表 → NuxtLink props，不是只挂了个 data 属性）
// ⑤旧门 ch1–ch3 不回退（串行复跑）→ 清理退出。
// 断言锚点说明：NuxtLink 的视口预取是客户端运行时行为（空闲 + IntersectionObserver），
// SSR HTML 的 <a> 上没有它的痕迹，策略因此以 data-prefetch 标注显式落在锚点上（QA/gate 锚点）；
// 预取的“行为面”（Network 里分块被预取）由浏览器侧人工观察（正文 milestone_verify）。
// SKIP_BUILD=1 跳过构建加速迭代（要求 .output 已存在）。
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBuild, startServer, ROOT } from './lib/server.mjs'
import { requestPage } from './lib/measure-core.mjs'

const failures = []
const checks = []
function check(ok, label) {
  checks.push({ ok, label })
  if (!ok) failures.push(label)
}

// 页头三个导航项的期望策略（与 app/utils/nav-links.ts 的表对账；改策略要连这里一起改）
const EXPECTED_STRATEGIES = {
  '/products': 'viewport',
  '/search': 'interaction',
  '/favorites': 'none',
}
const HERO_ASSET = '/hero-snail.svg'
// 路由分块的文案标记：HTML 里 Nuxt 自带的 rel=prefetch 若命中任何一个，
// 说明它变成了路由预取——与实测结论（错误页分块）不符即红
const ROUTE_MARKERS = ['我的收藏', '搜一搜', '全部商品', '慢慢来，比较快', '反例：客户端取数']

/** 抓出 HTML 里所有带 data-prefetch 标注的锚点：{ href: mode } */
function anchorsWithStrategy(html) {
  const found = {}
  for (const m of html.matchAll(/<a\b[^>]*>/g)) {
    const tag = m[0]
    if (!tag.includes('data-prefetch=')) continue
    const href = /href="([^"]*)"/.exec(tag)?.[1]
    const mode = /data-prefetch="([^"]*)"/.exec(tag)?.[1]
    if (href) found[href] = mode
  }
  return found
}

/** 递归找 dir 下第一个内容含 marker 的 .js 文件 */
function findChunkContaining(dir, marker) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    if (f.isDirectory()) {
      const hit = findChunkContaining(p, marker)
      if (hit) return hit
    } else if (f.name.endsWith('.js') && readFileSync(p, 'utf8').includes(marker)) {
      return p
    }
  }
  return null
}

/** 串行跑一个旧门（SKIP_BUILD=1 复用本章已构建产物），resolve 退出码 */
function runGate(script) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [join(ROOT, 'scripts', script)], {
      cwd: ROOT,
      env: { ...process.env, SKIP_BUILD: '1' },
      stdio: 'inherit',
    })
    proc.on('error', () => resolve(1))
    proc.on('exit', (code) => resolve(code ?? 1))
  })
}

const buildInfo = await ensureBuild()
const srv = await startServer()
const navObserved = {}
const heroObserved = {}
const htmlPrefetchLinks = []
let wiringObserved = null
try {
  for (const pagePath of ['/', '/products']) {
    const page = await requestPage(srv.base, pagePath)
    const html = page.body.toString('utf8')
    check(page.status === 200, `页面可用：${pagePath} 返回 200（实际 ${page.status}）`)

    // ---- A. 预取策略在 HTML：页头锚点带 data-prefetch 标注，三档策略逐一对上 ----
    const strategies = anchorsWithStrategy(html)
    navObserved[pagePath] = strategies
    for (const [to, mode] of Object.entries(EXPECTED_STRATEGIES)) {
      check(
        strategies[to] === mode,
        `预取策略：${pagePath} 页头 ${to} 锚点标注 data-prefetch="${mode}"（实际 "${strategies[to] ?? '(无)'}"）`,
      )
    }
    // 每条路由只出现一个带策略标注的锚点（页头唯一）
    const allAnchors = [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
    for (const to of Object.keys(EXPECTED_STRATEGIES)) {
      const count = allAnchors.filter(
        (t) => t.includes(`href="${to}"`) && t.includes('data-prefetch='),
      ).length
      check(
        count === 1,
        `预取策略：${pagePath} 的 ${to} 策略锚点恰好 1 个（实际 ${count}）`,
      )
    }

    // ---- C. preload 纪律：preload 只出现在用它的页面（首页），不泄漏到别的页 ----
    const heroPreloadTag =
      /<link\b[^>]*rel="preload"[^>]*hero-snail\.svg[^>]*>/.exec(html)?.[0] ?? ''
    if (pagePath === '/') {
      const as = /as="([^"]*)"/.exec(heroPreloadTag)?.[1]
      heroObserved.preloadTag = heroPreloadTag
      check(
        !!heroPreloadTag && as === 'image',
        `关键资源 preload：首页 HTML 含 <link rel="preload" as="image" href="${HERO_ASSET}">（实际 as="${as ?? '(无)'}"）`,
      )
      // 真资源：preload 指向的资产真的被本页用——渲染容器与 CSS 引用同在
      check(
        html.includes('hero-art'),
        '真资源：首页 HTML 含 hero-art 渲染容器（preload 指向本页真要用的资产）',
      )
      const cssHref = /<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/.exec(html)?.[1]
      const css = await requestPage(srv.base, cssHref ?? '/_nuxt/missing.css')
      heroObserved.cssReferencesAsset = css.body.toString('utf8').includes('hero-snail.svg')
      check(
        heroObserved.cssReferencesAsset,
        '真资源：入口 CSS 引用 hero-snail.svg（背景图只能经 CSS 发现，preload 提前发现才有意义）',
      )
      const asset = await requestPage(srv.base, HERO_ASSET)
      heroObserved.assetBytes = asset.body.length
      check(
        asset.status === 200 && asset.body.length > 500,
        `真资源：${HERO_ASSET} 可服务且非空（${asset.status}，${asset.body.length} B）`,
      )
    } else {
      check(
        !heroPreloadTag,
        `preload 纪律：${pagePath} 不注入 hero preload（每页只 preload 自己马上要用的资源）`,
      )
    }

    // ---- D. Nuxt 自带的 rel=prefetch 不指向任何路由分块（实测锚点，防张冠李戴）----
    const nuxtDir = join(ROOT, '.output', 'public', '_nuxt')
    const prefetchHrefs = [...html.matchAll(/<link\b[^>]*rel="prefetch"[^>]*href="([^"]+)"[^>]*>/g)].map(
      (m) => m[1],
    )
    if (pagePath === '/') htmlPrefetchLinks.push(...prefetchHrefs)
    for (const href of prefetchHrefs) {
      const file = join(nuxtDir, href.split('/').pop())
      let text = ''
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        check(false, `prefetch 目标存在：${href} 指向的分块文件可读`)
        continue
      }
      const hit = ROUTE_MARKERS.filter((mk) => text.includes(mk))
      check(
        hit.length === 0,
        `prefetch 事实：${pagePath} 的 rel=prefetch 目标 ${href.split('/').pop()} 不是路由分块（命中标记：${hit.join('、') || '无'}）`,
      )
    }
  }

  // ---- B. 编译连线：策略表真的驱动 NuxtLink props（不是只挂了个 data 属性）----
  // 客户端是预取发生的一侧：含 data-prefetch 的分块（SiteHeader 编译产物）必须同时携带
  // 策略表的路由（/products 等）与 props 映射（noPrefetch / prefetchOn 的运行时形态）。
  const nuxtDir = join(ROOT, '.output', 'public', '_nuxt')
  const siteHeaderChunk = findChunkContaining(nuxtDir, 'data-prefetch')
  check(!!siteHeaderChunk, '编译连线：客户端分块含 data-prefetch 标注（SiteHeader 编译产物在位）')
  if (siteHeaderChunk) {
    const text = readFileSync(siteHeaderChunk, 'utf8')
    const hasTable = Object.keys(EXPECTED_STRATEGIES).every((to) => text.includes(to))
    const hasProps = text.includes('noPrefetch') && text.includes('prefetchOn')
    check(
      hasTable,
      `编译连线：同分块含策略表全部路由（${Object.keys(EXPECTED_STRATEGIES).join('、')}）`,
    )
    check(
      hasProps,
      '编译连线：同分块含 noPrefetch / prefetchOn props 映射（策略真的接到 NuxtLink 上）',
    )
    wiringObserved = {
      chunk: siteHeaderChunk.split('.output').pop(),
      bytes: statSync(siteHeaderChunk).size,
      hasTable,
      hasProps,
    }
  }
} catch (err) {
  console.error('gate:ch4 执行异常：', err)
  process.exitCode = 1
} finally {
  await srv.stop()
}

// ---- E. 旧门不回退：串行复跑 ch1–ch3（SKIP_BUILD=1 复用本次构建产物）----
const oldGates = []
if (!process.exitCode) {
  for (const script of ['e2e-ch1.mjs', 'e2e-ch2.mjs', 'e2e-ch3.mjs']) {
    const code = await runGate(script)
    oldGates.push({ script, code })
    check(
      code === 0,
      `旧门不回退：node scripts/${script} 退出码 0（实际 ${code}）`,
    )
  }
}

const passed = checks.length - failures.length
const report = {
  command: 'pnpm gate:ch4（node scripts/e2e-ch4.mjs）',
  generatedAt: new Date().toISOString(),
  base: srv.base,
  build: buildInfo,
  summary: { passed, failed: failures.length, total: checks.length },
  failed: failures,
  detail: {
    expectedStrategies: EXPECTED_STRATEGIES,
    navObserved,
    hero: heroObserved,
    htmlPrefetchLinks,
    wiring: wiringObserved,
    oldGates,
  },
}
const outFile = join(ROOT, 'reports', 'gate-ch4.json')
mkdirSync(join(ROOT, 'reports'), { recursive: true })
writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

console.log(`gate:ch4 —— ${passed}/${checks.length} 项通过；报告：${outFile}`)
if (failures.length) {
  console.error('失败项：')
  for (const f of failures) console.error(`  - ${f}`)
  process.exitCode = 1
} else {
  console.log('gate:ch4 通过')
}
