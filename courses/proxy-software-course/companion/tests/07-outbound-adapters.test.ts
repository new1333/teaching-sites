// tests/07-outbound-adapters.test.ts —— 第 7 章：出站适配器
// DIRECT（裸 TCP）、REJECT（直接拒绝）、SOCKS5 上游客户端（NO AUTH + CONNECT，
// 域名/IPv4/IPv6 目标，校验响应码）。

import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createDirectDialer, createRejectDialer, createSocks5Dialer } from '../src/dialers.js'
import { createSocketReader } from '../src/socket-reader.js'
import { createSocks5Server } from '../src/socks5-server.js'
import { METHOD, REPLY, SOCKS5_VERSION } from '../src/socks5-wire.js'
import type { Dialer, TargetAddress } from '../src/types.js'
import { closeAsync, createEchoServer, destroyAll, listenAsync, readAtLeast } from './support.js'

const openServers: net.Server[] = []
async function trackedListen(server: net.Server, host = '127.0.0.1'): Promise<number> {
  openServers.push(server)
  return listenAsync(server, host)
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((s) => closeAsync(s)))
})

describe('DIRECT 出站', () => {
  it('成功连接目标并可以收发数据', async () => {
    const echo = createEchoServer()
    const echoPort = await trackedListen(echo)

    const dialer = createDirectDialer()
    const outcome = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: echoPort })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    outcome.result.socket.write('direct-hello')
    const echoed = await readAtLeast(outcome.result.socket, 'direct-hello'.length)
    expect(echoed.toString('utf8')).toBe('direct-hello')
    destroyAll(outcome.result.socket)
  })

  it('目标不可达时返回失败原因', async () => {
    const dialer = createDirectDialer()
    const outcome = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: 1 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('direct dial failed')
  })
})

describe('REJECT 出站', () => {
  it('永远立刻返回失败，不建立任何连接', async () => {
    const dialer = createRejectDialer()
    const outcome = await dialer({ kind: 'domain', host: 'anything.test', port: 443 })
    expect(outcome).toEqual({ ok: false, reason: 'rejected by rule' })
  })
})

describe('SOCKS5 上游客户端', () => {
  it('通过真实 SOCKS5 服务端成功建立 CONNECT 隧道并转发数据（域名目标）', async () => {
    const echo = createEchoServer()
    const echoPort = await trackedListen(echo)

    // 上游 SOCKS5 服务端把任何目标都直接转发到本地 echo server，专注验证客户端握手/编码逻辑
    const seenTargets: TargetAddress[] = []
    const upstreamConnect: Dialer = async (target) => {
      seenTargets.push(target)
      return createDirectDialer()({ kind: 'ipv4', host: '127.0.0.1', port: echoPort })
    }
    const upstream = createSocks5Server({ connect: upstreamConnect })
    const upstreamPort = await trackedListen(upstream)

    const dialer = createSocks5Dialer({ host: '127.0.0.1', port: upstreamPort })
    const outcome = await dialer({ kind: 'domain', host: 'my-target.example', port: 9999 })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(seenTargets).toEqual([{ kind: 'domain', host: 'my-target.example', port: 9999 }])

    outcome.result.socket.write('via-socks5-upstream')
    const echoed = await readAtLeast(outcome.result.socket, 'via-socks5-upstream'.length)
    expect(echoed.toString('utf8')).toBe('via-socks5-upstream')
    destroyAll(outcome.result.socket)
  })

  it('IPv4 / IPv6 目标同样可以通过上游 SOCKS5 转发', async () => {
    const echo4 = createEchoServer()
    const echo4Port = await trackedListen(echo4, '127.0.0.1')
    const echo6 = createEchoServer()
    const echo6Port = await trackedListen(echo6, '::1')

    const upstream = createSocks5Server({ connect: createDirectDialer() })
    const upstreamPort = await trackedListen(upstream)
    const dialer = createSocks5Dialer({ host: '127.0.0.1', port: upstreamPort })

    const outcome4 = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: echo4Port })
    expect(outcome4.ok).toBe(true)
    if (outcome4.ok) {
      outcome4.result.socket.write('v4-ok')
      expect((await readAtLeast(outcome4.result.socket, 'v4-ok'.length)).toString('utf8')).toBe('v4-ok')
      destroyAll(outcome4.result.socket)
    }

    const outcome6 = await dialer({ kind: 'ipv6', host: '::1', port: echo6Port })
    expect(outcome6.ok).toBe(true)
    if (outcome6.ok) {
      outcome6.result.socket.write('v6-ok')
      expect((await readAtLeast(outcome6.result.socket, 'v6-ok'.length)).toString('utf8')).toBe('v6-ok')
      destroyAll(outcome6.result.socket)
    }
  })

  it('上游拒绝 NO AUTH 时返回失败', async () => {
    const fakeUpstream = net.createServer((socket) => {
      socket.once('data', () => {
        socket.end(Buffer.from([SOCKS5_VERSION, METHOD.NO_ACCEPTABLE]))
      })
    })
    const port = await trackedListen(fakeUpstream)

    const dialer = createSocks5Dialer({ host: '127.0.0.1', port })
    const outcome = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: 80 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('NO AUTH')
  })

  it('上游返回非成功响应码时返回失败原因', async () => {
    const fakeUpstream = net.createServer((socket) => {
      const reader = createSocketReader(socket)
      void (async () => {
        await reader.readExact(1) // VER
        const nmethods = (await reader.readExact(1)).readUInt8(0)
        await reader.readExact(nmethods)
        socket.write(Buffer.from([SOCKS5_VERSION, METHOD.NO_AUTH]))

        await reader.readExact(3) // VER CMD RSV
        const atyp = (await reader.readExact(1)).readUInt8(0)
        if (atyp === 0x01) await reader.readExact(4)
        else if (atyp === 0x04) await reader.readExact(16)
        else if (atyp === 0x03) {
          const len = (await reader.readExact(1)).readUInt8(0)
          await reader.readExact(len)
        }
        await reader.readExact(2) // port
        // 回一个"主机不可达"，附带一个哑地址帧（IPv4 + 0.0.0.0:0）
        socket.end(Buffer.from([SOCKS5_VERSION, REPLY.HOST_UNREACHABLE, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      })()
    })
    const port = await trackedListen(fakeUpstream)

    const dialer = createSocks5Dialer({ host: '127.0.0.1', port })
    const outcome = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: 80 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain(String(REPLY.HOST_UNREACHABLE))
  })

  it('上游不可达时返回连接失败原因', async () => {
    const dialer = createSocks5Dialer({ host: '127.0.0.1', port: 1 })
    const outcome = await dialer({ kind: 'ipv4', host: '127.0.0.1', port: 80 })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('socks5 upstream connect failed')
  })
})
