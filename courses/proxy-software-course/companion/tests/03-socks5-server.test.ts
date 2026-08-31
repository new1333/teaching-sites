// tests/03-socks5-server.test.ts —— 第 3 章：SOCKS5 服务端
// 仅 NO AUTH + CONNECT；domain/IPv4/IPv6 地址帧；握手分片；BIND/UDP ASSOCIATE 规范拒绝。

import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDirectDialer } from '../src/dialers.js'
import { createSocks5Server } from '../src/socks5-server.js'
import { createSocketReader } from '../src/socket-reader.js'
import { CMD, METHOD, REPLY, SOCKS5_VERSION, encodeAddress, readAddressFrame } from '../src/socks5-wire.js'
import type { Dialer, TargetAddress } from '../src/types.js'
import { closeAsync, connectAsync, createEchoServer, destroyAll, listenAsync, readAtLeast } from './support.js'

function greeting(methods: readonly number[]): Buffer {
  return Buffer.from([SOCKS5_VERSION, methods.length, ...methods])
}

function requestFrame(cmd: number, target: TargetAddress): Buffer {
  return Buffer.concat([Buffer.from([SOCKS5_VERSION, cmd, 0x00]), encodeAddress(target)])
}

/** 把 data 拆成 chunkSize 一片、逐片写入，片间让出事件循环，逼真模拟 TCP 分片到达。*/
async function writeFragmented(socket: net.Socket, data: Buffer, chunkSize = 1): Promise<void> {
  for (let i = 0; i < data.length; i += chunkSize) {
    socket.write(data.subarray(i, i + chunkSize))
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

describe('SOCKS5 服务端', () => {
  let echo: net.Server
  let echoPort: number
  let echo6: net.Server
  let echo6Port: number

  beforeAll(async () => {
    echo = createEchoServer()
    echoPort = await listenAsync(echo, '127.0.0.1')
    echo6 = createEchoServer()
    echo6Port = await listenAsync(echo6, '::1')
  })

  afterAll(async () => {
    await Promise.all([closeAsync(echo), closeAsync(echo6)])
  })

  it('NO AUTH 握手 + IPv4 CONNECT 成功后可以双向转发', async () => {
    const server = createSocks5Server({ connect: createDirectDialer() })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    const reader = createSocketReader(client)

    client.write(greeting([METHOD.NO_AUTH]))
    const methodChoice = await reader.readExact(2)
    expect(methodChoice.readUInt8(0)).toBe(SOCKS5_VERSION)
    expect(methodChoice.readUInt8(1)).toBe(METHOD.NO_AUTH)

    client.write(requestFrame(CMD.CONNECT, { kind: 'ipv4', host: '127.0.0.1', port: echoPort }))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(0)).toBe(SOCKS5_VERSION)
    expect(replyHead.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    const bound = await readAddressFrame(reader)
    expect(bound.ok).toBe(true)
    reader.release()

    client.write('hello-socks5')
    const echoed = await readAtLeast(client, 'hello-socks5'.length)
    expect(echoed.toString('utf8')).toBe('hello-socks5')

    destroyAll(client)
    await closeAsync(server)
  })

  it('握手与请求被拆成逐字节分片依然能完成 CONNECT', async () => {
    const server = createSocks5Server({ connect: createDirectDialer() })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    const reader = createSocketReader(client)

    await writeFragmented(client, greeting([METHOD.NO_AUTH]))
    const methodChoice = await reader.readExact(2)
    expect(methodChoice.readUInt8(1)).toBe(METHOD.NO_AUTH)

    await writeFragmented(client, requestFrame(CMD.CONNECT, { kind: 'ipv4', host: '127.0.0.1', port: echoPort }))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    await readAddressFrame(reader)
    reader.release()

    client.write('fragmented-ok')
    const echoed = await readAtLeast(client, 'fragmented-ok'.length)
    expect(echoed.toString('utf8')).toBe('fragmented-ok')

    destroyAll(client)
    await closeAsync(server)
  })

  it('IPv6 地址帧 CONNECT 成功', async () => {
    const server = createSocks5Server({ connect: createDirectDialer() })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    const reader = createSocketReader(client)

    client.write(greeting([METHOD.NO_AUTH]))
    await reader.readExact(2)
    client.write(requestFrame(CMD.CONNECT, { kind: 'ipv6', host: '::1', port: echo6Port }))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    await readAddressFrame(reader)
    reader.release()

    client.write('ipv6-ok')
    const echoed = await readAtLeast(client, 'ipv6-ok'.length)
    expect(echoed.toString('utf8')).toBe('ipv6-ok')

    destroyAll(client)
    await closeAsync(server)
  })

  it('域名地址帧被原样解析、原样交给 connect()', async () => {
    const seenTargets: TargetAddress[] = []
    const directDialer = createDirectDialer()
    const connect: Dialer = async (target) => {
      seenTargets.push(target)
      return directDialer({ kind: 'ipv4', host: '127.0.0.1', port: echoPort })
    }
    const server = createSocks5Server({ connect })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    const reader = createSocketReader(client)

    client.write(greeting([METHOD.NO_AUTH]))
    await reader.readExact(2)
    client.write(requestFrame(CMD.CONNECT, { kind: 'domain', host: 'my-test-domain.internal', port: 4321 }))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.SUCCEEDED)
    await readAddressFrame(reader)
    reader.release()

    expect(seenTargets).toEqual([{ kind: 'domain', host: 'my-test-domain.internal', port: 4321 }])

    destroyAll(client)
    await closeAsync(server)
  })

  it('BIND / UDP ASSOCIATE 一律回 COMMAND_NOT_SUPPORTED', async () => {
    const server = createSocks5Server({ connect: createDirectDialer() })
    const port = await listenAsync(server)

    for (const cmd of [CMD.BIND, CMD.UDP_ASSOCIATE]) {
      const client = await connectAsync('127.0.0.1', port)
      const reader = createSocketReader(client)
      client.write(greeting([METHOD.NO_AUTH]))
      await reader.readExact(2)
      client.write(requestFrame(cmd, { kind: 'ipv4', host: '127.0.0.1', port: echoPort }))
      const replyHead = await reader.readExact(3)
      expect(replyHead.readUInt8(1)).toBe(REPLY.COMMAND_NOT_SUPPORTED)
      destroyAll(client)
    }

    await closeAsync(server)
  })

  it('客户端不提供 NO AUTH 时回 NO_ACCEPTABLE 并关闭连接', async () => {
    const server = createSocks5Server({ connect: createDirectDialer() })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    client.write(greeting([0x02])) // 只提供 GSSAPI，服务端不支持
    const reply = await readAtLeast(client, 2)
    expect(reply.readUInt8(0)).toBe(SOCKS5_VERSION)
    expect(reply.readUInt8(1)).toBe(METHOD.NO_ACCEPTABLE)
    destroyAll(client)
    await closeAsync(server)
  })

  it('规则拒绝（REJECT）与其他拨号失败回不同的响应码', async () => {
    const rejecting: Dialer = () => Promise.resolve({ ok: false, reason: 'rejected by rule' })
    const server = createSocks5Server({ connect: rejecting })
    const port = await listenAsync(server)
    const client = await connectAsync('127.0.0.1', port)
    const reader = createSocketReader(client)
    client.write(greeting([METHOD.NO_AUTH]))
    await reader.readExact(2)
    client.write(requestFrame(CMD.CONNECT, { kind: 'ipv4', host: '127.0.0.1', port: 1 }))
    const replyHead = await reader.readExact(3)
    expect(replyHead.readUInt8(1)).toBe(REPLY.CONNECTION_NOT_ALLOWED)
    destroyAll(client)
    await closeAsync(server)
  })
})
