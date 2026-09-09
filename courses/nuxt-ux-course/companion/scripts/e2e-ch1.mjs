#!/usr/bin/env node
// companion/scripts/e2e-ch1.mjs · gate:ch1 —— 指标组门槛
// 自起构建产物服务器 → 复测指标组 → 断言：口径完整 / 数值合理 / 重复稳定 / 基线事实成立 → 清理退出。
// SKIP_BUILD=1 跳过构建加速迭代（要求 .output 已存在）。
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureBuild, startServer, ROOT } from './lib/server.mjs'
import { measureAll } from './lib/measure-core.mjs'

const failures = []
const checks = []
function check(ok, label) {
  checks.push({ ok, label })
  if (!ok) failures.push(label)
}

const buildInfo = await ensureBuild()
const srv = await startServer()
try {
  const { passes, endpoints, apiHits, chaos } = await measureAll(srv.base)
  const [run1, run2] = passes

  // ---- A. 口径完整：每个页面都要给出指标组的全部字段，且类型可判定 ----
  const REQUIRED = ['status', 'ttfbMs', 'htmlBytes', 'payloadBytes', 'firstLoadJs', 'dataWithHtml']
  for (const r of run1) {
    for (const key of REQUIRED)
      check(r[key] !== undefined, `口径完整：${r.label}.${key} 存在`)
    check(Number.isFinite(r.ttfbMs), `口径完整：${r.label}.ttfbMs 是数值`)
    check(Number.isFinite(r.htmlBytes) && r.htmlBytes > 0, `口径完整：${r.label}.htmlBytes 为正数`)
    check(
      Number.isFinite(r.payloadBytes) && r.payloadBytes >= 0,
      `口径完整：${r.label}.payloadBytes 已提取`,
    )
    check(
      Number.isFinite(r.firstLoadJs.bytes) && r.firstLoadJs.bytes > 0,
      `口径完整：${r.label}.firstLoadJs.bytes 为正数`,
    )
    check(typeof r.dataWithHtml.present === 'boolean', `口径完整：${r.label}.dataWithHtml 可判定`)
  }
  check(Array.isArray(endpoints) && endpoints.length === 1, '口径完整：数据端点已直测')

  // ---- B. 数值合理：全部 200，页面 TTFB 在 SSR 壳渲染的合理区间 ----
  for (const r of run1) {
    check(r.status === 200, `数值合理：${r.label} 返回 200（实际 ${r.status}）`)
    check(r.ttfbMs >= 0 && r.ttfbMs < 2000, `数值合理：${r.label} TTFB < 2000ms（实际 ${r.ttfbMs}）`)
  }

  // ---- C. 基线事实：蜗牛商店第 1 章的刻意设计必须如实反映在数字里 ----
  const byLabel = Object.fromEntries(run1.map((r) => [r.label, r]))
  check(
    byLabel.home.dataWithHtml.present === true,
    '基线事实：首页静态内容随 HTML 直出（present=true）',
  )
  for (const label of ['products', 'detail', 'search', 'favorites'])
    check(
      byLabel[label].dataWithHtml.present === false,
      `基线事实：${label} 数据不在 HTML 里（客户端取数反例，present=false）`,
    )
  for (const endpoint of ['/api/products', '/api/products/:id', '/api/search', '/api/favorites'])
    check(
      (apiHits[endpoint] ?? 0) === 0,
      `基线事实：node 直取页面时 ${endpoint} 命中 0 次（客户端发的请求 node 代理看不到）`,
    )
  const api = endpoints.find((e) => e.label === 'api-products')
  check(api.status === 200, '基线事实：/api/products 返回 200')
  check(
    api.ttfbMs >= 750 && api.ttfbMs <= 5000,
    `基线事实：/api/products TTFB 落在注入延迟 800ms 附近（实际 ${api.ttfbMs}ms）`,
  )
  check(
    chaos.delayMs === null && chaos.fail === 'none',
    '基线事实：测量时故障开关处于默认态（delayMs=null, fail=none）',
  )
  check(
    chaos.defaultDelays['/api/products'] === 800,
    '基线事实：默认延迟表 /api/products=800ms（基线口径的一部分）',
  )

  // ---- D. 重复稳定：两遍测量的可重复字段逐一相等；TTFB 差异可用容忍带解释 ----
  run1.forEach((r1, i) => {
    const r2 = run2[i]
    check(r1.status === r2.status, `重复稳定：${r1.label} 状态两遍一致`)
    check(r1.htmlBytes === r2.htmlBytes, `重复稳定：${r1.label} HTML 字节两遍一致`)
    check(r1.payloadBytes === r2.payloadBytes, `重复稳定：${r1.label} payload 字节两遍一致`)
    check(
      r1.firstLoadJs.bytes === r2.firstLoadJs.bytes,
      `重复稳定：${r1.label} 首屏 JS 字节两遍一致`,
    )
    check(
      r1.dataWithHtml.present === r2.dataWithHtml.present,
      `重复稳定：${r1.label} 数据随 HTML 判定两遍一致`,
    )
    const drift = Math.abs(r1.ttfbMs - r2.ttfbMs)
    check(
      drift <= Math.max(150, r1.ttfbMs * 0.8),
      `重复稳定：${r1.label} TTFB 两遍差异 ${drift.toFixed(1)}ms 在容忍带内`,
    )
  })

  const passed = checks.length - failures.length
  const report = {
    command: 'pnpm gate:ch1（node scripts/e2e-ch1.mjs）',
    generatedAt: new Date().toISOString(),
    base: srv.base,
    build: buildInfo,
    summary: { passed, failed: failures.length, total: checks.length },
    failed: failures,
    routes: run1.map((r, i) => ({
      ...r,
      ttfbMs: { run1: r.ttfbMs, run2: run2[i].ttfbMs },
    })),
    endpoints,
    apiHits,
    chaos,
  }
  const outFile = join(ROOT, 'reports', 'gate-ch1.json')
  mkdirSync(join(ROOT, 'reports'), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(`gate:ch1 —— ${passed}/${checks.length} 项通过；报告：${outFile}`)
  if (failures.length) {
    console.error('失败项：')
    for (const f of failures) console.error(`  - ${f}`)
    process.exitCode = 1
  } else {
    console.log('gate:ch1 通过')
  }
} catch (err) {
  console.error('gate:ch1 执行异常：', err)
  process.exitCode = 1
} finally {
  await srv.stop()
}
