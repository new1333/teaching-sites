import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import net from 'node:net'
import { createMiniNginx, type MiniNginxConfig, type MiniNginxServer } from '../src/index.js'
import { startMockUpstream, type Recorded } from './helpers.js'

let backendUrl = ''
let closeBackend: () => Promise<void>
let base = ''
let server: MiniNginxServer | null = null
const seen: Recorded[] = []

beforeAll(async () => {
  const backend = await startMockUpstream({
    onRequest: (rec, res) => {
      seen.push(rec)
      res.writeHead(200)
      res.end('ok')
    },
    onUpgrade: (_req, socket, head) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: k\r\n\r\n',
      )
      const reply = () => {
        socket.write(Buffer.concat([Buffer.from([0x81, 0x07]), Buffer.from('hi-back')]))
      }
      // 帧可能随握手同段到达（走 head 参数），也可能分腿到达（走 data 事件）
      if (head?.length) reply()
      else socket.once('data', reply)
      // 模拟真实 WS 服务端：对端断开即收尾，不留半开连接
      socket.on('end', () => socket.end())
    },
  })
  backendUrl = backend.url
  closeBackend = backend.close

  const config: MiniNginxConfig = {
    server: {
      locations: [
        {
          match: { type: 'prefix', path: '/api' },
          proxy_pass: backendUrl,
          proxy_set_header: { Host: 'api.internal' },
        },
        // WebSocket 不改头，纯透传
        { match: { type: 'prefix', path: '/ws' }, proxy_pass: backendUrl },
      ],
    },
  }
  server = createMiniNginx(config)
  base = (await server.listen()).url
})

afterAll(async () => {
  await server?.close()
  await closeBackend()
})

describe('ch6 代理请求头透传', () => {
  it('默认注入 X-Real-IP / X-Forwarded-For / X-Forwarded-Proto', async () => {
    await fetch(base + '/api/who')
    const h = seen.at(-1)!.headers
    expect(h['x-real-ip']).toBe('127.0.0.1')
    expect(h['x-forwarded-for']).toBe('127.0.0.1')
    expect(h['x-forwarded-proto']).toBe('http')
  })

  it('客户端伪造的 X-Forwarded-For 被追加而非覆盖', async () => {
    await fetch(base + '/api/spoof', { headers: { 'X-Forwarded-For': '203.0.113.9' } })
    expect(seen.at(-1)!.headers['x-forwarded-for']).toBe('203.0.113.9, 127.0.0.1')
  })

  it('proxy_set_header 覆盖 Host', async () => {
    await fetch(base + '/api/host')
    expect(seen.at(-1)!.headers.host).toBe('api.internal')
  })

  it('未配置覆盖时 Host 默认为 upstream 主机', async () => {
    await fetch(base + '/ws/host')
    expect(seen.at(-1)!.headers.host).toBe(new URL(backendUrl).host)
  })
})

describe('ch6 WebSocket 升级', () => {
  it('完成 101 握手并双向转发一帧', async () => {
    const u = new URL(base)
    const result = await new Promise<string>((resolve, reject) => {
      const sock = net.connect({ host: '127.0.0.1', port: Number(u.port) })
      let buf = Buffer.alloc(0)
      const fail = setTimeout(() => reject(new Error(`timeout, got: ${buf.toString('latin1')}`)), 5000)

      sock.on('connect', () => {
        sock.write(
          'GET /ws/chat HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        )
        // 一帧 masked text "hello"：payload 与 mask 01020304 逐字节异或
        sock.write(Buffer.from([0x81, 0x85, 0x01, 0x02, 0x03, 0x04, 0x69, 0x67, 0x6f, 0x68, 0x6e]))
      })
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk])
        const headEnd = buf.indexOf('\r\n\r\n')
        if (headEnd < 0) return
        const head = buf.slice(0, headEnd).toString('latin1')
        if (!head.startsWith('HTTP/1.1 101')) { clearTimeout(fail); reject(new Error(head)); return }
        const frame = buf.slice(headEnd + 4)
        if (frame.length >= 2 && frame.length >= 2 + frame[1]) {
          clearTimeout(fail)
          resolve(frame.slice(2, 2 + frame[1]).toString('latin1'))
          sock.destroy()
        }
      })
      sock.on('error', (e) => { clearTimeout(fail); reject(e) })
    })
    expect(result).toBe('hi-back')
  })
})
