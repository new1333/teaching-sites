import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'

let wwwRoot = ''
let altRoot = ''
let base = ''
let server: MiniNginxServer | null = null

async function get(path: string): Promise<{ status: number; type: string | null; body: string }> {
  const res = await fetch(base + path)
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() }
}

// fetch 会把 URL 里的 ../ 规范化掉，穿越路径必须用原生 http 直发原始路径
function rawGet(path: string): Promise<number | undefined> {
  const u = new URL(base)
  return new Promise((resolve) => {
    const req = http.request({ host: u.hostname, port: u.port, path }, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    req.on('error', () => resolve(undefined))
    req.end()
  })
}

beforeAll(async () => {
  wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-www-'))
  altRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-alt-'))
  writeFileSync(join(wwwRoot, 'index.html'), '<h1>home</h1>')
  writeFileSync(join(wwwRoot, 'app.js'), 'console.log("app")')
  writeFileSync(join(wwwRoot, 'style.css'), 'body{color:red}')
  mkdirSync(join(wwwRoot, 'img'))
  writeFileSync(join(wwwRoot, 'img', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  mkdirSync(join(altRoot, 'docs'))
  writeFileSync(join(altRoot, 'docs', 'guide.html'), '<h1>guide</h1>')

  const config: MiniNginxConfig = {
    server: {
      root: wwwRoot,
      locations: [{ match: { type: 'prefix', path: '/docs' }, root: altRoot }],
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  rmSync(wwwRoot, { recursive: true, force: true })
  rmSync(altRoot, { recursive: true, force: true })
})

describe('ch2 静态文件服务：root / index / MIME', () => {
  it('GET / 命中默认 index，返回 index.html', async () => {
    const r = await get('/')
    expect(r.status).toBe(200)
    expect(r.type).toBe('text/html')
    expect(r.body).toBe('<h1>home</h1>')
  })

  it('显式请求 /index.html 同样返回', async () => {
    const r = await get('/index.html')
    expect(r.status).toBe(200)
    expect(r.body).toBe('<h1>home</h1>')
  })

  it('JS 文件返回 application/javascript（不再被当成文本）', async () => {
    const r = await get('/app.js')
    expect(r.status).toBe(200)
    expect(r.type).toBe('application/javascript')
  })

  it('CSS 与 PNG 各自返回正确 MIME', async () => {
    expect((await get('/style.css')).type).toBe('text/css')
    expect((await get('/img/logo.png')).type).toBe('image/png')
  })

  it('不存在的文件返回 404', async () => {
    expect((await get('/missing.js')).status).toBe(404)
  })

  it('目录穿越路径返回 403', async () => {
    expect(await rawGet('/img/../../etc/passwd')).toBe(403)
    expect(await rawGet('/%2e%2e/secret')).toBe(403)
  })

  it('location 级 root 覆盖 server 级 root', async () => {
    const r = await get('/docs/guide.html')
    expect(r.status).toBe(200)
    expect(r.body).toBe('<h1>guide</h1>')
    expect((await get('/docs/nope.html')).status).toBe(404)
  })
})
