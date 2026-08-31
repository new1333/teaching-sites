// 第 3 章测试：并发语义与管道。
// 反例组钉住「串行伺候会冻结后来者」——naive 版的坏行为本身就是教学对象；
// 正式组钉住里程碑「静默连接不阻塞活跃连接」「一口气发 10 条一次收回 10 条」。
import { describe, expect, it } from 'vitest'
import { MiniRedis } from '../src/db.ts'
import { connect } from '../src/client.ts'
import { createMiniRedisServer } from '../src/server.ts'
import { createNaiveMiniRedisServer } from '../src/naive-server.ts'

// 「ms 内 settle 了吗」：naive 的冻结是结构性的——没轮到的连接根本没人读，
// 不是竞速；窗口只是留出「若会回、早就回了」的余量。
function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])
}

describe('反例：naive 服务器串行伺候', () => {
  it('占着席位的客户端一切正常，后来者的 PING 无人应答', async () => {
    const server = await createNaiveMiniRedisServer(new MiniRedis(), 0)
    const holder = await connect(server.port)
    expect(await holder.cmd('PING')).toBe('+PONG\r\n') // 先确认席位归属，再请进下一位
    const queued = await connect(server.port)
    try {
      expect(await holder.cmd('SET', 'floor', 'mine')).toBe('+OK\r\n') // 占位者畅通
      expect(await within(queued.cmd('PING'), 150)).toBe('timeout') // 后来者冻结
    } finally {
      await holder.close()
      await queued.close()
      await server.close()
    }
  })

  it('占位者一离场，冻结的应答立刻解冻', async () => {
    const server = await createNaiveMiniRedisServer(new MiniRedis(), 0)
    const holder = await connect(server.port)
    expect(await holder.cmd('PING')).toBe('+PONG\r\n')
    const queued = await connect(server.port)
    try {
      const pong = queued.cmd('PING') // 发出去了，但没人伺候
      expect(await within(pong, 150)).toBe('timeout')
      await holder.close() // 占位者离场
      expect(await pong).toBe('+PONG\r\n') // 同一个 Promise 此刻解冻
    } finally {
      await queued.close()
      await server.close()
    }
  })
})

describe('事件驱动：静默连接不阻塞任何人', () => {
  it('A 连上后一言不发，B 照常 SET/GET 秒回', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const silent = await connect(server.port) // 连上，什么都不发
    const active = await connect(server.port)
    try {
      expect(await within(active.cmd('SET', 'who', 'B'), 500)).toBe('+OK\r\n')
      expect(await within(active.cmd('GET', 'who'), 500)).toBe('$1\r\nB\r\n')
    } finally {
      await silent.close()
      await active.close()
      await server.close()
    }
  })

  it('沉默者随后开口，也被照常伺候', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const silent = await connect(server.port)
    const active = await connect(server.port)
    try {
      await active.cmd('SET', 'x', '1')
      expect(await within(silent.cmd('GET', 'x'), 500)).toBe('$1\r\n1\r\n')
    } finally {
      await silent.close()
      await active.close()
      await server.close()
    }
  })
})

describe('管道：一口气发十连问，一次收回十条应答', () => {
  it('单连接一次发 10 条命令，按序收回 10 条应答', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const c = await connect(server.port)
    try {
      const batch: string[][] = []
      for (let i = 0; i < 9; i++) batch.push(['SET', `k${i}`, `v${i}`])
      batch.push(['GET', 'k0'])
      const replies = await c.pipe(...batch)
      expect(replies).toHaveLength(10)
      expect(replies.slice(0, 9)).toEqual(Array.from({ length: 9 }, () => '+OK\r\n'))
      expect(replies[9]).toBe('$2\r\nv0\r\n') // 应答顺序与命令顺序一一对应
    } finally {
      await c.close()
      await server.close()
    }
  })

  it('两条连接同时各管道十连发，应答互不串门', async () => {
    const server = await createMiniRedisServer(new MiniRedis(), 0)
    const a = await connect(server.port)
    const b = await connect(server.port)
    try {
      const mk = (tag: string) => {
        const batch: string[][] = []
        for (let i = 0; i < 9; i++) batch.push(['SET', `${tag}${i}`, `v${i}`])
        batch.push(['GET', `${tag}0`])
        return batch
      }
      const [ra, rb] = await Promise.all([a.pipe(...mk('a')), b.pipe(...mk('b'))])
      expect(ra[9]).toBe('$2\r\nv0\r\n')
      expect(rb[9]).toBe('$2\r\nv0\r\n')
      // 互不串门：各自 GET 得到的是对方管道里 SET 出来的键——两个连接共享同一个库
      expect(await a.cmd('GET', 'b0')).toBe('$2\r\nv0\r\n')
      expect(await b.cmd('GET', 'a0')).toBe('$2\r\nv0\r\n')
    } finally {
      await a.close()
      await b.close()
      await server.close()
    }
  })
})
