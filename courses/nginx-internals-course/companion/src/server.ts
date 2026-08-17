// src/server.ts —— 组装层：连接注册表 + 解析状态机 = 一个会 keep-alive 的 HTTP 服务器
import net from 'node:net'
import { createConnRegistry, type ConnRegistry, type ManagedConn } from './conn'
import { createHttpParser, type HttpParser, type RequestHead } from './http-parser'
import { proxyRequest, proxyRequestPooled, type ProxyTarget } from './proxy'
import type { UpstreamPool } from './upstream'
import type { LeakyBucket } from './ratelimit'

export interface HandlerResponse {
  status: number
  body: string
}

export interface ServerOptions {
  handler: (head: RequestHead) => HandlerResponse
  proxy?: ProxyTarget // 配了它，请求不再走 handler，而是转发给上游（第 8 章）
  upstreamPool?: UpstreamPool // 配了它，用池挑目标、失败换下一台重试（第 9 章）
  rateLimit?: LeakyBucket // 配了它，按客户端地址过漏桶，溢出回 503（第 10 章）
  keepAliveTimeoutMs?: number // 一条连接空闲多久后挂断（默认 75_000，nginx 的默认是 75 秒）
  maxConns?: number
  now?: () => number
  sweepIntervalMs?: number // 自动扫账周期；传 Infinity 则完全手动 tick（测试用）
}

export interface TinyServer {
  /** 启动监听，返回实际端口（端口传 0 时由系统分配） */
  start(port?: number): Promise<number>
  /** 手动驱动一次空闲收割，返回收割数（生产由定时器驱动） */
  tick(): number
  connections(): number
  acceptedCount(): number
  requestCount(): number
  close(): Promise<void>
}

export function createServer(opts: ServerOptions): TinyServer {
  const now = opts.now ?? Date.now
  const registry: ConnRegistry = createConnRegistry({
    maxConns: opts.maxConns,
    idleTimeoutMs: opts.keepAliveTimeoutMs ?? 75_000,
    now,
  })

  // 每条连接一个解析器：半包记忆属于连接，不共享
  const parsers = new Map<number, HttpParser>()
  // 自持一份 socket 引用：close() 时主动清场，不等 keep-alive 连接自然超时
  const sockets = new Set<net.Socket>()

  let accepted = 0
  let handled = 0
  let timer: ReturnType<typeof setInterval> | null = null

  const server = net.createServer((sock) => {
    sockets.add(sock)
    sock.on('close', () => sockets.delete(sock))

    const r = registry.add(sock)
    if (!r.ok) {
      sock.destroy() // 满员：不入账，直接请回
      return
    }
    accepted++
    parsers.set(r.conn.id, createHttpParser())
  })

  registry.onClose((conn) => {
    parsers.delete(conn.id) // 销账时连解析器一起清，不留尸体
  })

  registry.onData((conn, chunk) => {
    const parser = parsers.get(conn.id)
    if (!parser) return
    for (const ev of parser.feed(chunk)) {
      if (ev.type === 'error') {
        conn.destroy() // 解析失败的连接不可信任，请回
        return
      }
      // 漏桶挡在业务之前：溢出的请求直接 503（nginx limit_req 的默认拒绝码）
      // key 取 IP 段——按「人」限流而不是按「连接」限流（一人一桶）
      if (opts.rateLimit && !opts.rateLimit.allow(conn.remote.split(':')[0]).ok) {
        const body = 'rate limited'
        const text =
          `HTTP/1.1 503 Service Unavailable\r\n` +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Connection: close\r\n` +
          `\r\n` +
          body
        conn.write(new TextEncoder().encode(text))
        conn.destroy()
        continue
      }
      respond(conn, ev.head)
    }
  })

  function respond(conn: ManagedConn, head: RequestHead): void {
    handled++
    if (opts.upstreamPool) {
      void proxyRequestPooled(conn, head, opts.upstreamPool) // 挑台、转发、失败换下一台
      return
    }
    if (opts.proxy) {
      void proxyRequest(conn, head, opts.proxy) // 双跳交给代理；成败都由它负责回写
      return
    }
    const res = opts.handler(head)
    // HTTP/1.1 默认不挂电话；对方明确说了 close 才挂
    const keepAlive = head.headers['connection'] !== 'close'
    const statusText = res.status === 200 ? 'OK' : 'STATUS'
    const headText =
      `HTTP/1.1 ${res.status} ${statusText}\r\n` +
      `Content-Length: ${Buffer.byteLength(res.body)}\r\n` +
      `Connection: ${keepAlive ? 'keep-alive' : 'close'}\r\n` +
      `\r\n`
    conn.write(new TextEncoder().encode(headText + res.body))
    if (!keepAlive) conn.destroy() // 说完这句就挂
  }

  return {
    start(listenPort = 0) {
      return new Promise<number>((resolve, reject) => {
        server.once('error', reject)
        server.listen(listenPort, '127.0.0.1', () => {
          const port = (server.address() as net.AddressInfo).port
          const interval = opts.sweepIntervalMs ?? 1000
          if (Number.isFinite(interval)) {
            timer = setInterval(() => registry.sweepIdle(now()), interval)
          }
          resolve(port)
        })
      })
    },

    tick() {
      return registry.sweepIdle(now()).length
    },

    connections() {
      return registry.size()
    },
    acceptedCount() {
      return accepted
    },
    requestCount() {
      return handled
    },

    close() {
      if (timer) clearInterval(timer)
      for (const s of sockets) s.destroy() // 主动清场：挂着等 keep-alive 的连接一并请回
      sockets.clear()
      return new Promise<void>((resolve) => {
        server.close(() => resolve())
      })
    },
  }
}
