// src/dialers.ts —— 出站适配器：DIRECT（裸 TCP 连接）、REJECT（直接拒绝）、
// SOCKS5 上游客户端（NO AUTH 握手 + CONNECT，支持域名/IPv4/IPv6 目标，校验响应码）

import net from 'node:net'
import type { Socket } from 'node:net'
import { errorMessage } from './errors.js'
import { createSocketReader } from './socket-reader.js'
import { CMD, METHOD, REPLY, SOCKS5_VERSION, encodeAddress, readAddressFrame } from './socks5-wire.js'
import type { Dialer, DialOutcome, TargetAddress } from './types.js'

function connectTcp(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    // allowHalfOpen: true——拨号出去的这条连接也要支持半关闭，否则对端一发 FIN，
    // Node 就会自动把这侧写端也关掉，relay 转发半关闭的努力就白做了。
    const socket = net.connect({ host, port, allowHalfOpen: true })
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    const onConnect = (): void => {
      cleanup()
      resolve(socket)
    }
    function cleanup(): void {
      socket.off('error', onError)
      socket.off('connect', onConnect)
    }
    socket.once('error', onError)
    socket.once('connect', onConnect)
  })
}

/** DIRECT：直接向目标地址建立 TCP 连接。domain 目标应由调用方先通过注入的 resolver 解析成 IP。*/
export function createDirectDialer(): Dialer {
  return async (target: TargetAddress): Promise<DialOutcome> => {
    try {
      const socket = await connectTcp(target.host, target.port)
      return { ok: true, result: { socket } }
    } catch (err) {
      return { ok: false, reason: `direct dial failed: ${errorMessage(err)}` }
    }
  }
}

/** REJECT：不建立任何连接，立刻拒绝。*/
export function createRejectDialer(): Dialer {
  return (): Promise<DialOutcome> => Promise.resolve({ ok: false, reason: 'rejected by rule' })
}

export interface Socks5UpstreamOptions {
  readonly host: string
  readonly port: number
}

/** SOCKS5 上游客户端：连接上游代理，仅走 NO AUTH，发起 CONNECT，校验响应码后把 socket 交给 relay。*/
export function createSocks5Dialer(upstream: Socks5UpstreamOptions): Dialer {
  return async (target: TargetAddress): Promise<DialOutcome> => {
    let socket: Socket
    try {
      socket = await connectTcp(upstream.host, upstream.port)
    } catch (err) {
      return { ok: false, reason: `socks5 upstream connect failed: ${errorMessage(err)}` }
    }

    const reader = createSocketReader(socket)
    function fail(reason: string): DialOutcome {
      reader.release()
      socket.destroy()
      return { ok: false, reason }
    }

    try {
      socket.write(Buffer.from([SOCKS5_VERSION, 1, METHOD.NO_AUTH]))
      const methodReply = await reader.readExact(2)
      if (methodReply.readUInt8(0) !== SOCKS5_VERSION || methodReply.readUInt8(1) !== METHOD.NO_AUTH) {
        return fail('socks5 upstream did not accept NO AUTH method')
      }

      const requestHeader = Buffer.from([SOCKS5_VERSION, CMD.CONNECT, 0x00])
      socket.write(Buffer.concat([requestHeader, encodeAddress(target)]))

      const replyHeader = await reader.readExact(3) // VER REP RSV
      if (replyHeader.readUInt8(0) !== SOCKS5_VERSION) {
        return fail('socks5 upstream sent an invalid reply version')
      }
      const rep = replyHeader.readUInt8(1)
      // 无论成功与否，回复里都带 BND.ADDR/PORT，必须读完才能保证流对齐
      const addrOutcome = await readAddressFrame(reader)
      if (rep !== REPLY.SUCCEEDED) {
        return fail(`socks5 upstream reply code ${rep}`)
      }
      if (!addrOutcome.ok) {
        return fail('socks5 upstream reply used an unsupported address type')
      }

      reader.release()
      return { ok: true, result: { socket } }
    } catch (err) {
      return fail(`socks5 upstream handshake failed: ${errorMessage(err)}`)
    }
  }
}
