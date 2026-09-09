#!/usr/bin/env node
// companion/scripts/measure.mjs · 构建 → 起服务器 → 逐页测量首屏指标组 → 写报告
// 用法：node scripts/measure.mjs [--out reports/measure.json]；SKIP_BUILD=1 跳过构建（.output 需已存在）
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { ensureBuild, startServer, ROOT } from './lib/server.mjs'
import { measureAll } from './lib/measure-core.mjs'

// ---- 参数：--out 指定输出文件 ----
const outIdx = process.argv.indexOf('--out')
const outFile =
  outIdx > 0 && process.argv[outIdx + 1]
    ? resolve(process.argv[outIdx + 1])
    : join(ROOT, 'reports', 'measure.json')

const buildInfo = await ensureBuild()
const srv = await startServer()
try {
  const { passes, endpoints, apiHits, chaos } = await measureAll(srv.base)

  // 两遍结果合并成单页记录：字节类取 run1，同时保留两遍 TTFB 与稳定位
  const routes = passes[0].map((r1, i) => {
    const r2 = passes[1][i]
    return {
      ...r1,
      ttfbMs: { run1: r1.ttfbMs, run2: r2.ttfbMs },
      repeatStable: {
        status: r1.status === r2.status,
        htmlBytes: r1.htmlBytes === r2.htmlBytes,
        payloadBytes: r1.payloadBytes === r2.payloadBytes,
        firstLoadJsBytes: r1.firstLoadJs.bytes === r2.firstLoadJs.bytes,
        dataWithHtml: r1.dataWithHtml.present === r2.dataWithHtml.present,
      },
    }
  })

  const report = {
    tool: 'scripts/measure.mjs（node 代理指标口径：不跑浏览器 JS，浏览器口径见正文）',
    generatedAt: new Date().toISOString(),
    base: srv.base,
    build: buildInfo,
    node: process.version,
    routes,
    endpoints,
    apiHits,
    chaos,
  }

  mkdirSync(dirname(outFile), { recursive: true })
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  // 控制台摘要：一眼看全指标组
  const kb = (n) => `${(n / 1024).toFixed(1)} KiB`
  console.log(`测量对象：${srv.base}（构建：${buildInfo}）`)
  console.log('页面       状态  TTFB(run1/run2)      HTML      payload  首屏JS     数据随HTML')
  for (const r of routes) {
    console.log(
      String(r.label).padEnd(10),
      String(r.status).padEnd(5),
      `${String(r.ttfbMs.run1).padEnd(6)}/${String(r.ttfbMs.run2)} ms`.padEnd(14),
      kb(r.htmlBytes).padEnd(9),
      kb(r.payloadBytes).padEnd(8),
      kb(r.firstLoadJs.bytes).padEnd(10),
      r.dataWithHtml.present,
    )
  }
  for (const e of endpoints)
    console.log(`端点 ${e.label.padEnd(14)} 状态 ${e.status}  TTFB ${e.ttfbMs} ms`)
  console.log(`API 命中计数：${JSON.stringify(apiHits)}`)
  console.log(`报告已写入：${outFile}`)
} finally {
  await srv.stop()
}
