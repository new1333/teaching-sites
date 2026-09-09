// companion/scripts/lib/measure-core.mjs · 首屏指标组测量核心（measure.mjs 与 e2e-ch1.mjs 共用）
//
// node 代理口径（本脚本能量出的）：
//   状态码 / TTFB（请求发出→响应首字节）/ HTML 字节 / payload 字节（内联 __NUXT_DATA__）/
//   首屏 JS 字节（HTML 里声明的 _nuxt 分块大小之和）/ 数据是否随 HTML 到达 / API 命中计数。
// 浏览器口径（本脚本量不出，正文单独说明）：
//   LCP / INP / CLS 等渲染与交互指标。
import http from 'node:http'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './server.mjs'

/** 关键页面清单：path 为请求路径；probes 为“数据应出现的特征串”（静态文案也算数据面） */
export const ROUTES = [
  { label: 'home', path: '/', probes: ['蜗牛商店', '慢慢来'] },
  { label: 'products', path: '/products', probes: ['云朵雨伞', '慢炖陶锅'] },
  { label: 'detail', path: '/products/1', probes: ['云朵雨伞'] },
  { label: 'search', path: '/search?q=%E9%9B%A8', probes: ['云朵雨伞'] }, // q=雨
  { label: 'favorites', path: '/favorites', probes: ['竹柄油纸伞'] },
]

/** 直测的数据端点（默认带服务端延迟，量出来就是延迟后的 TTFB） */
export const API_ENDPOINTS = [{ label: 'api-products', path: '/api/products' }]

const round1 = (n) => Math.round(n * 10) / 10

/** 原始 HTTP GET：量状态码、TTFB（首字节）与完整响应体 */
export function requestPage(base, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base)
    const t0 = performance.now()
    const req = http.get(url, (res) => {
      const chunks = []
      let ttfbMs = null
      res.on('data', (chunk) => {
        if (ttfbMs === null) ttfbMs = performance.now() - t0
        chunks.push(chunk)
      })
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          ttfbMs: ttfbMs ?? performance.now() - t0,
          body: Buffer.concat(chunks),
        }),
      )
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

const NUXT_DATA_RE = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/

/** 提取内联 payload（Nuxt 注入的 __NUXT_DATA__ JSON）的原始文本；没有则空串 */
export function extractPayloadText(html) {
  return NUXT_DATA_RE.exec(html)?.[1] ?? ''
}

/** 提取内联 payload（Nuxt 注入的 __NUXT_DATA__ JSON）的字节数；没有则 0 */
export function extractPayloadBytes(html) {
  const text = extractPayloadText(html)
  return text ? Buffer.byteLength(text, 'utf8') : 0
}

/** 首屏 JS：HTML 里 <script src> 与 <link rel=modulepreload> 声明的 _nuxt 分块字节清单 */
export function firstLoadJs(html) {
  const urls = new Set()
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g))
    if (m[1].includes('_nuxt/') && m[1].endsWith('.js')) urls.add(m[1])
  for (const m of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1]
    if (href && href.includes('_nuxt/') && href.endsWith('.js')) urls.add(href)
  }
  const chunks = []
  let bytes = 0
  for (const u of urls) {
    const name = u.split('/').pop()
    const file = join(ROOT, '.output', 'public', '_nuxt', name)
    if (!existsSync(file)) continue
    const size = statSync(file).size
    bytes += size
    chunks.push({ file: `_nuxt/${name}`, bytes: size })
  }
  chunks.sort((a, b) => b.bytes - a.bytes)
  return { bytes, count: chunks.length, chunks }
}

/** 测单个页面：状态/TTFB/HTML 字节/payload 字节/首屏 JS/数据是否随 HTML 到达 */
export async function measureRoute(base, route) {
  const r = await requestPage(base, route.path)
  const html = r.body.toString('utf8')
  return {
    label: route.label,
    path: route.path,
    status: r.status,
    ttfbMs: round1(r.ttfbMs),
    htmlBytes: r.body.length,
    payloadBytes: extractPayloadBytes(html),
    dataWithHtml: {
      probes: route.probes,
      present: route.probes.some((p) => html.includes(p)),
    },
    firstLoadJs: firstLoadJs(html),
  }
}

export async function getJson(base, path) {
  const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json()
}

/** 全量测量：关键页面跑两遍（稳定性与重复口径证据）→ 读命中计数 → 直测端点 */
export async function measureAll(base) {
  const passes = []
  for (let i = 0; i < 2; i++) {
    const routes = []
    for (const route of ROUTES) routes.push(await measureRoute(base, route))
    passes.push(routes)
  }
  // 先读命中再直测端点：apiHits 只反映“页面请求”触发的服务端数据调用，
  // 不混入测量脚本自己对 /api/products 的探测请求。
  const apiHits = await getJson(base, '/api/_hits')
  const chaos = await getJson(base, '/api/_chaos')
  const endpoints = []
  for (const e of API_ENDPOINTS) {
    const r = await requestPage(base, e.path)
    endpoints.push({ label: e.label, path: e.path, status: r.status, ttfbMs: round1(r.ttfbMs) })
  }
  return { passes, endpoints, apiHits, chaos }
}
