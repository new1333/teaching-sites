// tests/02-http-forward-proxy.test.ts —— 第 2 章：HTTP 正向代理
// absolute-form 改写为 origin-form 后转发；CONNECT 建立隧道，回 200 后双向 relay。
// 全程只连 127.0.0.1，不出网。

import http from 'node:http'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirectDialer } from '../src/dialers.js'
import { createHttpForwardServer } from '../src/http-server.js'
import { closeAsync, connectAsync, createEchoServer, destroyAll, listenAsync, readAtLeast, readUntilClose } from './support.js'

describe('HTTP 正向代理', () => {
  let origin: http.Server
  let originPort: number
  let proxyServer: net.Server
  let proxyPort: number

  beforeAll(async () => {
    origin = http.createServer((req, res) => {
      res.setHeader('X-Seen-Host', req.headers.host ?? '')
      res.end(`origin-ok:${req.url ?? ''}`)
    })
    originPort = await listenAsync(origin)

    proxyServer = createHttpForwardServer({ connect: createDirectDialer() })
    proxyPort = await listenAsync(proxyServer)
  })

  afterAll(async () => {
    await Promise.all([closeAsync(origin), closeAsync(proxyServer)])
  })

  it('absolute-form 请求被改写为 origin-form 并转发到真实 Host', async () => {
    const client = await connectAsync('127.0.0.1', proxyPort)
    client.write(`GET http://127.0.0.1:${originPort}/hello?x=1 HTTP/1.1\r\nHost: this-should-be-overwritten\r\nConnection: close\r\n\r\n`)
    const response = (await readUntilClose(client)).toString('utf8')

    expect(response).toContain('HTTP/1.1 200')
    expect(response).toContain(`origin-ok:/hello?x=1`)
    expect(response).toContain(`X-Seen-Host: 127.0.0.1:${originPort}`)
    destroyAll(client)
  })

  it('CONNECT 建立隧道，回 200 后双向转发原始字节', async () => {
    const echo = createEchoServer()
    const echoPort = await listenAsync(echo)

    const client = await connectAsync('127.0.0.1', proxyPort)
    client.write(`CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n\r\n`)

    const expectedStatus = 'HTTP/1.1 200 Connection Established\r\n\r\n'
    const statusBytes = await readAtLeast(client, expectedStatus.length)
    expect(statusBytes.toString('latin1')).toBe(expectedStatus)

    client.write('ping-through-tunnel')
    const echoed = await readAtLeast(client, 'ping-through-tunnel'.length)
    expect(echoed.toString('utf8')).toBe('ping-through-tunnel')

    destroyAll(client)
    await closeAsync(echo)
  })

  it('拨号失败时返回 502 Bad Gateway', async () => {
    const client = await connectAsync('127.0.0.1', proxyPort)
    client.write(`GET http://127.0.0.1:1/never HTTP/1.1\r\nHost: 127.0.0.1:1\r\nConnection: close\r\n\r\n`)
    const response = (await readUntilClose(client)).toString('utf8')
    expect(response).toContain('502')
    destroyAll(client)
  })

  it('请求行既不是 origin-form 也不是合法 absolute-form 时返回 400', async () => {
    const client = await connectAsync('127.0.0.1', proxyPort)
    client.write(`GET ftp://example.com/x HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`)
    const response = (await readUntilClose(client)).toString('utf8')
    expect(response).toContain('400')
    destroyAll(client)
  })
})
