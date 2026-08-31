// src/socks5-server.ts —— SOCKS5 服务端：仅 NO AUTH + CONNECT，域名/IPv4/IPv6 地址帧，
// 握手分片健壮；BIND/UDP ASSOCIATE 按 RFC 1928 回 COMMAND_NOT_SUPPORTED。

import net from 'node:net'
import type { Socket } from 'node:net'
import { classifyHost } from './authority.js'
import { errorMessage } from './errors.js'
import { relay } from './relay.js'
import { createSocketReader } from './socket-reader.js'
import { CMD, METHOD, REPLY, SOCKS5_VERSION, encodeAddress, readAddressFrame } from './socks5-wire.js'
import type { Dialer, EventSink, TargetAddress } from './types.js'

export interface Socks5ServerOptions {
  readonly connect: Dialer
  readonly sink?: EventSink
}

const DUMMY_BOUND_ADDRESS: TargetAddress = { kind: 'ipv4', host: '0.0.0.0', port: 0 }

function buildReply(rep: number, address: TargetAddress): Buffer {
  return Buffer.concat([Buffer.from([SOCKS5_VERSION, rep, 0x00]), encodeAddress(address)])
}

function boundAddressOf(socket: Socket): TargetAddress {
  const host = socket.localAddress
  const port = socket.localPort
  if (host === undefined || port === undefined) return DUMMY_BOUND_ADDRESS
  return { kind: classifyHost(host), host, port }
}

export function createSocks5Server(options: Socks5ServerOptions): net.Server {
  const sink = options.sink

  // allowHalfOpen: true——否则 Node 收到对端 FIN 会自动把本侧写端也关掉，
  // relay 的半关闭转发就会被这套默认行为抢跑，真正的半关闭语义无从谈起。
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    handleConnection(socket).catch((err) => {
      sink?.({ type: 'server-error', message: `socks5 connection handler crashed: ${errorMessage(err)}` })
      socket.destroy()
    })
  })

  async function handleConnection(socket: Socket): Promise<void> {
    const reader = createSocketReader(socket)

    let greeting: { version: number; methods: Buffer }
    try {
      const version = (await reader.readExact(1)).readUInt8(0)
      const nmethods = (await reader.readExact(1)).readUInt8(0)
      const methods = await reader.readExact(nmethods)
      greeting = { version, methods }
    } catch {
      socket.destroy()
      return
    }

    if (greeting.version !== SOCKS5_VERSION) {
      socket.destroy()
      return
    }
    if (!greeting.methods.includes(METHOD.NO_AUTH)) {
      socket.end(Buffer.from([SOCKS5_VERSION, METHOD.NO_ACCEPTABLE]))
      return
    }
    socket.write(Buffer.from([SOCKS5_VERSION, METHOD.NO_AUTH]))

    let version: number
    let cmd: number
    try {
      version = (await reader.readExact(1)).readUInt8(0)
      cmd = (await reader.readExact(1)).readUInt8(0)
      await reader.readExact(1) // RSV，恒为 0x00，丢弃即可
    } catch {
      socket.destroy()
      return
    }
    if (version !== SOCKS5_VERSION) {
      socket.destroy()
      return
    }

    const addressOutcome = await readAddressFrame(reader).catch(() => null)
    if (addressOutcome === null) {
      socket.destroy()
      return
    }
    if (!addressOutcome.ok) {
      socket.end(buildReply(REPLY.ADDRESS_TYPE_NOT_SUPPORTED, DUMMY_BOUND_ADDRESS))
      return
    }
    const target = addressOutcome.target

    if (cmd !== CMD.CONNECT) {
      // 题面明确要求：BIND / UDP ASSOCIATE 不支持，按规范回 COMMAND_NOT_SUPPORTED
      socket.end(buildReply(REPLY.COMMAND_NOT_SUPPORTED, DUMMY_BOUND_ADDRESS))
      return
    }

    sink?.({ type: 'route', message: 'socks5-connect', detail: { host: target.host, port: target.port } })
    const outcome = await options.connect(target)
    if (!outcome.ok) {
      sink?.({ type: 'dial-error', message: outcome.reason, detail: { host: target.host, port: target.port } })
      // REJECT 出站与其他拨号失败给出不同的响应码，方便客户端区分“被规则拒绝”与“网络故障”
      const rep = outcome.reason === 'rejected by rule' ? REPLY.CONNECTION_NOT_ALLOWED : REPLY.GENERAL_FAILURE
      socket.end(buildReply(rep, DUMMY_BOUND_ADDRESS))
      return
    }

    socket.write(buildReply(REPLY.SUCCEEDED, boundAddressOf(outcome.result.socket)))
    reader.release()
    await relay(socket, outcome.result.socket, sink)
  }

  return server
}
