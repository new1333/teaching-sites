/**
 * 双语渲染（第 3 章）：在可译块正后方插入带标记的译文节点，原文一个字不动；幂等。
 * 公共 API：OWN_ATTR / renderBilingual / isOwnNode。
 */
import type { TranslatableBlock } from './extract'

/**
 * 标记属性名：引擎插入的每个译文节点都打这个记号。
 * 认自己人全靠它——重复渲染不重复插（本章），第 8 章变化监听还要靠它
 * 把译文从「新原文」里摘出去。data-* 前缀是 HTML 留给页面自定义数据的属性地界，
 * 不会跟页面作者的属性撞车；它还顺手是 CSS 选择器（[data-duo]），样式钩子白送。
 */
export const OWN_ATTR = 'data-duo'

/**
 * 判定一个元素是不是引擎自己插入的译文节点。
 * 只看「有没有标记属性」，不看值——值（"1"）是给人看的，判定语义是「这节点是我生的吗」。
 */
export function isOwnNode(el: Element): boolean {
  return el.hasAttribute(OWN_ATTR)
}

/**
 * 把译文渲染成可译块的正后方兄弟节点，返回译文节点；幂等。
 *
 * 三条纪律都在这十来行里：
 * ① 只插不改——原文的子树一个字节不碰，监听器、状态、行内结构原封不动；
 * ② 先认后插——紧邻的下一个兄弟若已是自己的译文，原地刷新文本并返回它，
 *    不产生第二份（认领范围只到紧邻兄弟：中间被别人插了节点，引擎会当它没有译文）；
 * ③ 出生证找这棵树自己开——ownerDocument 是节点所属的文档对象，
 *    不依赖全局 document（Node 与测试环境里它可能不存在，或不是这棵树）。
 */
export function renderBilingual(block: TranslatableBlock, translated: string): Element {
  const existing = block.element.nextElementSibling
  if (existing !== null && isOwnNode(existing)) {
    existing.textContent = translated // 重复调用：刷新旧译文的文本，节点还是那个节点
    return existing
  }
  // 原文是块级元素，译文也用块级标签 p——独占一行，才能落在正下方；
  // 不带原文的 class 与属性：译文自己管自己的样子（样式钩子就是 [data-duo]）
  const node = block.element.ownerDocument.createElement('p')
  node.setAttribute(OWN_ATTR, '1') // 先打记号再上树：从挂上那一刻起它就是「自己人」
  node.textContent = translated
  block.element.insertAdjacentElement('afterend', node) // 插在原文正后方当兄弟，等价于 after()
  return node
}
