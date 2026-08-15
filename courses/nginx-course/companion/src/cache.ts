import type { Stats } from 'node:fs'
import type { ExpiresPolicy } from './types.js'

/** expires 策略 → Cache-Control 响应头值 */
export function cacheControlFor(policy: ExpiresPolicy | undefined): string | undefined {
  if (!policy) return undefined
  if (policy === 'no-cache') return 'no-cache'
  return policy.immutable
    ? `max-age=${policy.maxAge}, immutable`
    : `max-age=${policy.maxAge}`
}

/**
 * ETag 生成：nginx 同款「修改时间秒数-大小」的十六进制形式。
 * 内容变了 → 时间或大小变 → ETag 变；构建产物重命名但内容不变 → ETag 不变。
 */
export function entityTag(stat: Stats): string {
  return `"${Math.floor(stat.mtimeMs / 1000).toString(16)}-${stat.size.toString(16)}"`
}

/** If-None-Match 匹配：容忍 W/ 前缀、引号与多值逗号列表 */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false
  const normalize = (v: string) => v.trim().replace(/^W\//, '')
  const target = normalize(etag)
  if (normalize(ifNoneMatch) === '*' ) return true
  return ifNoneMatch.split(',').some((candidate) => normalize(candidate) === target)
}
