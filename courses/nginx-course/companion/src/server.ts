import http from 'node:http'
import type { ListenInfo, MiniNginxConfig, MiniNginxServer } from './types.js'
import { matchLocation } from './location.js'
import { resolveTryFiles, sendText, serveStatic } from './static.js'
import { proxyPass, proxyUpgrade } from './proxy.js'
import { createUpstreamPool, type UpstreamPool } from './upstream.js'
import { corsHeadersFor, effectiveAddHeader, isPreflight } from './headers.js'

const DEFAULT_INDEX = 'index.html'
// 内部重定向上限：nginx 同款保护，超限按"重定向循环"报 500
const MAX_INTERNAL_REDIRECTS = 10

export function createMiniNginx(config: MiniNginxConfig): MiniNginxServer {
  let server: http.Server | null = null

  // proxy_pass 引用 upstream 组名（如 http://backend）时命中池，否则按直连地址处理
  const pools = new Map<string, UpstreamPool>()
  for (const [name, upstream] of Object.entries(config.upstreams ?? {})) {
    pools.set(name, createUpstreamPool(upstream.servers))
  }
  const poolFor = (proxyPass: string): UpstreamPool | undefined => {
    const m = /^http:\/\/([^/:]+)$/.exec(proxyPass)
    return m ? pools.get(m[1]) : undefined
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let rawPath: string
    let search = ''
    try {
      const raw = req.url ?? '/'
      const q = raw.indexOf('?')
      // 不走 new URL()：它会按规范把 /../ 段消解掉，穿越检测就失效了
      rawPath = decodeURIComponent(q >= 0 ? raw.slice(0, q) : raw)
      search = q >= 0 ? raw.slice(q) : ''
    } catch {
      return sendText(res, 400, 'bad request')
    }
    if (!rawPath.startsWith('/')) return sendText(res, 400, 'bad request')

    // 内部重定向循环：try_files 末项回退的 URI 会重新走一遍「匹配 → handler」
    let uri = rawPath
    for (let hop = 0; hop < MAX_INTERNAL_REDIRECTS; hop++) {
      const loc = matchLocation(config.server.locations, uri)

      // 响应头统一组装：add_header（带继承遮蔽语义）+ CORS
      const extraHeaders: Record<string, string> = { ...effectiveAddHeader(loc, config.server) }
      if (loc?.cors) Object.assign(extraHeaders, corsHeadersFor(loc.cors, req))

      // CORS 预检不进 handler：网关直接应答 204 + Allow-* 头
      if (loc?.cors && isPreflight(req)) {
        res.writeHead(204, extraHeaders)
        res.end()
        return
      }

      if (loc?.proxy_pass)
        return proxyPass(req, res, loc, uri, search, poolFor(loc.proxy_pass), extraHeaders)

      const root = loc?.root ?? config.server.root
      if (!root) return sendText(res, 500, 'no root configured')
      const index = loc?.index ?? DEFAULT_INDEX
      const serveCtx = {
        acceptEncoding: req.headers['accept-encoding'],
        gzip: config.server.gzip,
        expires: loc?.expires,
        etag: loc?.etag,
        ifNoneMatch: req.headers['if-none-match'],
        extraHeaders,
      }

      if (loc?.try_files?.length) {
        const next = await resolveTryFiles(loc.try_files, uri, root)
        if (!next) return sendText(res, 404, 'not found')
        if (next.kind === 'redirect') {
          uri = next.uri
          continue
        }
        return serveStatic(res, root, next.uri, index, serveCtx)
      }

      return serveStatic(res, root, uri, index, serveCtx)
    }
    return sendText(res, 500, 'internal redirection cycle')
  }

  return {
    listen: (port = 0) =>
      new Promise<ListenInfo>((resolve, reject) => {
        if (server) return reject(new Error('already listening'))
        server = http.createServer((req, res) => {
          handle(req, res).catch(() => sendText(res, 500, 'internal error'))
        })
        server.on('upgrade', (req, socket, head) => {
          // WebSocket：Upgrade 头的请求不走 request handler，走这里
          try {
            const uri = decodeURIComponent(req.url ?? '/')
            const loc = matchLocation(config.server.locations, uri)
            if (loc?.proxy_pass) return proxyUpgrade(req, socket, head, loc)
            socket.destroy()
          } catch {
            socket.destroy()
          }
        })
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => {
          const addr = server!.address()
          if (typeof addr === 'string' || addr === null) return reject(new Error('no port'))
          resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}` })
        })
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (!server) return resolve()
        // 强制回收所有连接（含 keep-alive 空闲连接与隧道），保证端口释放
        server.closeAllConnections()
        server.close(() => resolve())
        server = null
      }),
  }
}
