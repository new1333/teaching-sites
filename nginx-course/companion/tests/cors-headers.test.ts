import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { startMockUpstream } from './helpers.js'

let wwwRoot = ''
let base = ''
let backendUrl = ''
let closeBackend: () => Promise<void>
let server: MiniNginxServer | null = null

beforeAll(async () => {
  wwwRoot = mkdtempSync(join(tmpdir(), 'mini-nginx-cors-'))
  writeFileSync(join(wwwRoot, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  writeFileSync(join(wwwRoot, 'plain.txt'), 'plain')
  writeFileSync(join(wwwRoot, 'shadowed.txt'), 'shadowed')
  const backend = await startMockUpstream((_rec, res) => {
    res.writeHead(200)
    res.end('api-ok')
  })
  backendUrl = backend.url
  closeBackend = backend.close

  const config: MiniNginxConfig = {
    server: {
      root: wwwRoot,
      add_header: { 'X-Frame-Options': 'DENY' }, // server 级头：应被无 add_header 的块继承
      locations: [
        // 跨域开放的静态资源
        {
          match: { type: 'prefix', path: '/img.png' },
          cors: { origin: 'https://app.example.com', methods: 'GET, POST' },
        },
        // 有自己 add_header 的块：server 级头被整体遮蔽（nginx 继承陷阱）
        {
          match: { type: 'prefix', path: '/shadowed.txt' },
          add_header: { 'X-Local': 'yes' },
        },
        // 普通代理块 + add_header
        {
          match: { type: 'prefix', path: '/api' },
          proxy_pass: backendUrl,
          add_header: { 'X-Gateway': 'mini' },
        },
      ],
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  await closeBackend()
  rmSync(wwwRoot, { recursive: true, force: true })
})

describe('ch10 add_header 与 CORS', () => {
  it('server 级 add_header 被无自有头的块继承', async () => {
    const res = await fetch(base + '/plain.txt')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })

  it('nginx 继承陷阱：块内出现 add_header 即遮蔽全部继承头', async () => {
    const res = await fetch(base + '/shadowed.txt')
    expect(res.headers.get('x-local')).toBe('yes')
    expect(res.headers.get('x-frame-options')).toBeNull()
  })

  it('cors 配置为响应注入 Access-Control-Allow-Origin', async () => {
    const res = await fetch(base + '/img.png', {
      headers: { Origin: 'https://app.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
  })

  it('OPTIONS 预检被网关应答：204 + Allow-* 头', async () => {
    const res = await fetch(base + '/img.png', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com')
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(res.headers.get('access-control-allow-headers')).toBeTruthy()
  })

  it('未配置 cors 的块不输出跨源头', async () => {
    const res = await fetch(base + '/plain.txt', {
      headers: { Origin: 'https://app.example.com' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('add_header 同样作用于代理响应', async () => {
    const res = await fetch(base + '/api/user')
    expect(await res.text()).toBe('api-ok')
    expect(res.headers.get('x-gateway')).toBe('mini')
  })
})
