import { describe, expect, it, vi } from 'vitest'
import { createMemoryChannelPair } from '../src/channel'
import type { Channel } from '../src/channel'
import { createRpc } from '../src/rpc'

describe('createMemoryChannelPair', () => {
  it('全双工：A 发 B 收，B 发 A 收', () => {
    const [a, b] = createMemoryChannelPair()
    const gotA: unknown[] = []
    const gotB: unknown[] = []
    a.on(data => gotA.push(data))
    b.on(data => gotB.push(data))

    a.post('to-b')
    b.post('to-a')

    expect(gotB).toEqual(['to-b'])
    expect(gotA).toEqual(['to-a'])
  })
})

describe('createRpc', () => {
  it('基本调用：请求过通道，结果按 promise 返回', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    const server = createRpc({
      add: (a: number, b: number) => a + b,
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('add', 1, 2)).resolves.toBe(3)
    void server
  })

  it('参数逐个透传', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    createRpc({
      echo3: (a: unknown, b: unknown, c: unknown) => [a, b, c],
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('echo3', 'x', 42, true)).resolves.toEqual(['x', 42, true])
  })

  it('服务端函数抛错：promise reject 且带错误信息', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    createRpc({
      boom: () => {
        throw new Error('server exploded')
      },
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('boom')).rejects.toThrow('server exploded')
  })

  it('对端没有这个方法：reject 而不是悬挂', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    createRpc({}, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('nonexistent')).rejects.toThrow(/nonexistent/)
  })

  it('双向：两侧互为客户端与服务端', async () => {
    const [kitChannel, uiChannel] = createMemoryChannelPair()
    const kit = createRpc({
      getTree: () => ['root', 'list'],
    }, kitChannel)
    const ui = createRpc({
      refresh: (reason: string) => `refreshed:${reason}`,
    }, uiChannel)

    await expect(ui.call('getTree')).resolves.toEqual(['root', 'list'])
    await expect(kit.call('refresh', 'tree-changed')).resolves.toBe('refreshed:tree-changed')
  })

  it('并发请求：响应按各自 id 配对，不串线', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    createRpc({
      slow: () => new Promise(resolve => setTimeout(() => resolve('slow-result'), 30)),
      fast: () => new Promise(resolve => setTimeout(() => resolve('fast-result'), 5)),
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    const [slow, fast] = await Promise.all([
      client.call('slow'),
      client.call('fast'),
    ])

    expect(slow).toBe('slow-result')        // 慢的拿到慢的结果
    expect(fast).toBe('fast-result')        // 快的先回也没串到慢的
  })

  it('永不超时：晚到的响应仍然被接住', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    createRpc({
      lazy: () => new Promise(resolve => setTimeout(() => resolve('late'), 120)),
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('lazy')).resolves.toBe('late')   // 120ms 后照样 resolve
  })

  it('请求载荷是纯数据（可 JSON 过桥）', async () => {
    const seen: unknown[] = []
    let serverHandler: (data: unknown) => void = () => {}
    let clientHandler: (data: unknown) => void = () => {}
    const clientChannel: Channel = {
      post: (data) => {
        seen.push(data)                       // 窃听出站的请求
        serverHandler(data)
      },
      on: (handler) => {
        clientHandler = handler
      },
    }
    const serverChannel: Channel = {
      post: (data) => {
        clientHandler(data)
      },
      on: (handler) => {
        serverHandler = handler
      },
    }
    createRpc({ ping: () => 'pong' }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('ping')).resolves.toBe('pong')
    expect(() => JSON.stringify(seen[0])).not.toThrow()
    const payload = JSON.parse(JSON.stringify(seen[0])) as { type: string, method: string }
    expect(payload.type).toBe('request')
    expect(payload.method).toBe('ping')
  })

  it('响应方抛错时消息也回得来（不会卡死对端）', async () => {
    const [clientChannel, serverChannel] = createMemoryChannelPair()
    const handler = vi.fn()
    createRpc({
      ok: () => 'fine',
    }, serverChannel)
    const client = createRpc({}, clientChannel)

    await expect(client.call('ok')).resolves.toBe('fine')
    expect(handler).not.toHaveBeenCalled()
  })
})
