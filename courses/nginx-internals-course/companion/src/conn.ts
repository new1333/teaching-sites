// src/conn.ts —— 连接注册表：把连接当成一等公民管理
// SocketLike 是「最小接口」：只要求注册表真正用到的那几个能力。
// node:net 的 Socket 天然满足；测试里用假对象实现同一接口。

export interface SocketLike {
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown
  on(event: 'close', listener: () => void): unknown
  write(chunk: Uint8Array): boolean
  destroy(): void
  readonly remoteAddress?: string
  readonly remotePort?: number
}

// 账本里的一行：连接的编号、来处、最后活跃时刻
// （write 是第 4 章加上的：组装层需要替连接说话——接口只增不破）
export interface ManagedConn {
  readonly id: number
  readonly remote: string
  lastActiveAt: number
  write(chunk: Uint8Array): boolean
  destroy(): void
}

// 可预期失败走判别联合，不抛异常：拒绝入账也是一种正常业务结果
export type AddResult = { ok: true; conn: ManagedConn } | { ok: false; reason: 'max-conns' }

type ConnCb<Args extends unknown[]> = (conn: ManagedConn, ...args: Args) => void

export interface ConnRegistry {
  add(socket: SocketLike): AddResult
  size(): number
  sweepIdle(now: number): ManagedConn[]
  onData(cb: ConnCb<[chunk: Uint8Array]>): void
  onIdle(cb: ConnCb<[]>): void
  onClose(cb: ConnCb<[]>): void
}

export interface RegistryOptions {
  maxConns?: number
  idleTimeoutMs?: number
  now?: () => number // 时钟可注入：测试用假时钟，生产用 Date.now
}

export function createConnRegistry(opts: RegistryOptions = {}): ConnRegistry {
  const maxConns = opts.maxConns ?? 1024 // 呼应第 1 章：文件描述符的 1024 墙
  const idleTimeoutMs = opts.idleTimeoutMs ?? Number.POSITIVE_INFINITY
  const now = opts.now ?? Date.now

  const conns = new Map<number, ManagedConn>()
  let nextId = 1

  const dataCbs: ConnCb<[Uint8Array]>[] = []
  const idleCbs: ConnCb<[]>[] = []
  const closeCbs: ConnCb<[]>[] = []

  return {
    add(socket) {
      if (conns.size >= maxConns) return { ok: false, reason: 'max-conns' }

      const id = nextId++
      const conn: ManagedConn = {
        id,
        remote: `${socket.remoteAddress ?? '?'}:${socket.remotePort ?? '?'}`,
        lastActiveAt: now(),
        write: (chunk) => socket.write(chunk),
        destroy: () => socket.destroy(),
      }
      conns.set(id, conn)

      // 事件经过账本：data 到达即续命，再转发给订阅者
      socket.on('data', (chunk) => {
        conn.lastActiveAt = now()
        for (const cb of dataCbs) cb(conn, chunk)
      })
      socket.on('close', () => {
        conns.delete(conn.id)
        for (const cb of closeCbs) cb(conn)
      })

      return { ok: true, conn }
    },

    size() {
      return conns.size
    },

    sweepIdle(t) {
      const reaped: ManagedConn[] = []
      for (const conn of conns.values()) {
        if (t - conn.lastActiveAt > idleTimeoutMs) reaped.push(conn)
      }
      for (const conn of reaped) {
        conn.destroy() // 真 socket 会随后触发 close 事件，delete 是幂等的
        conns.delete(conn.id)
        for (const cb of idleCbs) cb(conn)
      }
      return reaped
    },

    onData(cb) {
      dataCbs.push(cb)
    },
    onIdle(cb) {
      idleCbs.push(cb)
    },
    onClose(cb) {
      closeCbs.push(cb)
    },
  }
}
