// src/socks5-wire.ts —— SOCKS5 报文的地址帧编解码，服务端与客户端拨号器共用
// RFC 1928：ATYP 1=IPv4 / 3=DOMAINNAME / 4=IPv6；地址帧 = ATYP + ADDR + PORT(2 bytes BE)。

import type { SocketReader } from './socket-reader.js'
import type { TargetAddress } from './types.js'

export const SOCKS5_VERSION = 0x05

export const ATYP = { IPV4: 0x01, DOMAIN: 0x03, IPV6: 0x04 } as const

export const CMD = { CONNECT: 0x01, BIND: 0x02, UDP_ASSOCIATE: 0x03 } as const

export const REPLY = {
  SUCCEEDED: 0x00,
  GENERAL_FAILURE: 0x01,
  CONNECTION_NOT_ALLOWED: 0x02,
  NETWORK_UNREACHABLE: 0x03,
  HOST_UNREACHABLE: 0x04,
  CONNECTION_REFUSED: 0x05,
  TTL_EXPIRED: 0x06,
  COMMAND_NOT_SUPPORTED: 0x07,
  ADDRESS_TYPE_NOT_SUPPORTED: 0x08,
} as const

export const METHOD = { NO_AUTH: 0x00, NO_ACCEPTABLE: 0xff } as const

function ipv4ToBytes(host: string): Buffer {
  const parts = host.split('.').map((p) => Number(p))
  return Buffer.from(parts)
}

/** 展开简写形式（含 "::"）为 8 组 16 位数值。仅供本模块内部编解码使用，非通用校验器。*/
function expandIPv6Groups(addr: string): number[] {
  if (addr.includes('::')) {
    const [head, tail] = addr.split('::')
    const headParts = head === undefined || head.length === 0 ? [] : head.split(':').map((h) => Number.parseInt(h, 16))
    const tailParts = tail === undefined || tail.length === 0 ? [] : tail.split(':').map((h) => Number.parseInt(h, 16))
    const missing = 8 - headParts.length - tailParts.length
    return [...headParts, ...new Array<number>(Math.max(missing, 0)).fill(0), ...tailParts]
  }
  return addr.split(':').map((h) => Number.parseInt(h, 16))
}

function ipv6ToBytes(host: string): Buffer {
  const groups = expandIPv6Groups(host)
  const buf = Buffer.alloc(16)
  for (let i = 0; i < 8; i++) {
    buf.writeUInt16BE(groups[i] ?? 0, i * 2)
  }
  return buf
}

/** 把 16 字节压缩回最长零段用 "::" 省略的简写形式。*/
function bytesToIPv6(buf: Buffer): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(buf.readUInt16BE(i).toString(16))

  let bestStart = -1
  let bestLen = 0
  let curStart = -1
  let curLen = 0
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i
      curLen++
      if (curLen > bestLen) {
        bestLen = curLen
        bestStart = curStart
      }
    } else {
      curStart = -1
      curLen = 0
    }
  }
  if (bestLen >= 2) {
    const before = groups.slice(0, bestStart)
    const after = groups.slice(bestStart + bestLen)
    return `${before.join(':')}::${after.join(':')}`
  }
  return groups.join(':')
}

function portBytes(port: number): Buffer {
  const buf = Buffer.alloc(2)
  buf.writeUInt16BE(port, 0)
  return buf
}

/** 把目标地址编码成 SOCKS5 地址帧（ATYP + ADDR + PORT），CONNECT 请求与拨号器共用。*/
export function encodeAddress(target: TargetAddress): Buffer {
  if (target.kind === 'ipv4') {
    return Buffer.concat([Buffer.from([ATYP.IPV4]), ipv4ToBytes(target.host), portBytes(target.port)])
  }
  if (target.kind === 'ipv6') {
    return Buffer.concat([Buffer.from([ATYP.IPV6]), ipv6ToBytes(target.host), portBytes(target.port)])
  }
  const hostBuf = Buffer.from(target.host, 'utf8')
  return Buffer.concat([Buffer.from([ATYP.DOMAIN, hostBuf.length]), hostBuf, portBytes(target.port)])
}

export type ReadAddressOutcome =
  | { readonly ok: true; readonly target: TargetAddress }
  | { readonly ok: false; readonly reason: 'address-type-not-supported' }

/** 从 SocketReader 顺序读出一个地址帧；能应对握手被拆成任意分片喂入。*/
export async function readAddressFrame(reader: SocketReader): Promise<ReadAddressOutcome> {
  const atypBuf = await reader.readExact(1)
  const atyp = atypBuf.readUInt8(0)
  if (atyp === ATYP.IPV4) {
    const addr = await reader.readExact(4)
    const portBuf = await reader.readExact(2)
    const host = `${addr.readUInt8(0)}.${addr.readUInt8(1)}.${addr.readUInt8(2)}.${addr.readUInt8(3)}`
    return { ok: true, target: { kind: 'ipv4', host, port: portBuf.readUInt16BE(0) } }
  }
  if (atyp === ATYP.DOMAIN) {
    const lenBuf = await reader.readExact(1)
    const len = lenBuf.readUInt8(0)
    const hostBuf = await reader.readExact(len)
    const portBuf = await reader.readExact(2)
    return { ok: true, target: { kind: 'domain', host: hostBuf.toString('utf8'), port: portBuf.readUInt16BE(0) } }
  }
  if (atyp === ATYP.IPV6) {
    const addr = await reader.readExact(16)
    const portBuf = await reader.readExact(2)
    return { ok: true, target: { kind: 'ipv6', host: bytesToIPv6(addr), port: portBuf.readUInt16BE(0) } }
  }
  return { ok: false, reason: 'address-type-not-supported' }
}
