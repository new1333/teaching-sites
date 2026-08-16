import type { IconIntelliConfig } from './config'
import { applyAlias, parseIcon } from './parse'
import type { Renderer } from './render'
import { toRenderInfo } from './render'
import type { IconSetData } from './types'

export interface MarkdownEnv {
  config: IconIntelliConfig
  collectionIds: string[]
  aliases?: Record<string, string>
  loadIconSet: (id: string) => Promise<IconSetData | undefined>
  render: Renderer
  /** 集合 id → 展示名,缺省用 id 本身 */
  collectionNames?: Record<string, string>
  fontSize?: number
}

/** 图标悬停文档:markdown 表格里内嵌 data URL 大图,展示用户书写的键 */
export async function getIconMarkdown(key: string, env: MarkdownEnv): Promise<string> {
  const actualKey = applyAlias(key, env.aliases ?? {})
  const parsed = parseIcon(actualKey, env.collectionIds)
  if (!parsed)
    return ''
  const set = await env.loadIconSet(parsed.collection)
  if (!set)
    return ''
  const info = toRenderInfo(set, parsed.icon, actualKey)
  if (!info)
    return ''
  const dataUrl = env.render.getIconDataUrl(info, env.fontSize ?? 150)
  return `| |\n|:---:|\n| ![](${dataUrl}) |\n| \`${key}\` |`
}

/** 集合悬停文档:标题 + 至多 5 个图标的小图预览 */
export async function getCollectionMarkdown(id: string, env: MarkdownEnv): Promise<string> {
  const set = await env.loadIconSet(id)
  if (!set)
    return ''
  const previews = Object.keys(set.icons)
    .slice(0, 5)
    .map(name => toRenderInfo(set, name, `${id}${env.config.delimiters[0]}${name}`))
    .filter(info => info !== undefined)
    .map(info => `![](${env.render.getIconDataUrl(info, env.fontSize ?? 24)})`)
    .join('  ')
  const title = env.collectionNames?.[id] ?? id
  return `#### ${title}\n\n${previews}\n`
}
