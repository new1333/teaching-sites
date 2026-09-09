#!/usr/bin/env node
// companion/scripts/e2e-ch2.mjs · gate:ch2 —— SSR 数据流门槛
// 自起构建产物服务器 → 断言 /products 四步链路的前三步可观测、第四步的净效果 → 反例页仍是旧形态 → 清理退出。
// 三类断言：直出事实（HTML/payload 含同源商品数据）/ 单次命中（一次 SSR 渲染只调 1 次 /api/products）/
//           反例仍在（/demo/client-fetch 保持 onMounted+$fetch 白屏路径）。
// SKIP_BUILD=1 跳过构建加速迭代（要求 .output 已存在）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBuild, startServer, ROOT } from './lib/server.mjs'
import { requestPage, getJson, extractPayloadText } from './lib/measure-core.mjs'

const failures = []
const checks = []
function check(ok, label) {
  checks.push({ ok, label })
  if (!ok) failures.push(label)
}

const round1 = (n) => Math.round(n * 10) / 10
// 与 measure 口径同源的特征串：只可能来自商品数据，不可能来自模板文案
const PROBES = ['云朵雨伞', '慢炖陶锅']

const buildInfo = await ensureBuild()
const srv = await startServer()
try {
  // ---- A. 直出事实：数据渲染进 HTML、同源数据序列化进 payload ----
  const page = await requestPage(srv.base, '/products')
  const html = page.body.toString('utf8')
  const payload = extractPayloadText(html)

  check(page.status === 200, `直出事实：/products 返回 200（实际 ${page.status}）`)
  check(
    page.ttfbMs >= 700 && page.ttfbMs <= 5000,
    `直出事实：/products TTFB 含 800ms 数据等待（SSR 等接口，实际 ${round1(page.ttfbMs)}ms）`,
  )
  for (const probe of PROBES)
    check(html.includes(probe), `直出事实：HTML 含商品名「${probe}」（数据渲染进 HTML）`)
  check(payload.length > 0, '直出事实：__NUXT_DATA__ payload 存在')
  for (const probe of PROBES)
    check(
      payload.includes(probe),
      `直出事实：payload 含同源数据「${probe}」（服务端结果序列化进 __NUXT_DATA__）`,
    )

  // ---- B. 单次命中：一次 /products 渲染只触发 1 次 /api/products（水合复用 payload，不重复请求）----
  // 必须在任何直测 /api/products 的请求之前读取，否则会混入本脚本自己的探测。
  const hitsAfterRender = await getJson(srv.base, '/api/_hits')
  check(
    (hitsAfterRender['/api/products'] ?? 0) === 1,
    `单次命中：一次 /products 渲染恰触发 1 次 /api/products（实际 ${hitsAfterRender['/api/products'] ?? 0}）`,
  )

  // ---- C. 反例仍在：/demo/client-fetch 保持基线的客户端取数形态 ----
  const demo = await requestPage(srv.base, '/demo/client-fetch')
  const demoHtml = demo.body.toString('utf8')
  check(demo.status === 200, `反例仍在：/demo/client-fetch 返回 200（实际 ${demo.status}）`)
  check(
    !PROBES.some((p) => demoHtml.includes(p)),
    '反例仍在：/demo/client-fetch 数据不在 HTML 里（onMounted+$fetch 旧形态，present=false）',
  )
  check(
    demoHtml.includes('商品加载中'),
    '反例仍在：/demo/client-fetch 首屏仍是加载壳（反例原样保留）',
  )
  const hitsAfterDemo = await getJson(srv.base, '/api/_hits')
  check(
    (hitsAfterDemo['/api/products'] ?? 0) === 1,
    `反例仍在：渲染反例页不增加服务端命中（客户端发的请求 node 代理看不到，实际 ${hitsAfterDemo['/api/products'] ?? 0}）`,
  )

  // ---- D. 同源交叉验证：HTML 与 payload 里的数据逐字来自同一次 /api/products 获取 ----
  const api = await getJson(srv.base, '/api/products')
  const summary1 = String(api[0]?.summary ?? '')
  check(
    summary1.length > 0 && html.includes(summary1) && payload.includes(summary1),
    '同源交叉：1 号商品的简介在 API 响应、HTML、payload 三处逐字一致（同一次获取）',
  )

  const passed = checks.length - failures.length
  const report = {
    command: 'pnpm gate:ch2（node scripts/e2e-ch2.mjs）',
    generatedAt: new Date().toISOString(),
    base: srv.base,
    build: buildInfo,
    summary: { passed, failed: failures.length, total: checks.length },
    failed: failures,
    products: {
      status: page.status,
      ttfbMs: round1(page.ttfbMs),
      htmlBytes: page.body.length,
      payloadBytes: Buffer.byteLength(payload, 'utf8'),
      probesInHtml: Object.fromEntries(PROBES.map((p) => [p, html.includes(p)])),
      probesInPayload: Object.fromEntries(PROBES.map((p) => [p, payload.includes(p)])),
    },
    demo: {
      status: demo.status,
      presentFalse: !PROBES.some((p) => demoHtml.includes(p)),
    },
    apiHits: hitsAfterDemo,
  }
  const outFile = join(ROOT, 'reports', 'gate-ch2.json')
  mkdirSync(join(ROOT, 'reports'), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`gate:ch2 —— ${passed}/${checks.length} 项通过；报告：${outFile}`)
  if (failures.length) {
    console.error('失败项：')
    for (const f of failures) console.error(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('gate:ch2 通过')
  }
} catch (err) {
  console.error('gate:ch2 执行异常：', err)
  process.exitCode = 1
} finally {
  await srv.stop()
}
