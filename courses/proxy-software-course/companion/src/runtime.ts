// src/runtime.ts —— 组装层：同时起 HTTP / SOCKS5 监听，共享同一条 route → dns → dial 管线
// createProxyRuntime 返回实际监听端口（port:0 场景下由内核分配）、close()、以及事件日志回调。

import net from 'node:net'
import dns from 'node:dns/promises'
import { planRoute } from './dns.js'
import { createDirectDialer, createRejectDialer, createSocks5Dialer } from './dialers.js'
import { errorMessage } from './errors.js'
import { createHttpForwardServer } from './http-server.js'
import { createSocks5Server } from './socks5-server.js'
import type { Dialer, DialOutcome, EventSink, ProxyConfig, Resolver, RouteDecision, TargetAddress } from './types.js'

export interface ProxyRuntimeOptions {
  /** 域名解析器；不传时用 node:dns/promises 做真实解析（生产用途）。测试必须显式注入固定实现。*/
  readonly resolver?: Resolver
  readonly sink?: EventSink
}

export interface ProxyRuntime {
  readonly httpPort: number
  readonly socksPort: number
  close(): Promise<void>
}

async function defaultResolver(host: string): Promise<string> {
  const result = await dns.lookup(host, { family: 4 })
  return result.address
}

function listen(server: net.Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('server did not bind to a TCP address'))
        return
      }
      resolve(address.port)
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/** 追踪一个 server 上所有已接受的连接，close 时可以强制断开，保证测试不留下悬挂 socket。*/
function trackConnections(server: net.Server): { closeAll: () => void } {
  const sockets = new Set<net.Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  return {
    closeAll: () => {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
    },
  }
}

export async function createProxyRuntime(config: ProxyConfig, options: ProxyRuntimeOptions = {}): Promise<ProxyRuntime> {
  const resolver = options.resolver ?? defaultResolver
  const sink = options.sink

  const directDialer = createDirectDialer()
  const rejectDialer = createRejectDialer()
  const proxyDialers = new Map<string, Dialer>()
  for (const [name, outbound] of Object.entries(config.outbounds)) {
    if (outbound.type === 'SOCKS5') {
      proxyDialers.set(name, createSocks5Dialer({ host: outbound.host, port: outbound.port }))
    }
  }

  function pickDialer(decision: RouteDecision): Dialer | null {
    if (decision.action === 'DIRECT') return directDialer
    if (decision.action === 'REJECT') return rejectDialer
    if (decision.outbound === undefined) return null
    return proxyDialers.get(decision.outbound) ?? null
  }

  async function connect(target: TargetAddress): Promise<DialOutcome> {
    const plan = await planRoute(target, config.dnsStrategy, config.rules, resolver)
    if (!plan.ok) {
      sink?.({ type: 'dial-error', message: plan.reason, detail: { host: target.host, port: target.port } })
      return { ok: false, reason: plan.reason }
    }
    sink?.({
      type: 'route',
      message: plan.decision.action,
      detail: { host: target.host, port: target.port, outbound: plan.decision.outbound ?? null },
    })
    const dialer = pickDialer(plan.decision)
    if (!dialer) {
      const reason = `no dialer available for action ${plan.decision.action}`
      sink?.({ type: 'dial-error', message: reason })
      return { ok: false, reason }
    }
    return dialer(plan.dialTarget)
  }

  const httpServer = createHttpForwardServer({ connect, sink })
  const socksServer = createSocks5Server({ connect, sink })
  const httpConnections = trackConnections(httpServer)
  const socksConnections = trackConnections(socksServer)

  let httpPort: number
  let socksPort: number
  try {
    httpPort = await listen(httpServer, config.listeners.http.host, config.listeners.http.port)
    socksPort = await listen(socksServer, config.listeners.socks.host, config.listeners.socks.port)
  } catch (err) {
    httpServer.close()
    socksServer.close()
    throw new Error(`failed to start proxy runtime: ${errorMessage(err)}`)
  }

  sink?.({ type: 'listening', message: 'http', detail: { host: config.listeners.http.host, port: httpPort } })
  sink?.({ type: 'listening', message: 'socks5', detail: { host: config.listeners.socks.host, port: socksPort } })

  return {
    httpPort,
    socksPort,
    async close(): Promise<void> {
      httpConnections.closeAll()
      socksConnections.closeAll()
      await Promise.all([closeServer(httpServer), closeServer(socksServer)])
      sink?.({ type: 'closed', message: 'proxy runtime closed' })
    },
  }
}
