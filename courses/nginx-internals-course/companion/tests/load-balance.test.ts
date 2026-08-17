// tests/load-balance.test.ts —— 第 9 章：负载均衡与故障转移
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createUpstreamPool, type UpstreamPeer, type UpstreamPool } from '../src/upstream'
import { createServer, type TinyServer } from '../src/server'

const tinies: TinyServer[] = []
const rawServers: net.Server[] = []

afterEach(async () => {
  for (const t of tinies.splice(0)) await t.close().catch(() => {})
  for (const s of rawServers.splice(0)) await new Promise<void>((r) => s.close(() => r()))
})

const A: UpstreamPeer = { host: '127.0.0.1', port: 4001 }
const B: UpstreamPeer = { host: '127.0.0.1', port: 4002 }
const C: UpstreamPeer = { host: '127.0.0.1', port: 4003 }

describe('轮询分发', () => {
  it('三台均分：六次挑选拿到 a,b,c,a,b,c', () => {
    const pool = createUpstreamPool({ peers: [A, B, C] })
    const got: string[] = []
    for (let i = 0; i < 6; i++) {
      const r = pool.pick()
      expect(r.ok).toBe(true)
      if (r.ok) got.push(r.peer.port === 4001 ? 'a' : r.peer.port === 4002 ? 'b' : 'c')
    }
    expect(got).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })
})

describe('失败计数与摘除', () => {
  it('连续失败达到 maxFails 被摘除，pick 自动跳过', () => {
    let clock = 1000
    const pool = createUpstreamPool({ peers: [A, B, C], maxFails: 2, failTimeoutMs: 10_000, now: () => clock })
    pool.report(B, false)
    expect(pool.isDown(B)).toBe(false) // 一次还不够
    pool.report(B, false)
    expect(pool.isDown(B)).toBe(true) // 连续两次，摘除

    const got: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = pool.pick()
      expect(r.ok).toBe(true)
      if (r.ok) got.push(r.peer.port === 4001 ? 'a' : r.peer.port === 4002 ? 'b' : 'c')
    }
    expect(got).toEqual(['a', 'c', 'a', 'c']) // b 整场缺席
  })

  it('摘除期满自动回归：再被挑中后失败重新计数', () => {
    let clock = 1000
    const pool = createUpstreamPool({ peers: [A, B, C], maxFails: 2, failTimeoutMs: 10_000, now: () => clock })
    pool.report(B, false)
    pool.report(B, false)
    expect(pool.isDown(B)).toBe(true)

    clock += 10_001 // 摘除期满
    expect(pool.isDown(B)).toBe(false)

    // 回归后挑选拿得到 b（前三台顺序里必出现）
    const picks: number[] = []
    for (let i = 0; i < 3; i++) {
      const r = pool.pick()
      if (r.ok) picks.push(r.peer.port)
    }
    expect(picks).toContain(4002)
  })

  it('成功一次就清零失败计数：断断续续的失败摘不掉', () => {
    const pool = createUpstreamPool({ peers: [A, B, C], maxFails: 2 })
    pool.report(B, false)
    pool.report(B, true) // 清零
    pool.report(B, false)
    pool.report(B, true)
    pool.report(B, false)
    expect(pool.isDown(B)).toBe(false) // 从未连续两次
  })

  it('全部摘除：pick 明确返回 all-down', () => {
    let clock = 1000
    const pool = createUpstreamPool({ peers: [A, B, C], maxFails: 1, now: () => clock })
    for (const p of [A, B, C]) pool.report(p, false)
    expect(pool.pick()).toEqual({ ok: false, reason: 'all-down' })
  })
})

describe('集成：三台后端坏一台，用户看不见', () => {
  it('一台持续失联：全部请求成功、故障机被摘除', async () => {
    // A、C 是真 upstream；B 是「起完就关」的幽灵端口
    const mkUpstream = async (body: string): Promise<number> => {
      const srv = net.createServer((s) => {
        let buf = ''
        s.on('data', (d: Buffer) => {
          buf += d.toString('latin1')
          if (!buf.includes('\r\n\r\n')) return
          s.end(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`)
        })
      })
      rawServers.push(srv)
      srv.listen(0, '127.0.0.1')
      await once(srv, 'listening')
      return (srv.address() as net.AddressInfo).port
    }
    const portA = await mkUpstream('from-a')
    const portC = await mkUpstream('from-c')
    const ghost = net.createServer()
    ghost.listen(0, '127.0.0.1')
    await once(ghost, 'listening')
    const portB = (ghost.address() as net.AddressInfo).port
    await new Promise<void>((r) => ghost.close(() => r()))

    const a: UpstreamPeer = { host: '127.0.0.1', port: portA }
    const b: UpstreamPeer = { host: '127.0.0.1', port: portB }
    const c: UpstreamPeer = { host: '127.0.0.1', port: portC }
    const pool: UpstreamPool = createUpstreamPool({ peers: [a, b, c], maxFails: 2 })

    const proxy = createServer({
      handler: () => ({ status: 500, body: 'x' }),
      upstreamPool: pool,
      sweepIntervalMs: Infinity,
    })
    tinies.push(proxy)
    const port = await proxy.start()

    const bodies: string[] = []
    for (let i = 0; i < 6; i++) {
      const client = net.connect(port, '127.0.0.1')
      await once(client, 'connect')
      const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        let buf = ''
        const onData = (d: Buffer) => {
          buf += d.toString('latin1')
          const end = buf.indexOf('\r\n\r\n')
          if (end === -1) return
          const status = Number(buf.slice(0, end).split(' ')[1])
          const len = Number(
            buf
              .slice(0, end)
              .split('\r\n')
              .find((l) => l.toLowerCase().startsWith('content-length:'))
              ?.split(':')[1]
              .trim() ?? 0,
          )
          const body = buf.slice(end + 4)
          if (body.length >= len) {
            client.off('data', onData)
            resolve({ status, body: body.slice(0, len) })
          }
        }
        client.on('data', onData)
        client.once('error', reject)
        client.write('GET /x HTTP/1.1\r\nHost: h\r\n\r\n')
      })
      expect(res.status).toBe(200)
      bodies.push(res.body)
      client.destroy()
    }

    expect(bodies).toEqual(['from-a', 'from-c', 'from-a', 'from-c', 'from-a', 'from-c']) // b 的位置全被接住
    expect(pool.isDown(b)).toBe(true) // 幽灵被摘除
  })
})
