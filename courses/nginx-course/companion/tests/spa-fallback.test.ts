import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'

let wwwRoot = ''
let base = ''
let server: MiniNginxServer | null = null

// 模拟一份 SPA 构建产物：入口 index.html + 带名字的静态资源
beforeAll(async () => {
  wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-spa-'))
  writeFileSync(join(wwwRoot, 'index.html'), '<h1>spa-shell</h1>')
  mkdirSync(join(wwwRoot, 'assets'))
  writeFileSync(join(wwwRoot, 'assets', 'app.js'), 'console.log("app")')

  const config: MiniNginxConfig = {
    server: {
      root: wwwRoot,
      locations: [
        // 静态资源走 ^~：不吃 try_files 回退，缺失直接 404
        { match: { type: '^~', path: '/assets/' } },
        // 页面路由统一回退到 index.html
        { match: { type: 'prefix', path: '/' }, try_files: ['$uri', '/index.html'] },
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

describe('ch4 try_files 与 SPA 回退', () => {
  it('深层路由 /orders/42 回退返回 index.html（刷新不再 404）', async () => {
    const res = await fetch(base + '/orders/42')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html')
    expect(await res.text()).toBe('<h1>spa-shell</h1>')
  })

  it('真实存在的资源命中 $uri 分支，按文件返回', async () => {
    const res = await fetch(base + '/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/javascript')
  })

  it('/index.html 自身经 $uri 分支正常返回', async () => {
    expect((await fetch(base + '/index.html')).status).toBe(200)
  })

  it('^~ 静态块不回退：缺失资源直接 404', async () => {
    expect((await fetch(base + '/assets/missing.js')).status).toBe(404)
  })
})

describe('ch4 回退循环保护', () => {
  it('回退目标永不存在时返回 500 而非死循环', async () => {
    const loopRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-loop-'))
    try {
      const loopServer = createMiniNginx({
        server: {
          root: loopRoot,
          locations: [{ match: { type: 'prefix', path: '/' }, try_files: ['$uri', '/loop'] }],
        },
      })
      const { url } = await loopServer.listen()
      const res = await fetch(url + '/start')
      expect(res.status).toBe(500)
      await loopServer.close()
    } finally {
      rmSync(loopRoot, { recursive: true, force: true })
    }
  })
})
