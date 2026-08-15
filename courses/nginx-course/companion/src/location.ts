import type { LocationBlock } from './types.js'

/**
 * location 匹配：对齐真实 Nginx 的判定顺序。
 * 1. 精确 = 命中即返回
 * 2. 记住最长命中的前缀块（prefix 与 ^~ 一视同仁参与"最长"比较）
 * 3. 最长前缀块若带 ^~，跳过正则直接返回它
 * 4. 否则按声明顺序试正则（~ 大小写敏感，~* 不敏感），第一个命中即返回
 * 5. 都没有正则命中，返回记住的最长前缀块（可能为 null）
 */
export function matchLocation(
  locations: LocationBlock[] | undefined,
  uri: string,
): LocationBlock | null {
  if (!locations || locations.length === 0) return null

  for (const loc of locations) {
    if (loc.match.type === '=' && uri === loc.match.path) return loc
  }

  let longestPrefix: LocationBlock | null = null
  for (const loc of locations) {
    if (loc.match.type !== 'prefix' && loc.match.type !== '^~') continue
    if (!uri.startsWith(loc.match.path)) continue
    const current = longestPrefix?.match.path.length ?? 0
    if (loc.match.path.length >= current) longestPrefix = loc
  }
  if (longestPrefix?.match.type === '^~') return longestPrefix

  for (const loc of locations) {
    const { type, path } = loc.match
    if (type === '~' || type === '~*') {
      const re = new RegExp(path, type === '~*' ? 'i' : undefined)
      if (re.test(uri)) return loc
    }
  }

  return longestPrefix
}
