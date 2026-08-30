/**
 * 内联格式保留（第 5 章）：占位标记法——翻译单元里的记号替内联标签「出差」，
 * 译文回来后按索引认亲、重建结构，strong/a/code 在译文里活回来。
 * 公共 API：splitSegments / renderSegments。
 */
import { BLOCK_TAGS, DEFAULT_SKIP_TAGS, type TranslatableBlock } from './extract'
import { OWN_ATTR, isOwnNode } from './render'

/** 成对记号包裹的可翻译内联：内容随整句送翻，结构按记号重建；a 的 href 靠浅克隆活下来。 */
const WRAP_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'b', 'i', 'a'])

/** 不可译内联（行内 code）：一枚独立记号暂代，内容不送翻、原文逐字拼回——第 2 章的账在这还。 */
const KEEP_TAGS: ReadonlySet<string> = new Set(['code'])

/** 跳过族的其余成员（button 等）：文本不进翻译单元——与第 2 章 collectDirectText 同一条边界。 */
const SKIP_INLINE: ReadonlySet<string> = new Set(DEFAULT_SKIP_TAGS.filter((t) => t !== 'code'))

/** 内联槽位：solo＝独立记号暂代、原样拼回；pair＝成对记号包裹、内容送翻后重建。 */
interface Slot {
  kind: 'solo' | 'pair'
  el: Element
}

/** 记号语法：⟦0⟧ 开、⟦/0⟧ 闭——罕见字符＋数字编号，正文撞不上、分词器拆不开。 */
function markOpen(i: number): string {
  return `⟦${i}⟧`
}
function markClose(i: number): string {
  return `⟦/${i}⟧`
}
const MARKER_RE = /⟦(\/?)(\d+)⟧/g
const MARKER_ANY_RE = /⟦[^⟧]*⟧/g

/** 折叠空白——与 extract 的 normalize 同一条规则：送翻文本不带排版空隙。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 织出带记号的翻译单元：文本照走（空白最后统一折叠），code 换成独立记号，
 * strong/a 换成成对记号夹着它的摊平文本；块级子代跳过——它的账它自己记。
 * 这趟走法与第 2 章的 collectDirectText 同构：同一棵树、同一条边界，只是边界上立了记号。
 */
function weave(el: Element, slots: Slot[]): string {
  let out = ''
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* Node.TEXT_NODE */) {
      out += child.textContent ?? ''
      continue
    }
    if (child.nodeType !== 1 /* Node.ELEMENT_NODE */) continue
    const tag = (child as Element).tagName.toLowerCase()
    if (KEEP_TAGS.has(tag)) {
      out += markOpen(slots.length) // 独立记号：整枚占位，代码不出门
      slots.push({ kind: 'solo', el: child as Element })
    } else if (WRAP_TAGS.has(tag)) {
      const i = slots.length
      slots.push({ kind: 'pair', el: child as Element })
      out += markOpen(i) + normalize((child as Element).textContent ?? '') + markClose(i)
    } else if (SKIP_INLINE.has(tag) || BLOCK_TAGS.has(tag)) {
      continue // 跳过族与块级子代：与第 2 章同一条账本边界
    } else {
      out += weave(child as Element, slots) // 其他内联：往里走，里层的 strong/code 照样立记号
    }
  }
  return out
}

/**
 * 切出一个块的翻译单元（占位标记方案：一块一个单元，整句上下文完整）。
 * 返回 string[] 是与 Translator 的批量形状对齐——第 7 章把多块打进一单时，这里的形状不用改。
 */
export function splitSegments(block: TranslatableBlock): string[] {
  return [normalize(weave(block.element, []))]
}

/** 造一个带标记属性的空译文节点，插到原文正后方——与 renderBilingual 同一条出生流程。 */
function insertFresh(block: TranslatableBlock): Element {
  const node = block.element.ownerDocument.createElement('p')
  node.setAttribute(OWN_ATTR, '1') // 先打记号再上树：从挂上那一刻起它就是「自己人」
  block.element.insertAdjacentElement('afterend', node)
  return node
}

/**
 * 把译文按记号重建进译文节点：文本落文本节点，闭记号合拢成包裹元素，独立记号拼回原文。
 * 记号对不上号（被吞、被拆、编号陌生）就降级：剥掉残记号按纯文本渲染——格式丢、译文留。
 */
function rebuild(target: Element, translated: string, slots: Slot[]): void {
  const doc = target.ownerDocument
  target.textContent = '' // 幂等刷新路径：清掉旧内容原地重建
  let openFrag: DocumentFragment | null = null // 成对记号不嵌套：同时最多开一对（fragment＝离体收纳袋：挂进树时整体倒出内容、自己不占节点）
  let openIndex: number | null = null
  const appendText = (raw: string): void => {
    if (raw === '') return
    ;(openFrag ?? target).appendChild(doc.createTextNode(raw))
  }
  let failed = false
  let last = 0
  for (const m of translated.matchAll(MARKER_RE)) {
    const at = m.index ?? 0
    appendText(translated.slice(last, at))
    const slot = slots[Number(m[2])]
    if (slot === undefined) {
      failed = true // 陌生编号：译文里的记号与槽位对不上号
      break
    }
    if (m[1] === '/') {
      if (openFrag === null || openIndex !== Number(m[2])) {
        failed = true // 闭记号没有配对的开记号
        break
      }
      const wrap = slot.el.cloneNode(false) as Element // 浅克隆：标签＋属性原样（href 在这活下来），内容重填
      wrap.appendChild(openFrag)
      target.appendChild(wrap)
      openFrag = null
      openIndex = null
    } else if (slot.kind === 'solo') {
      target.appendChild(slot.el.cloneNode(true)) // 深克隆：code 原文逐字拼回，一个字符没出门
    } else {
      if (openFrag !== null) {
        failed = true // 成对记号里又开记号：嵌套不在本章方案内
        break
      }
      openFrag = doc.createDocumentFragment()
      openIndex = Number(m[2])
    }
    last = at + m[0].length
  }
  if (!failed && openFrag === null) {
    appendText(translated.slice(last)) // 收尾文本
  } else {
    // 降级：结构放弃，译文保留——第 4 章「翻译是增强不是生死要件」的同一条纪律
    target.textContent = translated.replace(MARKER_ANY_RE, '')
  }
}

/**
 * 把带记号的译文渲染成块的正后方译文节点，返回它；幂等（先认后插，同块刷新不重建节点）。
 *
 * 正确性前提藏在第 3 章的纪律里：原文一个字不动——renderSegments 在原文上再走一遍
 * weave 重新登记槽位，两次走出的一一对应，靠的就是这棵树没变过。
 */
export function renderSegments(block: TranslatableBlock, translations: string[]): Element {
  const translated = translations[0] ?? ''
  const existing = block.element.nextElementSibling
  const node = existing !== null && isOwnNode(existing) ? existing : insertFresh(block)
  const slots: Slot[] = []
  weave(block.element, slots)
  rebuild(node, translated, slots)
  return node
}
