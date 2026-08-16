import { builtinCollectionIds } from './collections'

export interface IconIntelliConfig {
  /** 集合 id 与图标 id 之间的分隔符候选 */
  delimiters: string[]
  /** 图标键允许的前缀候选 */
  prefixes: string[]
  /** 图标键允许的后缀候选 */
  suffixes: string[]
  /** 参与识别的集合 id 列表;缺省用内置静态清单 */
  collections?: string[]
  /** 参与识别的别名 id 列表 */
  aliases?: string[]
  /** 纯别名模式:只识别别名,不再识别「集合+分隔符+图标名」形态 */
  customAliasesOnly?: boolean
}

export function createConfig(partial: Partial<IconIntelliConfig> = {}): IconIntelliConfig {
  return {
    delimiters: partial.delimiters ?? [':', '--', '-', '/'],
    prefixes: partial.prefixes ?? ['', 'i-', '~icons/'],
    suffixes: partial.suffixes ?? ['', 'i-'],
    ...(partial.collections !== undefined ? { collections: partial.collections } : {}),
    ...(partial.aliases !== undefined ? { aliases: partial.aliases } : {}),
    ...(partial.customAliasesOnly !== undefined ? { customAliasesOnly: partial.customAliasesOnly } : {}),
  }
}

export function escapeRegExp(text: string) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}

/** 一组候选拼成「可选出现」的分组:`['', 'i-']` → `(?:i-)?`,`[]` → '' */
function buildOptionalAlternation(list: string[]) {
  const nonEmpty = list.filter(Boolean)
  if (!nonEmpty.length)
    return ''
  const body = nonEmpty.map(escapeRegExp).join('|')
  return list.includes('') ? `(?:${body})?` : `(?:${body})`
}

export interface Regexes {
  /** 全局正则:识别「集合+分隔符+图标名」或别名的完整形态 */
  full: RegExp
  /** 非全局:行尾是否处于「前缀后的词」上下文(补全入口用) */
  prefixed: RegExp
  /** 非全局:行尾是否处于「集合+分隔符」命名空间上下文 */
  namespace: RegExp
}

export function buildRegexes(config: IconIntelliConfig): Regexes {
  // 交替分支按长度降序:正则的交替是首个匹配优先,长 id 必须排在短 id 前面
  const collectionIds = [...(config.collections ?? builtinCollectionIds)]
    .sort((a, b) => b.length - a.length)
  const aliasIds = [...(config.aliases ?? [])].sort((a, b) => b.length - a.length)

  const reDelimiters = `(${config.delimiters.map(escapeRegExp).join('|')})`
  const rePrefixes = buildOptionalAlternation(config.prefixes)
  const reSuffixes = buildOptionalAlternation(config.suffixes)

  const collectionPart = `(?:${collectionIds.join('|')})${reDelimiters}[\\w-]+`
  const aliasPart = aliasIds.length ? `|(?:${aliasIds.join('|')})` : ''

  const full = new RegExp(
    `[^\\w\\d]${rePrefixes}(${collectionPart}${aliasPart})${reSuffixes}(?![\\w-])`,
    'g',
  )
  const prefixed = new RegExp(`[^\\w\\d]${rePrefixes}[\\w-]*$`)
  const namespace = new RegExp(
    `[^\\w\\d]${rePrefixes}(${collectionIds.join('|')})${reDelimiters}[\\w-]*$`,
  )
  return { full, prefixed, namespace }
}
