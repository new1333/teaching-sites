// tests/10-end-to-end.test.ts —— 第 10 章：端到端
// 用完整组装好的 createProxyRuntime（HTTP + SOCKS5 共享同一条 route/dial 管线）驱动：
// HTTP absolute-form、CONNECT 隧道、SOCKS5、规则拒绝、上游 SOCKS5 链，各至少一个行为测试。
// 全程只连 127.0.0.1，不出网；结束时关闭所有 server/socket。

import http from 'node:http'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProxyRuntime } from '../src/runtime.js'
import { createDirectDialer } from '../src/dialers.js'
import { createSocks5Server } from '../src/socks5-server.js'
import { createSocketReader } from '../src/socket-reader.js'
import { CMD, METHOD, REPLY, SOCKS5_VERSION, encodeAddress, readAddressFrame } from '../src/socks5-wire.js'
import type { ProxyConfig, Resolver } from '../src/types.js'
import type { ProxyRuntime } from '../src/runtime.js'
import { closeAsync, connectAsync, createEchoServer, destroyAll, listenAsync, readAtLeast, readUntilClose } from './support.js'

describe('端到端：完整代理运行时', () => {
  let origin: http.Server
  let originPort: number
  let echo: net.Server
  let echoPort: number
  let upstream: net.Server
  let upstreamPort: number
  let runtime: ProxyRuntime

  beforeAll(async () => {
    origin = http.createServer((req, res) => {
      res.end(`origin-reply:${req.url ?? ''}`)
    })
    originPort = await listenAsync(origin)

    echo = createEchoServer()
    echoPort = await listenAsync(echo)

    // 上游 SOCKS5：把任何目标一律转发到本地 echo server，模拟「链到另一个 SOCKS5 代理」
    upstream = createSocks5Server({
      connect: async () => createDirectDialer()({ kind: 'ipv4', host: '127.0.0.1', port: echoPort }),
    })
    upstreamPort = await listenAsync(upstream)

    // preserve-domain：DIRECT 才解析；这个测试里 DIRECT 目标全部用字面 IP，不会真的调用 resolver，
    // 但仍然注入一个固定实现，绝不允许意外触达公网 DNS。
    const resolver: Resolver = async () => '127.0.0.1'

    const config: ProxyConfig = {
      listeners: {
        http: { host: '127.0.0.1', port: 0 },
        socks: { host: '127.0.0.1', port: 0 },
      },
      dnsStrategy: 'preserve-domain',
      rules: [
        { type: 'DOMAIN', value: 'blocked.test', action: 'REJECT' },
        { type: 'DOMAIN', value: 'proxied.test', action: 'PROXY', outbound: 'upstream' },
        { type: 'MATCH', value: '', action: 'DIRECT' },
      ],
      outbounds: {
        DIRECT: { type: 'DIRECT' },
        REJECT: { type: 'REJECT' },
        upstream: { type: 'SOCKS5', host: '127.0.0.1', port: upstreamPort },
      },
    }

    runtime = await createProxyRuntime(config, { resolver })
  })

  afterAll(async () => {
    await runtime.close()
    await Promise.all([closeAsync(origin), closeAsync(echo), closeAsync(upstream)])
  })

  it('HTTP absolute-form：改写为 origin-form 后直连真实 origin server', async () => {
    const client = await connectAsync('127.0.0.1', runtime.httpPort)
    client.write(`GET http://127.0.0.1:${originPort}/e2e-check HTTP/1.1\r\nHost: ignored\r\nConnection: close\r\n\r\n`)
    const response = (await readUntilClose(client)).toString('utf8')
    expect(response).toContain('HTTP/1.1 200')
    expect(response).toContain('origin-reply:/e2e-check')
    destroyAll(client)
  })

  it('HTTP CONNECT：建立隧道后双向转发到真实 TCP 服务', async () => {
    const client = await connectAsync('127.0.0.1', runtime.httpPort)
    client.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`)
    const status = await readAtLeast(client, 'HTTP/1.1 200 Connection Established\r\n\r\n'.length)
    expect(status.toString('latin1')).toContain('200')
    client.write('e2e-connect-ping')
    const echoed = await readAtLeast(client, 'e2e-connect-ping'.length)
    expect(echoed.toString('utf8')).toBe('e2e-connect-ping')
    destroyAll(client)
  })

  it('SOCKS5：NO AUTH 握手 + CONNECT 直连真实 TCP 服务', async () => {
    const client = await connectAsync('127.0.0.1', runtime.socksPort)
    const reader = createSocketReader(client)
    client.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
    await reader.readExact(2)
    client.write(Buffer.concat([Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00]), encodeAddress({ kind: 'ipv4', host: '127.0.0.1', port: echoPort })]))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    await readAddressFrame(reader)
    reader.release()
    client.write('e2e-socks5-ping')
    const echoed = await readAtLeast(client, 'e2e-socks5-ping'.length)
    expect(echoed.toString('utf8')).toBe('e2e-socks5-ping')
    destroyAll(client)
  })

  it('规则拒绝：HTTP 与 SOCKS5 入口对同一条 REJECT 规则表现一致', async () => {
    const httpClient = await connectAsync('127.0.0.1', runtime.httpPort)
    httpClient.write(`CONNECT blocked.test:443 HTTP/1.1\r\nHost: blocked.test:443\r\n\r\n`)
    const httpResponse = (await readUntilClose(httpClient)).toString('latin1')
    expect(httpResponse).toContain('502')

    const socksClient = await connectAsync('127.0.0.1', runtime.socksPort)
    const reader = createSocketReader(socksClient)
    socksClient.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
    await reader.readExact(2)
    socksClient.write(Buffer.concat([Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00]), encodeAddress({ kind: 'domain', host: 'blocked.test', port: 443 })]))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.CONNECTION_NOT_ALLOWED)
    destroyAll(socksClient)
  })

  it('上游 SOCKS5 链：PROXY 规则把域名原样交给上游，数据经上游转发到真实 TCP 服务', async () => {
    const client = await connectAsync('127.0.0.1', runtime.httpPort)
    client.write(`CONNECT proxied.test:1234 HTTP/1.1\r\nHost: proxied.test:1234\r\n\r\n`)
    const status = await readAtLeast(client, 'HTTP/1.1 200 Connection Established\r\n\r\n'.length)
    expect(status.toString('latin1')).toContain('200')
    client.write('e2e-upstream-chain-ping')
    const echoed = await readAtLeast(client, 'e2e-upstream-chain-ping'.length)
    expect(echoed.toString('utf8')).toBe('e2e-upstream-chain-ping')
    destroyAll(client)
  })
})
