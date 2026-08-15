import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { startMockUpstream, type Recorded } from './helpers.js'

let backendUrl = ''
let backend2Url = ''
let closeBackend: () => Promise<void>
let closeBackend2: () => Promise<void>
let base = ''
let server: MiniNginxServer | null = null
const seen: Recorded[] = []

beforeAll(async () => {
  const backend = await startMockUpstream((rec, res) => {
    seen.push(rec)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ path: rec.url, method: rec.method }))
  })
  backendUrl = backend.url
  closeBackend = backend.close
  const backend2 = await startMockUpstream((rec, res) => {
    seen.push(rec)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ rewritten: rec.url }))
  })
  backend2Url = backend2.url
  closeBackend2 = backend2.close

  const config: MiniNginxConfig = {
    server: {
      locations: [
        // 透传：proxy_pass 不带路径，URI 原样转发
        { match: { type: 'prefix', path: '/api' }, proxy_pass: backendUrl },
        // 改写：proxy_pass 带路径，/api/v2/ 前缀被替换为 /v2/
        { match: { type: 'prefix', path: '/api/v2/' }, proxy_pass: `${backend2Url}/v2/` },
      ],
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  await closeBackend()
  await closeBackend2()
})

describe('ch5 反向代理 proxy_pass', () => {
  it('不带路径：URI 与查询串原样透传', async () => {
    const res = await fetch(base + '/api/user?x=1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ path: '/api/user?x=1', method: 'GET' })
  })

  it('带路径：location 前缀被 proxy_pass 路径替换', async () => {
    const res = await fetch(base + '/api/v2/orders')
    expect(await res.json()).toEqual({ rewritten: '/v2/orders' })
  })

  it('POST 方法与请求体透传', async () => {
    const res = await fetch(base + '/api/echo', {
      method: 'POST',
      body: 'hello-proxy',
    })
    const rec = seen.at(-1)!
    expect(rec.method).toBe('POST')
    expect(rec.body).toBe('hello-proxy')
    expect(res.status).toBe(200)
  })

  it('自定义请求头透传', async () => {
    await fetch(base + '/api/hdr', { headers: { 'X-Custom': 'foo' } })
    expect(seen.at(-1)!.headers['x-custom']).toBe('foo')
  })

  it('上游 500 原样透传，不被网关改写', async () => {
    const errBackend = await startMockUpstream((_rec, res) => {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('boom')
    })
    try {
      const srv = createMiniNginx({
        server: { locations: [{ match: { type: 'prefix', path: '/' }, proxy_pass: errBackend.url }] },
      })
      const { url } = await srv.listen()
      const res = await fetch(url + '/anything')
      expect(res.status).toBe(500)
      expect(await res.text()).toBe('boom')
      await srv.close()
    } finally {
      await errBackend.close()
    }
  })

  it('上游拒连时网关返回 502', async () => {
    const srv = createMiniNginx({
      // 61111：大概率没有进程在监听
      server: { locations: [{ match: { type: 'prefix', path: '/' }, proxy_pass: 'http://127.0.0.1:61111' }] },
    })
    const { url } = await srv.listen()
    const res = await fetch(url + '/x')
    expect(res.status).toBe(502)
    await srv.close()
  })
})
