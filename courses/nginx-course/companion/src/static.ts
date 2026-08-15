import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ServerResponse } from 'node:http'
import { createGzip } from 'node:zlib'
import { mimeOf } from './mime.js'
import { shouldGzip } from './gzip.js'
import { cacheControlFor, entityTag, etagMatches } from './cache.js'
import type { ExpiresPolicy, GzipOptions } from './types.js'

/** 错误响应统一约定：text/plain + 小写短语 */
export function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain' })
  res.end(body)
}

export interface ServeContext {
  acceptEncoding?: string
  gzip?: GzipOptions
  expires?: ExpiresPolicy
  etag?: boolean
  ifNoneMatch?: string
  /** add_header / CORS 等追加的响应头 */
  extraHeaders?: Record<string, string>
}

async function streamFile(res: ServerResponse, filePath: string, ctx?: ServeContext): Promise<void> {
  const info = await stat(filePath)
  const contentType = mimeOf(filePath)
  const cacheControl = cacheControlFor(ctx?.expires)
  const etag = ctx?.etag !== false ? entityTag(info) : undefined

  // 协商缓存：凭证命中 → 304 空体（只有头，没有 body）
  if (etag && etagMatches(ctx?.ifNoneMatch, etag)) {
    const headers: Record<string, string> = { ETag: etag }
    if (cacheControl) headers['Cache-Control'] = cacheControl
    res.writeHead(304, { ...ctx?.extraHeaders, ...headers })
    res.end()
    return
  }

  const baseHeaders: Record<string, string> = { ...ctx?.extraHeaders, 'Content-Type': contentType }
  if (etag) baseHeaders.ETag = etag
  if (cacheControl) baseHeaders['Cache-Control'] = cacheControl

  if (ctx && shouldGzip(contentType, info.size, ctx.acceptEncoding, ctx.gzip)) {
    // 压缩后长度不可预知：去掉 Content-Length，交给 chunked 传输
    res.writeHead(200, { ...baseHeaders, 'Content-Encoding': 'gzip' })
    createReadStream(filePath).pipe(createGzip()).pipe(res)
    return
  }
  res.writeHead(200, { ...baseHeaders, 'Content-Length': info.size })
  createReadStream(filePath).pipe(res)
}

/**
 * 静态文件 handler：把 URI 映射到 root 下的文件。
 * nginx 对齐点：目录→找 index（默认 index.html），无 index 的目录 403，文件不存在 404，
 * 路径含 .. 或反斜杠 403（目录穿越防护）。
 */
export async function serveStatic(
  res: ServerResponse,
  root: string,
  uri: string,
  indexFile: string,
  ctx?: ServeContext,
): Promise<void> {
  const relative = uri.slice(1)
  if (relative.split('/').includes('..') || relative.includes('\\')) {
    return sendText(res, 403, 'forbidden')
  }
  const absPath = join(root, relative)
  const info = await stat(absPath).catch(() => null)
  if (info?.isFile()) return streamFile(res, absPath, ctx)
  if (info?.isDirectory()) {
    const indexPath = join(absPath, indexFile)
    const indexInfo = await stat(indexPath).catch(() => null)
    if (indexInfo?.isFile()) return streamFile(res, indexPath, ctx)
    return sendText(res, 403, 'forbidden')
  }
  return sendText(res, 404, 'not found')
}

export type TryFilesResult =
  | { kind: 'file'; uri: string }
  | { kind: 'redirect'; uri: string }
  | null

async function isFileUnder(root: string, uri: string): Promise<boolean> {
  if (uri.includes('..')) return false
  const info = await stat(join(root, uri.slice(1))).catch(() => null)
  return info?.isFile() ?? false
}

/**
 * try_files 解析：逐项尝试（$uri 占位符替换为当前 URI），非末项只做文件存在性检查；
 * 末项以 / 开头 = 内部重定向 URI（重新走 location 匹配），否则也按文件试。
 * 返回 null 表示全部落空 → 404。
 */
export async function resolveTryFiles(
  entries: string[],
  uri: string,
  root: string,
): Promise<TryFilesResult> {
  const expand = (entry: string): string => entry.replaceAll('$uri', uri)
  for (const entry of entries.slice(0, -1)) {
    const candidate = expand(entry)
    if (await isFileUnder(root, candidate)) return { kind: 'file', uri: candidate }
  }
  const last = expand(entries[entries.length - 1])
  if (last.startsWith('/')) return { kind: 'redirect', uri: last }
  if (await isFileUnder(root, last)) return { kind: 'file', uri: last }
  return null
}
