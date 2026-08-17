// tests/reverse-proxy.test.ts —— 第 8 章：反向代理
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createServer, type TinyServer } from '../src/server'

const servers: net.Server[] = []
const tinies: TinyServer[] = []

afterEach(async () => {
  for (const s of tinies.splice(0)) await s.close().catch(() => {})
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()))
})

/** 起一个手写 HTTP upstream：记录收到的请求头，回固定响应 */
async function startUpstream(body: string): Promise<{
  port: number
  hits: { headers: Record<string, string>; remotePort: number }[]
  connectionCount: () => number
}> {
  const hits: { headers: Record<string, string>; remotePort: number }[] = []
  let connections = 0
  const srv = net.createServer((sock) => {
    connections++
    let buf = ''
    sock.on('data', (d: Buffer) => {
      buf += d.toString('latin1')
      const end = buf.indexOf('\r\n\r\n')
      if (end === -1) return
      const lines = buf.slice(0, end).split('\r\n')
      const headers: Record<string, string> = {}
      for (const l of lines.slice(1)) {
        const c = l.indexOf(':')
        headers[l.slice(0, c).trim().toLowerCase()] = l.slice(c + 1).trim()
      }
      hits.push({ headers, remotePort: sock.remotePort ?? 0 })
      sock.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`)
    })
  })
  servers.push(srv)
  srv.listen(0, '127.0.0.1')
  await once(srv, 'listening')
  return { port: (srv.address() as net.AddressInfo).port, hits, connectionCount: () => connections }
}

function readResponse(sock: net.Socket): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (d: Buffer) => {
      buf += d.toString('latin1')
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const lines = buf.slice(0, headerEnd).split('\r\n')
      const status = Number(lines[0].split(' ')[1])
      const headers: Record<string, string> = {}
      for (const l of lines.slice(1)) {
        const c = l.indexOf(':')
        headers[l.slice(0, c).trim().toLowerCase()] = l.slice(c + 1).trim()
      }
      const len = Number(headers['content-length'] ?? 0)
      const body = buf.slice(headerEnd + 4)
      if (body.length >= len) {
        sock.off('data', onData)
        resolve({ status, headers, body: body.slice(0, len) })
      }
    }
    sock.on('data', onData)
    sock.once('error', reject)
  })
}

describe('双跳全链路：客户端 → tinysrv → 真实 upstream', () => {
  it('请求经代理转发，响应完整回写，upstream 收到代理发起的新连接', async () => {
    const up = await startUpstream('hello-from-upstream')
    const proxy = createServer({
      handler: () => ({ status: 500, body: 'should-not-here' }), // 配了 proxy 就不该走到 handler
      proxy: { host: '127.0.0.1', port: up.port },
      sweepIntervalMs: Infinity,
    })
    tinies.push(proxy)
    const port = await proxy.start()

    const client = net.connect(port, '127.0.0.1')
    await once(client, 'connect')
    const waiting = readResponse(client)
    client.write('GET /orders HTTP/1.1\r\nHost: shop.local\r\n\r\n')
    const res = await waiting

    // 响应体原样到达
    expect(res.status).toBe(200)
    expect(res.body).toBe('hello-from-upstream')

    // upstream 侧：收到的是代理发起的连接，且请求被盖了「经过前台」的邮戳
    expect(up.hits).toHaveLength(1)
    expect(up.hits[0].headers['host']).toBe('shop.local') // 原请求头透传
    expect(up.hits[0].headers['x-forwarded-for']).toContain('127.0.0.1') // 邮戳
    client.destroy()
  })

  it('多个请求各自打一条上游连接（简化实现：无上游连接池）', async () => {
    const up = await startUpstream('multi')
    const proxy = createServer({
      handler: () => ({ status: 500, body: 'x' }),
      proxy: { host: '127.0.0.1', port: up.port },
      sweepIntervalMs: Infinity,
    })
    tinies.push(proxy)
    const port = await proxy.start()

    for (let i = 0; i < 3; i++) {
      const c = net.connect(port, '127.0.0.1')
      await once(c, 'connect')
      const w = readResponse(c)
      c.write(`GET /r${i} HTTP/1.1\r\nHost: h\r\n\r\n`)
      expect((await w).body).toBe('multi')
      c.destroy()
    }
    expect(up.connectionCount()).toBe(3) // 每请求一条上游连接
    expect(proxy.requestCount()).toBe(3)
  })
})

describe('上游失联', () => {
  it('upstream 拒接时，客户端收到结构化的 502，而不是挂死', async () => {
    // 先起一个 upstream 拿端口，然后关掉它——制造「无人监听」
    const ghost = net.createServer()
    ghost.listen(0, '127.0.0.1')
    await once(ghost, 'listening')
    const deadPort = (ghost.address() as net.AddressInfo).port
    await new Promise<void>((r) => ghost.close(() => r()))

    const proxy = createServer({
      handler: () => ({ status: 500, body: 'x' }),
      proxy: { host: '127.0.0.1', port: deadPort },
      sweepIntervalMs: Infinity,
    })
    tinies.push(proxy)
    const port = await proxy.start()

    const client = net.connect(port, '127.0.0.1')
    await once(client, 'connect')
    const waiting = readResponse(client)
    client.write('GET /x HTTP/1.1\r\nHost: h\r\n\r\n')
    const res = await waiting
    expect(res.status).toBe(502)
    client.destroy()
  })
})
