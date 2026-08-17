// src/proxy.ts —— 反向代理：收请求 → 建上游连接 → 转发（盖邮戳）→ 缓冲响应 → 回写
import net from 'node:net'
import type { RequestHead } from './http-parser'
import type { ManagedConn } from './conn'
import type { UpstreamPool } from './upstream'

export interface ProxyTarget {
  host: string
  port: number
}

export interface ProxyOutcome {
  ok: boolean // 上游是否成功应答
  status: number // 最终回给客户端的状态码
}

const encoder = new TextEncoder()

function write502(client: ManagedConn): void {
  const body = 'bad gateway'
  const text =
    `HTTP/1.1 502 Bad Gateway\r\n` +
    `Content-Length: ${Buffer.byteLength(body)}\r\n` +
    `Connection: close\r\n` +
    `\r\n` +
    body
  client.write(encoder.encode(text))
  client.destroy()
}

/**
 * 底层：对单台上游的转发尝试。成功：收齐响应、回写、挂断，resolve {ok:true}。
 * 失败：对客户端不做任何事（写 502 还是换下一台重试，由调用方决定）。
 */
function proxyOnce(
  client: ManagedConn,
  head: RequestHead,
  target: ProxyTarget,
): Promise<ProxyOutcome> {
  return new Promise((resolve) => {
    const upstream = net.connect(target.port, target.host)

    upstream.on('error', () => resolve({ ok: false, status: 0 }))

    upstream.on('connect', () => {
      // 转发请求行与头部，盖一枚「我经过了一道前台」的邮戳
      const lines = [`${head.method} ${head.path} ${head.version}`]
      for (const [k, v] of Object.entries(head.headers)) {
        if (k === 'connection') continue // 代理与上游之间的连接语义由代理自己定
        lines.push(`${k}: ${v}`)
      }
      lines.push(`x-forwarded-for: ${client.remote}`)
      lines.push('connection: close')
      lines.push('', '')
      upstream.write(encoder.encode(lines.join('\r\n')))
    })

    // 缓冲整个响应：头部到空行、体按 Content-Length 收齐，然后一次性回写
    let buf = ''
    upstream.on('data', (chunk: Buffer) => {
      buf += chunk.toString('latin1')
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const headerLines = buf.slice(0, headerEnd).split('\r\n')
      const lenLine = headerLines.find((l) => l.toLowerCase().startsWith('content-length:'))
      const len = Number(lenLine?.split(':').slice(1).join(':').trim() ?? 0)
      if (buf.length - headerEnd - 4 >= len) {
        client.write(encoder.encode(buf.slice(0, headerEnd + 4 + len)))
        upstream.destroy()
        client.destroy()
        resolve({ ok: true, status: Number(headerLines[0].split(' ')[1]) })
      }
    })
  })
}

/** 单目标代理：失败就地回 502（第 8 章的行为） */
export async function proxyRequest(
  client: ManagedConn,
  head: RequestHead,
  target: ProxyTarget,
): Promise<ProxyOutcome> {
  const outcome = await proxyOnce(client, head, target)
  if (!outcome.ok) {
    write502(client)
    return { ok: false, status: 502 }
  }
  return outcome
}

/**
 * 池化代理（第 9 章）：从池里轮询挑一台试，失败记一笔并自动换下一台重试；
 * 连续一整圈全败或全员摘除，才对客户端说 502。
 */
export async function proxyRequestPooled(
  client: ManagedConn,
  head: RequestHead,
  pool: UpstreamPool,
): Promise<ProxyOutcome> {
  const maxTries = pool.size()
  for (let i = 0; i < maxTries; i++) {
    const pick = pool.pick()
    if (!pick.ok) break // 全员摘除
    const outcome = await proxyOnce(client, head, pick.peer)
    pool.report(pick.peer, outcome.ok)
    if (outcome.ok) return outcome
  }
  write502(client)
  return { ok: false, status: 502 }
}
