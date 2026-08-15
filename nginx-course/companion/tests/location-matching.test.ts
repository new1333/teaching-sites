import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, matchLocation, type LocationBlock, type MiniNginxServer } from '../src/index.js'

const locations: LocationBlock[] = [
  { match: { type: '=', path: '/exact' }, root: '/exact-root' },
  { match: { type: 'prefix', path: '/' }, root: '/default-root' },
  { match: { type: 'prefix', path: '/api' }, root: '/api-root' },
  { match: { type: 'prefix', path: '/api/v2' }, root: '/api-v2-root' },
  { match: { type: '^~', path: '/assets/' }, root: '/assets-root' },
  { match: { type: '~', path: '\\.(js|css)$' }, root: '/static-root' },
  { match: { type: '~', path: '\\.png$' }, root: '/png-root' },
  { match: { type: '~*', path: '\\.jpg$' }, root: '/jpg-root' },
]

const rootOf = (uri: string): string => matchLocation(locations, uri)?.root ?? '(null)'

describe('ch3 location 匹配优先级', () => {
  it('精确 = 优先于一切：/exact 不落入前缀 /', () => {
    expect(rootOf('/exact')).toBe('/exact-root')
  })

  it('普通前缀取最长：/api/v2/orders 命中 /api/v2 而非先声明的 /api', () => {
    expect(rootOf('/api/v2/orders')).toBe('/api-v2-root')
    expect(rootOf('/api/orders')).toBe('/api-root')
  })

  it('正则按声明顺序优先于最长普通前缀：/app.js 命中 ~ \\.js$ 而非前缀 /', () => {
    expect(rootOf('/app.js')).toBe('/static-root')
  })

  it('^~ 阻断正则：/assets/ 下的 js/png 不再被正则抢走', () => {
    expect(rootOf('/assets/app.js')).toBe('/assets-root')
    expect(rootOf('/assets/logo.png')).toBe('/assets-root')
  })

  it('正则按声明顺序取第一个命中', () => {
    expect(rootOf('/logo.png')).toBe('/png-root')
  })

  it('~ 大小写敏感、~* 不敏感：/logo.PNG 与 /photo.JPG 分流', () => {
    expect(rootOf('/logo.PNG')).toBe('/default-root')
    expect(rootOf('/photo.JPG')).toBe('/jpg-root')
  })

  it('只有前缀兜底：/about 落入 /', () => {
    expect(rootOf('/about')).toBe('/default-root')
  })

  it('无任何命中返回 null', () => {
    expect(matchLocation([{ match: { type: 'prefix', path: '/api' }, root: '/r' }], '/about')).toBeNull()
  })
})

// 端到端：server 的确用完整优先级算法分发
describe('ch3 匹配算法接入 server', () => {
  let wwwRoot = ''
  let healthRoot = ''
  let base = ''
  let server: MiniNginxServer | null = null

  beforeAll(async () => {
    wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-m3-'))
    healthRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-h3-'))
    writeFileSync(join(wwwRoot, 'index.html'), 'home')
    writeFileSync(join(healthRoot, 'health'), 'ok') // 精确块语义：root + 完整 URI = healthRoot/health
    server = createMiniNginx({
      server: {
        root: wwwRoot,
        locations: [
          { match: { type: '=', path: '/health' }, root: healthRoot },
          { match: { type: 'prefix', path: '/' }, root: wwwRoot },
        ],
      },
    })
    base = (await server.listen()).url
  })

  afterAll(async () => {
    await server?.close()
    rmSync(wwwRoot, { recursive: true, force: true })
    rmSync(healthRoot, { recursive: true, force: true })
  })

  it('GET /health 走精确块，GET /health/x 落回前缀块', async () => {
    expect(await (await fetch(base + '/health')).text()).toBe('ok')
    expect((await fetch(base + '/health/x')).status).toBe(404)
  })
})
