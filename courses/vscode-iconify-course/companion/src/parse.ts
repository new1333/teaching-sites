import { createConfig } from './config'

export interface ParsedIcon {
  collection: string
  icon: string
}

// 分隔符候选与识别共用一份默认配置,同样按长度降序:-- 必须排在 - 前面
const DELIMITERS = [...createConfig().delimiters].sort((a, b) => b.length - a.length)

export function parseIcon(str: string, collectionIds: string[]): ParsedIcon | undefined {
  // 与正则交替同理:字符串前缀匹配是首个命中优先,长集合 id 必须先试
  const ids = [...collectionIds].sort((a, b) => b.length - a.length)
  for (const collection of ids) {
    if (!str.startsWith(collection))
      continue
    const rest = str.slice(collection.length)
    const delimiter = DELIMITERS.find(d => rest.startsWith(d))
    if (!delimiter)
      continue
    const icon = rest.slice(delimiter.length)
    if (!icon)
      return undefined
    return { collection, icon }
  }
  return undefined
}

/** 别名(短名)→ 真实图标键;未命中原样返回 */
export function applyAlias(key: string, aliases: Record<string, string>): string {
  return aliases[key] ?? key
}
