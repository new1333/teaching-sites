import type { IconIntelliConfig } from './config'
import type { Renderer } from './render'
import { toRenderInfo } from './render'
import type { IconSetData } from './types'
import { applyAlias, parseIcon } from './parse'
import { collectMatches, type Position } from './scan'

/** 一条装饰的完整描述:编辑器侧只需把它翻译成原生装饰 API */
export interface DecorationDescriptor {
  range: { start: Position, end: Position }
  /** 用户书写的原始键(别名不替换,保持所见即所得) */
  key: string
  dataUrl: string
  hoverMarkdown: string
  /** in-place 模式用:是否隐藏原文字、只留图标 */
  hideText: boolean
}

export interface DecorationEnv {
  config: IconIntelliConfig
  collectionIds: string[]
  aliases?: Record<string, string>
  loadIconSet: (id: string) => Promise<IconSetData | undefined>
  render: Renderer
  fontSize?: number
  color?: string
  inplace?: boolean
  /** 光标所在行:in-place 模式下该行豁免隐藏,保证正在编辑的行可见可改 */
  cursorLine?: number
}

export async function collectDecorations(
  text: string,
  env: DecorationEnv,
): Promise<DecorationDescriptor[]> {
  // 别名表是唯一事实源:它的键同时驱动识别(正则的别名 id)与展开(键 → 真实键)
  const config = env.aliases
    ? { ...env.config, aliases: Object.keys(env.aliases) }
    : env.config
  const matches = collectMatches(text, config)
  const decorations: DecorationDescriptor[] = []
  for (const match of matches) {
    const actualKey = applyAlias(match.key, env.aliases ?? {})
    const parsed = parseIcon(actualKey, env.collectionIds)
    if (!parsed)
      continue
    const set = await env.loadIconSet(parsed.collection)
    if (!set)
      continue
    const info = toRenderInfo(set, parsed.icon, actualKey)
    if (!info)
      continue
    decorations.push({
      range: match.range,
      key: match.key,
      dataUrl: env.render.getIconDataUrl(info, env.fontSize ?? 12, env.color ?? 'currentColor'),
      hoverMarkdown: `\`${match.key}\``,
      hideText: env.inplace === true && match.range.start.line !== env.cursorLine,
    })
  }
  return decorations
}
