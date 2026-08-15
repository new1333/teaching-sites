import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { startMockUpstream } from './helpers.js'

interface Backend {
  url: string
  host: string
  close: () => Promise<void>
}

async function startBackend(name: string): Promise<Backend> {
  const b = await startMockUpstream((_rec, res) => {
    res.writeHead(200)
    res.end(name)
  })
  return { url: b.url, host: new URL(b.url).host, close: b.close }
}

async function withServer(config: MiniNginxConfig, fn: (base: string, srv: MiniNginxServer) => Promise<void>) {
  const srv = createMiniNginx(config)
  const { url } = await srv.listen()
  try {
    await fn(url, srv)
  } finally {
    await srv.close()
  }
}

let a1: Backend
let a2: Backend
let b1: Backend
let b2: Backend

beforeAll(async () => {
  a1 = await startBackend('a1')
  a2 = await startBackend('a2')
  b1 = await startBackend('b1')
  b2 = await startBackend('b2')
})

afterAll(async () => {
  for (const b of [a1, a2, b1, b2]) await b.close().catch(() => {})
})

describe('ch7 upstream 负载均衡', () => {
  it('轮询：8 次请求两台上游各收 4 次', async () => {
    const counts = { a1: 0, a2: 0 }
    await withServer(
      {
        upstreams: { group: { servers: [{ host: a1.host }, { host: a2.host }] } },
        server: { locations: [{ match: { type: 'prefix', path: '/api' }, proxy_pass: 'http://group' }] },
      },
      async (base) => {
        for (let i = 0; i < 8; i++) {
          const body = await (await fetch(base + '/api/ping')).text()
          counts[body as 'a1' | 'a2']++
        }
      },
    )
    expect(counts).toEqual({ a1: 4, a2: 4 })
  })

  it('权重 2:1：6 次请求按 4/2 分发', async () => {
    const counts = { b1: 0, b2: 0 }
    await withServer(
      {
        upstreams: { weighted: { servers: [{ host: b1.host, weight: 2 }, { host: b2.host }] } },
        server: { locations: [{ match: { type: 'prefix', path: '/api' }, proxy_pass: 'http://weighted' }] },
      },
      async (base) => {
        for (let i = 0; i < 6; i++) {
          const body = await (await fetch(base + '/api/ping')).text()
          counts[body as 'b1' | 'b2']++
        }
      },
    )
    expect(counts).toEqual({ b1: 4, b2: 2 })
  })

  it('故障摘除：一台上游关闭后请求全部成功', async () => {
    const dead = await startBackend('dead')
    await dead.close() // 直接关掉，制造拒连
    await withServer(
      {
        upstreams: { fa: { servers: [{ host: a1.host }, { host: dead.host }] } },
        server: { locations: [{ match: { type: 'prefix', path: '/api' }, proxy_pass: 'http://fa' }] },
      },
      async (base) => {
        for (let i = 0; i < 4; i++) {
          const res = await fetch(base + '/api/ping')
          expect(res.status).toBe(200)
          expect(await res.text()).toBe('a1')
        }
      },
    )
  })

  it('全部不可达返回 502', async () => {
    const d1 = await startBackend('d1')
    const d2 = await startBackend('d2')
    await d1.close()
    await d2.close()
    await withServer(
      {
        upstreams: { alldead: { servers: [{ host: d1.host }, { host: d2.host }] } },
        server: { locations: [{ match: { type: 'prefix', path: '/' }, proxy_pass: 'http://alldead' }] },
      },
      async (base) => {
        expect((await fetch(base + '/x')).status).toBe(502)
      },
    )
  })

  it('down:true 的实例不参与分发', async () => {
    await withServer(
      {
        upstreams: { partial: { servers: [{ host: a1.host }, { host: a2.host, down: true }] } },
        server: { locations: [{ match: { type: 'prefix', path: '/api' }, proxy_pass: 'http://partial' }] },
      },
      async (base) => {
        for (let i = 0; i < 3; i++) {
          expect(await (await fetch(base + '/api/ping')).text()).toBe('a1')
        }
      },
    )
  })
})
