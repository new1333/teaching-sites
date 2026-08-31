// tests/09-assembly.test.ts —— 第 9 章：组装层（runtime + cli）
// createProxyRuntime 同时起 HTTP / SOCKS5（port 0），共享同一条 route/dial 管线，
// 返回真实端口、close()、结构化事件；CLI 能从配置路径启动，SIGINT/SIGTERM 优雅关闭。

import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installGracefulShutdown, loadConfigFile, startFromConfigPath } from '../src/cli.js'
import { createProxyRuntime } from '../src/runtime.js'
import type { ProxyEvent, ProxyConfig } from '../src/types.js'
import type { ProxyRuntime } from '../src/runtime.js'
import { CMD, METHOD, REPLY, SOCKS5_VERSION, encodeAddress } from '../src/socks5-wire.js'
import { createSocketReader } from '../src/socket-reader.js'
import { closeAsync, connectAsync, createEchoServer, destroyAll, listenAsync, readAtLeast, readUntilClose } from './support.js'

function buildConfig(): ProxyConfig {
  return {
    listeners: {
      http: { host: '127.0.0.1', port: 0 },
      socks: { host: '127.0.0.1', port: 0 },
    },
    dnsStrategy: 'preserve-domain',
    rules: [
      { type: 'PORT', value: '9999', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ],
    outbounds: {
      DIRECT: { type: 'DIRECT' },
      REJECT: { type: 'REJECT' },
    },
  }
}

describe('createProxyRuntime：同时起 HTTP / SOCKS5，共享 route/dial 管线', () => {
  let echo: net.Server
  let echoPort: number
  let runtime: ProxyRuntime
  const events: ProxyEvent[] = []

  beforeAll(async () => {
    echo = createEchoServer()
    echoPort = await listenAsync(echo)
    runtime = await createProxyRuntime(buildConfig(), { sink: (e) => events.push(e) })
  })

  afterAll(async () => {
    await runtime.close()
    await closeAsync(echo)
  })

  it('返回的端口是内核实际分配的非零端口', () => {
    expect(runtime.httpPort).toBeGreaterThan(0)
    expect(runtime.socksPort).toBeGreaterThan(0)
  })

  it('listening 事件带着真实端口', () => {
    const listeningEvents = events.filter((e) => e.type === 'listening')
    expect(listeningEvents).toHaveLength(2)
    expect(listeningEvents.some((e) => e.detail?.['port'] === runtime.httpPort)).toBe(true)
    expect(listeningEvents.some((e) => e.detail?.['port'] === runtime.socksPort)).toBe(true)
  })

  it('HTTP 入口：DIRECT 规则放行，REJECT 规则拦截，同一条规则引擎两处都生效', async () => {
    const allowed = await connectAsync('127.0.0.1', runtime.httpPort)
    allowed.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`)
    const okStatus = await readAtLeast(allowed, 'HTTP/1.1 200 Connection Established\r\n\r\n'.length)
    expect(okStatus.toString('latin1')).toContain('200')
    destroyAll(allowed)

    const rejected = await connectAsync('127.0.0.1', runtime.httpPort)
    rejected.write(`CONNECT 127.0.0.1:9999 HTTP/1.1\r\nHost: 127.0.0.1:9999\r\n\r\n`)
    const badStatus = (await readUntilClose(rejected)).toString('latin1')
    expect(badStatus).toContain('502')
  })

  it('SOCKS5 入口：DIRECT 规则放行，REJECT 规则拦截，同一条规则引擎两处都生效', async () => {
    const allowed = await connectAsync('127.0.0.1', runtime.socksPort)
    const allowedReader = createSocketReader(allowed)
    allowed.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
    await allowedReader.readExact(2)
    allowed.write(Buffer.concat([Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00]), encodeAddress({ kind: 'ipv4', host: '127.0.0.1', port: echoPort })]))
    const okReply = await allowedReader.readExact(3)
    expect(okReply.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    destroyAll(allowed)

    const rejected = await connectAsync('127.0.0.1', runtime.socksPort)
    const rejectedReader = createSocketReader(rejected)
    rejected.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
    await rejectedReader.readExact(2)
    rejected.write(Buffer.concat([Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00]), encodeAddress({ kind: 'ipv4', host: '127.0.0.1', port: 9999 })]))
    const badReply = await rejectedReader.readExact(3)
    expect(badReply.readUInt8(1)).toBe(REPLY.CONNECTION_NOT_ALLOWED)
    destroyAll(rejected)
  })

  it('route 事件里能看到两条入口共用同一条决策', () => {
    const routeEvents = events.filter((e) => e.type === 'route')
    expect(routeEvents.some((e) => e.message === 'DIRECT')).toBe(true)
    expect(routeEvents.length).toBeGreaterThanOrEqual(4) // 上面两个 describe 各打了一次 DIRECT + 一次 REJECT
  })
})

describe('close()：停止监听、断开已追踪的连接', () => {
  it('close 之后端口不再接受新连接', async () => {
    const runtime = await createProxyRuntime(buildConfig())
    const { httpPort, socksPort } = runtime
    await runtime.close()

    await expect(connectAsync('127.0.0.1', httpPort)).rejects.toBeDefined()
    await expect(connectAsync('127.0.0.1', socksPort)).rejects.toBeDefined()
  })

  it('close 会强制断开仍处于 CONNECT 隧道中的连接，不留下悬挂 socket', async () => {
    const echo = createEchoServer()
    const echoPort = await listenAsync(echo)
    const runtime = await createProxyRuntime(buildConfig())

    const client = await connectAsync('127.0.0.1', runtime.httpPort)
    client.on('error', () => {}) // 服务端强制断开时，客户端这一侧通常会收到 ECONNRESET
    client.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`)
    await readAtLeast(client, 'HTTP/1.1 200 Connection Established\r\n\r\n'.length)

    const clientTornDown = new Promise<void>((resolve) => {
      client.once('close', resolve)
      client.once('end', resolve) // 客户端 socket 是 allowHalfOpen，收到 FIN 只会先触发 'end'
    })
    await runtime.close()
    await clientTornDown // close() 应该主动断开仍在隧道里的客户端连接

    destroyAll(client)
    await closeAsync(echo)
  })
})

describe('cli.ts：从配置文件路径启动', () => {
  let dir: string

  beforeAll(() => {
    const testsDir = path.dirname(fileURLToPath(import.meta.url))
    dir = mkdtempSync(path.join(testsDir, '.tmp-cli-fixtures-'))
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loadConfigFile：合法配置文件解析成功', async () => {
    const file = path.join(dir, 'valid.json')
    writeFileSync(file, JSON.stringify(buildConfig()))
    const outcome = await loadConfigFile(file)
    expect(outcome.ok).toBe(true)
  })

  it('loadConfigFile：JSON 语法错误时返回明确错误', async () => {
    const file = path.join(dir, 'broken.json')
    writeFileSync(file, '{ not valid json')
    const outcome = await loadConfigFile(file)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors[0]).toContain('JSON')
  })

  it('loadConfigFile：不符合 schema 的配置返回校验错误', async () => {
    const file = path.join(dir, 'invalid-schema.json')
    writeFileSync(file, JSON.stringify({ listeners: {}, dnsStrategy: 'nope', rules: [], outbounds: {} }))
    const outcome = await loadConfigFile(file)
    expect(outcome.ok).toBe(false)
  })

  it('startFromConfigPath：从真实文件路径启动一个可用的 runtime', async () => {
    const file = path.join(dir, 'start.json')
    writeFileSync(file, JSON.stringify(buildConfig()))
    const runtime = await startFromConfigPath(file, () => {})
    expect(runtime.httpPort).toBeGreaterThan(0)
    expect(runtime.socksPort).toBeGreaterThan(0)
    await runtime.close()
  })

  it('startFromConfigPath：配置非法时抛出带错误详情的异常', async () => {
    const file = path.join(dir, 'bad.json')
    writeFileSync(file, JSON.stringify({ nope: true }))
    await expect(startFromConfigPath(file, () => {})).rejects.toThrow('配置校验失败')
  })
})

describe('installGracefulShutdown：SIGINT / SIGTERM 优雅关闭', () => {
  function fakeRuntime(): { runtime: ProxyRuntime; close: ReturnType<typeof vi.fn> } {
    const close = vi.fn(async () => {})
    return { runtime: { httpPort: 1, socksPort: 2, close }, close }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('收到 SIGINT 后关闭 runtime 并以退出码 0 退出（用注入的信号源/退出函数，不动真的进程）', async () => {
    const { runtime, close } = fakeRuntime()
    const signals = new EventEmitter()
    const exit = vi.fn()
    installGracefulShutdown(runtime, { signals, exit, log: () => {} })

    signals.emit('SIGINT')
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })

  it('收到 SIGTERM 同样会优雅关闭', async () => {
    const { runtime, close } = fakeRuntime()
    const signals = new EventEmitter()
    const exit = vi.fn()
    installGracefulShutdown(runtime, { signals, exit, log: () => {} })

    signals.emit('SIGTERM')
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
  })

  it('重复收到信号只关闭一次，不会重入', async () => {
    const { runtime, close } = fakeRuntime()
    const signals = new EventEmitter()
    const exit = vi.fn()
    installGracefulShutdown(runtime, { signals, exit, log: () => {} })

    signals.emit('SIGINT')
    signals.emit('SIGINT')
    signals.emit('SIGTERM')
    await vi.waitFor(() => expect(exit).toHaveBeenCalledTimes(1))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
