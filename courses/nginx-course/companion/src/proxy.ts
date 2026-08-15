import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LocationBlock } from './types.js'
import type { UpstreamPool } from './upstream.js'
import { sendText } from './static.js'

/**
 * 计算 upstream 收到的路径：对齐 nginx 的 proxy_pass 语义。
 * - proxy_pass 不带路径（如 http://backend）→ 请求 URI 原样透传
 * - proxy_pass 带路径（如 http://backend/v2/）→ location 匹配前缀被该路径替换
 */
export function buildUpstreamPath(target: URL, loc: LocationBlock, uri: string): string {
  const basePath = target.pathname
  if (!basePath || basePath === '/') return uri
  const { type, path: prefix } = loc.match
  if (type === '~' || type === '~*') return uri // 正则块不做前缀替换（差异见第 12 章）
  const rest = uri.startsWith(prefix) ? uri.slice(prefix.length) : ''
  return basePath + rest || '/'
}

/**
 * 组装转发请求头：透传 + 注入客户端真实信息（nginx 默认行为）+ proxy_set_header 覆盖。
 * X-Forwarded-For 是链式追加：客户端可能伪造，代理补上"我亲眼看到的地址"。
 */
export function buildProxyHeaders(
  req: IncomingMessage,
  target: URL,
  loc: LocationBlock,
): Record<string, string> {
  const clientIp = req.socket.remoteAddress ?? ''
  const headers: Record<string, string> = { ...req.headers } as Record<string, string>
  headers['x-real-ip'] = clientIp
  const xff = req.headers['x-forwarded-for']
  headers['x-forwarded-for'] = xff ? `${xff}, ${clientIp}` : clientIp
  headers['x-forwarded-proto'] = target.protocol === 'https:' ? 'https' : 'http'
  headers.host = target.host
  for (const [key, value] of Object.entries(loc.proxy_set_header ?? {})) {
    headers[key.toLowerCase()] = value
  }
  return headers
}

/** 反向代理 handler：转发请求、管道响应；上游不可达 → 502；带池时失败换下一台重试 */
export function proxyPass(
  req: IncomingMessage,
  res: ServerResponse,
  loc: LocationBlock,
  uri: string,
  search: string,
  pool?: UpstreamPool,
  extraHeaders?: Record<string, string>,
): void {
  const tried = new Set<string>()
  const directTarget = pool ? null : new URL(loc.proxy_pass!)

  const attempt = (): void => {
    // 池化目标：每次尝试从池里取实例；直连目标：固定一台
    const server = pool?.next(tried)
    if (pool && !server) return sendText(res, 502, 'bad gateway')
    if (server) tried.add(server.host)
    const target = server ? new URL(`http://${server.host}`) : directTarget!
    const upstreamReq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || 80,
        method: req.method,
        path: buildUpstreamPath(target, loc, uri) + search,
        headers: buildProxyHeaders(req, target, loc),
      },
      (upstreamRes) => {
        // add_header / CORS 追加在 upstream 头之上（同名时追加头赢，对齐 add_header 语义）
        res.writeHead(upstreamRes.statusCode ?? 502, { ...upstreamRes.headers, ...extraHeaders })
        upstreamRes.pipe(res)
      },
    )
    upstreamReq.on('error', () => {
      // 对齐 nginx proxy_next_upstream error 默认行为：连接失败换下一台；无候选时 attempt 内部回 502
      if (pool && !res.headersSent) return attempt()
      if (!res.headersSent) sendText(res, 502, 'bad gateway')
      else res.end()
    })
    req.pipe(upstreamReq)
  }

  attempt()
}

/** WebSocket 升级代理：向 upstream 重放握手，101 之后双向裸管道 */
export function proxyUpgrade(
  req: IncomingMessage,
  socket: import('node:stream').Duplex,
  head: Buffer,
  loc: LocationBlock,
): void {
  const target = new URL(loc.proxy_pass!)
  const upstreamReq = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || 80,
    method: req.method,
    path: req.url,
    headers: buildProxyHeaders(req, target, loc),
  })
  upstreamReq.on('upgrade', (res, upstreamSocket, upstreamHead) => {
    const lines = ['HTTP/1.1 101 Switching Protocols']
    for (const [key, value] of Object.entries(res.headers)) {
      lines.push(`${key}: ${value}`)
    }
    socket.write(lines.join('\r\n') + '\r\n\r\n')
    if (upstreamHead?.length) socket.write(upstreamHead)
    // end:false——不让 pipe 自动发 FIN：半开的隧道没有意义，任何一侧断开都整体 RST 拆除
    upstreamSocket.pipe(socket, { end: false })
    socket.pipe(upstreamSocket, { end: false })
    let dropped = false
    const drop = () => {
      if (dropped) return
      dropped = true
      socket.destroy()
      upstreamSocket.destroy()
    }
    for (const s of [upstreamSocket, socket]) {
      s.on('error', drop)
      s.on('close', drop)
      s.on('end', drop)
    }
  })
  upstreamReq.on('error', () => socket.destroy())
  if (head?.length) upstreamReq.write(head)
  upstreamReq.end()
}
