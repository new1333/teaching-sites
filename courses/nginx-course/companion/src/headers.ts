import type { IncomingMessage } from 'node:http'
import type { CorsOptions, LocationBlock, ServerBlock } from './types.js'

/**
 * add_header 的继承规则（nginx 语义，著名的坑）：
 * 块内没有任何 add_header 时继承父块的全部；一旦块内出现 add_header，
 * 父块的头整体被遮蔽——不是合并。想要两份就得在子块里重抄一遍。
 */
export function effectiveAddHeader(
  loc: LocationBlock | null,
  server: ServerBlock,
): Record<string, string> | undefined {
  if (loc?.add_header) return loc.add_header
  return server.add_header
}

/** 是否为 CORS 预检请求：OPTIONS + Access-Control-Request-Method 头 */
export function isPreflight(req: IncomingMessage): boolean {
  return req.method === 'OPTIONS' && 'access-control-request-method' in req.headers
}

/** 命中 cors 配置的响应应携带的跨源头 */
export function corsHeadersFor(cors: CorsOptions, req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': cors.origin,
    Vary: 'Origin',
  }
  if (isPreflight(req)) {
    headers['Access-Control-Allow-Methods'] = cors.methods ?? 'GET, HEAD, POST'
    headers['Access-Control-Allow-Headers'] =
      cors.allowHeaders ?? (req.headers['access-control-request-headers'] as string) ?? '*'
    headers['Access-Control-Max-Age'] = '600'
  }
  return headers
}
