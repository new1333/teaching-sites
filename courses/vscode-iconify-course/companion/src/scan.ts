import type { IconIntelliConfig } from './config'
import { buildRegexes } from './config'

/** 文本层的原始匹配:偏移区间 + 识别出的图标键 */
export interface RawMatch {
  start: number
  end: number
  key: string
}

export function findIconKeys(text: string, config: IconIntelliConfig): RawMatch[] {
  const { full } = buildRegexes(config)
  // 正则要求图标键前有一个非单词的「边界字符」;第 0 位的键没有可依托的前字符,
  // 前置一个哨兵空格补齐,命中区间再整体减一还原
  const padded = ` ${text}`
  const matches: RawMatch[] = []
  full.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = full.exec(padded))) {
    if (m[1])
      matches.push({ start: m.index, end: m.index + m[0].length - 1, key: m[1] })
    if (m.index === full.lastIndex)
      full.lastIndex++
  }
  return matches
}

/** 编辑器坐标:行与列,一律 0 起 */
export interface Position {
  line: number
  character: number
}

export function positionAt(text: string, offset: number): Position {
  const o = Math.max(0, Math.min(offset, text.length))
  let line = 0
  let lineStart = 0
  for (let i = 0; i < o; i++) {
    if (text[i] === '\n') {
      line++
      lineStart = i + 1
    }
  }
  let character = o - lineStart
  // CRLF:偏移恰好落在 \r 之后时,\r 属于行尾序列而非行内字符
  if (text[o - 1] === '\r')
    character--
  return { line, character }
}

/** 带行列范围的匹配:装饰定位直接消费 */
export interface IconMatch {
  range: { start: Position, end: Position }
  key: string
}

export function collectMatches(text: string, config: IconIntelliConfig): IconMatch[] {
  return findIconKeys(text, config).map(m => ({
    key: m.key,
    range: {
      start: positionAt(text, m.start),
      end: positionAt(text, m.end),
    },
  }))
}
