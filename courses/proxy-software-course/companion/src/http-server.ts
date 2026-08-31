// src/http-server.ts —— HTTP 正向代理：absolute-form 改写为 origin-form 转发；
// CONNECT 建立 TCP 隧道，回 200 后转入双向 relay。一条连接只处理一个请求/隧道，
// 教学范围不追求 keep-alive 复用。

import net from 'node:net'
import type { Socket } from 'node:net'
import { parseAuthority, parseRequestLine, rewriteAbsoluteForm, toTargetAddress } from './authority.js'
import { errorMessage } from './errors.js'
import { relay } from './relay.js'
import { createSocketReader } from './socket-reader.js'
import type { Dialer, EventSink, TargetAddress } from './types.js'

const CRLF = '\r\n'
const HEADER_TERMINATOR = Buffer.from('\r\n\r\n')
const DEFAULT_MAX_HEADER_BYTES = 16 * 1024

export interface HttpForwardServerOptions {
  readonly connect: Dialer
  readonly sink?: EventSink
  readonly maxHeaderBytes?: number
}

function headerName(line: string): string | null {
  const idx = line.indexOf(':')
  return idx < 0 ? null : line.slice(0, idx).trim()
}

function findHeaderValue(lines: readonly string[], name: string): string | null {
  const lower = name.toLowerCase()
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    if (line.slice(0, idx).trim().toLowerCase() === lower) return line.slice(idx + 1).trim()
  }
  return null
}

function setHeader(lines: readonly string[], name: string, value: string): string[] {
  const lower = name.toLowerCase()
  const idx = lines.findIndex((line) => headerName(line)?.toLowerCase() === lower)
  const newLine = `${name}: ${value}`
  if (idx < 0) return [newLine, ...lines]
  const copy = [...lines]
  copy[idx] = newLine
  return copy
}

function writeStatus(socket: Socket, code: number, message: string): void {
  socket.end(`HTTP/1.1 ${code} ${message}${CRLF}${CRLF}`)
}

function buildRequestBytes(requestLine: string, headerLines: readonly string[]): Buffer {
  const headerText = headerLines.length > 0 ? headerLines.join(CRLF) + CRLF : ''
  return Buffer.from(`${requestLine}${CRLF}${headerText}${CRLF}`, 'latin1')
}

export function createHttpForwardServer(options: HttpForwardServerOptions): net.Server {
  const maxHeaderBytes = options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES
  const sink = options.sink

  // allowHalfOpen: true——否则 Node 收到对端 FIN 会自动把本侧写端也关掉，
  // relay 的半关闭转发就会被这套默认行为抢跑，真正的半关闭语义无从谈起。
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    handleConnection(socket).catch((err) => {
      sink?.({ type: 'server-error', message: `http connection handler crashed: ${errorMessage(err)}` })
      socket.destroy()
    })
  })

  async function handleConnection(socket: Socket): Promise<void> {
    const reader = createSocketReader(socket)
    let headerBlock: Buffer
    try {
      headerBlock = await reader.readUntil(HEADER_TERMINATOR, maxHeaderBytes)
    } catch {
      socket.destroy()
      return
    }

    const allLines = headerBlock.toString('latin1').split(CRLF)
    const requestLineRaw = allLines[0]
    const headerLines = allLines.slice(1)
    if (requestLineRaw === undefined || requestLineRaw.length === 0) {
      writeStatus(socket, 400, 'Bad Request')
      return
    }

    const requestLine = parseRequestLine(requestLineRaw)
    if (!requestLine) {
      writeStatus(socket, 400, 'Bad Request')
      return
    }

    if (requestLine.method === 'CONNECT') {
      await handleConnect(socket, reader, requestLine.target)
      return
    }

    await handleForward(socket, reader, requestLine, headerLines)
  }

  async function handleConnect(socket: Socket, reader: ReturnType<typeof createSocketReader>, targetRaw: string): Promise<void> {
    const authority = parseAuthority(targetRaw, 443)
    if (!authority) {
      writeStatus(socket, 400, 'Bad Request')
      return
    }
    const target = toTargetAddress(authority.host, authority.port)
    sink?.({ type: 'route', message: 'connect', detail: { host: target.host, port: target.port } })

    const outcome = await options.connect(target)
    if (!outcome.ok) {
      sink?.({ type: 'dial-error', message: outcome.reason, detail: { host: target.host, port: target.port } })
      writeStatus(socket, 502, 'Bad Gateway')
      return
    }

    socket.write(`HTTP/1.1 200 Connection Established${CRLF}${CRLF}`)
    reader.release()
    await relay(socket, outcome.result.socket, sink)
  }

  async function handleForward(
    socket: Socket,
    reader: ReturnType<typeof createSocketReader>,
    requestLine: NonNullable<ReturnType<typeof parseRequestLine>>,
    headerLines: readonly string[],
  ): Promise<void> {
    let target: TargetAddress
    let outRequestLine: string
    let outHeaderLines: readonly string[]

    if (requestLine.target.startsWith('/')) {
      const hostHeader = findHeaderValue(headerLines, 'host')
      if (hostHeader === null) {
        writeStatus(socket, 400, 'Bad Request')
        return
      }
      const authority = parseAuthority(hostHeader, 80)
      if (!authority) {
        writeStatus(socket, 400, 'Bad Request')
        return
      }
      target = toTargetAddress(authority.host, authority.port)
      outRequestLine = `${requestLine.method} ${requestLine.target} ${requestLine.version}`
      outHeaderLines = headerLines
    } else {
      const rewrite = rewriteAbsoluteForm(requestLine)
      if (!rewrite) {
        writeStatus(socket, 400, 'Bad Request')
        return
      }
      target = toTargetAddress(rewrite.authority.host, rewrite.authority.port)
      outRequestLine = rewrite.requestLine
      outHeaderLines = setHeader(headerLines, 'Host', rewrite.hostHeaderValue)
    }

    sink?.({ type: 'route', message: 'forward', detail: { host: target.host, port: target.port } })
    const outcome = await options.connect(target)
    if (!outcome.ok) {
      sink?.({ type: 'dial-error', message: outcome.reason, detail: { host: target.host, port: target.port } })
      writeStatus(socket, 502, 'Bad Gateway')
      return
    }

    outcome.result.socket.write(buildRequestBytes(outRequestLine, outHeaderLines))
    reader.release()
    await relay(socket, outcome.result.socket, sink)
  }

  return server
}
