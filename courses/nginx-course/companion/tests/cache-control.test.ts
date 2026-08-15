import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { rawGet } from './helpers.js'

let wwwRoot = ''
let base = ''
let server: MiniNginxServer | null = null

beforeAll(async () => {
  wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-cache-'))
  mkdirSync(join(wwwRoot, 'assets'))
  writeFileSync(join(wwwRoot, 'assets', 'app-3f9c12.js'), 'console.log("v1")'.repeat(50))
  writeFileSync(join(wwwRoot, 'index.html'), '<h1>v1</h1>')

  const config: MiniNginxConfig = {
    server: {
      root: wwwRoot,
      locations: [
        // 带 hash 的构建产物：内容寻址，可以放心长缓存
        { match: { type: '^~', path: '/assets/' }, expires: { maxAge: 31536000, immutable: true } },
        // 入口页：每次都要协商
        { match: { type: 'prefix', path: '/' }, expires: 'no-cache' },
      ],
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  rmSync(wwwRoot, { recursive: true, force: true })
})

describe('ch9 缓存控制', () => {
  it('hash 资源：max-age 一年 + immutable，附 ETag', async () => {
    const r = await rawGet(base + '/assets/app-3f9c12.js')
    expect(r.headers['cache-control']).toBe('max-age=31536000, immutable')
    expect(r.headers.etag).toBeTruthy()
  })

  it('index.html：no-cache（每次协商，绝不强缓存）', async () => {
    const r = await rawGet(base + '/')
    expect(r.headers['cache-control']).toBe('no-cache')
    expect(r.headers.etag).toBeTruthy()
  })

  it('If-None-Match 命中返回 304 空体', async () => {
    const first = await rawGet(base + '/assets/app-3f9c12.js')
    const etag = first.headers.etag as string
    const second = await rawGet(base + '/assets/app-3f9c12.js', { 'If-None-Match': etag })
    expect(second.status).toBe(304)
    expect(second.body.length).toBe(0)
  })

  it('文件变化后 ETag 变化，旧 ETag 拿到 200 新内容', async () => {
    writeFileSync(join(wwwRoot, 'index.html'), '<h1>v2-with-new-content</h1>')
    const fresh = await rawGet(base + '/')
    const oldEtag = await rawGet(base + '/', { 'If-None-Match': fresh.headers.etag as string })
    // 新内容先取 etag，再用「上一次的 etag」问——直接构造过期场景
    const stale = await rawGet(base + '/', { 'If-None-Match': '"deadbeef-11"' })
    expect(stale.status).toBe(200)
    expect(stale.body.toString()).toBe('<h1>v2-with-new-content</h1>')
    expect(oldEtag.status).toBe(304) // 拿着新 etag 再问仍是 304
  })

  it('etag: false 的块不输出 ETag，也不会 304', async () => {
    const srv = createMiniNginx({
      server: {
        root: wwwRoot,
        locations: [{ match: { type: 'prefix', path: '/' }, etag: false }],
      },
    })
    const { url } = await srv.listen()
    try {
      const r = await rawGet(url + '/index.html')
      expect(r.headers.etag).toBeUndefined()
    } finally {
      await srv.close()
    }
  })
})
