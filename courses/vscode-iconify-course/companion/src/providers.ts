import type { CollectionMeta } from './collections'
import type { IconIntelliConfig } from './config'
import { buildRegexes, escapeRegExp } from './config'

export interface CompletionItemDescriptor {
  label: string
  detail: string
  kind: 'collection' | 'icon' | 'alias'
  /** 行内替换起点:补全应覆盖 [replaceStart, 行尾] 区间,而非整个词根 */
  replaceStart: number
}

export interface ProviderContext {
  config: IconIntelliConfig
  /** 集合元数据(id + 图标名清单),常驻内存,补全不触网 */
  collections: CollectionMeta[]
  aliases?: Record<string, string>
  getIconMarkdown: (key: string) => Promise<string>
  getCollectionMarkdown: (id: string) => Promise<string>
}

/**
 * 两段式补全:命名空间上下文(集合+分隔符已写)补图标名;
 * 裸前缀上下文补集合 id。替换区间统一取「行尾正在敲的那个词」。
 */
export function provideCompletions(
  linePrefix: string,
  ctx: ProviderContext,
): CompletionItemDescriptor[] | null {
  const { prefixed } = buildRegexes(ctx.config)
  if (!linePrefix.match(prefixed))
    return null

  const replaceStart = computeReplaceStart(linePrefix, ctx.config)

  const aliasItems: CompletionItemDescriptor[] = Object.entries(ctx.aliases ?? {}).map(
    ([label, actual]) => ({ label, detail: actual, kind: 'alias', replaceStart }),
  )

  if (ctx.config.customAliasesOnly)
    return aliasItems

  const namespaceMatch = linePrefix.match(namespaceOf(ctx.config))
  if (namespaceMatch) {
    const id = namespaceMatch[1]!
    const meta = ctx.collections.find(c => c.id === id)
    if (meta) {
      return [
        ...aliasItems,
        ...meta.icons.map(icon => ({
          label: icon,
          detail: `${id}${ctx.config.delimiters[0]}${icon}`,
          kind: 'icon' as const,
          replaceStart,
        })),
      ]
    }
  }

  return [
    ...aliasItems,
    ...ctx.collections.map(c => ({
      label: c.id,
      detail: c.id,
      kind: 'collection' as const,
      replaceStart,
    })),
  ]
}

/** 选中候选后才取文档:昂贵的大图渲染推迟到这一刻 */
export async function resolveCompletion(
  item: CompletionItemDescriptor,
  ctx: ProviderContext,
): Promise<CompletionItemDescriptor & { documentation: string }> {
  const documentation = item.kind === 'collection'
    ? await ctx.getCollectionMarkdown(item.label)
    : await ctx.getIconMarkdown(item.detail)
  return { ...item, documentation }
}

function namespaceOf(config: IconIntelliConfig) {
  return buildRegexes(config).namespace
}

/**
 * 替换区间的起点 = 「行尾最后一个前缀或分隔符之后的那个词」的开头。
 * 词字符类含 '-',所以不能从整行倒着截,必须先锚定分隔结构再取其后的词。
 */
function computeReplaceStart(linePrefix: string, config: IconIntelliConfig): number {
  const breakers = [...config.prefixes.filter(Boolean), ...config.delimiters]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
  const anchored = new RegExp(`(?:${breakers.join('|')})[\\w-]*$`).exec(linePrefix)
  if (!anchored)
    return linePrefix.length - (/[\w-]*$/.exec(linePrefix)![0].length)
  const breaker = new RegExp(`^(?:${breakers.join('|')})`).exec(anchored[0])!
  const word = anchored[0].slice(breaker[0].length)
  return linePrefix.length - word.length
}
