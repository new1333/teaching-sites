// tests/keepalive-reuse.test.ts —— 第 4 章：keep-alive 连接复用
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createServer, type TinyServer } from '../src/server'

const servers: TinyServer[] = []
afterEach(async () => {
  for (const s of servers.splice(0)) await s.close().catch(() => {})
})

interface Response {
  status: number
  headers: Record<string, string>
  body: string
}

/** 在客户端 socket 上等一个完整响应（按 Content-Length 判齐） */
function readResponse(sock: net.Socket): Promise<Response> {
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

function request(path: string, extra: string[] = []): string {
  const lines = [`GET ${path} HTTP/1.1`, 'Host: t.local', ...extra, '', '']
  return lines.join('\r\n')
}

async function connect(port: number): Promise<net.Socket> {
  const c = net.connect(port, '127.0.0.1')
  await once(c, 'connect')
  return c
}

describe('一条连接说三件事', () => {
  it('三个请求复用同一条 TCP 连接，服务端只入账一次', async () => {
    let clock = 1000
    const srv = createServer({
      handler: (h) => ({ status: 200, body: `hi ${h.path}` }),
      now: () => clock,
      sweepIntervalMs: Infinity,
    })
    servers.push(srv)
    const port = await srv.start()

    const client = await connect(port)
    for (const p of ['/a', '/b', '/c']) {
      const waiting = readResponse(client)
      client.write(request(p))
      const res = await waiting
      expect(res.status).toBe(200)
      expect(res.body).toBe(`hi ${p}`)
      expect(res.headers['connection']).toBe('keep-alive')
    }

    expect(srv.acceptedCount()).toBe(1) // 三次请求，一次拨号
    expect(srv.requestCount()).toBe(3)
    expect(srv.connections()).toBe(1) // 连接还活着，等着下一句
    client.destroy()
  })

  it('请求中途不挂断：第一个请求的响应不因等待第二个而延迟', async () => {
    const srv = createServer({
      handler: (h) => ({ status: 200, body: `hi ${h.path}` }),
      sweepIntervalMs: Infinity,
    })
    servers.push(srv)
    const port = await srv.start()
    const client = await connect(port)

    const w1 = readResponse(client)
    client.write(request('/first'))
    const r1 = await w1
    expect(r1.body).toBe('hi /first')

    const w2 = readResponse(client)
    client.write(request('/second'))
    const r2 = await w2
    expect(r2.body).toBe('hi /second')
    client.destroy()
  })
})

describe('说完挂断：keepalive 超时', () => {
  it('空闲超过 keepAliveTimeoutMs 后，服务端主动关闭', async () => {
    let clock = 1000
    const srv = createServer({
      handler: (h) => ({ status: 200, body: 'ok' }),
      keepAliveTimeoutMs: 3000,
      now: () => clock,
      sweepIntervalMs: Infinity, // 不自动扫账，测试手动 tick
    })
    servers.push(srv)
    const port = await srv.start()
    const client = await connect(port)

    const w = readResponse(client)
    client.write(request('/a'))
    expect((await w).body).toBe('ok')
    expect(srv.connections()).toBe(1)

    clock += 10_000 // 时间前进十秒：这条连接自最后活跃起已远超 3 秒
    const reaped = srv.tick()
    expect(reaped).toBe(1)

    await once(client, 'close') // 服务端挂断了
    expect(srv.connections()).toBe(0)
  })
})

describe('对方要求挂断：Connection: close', () => {
  it('请求头声明 close 时，响应后连接关闭且响应头回写 close', async () => {
    const srv = createServer({
      handler: () => ({ status: 200, body: 'bye' }),
      sweepIntervalMs: Infinity,
    })
    servers.push(srv)
    const port = await srv.start()
    const client = await connect(port)

    const w = readResponse(client)
    client.write(request('/last', ['Connection: close']))
    const res = await w
    expect(res.body).toBe('bye')
    expect(res.headers['connection']).toBe('close')

    await once(client, 'close')
    expect(srv.connections()).toBe(0)
  })
})
