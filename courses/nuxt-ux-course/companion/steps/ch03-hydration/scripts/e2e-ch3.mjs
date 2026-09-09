#!/usr/bin/env node
// companion/scripts/e2e-ch3.mjs · gate:ch3 —— 水合瘦身门槛
// 自起构建产物服务器 → 断言：①详情页首屏 JS 显著低于同步引入记录 ②图表组件分块被动态导入且不在首屏清单
// ③Lazy 引入后详情页 SSR 直出不回退（数据与图表本体都在 HTML 里）④全站其他页面首屏 JS 不量级回退 → 清理退出。
// SKIP_BUILD=1 跳过构建加速迭代（要求 .output 已存在）。
import { mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBuild, startServer, ROOT } from './lib/server.mjs'
import { requestPage, getJson, extractPayloadText, firstLoadJs } from './lib/measure-core.mjs'

const failures = []
const checks = []
function check(ok, label) {
  checks.push({ ok, label })
  if (!ok) failures.push(label)
}

const round1 = (n) => Math.round(n * 10) / 10
const PROBE = '云朵雨伞' // 只可能来自商品数据，不可能来自模板文案

// ---- 写死的对照数字（两处口径，来源都在伴生仓存档里）----
// 1) 同步引入实测：演练第一步把价格走势图同步 import 进详情页后，存档
//    reports/measure-sync-chart.json 里 /products/1 的 firstLoadJs——「变胖」的账。
const SYNC_DETAIL_FIRSTLOAD_JS = 211_299
// 显著下降线：Lazy 分割后至少比同步记录低 8 KiB（搬出的是整个图表分块）。
const LAZY_MAX_DETAIL_FIRSTLOAD_JS = SYNC_DETAIL_FIRSTLOAD_JS - 8 * 1024
// 2) 存档对照：reports/measure.json（第 2 章末态）里各页面 firstLoadJs。
//    「不回退」允许 2 KiB 容差：注册新组件 + 延迟水合运行时让共享分块每页约 +1.3 KiB（正文有账），
//    量级回退（整块图表代码混进别的页面首屏）仍然会被拦下。
const OTHER_PAGES_CEILING = {
  home: 189_902,
  products: 199_183,
  search: 191_465,
  favorites: 190_733,
}
const CEILING_TOLERANCE = 2 * 1024
// 图表分块认定：含 price-trend-chart 标记（组件模板里的静态类名，minify 后保留）且 ≥ 8 KiB。
const CHART_MARKER = 'price-trend-chart'
const CHART_MIN_BYTES = 8 * 1024

const buildInfo = await ensureBuild()
const srv = await startServer()
try {
  // ---- A. 瘦身事实：详情页首屏 JS 显著低于同步引入记录 ----
  const page = await requestPage(srv.base, '/products/1')
  const html = page.body.toString('utf8')
  const payload = extractPayloadText(html)
  const detailJs = firstLoadJs(html)

  check(
    detailJs.bytes <= LAZY_MAX_DETAIL_FIRSTLOAD_JS,
    `瘦身事实：详情页首屏 JS ${detailJs.bytes} B 低于同步引入记录 ${SYNC_DETAIL_FIRSTLOAD_JS} B 至少 8 KiB（实际省 ${SYNC_DETAIL_FIRSTLOAD_JS - detailJs.bytes} B）`,
  )

  // ---- B. 分割事实：图表代码在独立分块里、被动态导入、不在首屏清单 ----
  const nuxtDir = join(ROOT, '.output', 'public', '_nuxt')
  const chartChunks = []
  for (const f of readdirSync(nuxtDir)) {
    if (!f.endsWith('.js')) continue
    const text = readFileSync(join(nuxtDir, f), 'utf8')
    if (text.includes(CHART_MARKER))
      chartChunks.push({ file: f, bytes: statSync(join(nuxtDir, f)).size })
  }
  const fattest = chartChunks.reduce((a, b) => (b.bytes > a.bytes ? b : a), {
    file: '(none)',
    bytes: 0,
  })
  check(
    chartChunks.length > 0 && fattest.bytes >= CHART_MIN_BYTES,
    `分割事实：图表分块存在且为重组件（含 ${CHART_MARKER} 标记，最大分块 ${fattest.file} ${fattest.bytes} B ≥ 8 KiB）`,
  )
  const firstLoadNames = detailJs.chunks.map((c) => c.file.replace('_nuxt/', ''))
  const inFirstLoad = chartChunks.filter((c) => firstLoadNames.includes(c.file))
  check(
    chartChunks.length > 0 && inFirstLoad.length === 0,
    `分割事实：图表分块不在详情页首屏加载清单（清单 ${detailJs.count} 块：${firstLoadNames.join('、')}）`,
  )
  // 动态导入形态：minify 后是 import(`./name.js`)（反引号）或 import("./name.js")
  const dynamicRefChunk = firstLoadNames
    .map((name) => {
      const text = readFileSync(join(nuxtDir, name), 'utf8')
      const hit = chartChunks.some((c) =>
        text.includes(`import(\`./${c.file}\`)`) || text.includes(`import("./${c.file}")`),
      )
      return hit ? name : null
    })
    .filter(Boolean)
  check(
    chartChunks.length > 0 && dynamicRefChunk.length > 0,
    `分割事实：图表分块以动态导入被引用（import() 形态见于首屏分块 ${dynamicRefChunk.join('、') || '(none)'}）`,
  )
  // 路由表自己的动态组件清单（「import(...) 后紧跟 name:」的形态）：页面分块也是动态导入的，
  // 区别在于组件分块不在路由表里——同步引入时图表代码会并进某个路由分块，这一条就会红。
  const routeChunks = new Set()
  for (const f of readdirSync(nuxtDir)) {
    if (!f.endsWith('.js')) continue
    const text = readFileSync(join(nuxtDir, f), 'utf8')
    const re = /import\(`\.\/([^`]+\.js)`\)[\s\S]{0,150}?name:`/g
    let m
    while ((m = re.exec(text))) routeChunks.add(m[1])
  }
  const chartRouteChunks = chartChunks.filter((c) => routeChunks.has(c.file))
  check(
    chartChunks.length > 0 && chartRouteChunks.length === 0,
    `分割事实：图表分块不是路由页面分块（路由表分块 ${[...routeChunks].join('、')}，图表命中 0 个）`,
  )

  // ---- C. 直出不回退：Lazy 只推迟 JS，数据与图表本体仍随 HTML 到达 ----
  check(page.status === 200, `直出不回退：/products/1 返回 200（实际 ${page.status}）`)
  check(
    page.ttfbMs >= 400 && page.ttfbMs <= 5000,
    `直出不回退：TTFB 含 500ms 数据等待（SSR 等详情接口，实际 ${round1(page.ttfbMs)}ms）`,
  )
  check(html.includes(PROBE), `直出不回退：HTML 含商品名「${PROBE}」（数据仍直出）`)
  check(
    payload.includes(PROBE),
    `直出不回退：payload 含同源数据「${PROBE}」（水合仍复用 payload）`,
  )
  check(
    html.includes(CHART_MARKER),
    `直出不回退：HTML 含图表本体（${CHART_MARKER} 标记在 SSR 输出里）`,
  )
  // 必须在任何直测 /api/products/:id 之前读取，否则会混入本脚本自己的探测
  const hits = await getJson(srv.base, '/api/_hits')
  check(
    (hits['/api/products/:id'] ?? 0) === 1,
    `直出不回退：一次详情渲染恰触发 1 次 /api/products/:id（实际 ${hits['/api/products/:id'] ?? 0}）`,
  )

  // ---- D. 全站不回退：其他页面首屏 JS 不超过存档 + 1 KiB 注册容差 ----
  for (const [label, ceiling] of Object.entries(OTHER_PAGES_CEILING)) {
    const path = { home: '/', products: '/products', search: '/search?q=%E9%9B%A8', favorites: '/favorites' }[label]
    const r = await requestPage(srv.base, path)
    const js = firstLoadJs(r.body.toString('utf8'))
    check(
      js.bytes <= ceiling + CEILING_TOLERANCE,
      `全站不回退：${label} 首屏 JS ${js.bytes} B ≤ 存档 ${ceiling} B + 2 KiB 容差`,
    )
  }

  const passed = checks.length - failures.length
  const report = {
    command: 'pnpm gate:ch3（node scripts/e2e-ch3.mjs）',
    generatedAt: new Date().toISOString(),
    base: srv.base,
    build: buildInfo,
    summary: { passed, failed: failures.length, total: checks.length },
    failed: failures,
    detail: {
      status: page.status,
      ttfbMs: round1(page.ttfbMs),
      htmlBytes: page.body.length,
      payloadBytes: Buffer.byteLength(payload, 'utf8'),
      firstLoadJs: { ...detailJs, syncRecord: SYNC_DETAIL_FIRSTLOAD_JS, saved: SYNC_DETAIL_FIRSTLOAD_JS - detailJs.bytes },
    },
    chartChunks,
    apiHits: hits,
  }
  const outFile = join(ROOT, 'reports', 'gate-ch3.json')
  mkdirSync(join(ROOT, 'reports'), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`gate:ch3 —— ${passed}/${checks.length} 项通过；报告：${outFile}`)
  if (failures.length) {
    console.error('失败项：')
    for (const f of failures) console.error(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('gate:ch3 通过')
  }
} catch (err) {
  console.error('gate:ch3 执行异常：', err)
  process.exitCode = 1
} finally {
  await srv.stop()
}
