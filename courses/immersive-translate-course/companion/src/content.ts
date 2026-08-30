/**
 * 主内容识别（第 6 章）：认出页面里「值得花翻译额度」的正文区。
 * 公共 API：detectMainContent / weighRegion / RegionMass。
 */
import { BLOCK_TAGS, DEFAULT_SKIP_TAGS, extractBlocks, type TranslatableBlock } from './extract'

/** 语义地标：作者亲口指认「正文在这」的写法——main、article，或 ARIA 的 role="main"。 */
const LANDMARK_SELECTOR = 'main, article, [role="main"]'

/** 区域门槛：托着不足 3 个可译块的容器不叫「区域」，是块的包装纸。 */
const MIN_REGION_BLOCKS = 3

/** 同量级份额：分数达到最高候选八成才算同量级，同量级里取最深（最紧）的。 */
const TOP_SHARE = 0.8

/** 与第 2 章 collectDirectText 同一条账本边界：这些标签的字不算块自己的。 */
const SKIP: ReadonlySet<string> = new Set(DEFAULT_SKIP_TAGS)

/** 折叠空白——与 extract 的 normalize 同一条规则。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 区域分量：可译字符总量（文字密度的账）与住在链接里的字符量（链接密度的分子）。 */
export interface RegionMass {
  /** 文字密度：这个区域的可译字符总量——正文区是全页文字最沉的地方 */
  textChars: number
  /** 链接字符量：住在 <a> 里的那部分——算文字，但算「用来点击的文字」 */
  linkChars: number
}

/** 一个块里住在链接中的字符量：走 collectDirectText 同一条边界，<a> 后代的字单独立账。 */
function linkCharsOf(block: TranslatableBlock): number {
  let raw = ''
  const visit = (node: Node, inLink: boolean): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3 /* Node.TEXT_NODE */) {
        if (inLink) raw += child.textContent ?? ''
      } else if (child.nodeType === 1 /* Node.ELEMENT_NODE */) {
        const tag = (child as Element).tagName.toLowerCase()
        if (SKIP.has(tag) || BLOCK_TAGS.has(tag)) continue // 同一条账本边界：跳过族不算，子块的字它自己记
        visit(child, inLink || tag === 'a')
      }
    }
  }
  visit(block.element, false)
  return normalize(raw).length
}

/**
 * 称一个区域的分量——只认第 2 章账本里的字（可译块），script/pre/button 的字不进账。
 * 两个密度都从这份账出：文字密度＝可译字符总量（分量），链接密度＝链接字符 ÷ 可译字符（折扣）。
 */
export function weighRegion(el: Element): RegionMass {
  const mass: RegionMass = { textChars: 0, linkChars: 0 }
  for (const block of extractBlocks(el)) {
    mass.textChars += block.text.length
    mass.linkChars += linkCharsOf(block)
  }
  return mass
}

/** 区域得分：文字分量 ×（1 − 链接密度）——住在链接外的字全额计分，链接里的字全额打折。 */
function regionScore(el: Element): number {
  const { textChars, linkChars } = weighRegion(el)
  if (textChars === 0) return 0
  return textChars * (1 - linkChars / textChars)
}

/** 密度兜底的候选池：托着足够多可译块的容器（root 自己除外——选它等于没选）。 */
function regionCandidates(root: ParentNode): Element[] {
  const counts = new Map<Element, number>()
  for (const block of extractBlocks(root)) {
    for (let el = block.element.parentElement; el !== null && el !== root; el = el.parentElement) {
      counts.set(el, (counts.get(el) ?? 0) + 1)
    }
  }
  return [...counts].filter(([, n]) => n >= MIN_REGION_BLOCKS).map(([el]) => el)
}

/** el 在 root 之内的深度——同量级候选里深者更紧：外面包的零碎更少。 */
function depthWithin(el: Element, root: ParentNode): number {
  let depth = 0
  for (let cur: Element | null = el; cur !== null && cur !== root; cur = cur.parentElement) depth++
  return depth
}

/**
 * 认出 root 里的主内容容器，认不出返回 null。
 * 两步走，地标与密度是配合不是替代：
 * ① 语义地标圈候选——作者写了 main/article 就信一半：它指认「正文在这」，
 *    但可能包得太宽（main 里裹着侧栏），也可能一个都没有（div 汤）；
 * ② 密度裁决——给候选称分量（文字密度），按链接密度打折，
 *    同量级（最高分的八成）里取最深的那个。
 * 地标一个都没有时，候选池换成密度兜底：凡托着足够多可译块的容器都入围。
 * 启发式的本分：快、够用、不保证全对——认错与认不出的场景登记在差异清单。
 */
export function detectMainContent(root: ParentNode): Element | null {
  const landmarks = Array.from(root.querySelectorAll(LANDMARK_SELECTOR))
  const pool = landmarks.length > 0 ? landmarks : regionCandidates(root)
  if (pool.length === 0) return null
  const ranked = pool.map((el) => ({ el, score: regionScore(el), depth: depthWithin(el, root) }))
  const best = Math.max(...ranked.map((r) => r.score))
  if (best <= 0) return null // 一行正文都没称出来：没有「主内容」可认
  return ranked
    .filter((r) => r.score >= best * TOP_SHARE)
    .sort((a, b) => b.depth - a.depth || b.score - a.score)[0].el
}
