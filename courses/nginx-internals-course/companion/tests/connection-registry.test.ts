// tests/connection-registry.test.ts —— 第 2 章：连接注册表
import { describe, it, expect } from 'vitest'
import net from 'node:net'
import { once } from 'node:events'
import { createConnRegistry, type SocketLike, type ManagedConn } from '../src/conn'

class FakeSocket implements SocketLike {
  remoteAddress = '127.0.0.1'
  remotePort = 40000
  private dataHandlers: ((chunk: Uint8Array) => void)[] = []
  private closeHandlers: (() => void)[] = []
  written: Uint8Array[] = []
  destroyed = false

  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'close', listener: () => void): unknown
  on(event: 'data' | 'close', listener: unknown): unknown {
    if (event === 'data') this.dataHandlers.push(listener as (chunk: Uint8Array) => void)
    else this.closeHandlers.push(listener as () => void)
    return this
  }

  write(chunk: Uint8Array): boolean {
    this.written.push(chunk)
    return true
  }

  destroy(): void {
    this.destroyed = true
  }

  emitData(chunk: Uint8Array): void {
    for (const h of this.dataHandlers) h(chunk)
  }

  emitClose(): void {
    for (const h of this.closeHandlers) h()
  }
}

function mustAdd(reg: ReturnType<typeof createConnRegistry>, sock: SocketLike): ManagedConn {
  const r = reg.add(sock)
  if (!r.ok) throw new Error('add 不应失败')
  return r.conn
}

describe('账本本身：登记与拒绝', () => {
  it('add 登记，size 如实', () => {
    const reg = createConnRegistry()
    mustAdd(reg, new FakeSocket())
    mustAdd(reg, new FakeSocket())
    expect(reg.size()).toBe(2)
  })

  it('超过 maxConns 拒绝入账并给理由', () => {
    const reg = createConnRegistry({ maxConns: 2 })
    mustAdd(reg, new FakeSocket())
    mustAdd(reg, new FakeSocket())
    const third = reg.add(new FakeSocket())
    expect(third).toEqual({ ok: false, reason: 'max-conns' })
    expect(reg.size()).toBe(2)
  })
})

describe('活跃记账：数据到达即续命', () => {
  it('data 事件转发给 onData，同时刷新 lastActiveAt', () => {
    let clock = 1000
    const reg = createConnRegistry({ now: () => clock })
    const sock = new FakeSocket()
    const conn = mustAdd(reg, sock)
    expect(conn.lastActiveAt).toBe(1000)

    const seen: string[] = []
    reg.onData((c, chunk) => seen.push(`${c.id}:${new TextDecoder().decode(chunk)}`))

    clock = 5000
    sock.emitData(new TextEncoder().encode('GET'))
    expect(conn.lastActiveAt).toBe(5000)
    expect(seen).toEqual([`${conn.id}:GET`])
  })
})

describe('空闲收割', () => {
  it('只收超过 idleTimeoutMs 的连接，活跃者留账', () => {
    let clock = 1000
    const reg = createConnRegistry({ idleTimeoutMs: 3000, now: () => clock })
    const idleSock = new FakeSocket()
    const busySock = new FakeSocket()
    const idleConn = mustAdd(reg, idleSock)
    mustAdd(reg, busySock)

    clock = 9000 // busy 在 9000 有数据，续命到 9000；idle 停在 1000
    busySock.emitData(new Uint8Array(1))

    const reaped = reg.sweepIdle(10_000) // idle 空闲 9000 > 3000 收；busy 空闲 1000 < 3000 留
    expect(reaped.map((c) => c.id)).toEqual([idleConn.id])
    expect(reg.size()).toBe(1)
  })

  it('被收割的连接销毁、onIdle 通知、账本减员', () => {
    let clock = 1000
    const reg = createConnRegistry({ idleTimeoutMs: 3000, now: () => clock })
    const sock = new FakeSocket()
    const conn = mustAdd(reg, sock)
    const idleIds: number[] = []
    reg.onIdle((c) => idleIds.push(c.id))

    const reaped = reg.sweepIdle(10_000)
    expect(sock.destroyed).toBe(true)
    expect(reaped.map((c) => c.id)).toEqual([conn.id])
    expect(idleIds).toEqual([conn.id])
    expect(reg.size()).toBe(0)
  })
})

describe('对端断开：close 清账', () => {
  it('close 事件把连接移出账本并通知 onClose', () => {
    const reg = createConnRegistry()
    const sock = new FakeSocket()
    const conn = mustAdd(reg, sock)
    const closedIds: number[] = []
    reg.onClose((c) => closedIds.push(c.id))

    sock.emitClose()
    expect(reg.size()).toBe(0)
    expect(closedIds).toEqual([conn.id])
  })
})

describe('真连接集成：127.0.0.1', () => {
  it('客户端连上即入账，断开即出账', async () => {
    const reg = createConnRegistry()
    const server = net.createServer((sock) => {
      reg.add(sock)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as net.AddressInfo).port

    const a = net.connect(port, '127.0.0.1')
    await once(a, 'connect')
    const b = net.connect(port, '127.0.0.1')
    await once(b, 'connect')
    await new Promise((r) => setTimeout(r, 100))
    expect(reg.size()).toBe(2)

    a.destroy()
    await once(a, 'close')
    await new Promise((r) => setTimeout(r, 100))
    expect(reg.size()).toBe(1)

    b.destroy()
    server.close()
  })
})
