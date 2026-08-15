import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

/** 原始 GET：不走 fetch 的透明解压，能看到真实响应头与字节 */
export function rawGet(
  url: string,
  headers?: Record<string, string>,
): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        )
      })
      .on('error', reject)
  })
}

/** 测试用 mock 上游：录下收到的请求，按回调应答；可选拦截 WebSocket 升级 */
export interface Recorded {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

export type UpstreamHandlers =
  | ((rec: Recorded, res: http.ServerResponse) => void)
  | {
      onRequest?: (rec: Recorded, res: http.ServerResponse) => void
      onUpgrade?: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void
    }

export async function startMockUpstream(
  handlers: UpstreamHandlers,
): Promise<{ url: string; close: () => Promise<void> }> {
  const h: { onRequest?: (rec: Recorded, res: http.ServerResponse) => void; onUpgrade?: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void } =
    typeof handlers === 'function' ? { onRequest: handlers } : handlers

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const rec: Recorded = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        headers: req.headers,
        body: Buffer.concat(chunks).toString(),
      }
      h.onRequest?.(rec, res)
    })
  })
  if (h.onUpgrade) server.on('upgrade', (req, socket, head) => h.onUpgrade!(req, socket, head))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
