// tests/rate-limit-leaky-bucket.test.ts —— 第 10 章：漏桶限流
import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createLeakyBucket } from '../src/ratelimit'
import { createServer, type TinyServer } from '../src/server'

const tinies: TinyServer[] = []
afterEach(async () => {
  for (const t of tinies.splice(0)) await t.close().catch(() => {})
})

describe('漏桶：注入假时钟的三段行为', () => {
  it('匀速到达（不超过漏速）全部放行', () => {
    let clock = 0
    const bucket = createLeakyBucket({ ratePerSec: 10, burst: 5, now: () => clock })
    const results: boolean[] = []
    for (let i = 0; i < 10; i++) {
      clock += 100 // 每秒 10 个 = 恰好漏速，水位不涨
      results.push(bucket.allow('ip-1').ok)
    }
    expect(results.every(Boolean)).toBe(true)
  })

  it('瞬时突发消耗 burst 额度：burst=5 时第 6 个被拒', () => {
    let clock = 1000
    const bucket = createLeakyBucket({ ratePerSec: 10, burst: 5, now: () => clock })
    const results: boolean[] = []
    for (let i = 0; i < 6; i++) results.push(bucket.allow('ip-1').ok)
    expect(results).toEqual([true, true, true, true, true, false]) // 前 5 个吃满额度，第 6 个溢出
  })

  it('水位随时间下漏：静置一秒后额度恢复', () => {
    let clock = 1000
    const bucket = createLeakyBucket({ ratePerSec: 10, burst: 5, now: () => clock })
    for (let i = 0; i < 5; i++) bucket.allow('ip-1') // 满
    expect(bucket.allow('ip-1').ok).toBe(false)

    clock += 1000 // 静置一秒：漏 10，水位 5→0
    expect(bucket.level('ip-1')).toBe(0)
    expect(bucket.allow('ip-1').ok).toBe(true)
    expect(bucket.allow('ip-1').ok).toBe(true)
    expect(bucket.allow('ip-1').ok).toBe(true)
  })

  it('拒绝时返回当前水位，给调用方做观测', () => {
    let clock = 1000
    const bucket = createLeakyBucket({ ratePerSec: 10, burst: 2, now: () => clock })
    bucket.allow('ip-1')
    bucket.allow('ip-1')
    const rejected = bucket.allow('ip-1')
    expect(rejected).toEqual({ ok: false, queue: 2 })
  })
})

describe('按 key 隔离：一人一桶', () => {
  it('A 打满不影响 B', () => {
    let clock = 1000
    const bucket = createLeakyBucket({ ratePerSec: 10, burst: 2, now: () => clock })
    bucket.allow('ip-A')
    bucket.allow('ip-A')
    expect(bucket.allow('ip-A').ok).toBe(false)
    expect(bucket.allow('ip-B').ok).toBe(true)
    expect(bucket.level('ip-A')).toBe(2)
    expect(bucket.level('ip-B')).toBe(1)
  })
})

describe('集成：tinysrv 挂上限流器', () => {
  it('第三个瞬时请求收到 503（nginx limit_req 的默认拒绝码）', async () => {
    const bucket = createLeakyBucket({ ratePerSec: 1, burst: 2 })
    const srv = createServer({
      handler: () => ({ status: 200, body: 'ok' }),
      rateLimit: bucket,
      sweepIntervalMs: Infinity,
    })
    tinies.push(srv)
    const port = await srv.start()

    const ask = async (): Promise<number> => {
      const client = net.connect(port, '127.0.0.1')
      await once(client, 'connect')
      const status = await new Promise<number>((resolve, reject) => {
        let buf = ''
        const onData = (d: Buffer) => {
          buf += d.toString('latin1')
          const end = buf.indexOf('\r\n\r\n')
          if (end === -1) return
          client.off('data', onData)
          resolve(Number(buf.split(' ')[1]))
        }
        client.on('data', onData)
        client.once('error', reject)
        client.write('GET / HTTP/1.1\r\nHost: h\r\n\r\n')
      })
      client.destroy()
      return status
    }

    expect(await ask()).toBe(200)
    expect(await ask()).toBe(200)
    expect(await ask()).toBe(503) // burst=2 已吃满，第三个被拒
  })
})
