import type { GzipOptions } from './types.js'

/** 默认只压文本类：html 是 nginx 永远的默认项，其余是前端标配 */
export const DEFAULT_GZIP_TYPES = [
  'text/html',
  'text/css',
  'text/plain',
  'application/javascript',
  'application/json',
  'image/svg+xml',
]

/**
 * 是否对该响应做 gzip：客户端声明支持（Accept-Encoding）× 类型在白名单 × 大于 minLength。
 * 图片不进默认白名单——已是压缩格式，再压收益为负还白耗 CPU。
 */
export function shouldGzip(
  contentType: string,
  size: number,
  acceptEncoding: string | undefined,
  options: GzipOptions | undefined,
): boolean {
  if (!options) return false
  const types = options.types ?? DEFAULT_GZIP_TYPES
  if (!types.includes(contentType)) return false
  if (size < (options.minLength ?? 0)) return false
  return (acceptEncoding ?? '').includes('gzip')
}
