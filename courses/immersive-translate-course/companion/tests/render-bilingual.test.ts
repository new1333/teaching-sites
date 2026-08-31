import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR, isOwnNode, renderBilingual } from '../src/render'

/** 第 3 章测试：双语渲染的行为——插兄弟节点、打标记、原文纹丝不动、幂等。 */

describe('renderBilingual · 双语渲染', () => {
  it('译文节点插在原文正后方：块级 p、带标记属性、文本正确、与原文同属一棵文档', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const strongP = blocks.find((b) => b.text.includes('significant speedups'))!
    const zh = renderBilingual(strongP, '早期用户报告在树密集的工作负载中有显著提速……')
    expect(zh.tagName).toBe('P') // 原文是块级，译文也用块级标签才能独占一行落在正下方
    expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
    expect(zh.getAttribute(OWN_ATTR)).toBe('1')
    expect(zh.textContent).toBe('早期用户报告在树密集的工作负载中有显著提速……')
    expect(strongP.element.nextElementSibling).toBe(zh) // 位置：紧跟原文的下一个兄弟
    expect(zh.isConnected).toBe(true)
    expect(zh.ownerDocument).toBe(strongP.element.ownerDocument) // 出生证来自这棵树，不是别处
  })

  it('原文一个字不动：渲染后 outerHTML 逐字相同，子元素还在、监听器活着', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const strongP = blocks.find((b) => b.text.includes('significant speedups'))!
    const strong = strongP.element.querySelector('strong')!
    let fired = 0
    strong.addEventListener('click', () => fired++)
    const before = strongP.element.outerHTML
    renderBilingual(strongP, '早期用户报告……')
    expect(strongP.element.outerHTML).toBe(before) // 不碰原文的最强形式：序列化逐字相同
    expect(strongP.element.querySelector('strong')).not.toBeNull()
    strong.dispatchEvent(new doc.defaultView!.MouseEvent('click'))
    expect(fired).toBe(1) // 钩子里那个事故（监听器死亡）在这条路线上不发生
  })

  it('反事实对照：textContent 追加路线销毁子元素——同一个段落，两条路两种结局', () => {
    // jsdom 未实现 innerText（算「渲染文本」需要排版引擎），用同族语义的 textContent 复现钩子：
    // 两个 setter 在规范里都是「清空全部子节点、替换成全新节点」（innerText 拆段、换行转 <br>，
    // textContent 塞单个文本节点）——重写路线，销毁结构。
    const html = '<div><p>Use <a href="/x">strict mode</a> in production.</p></div>'
    // 路线 A：插兄弟节点
    const docA = parseHTML(html)
    const pA = docA.querySelector('p')!
    const beforeA = pA.outerHTML
    renderBilingual({ element: pA, text: pA.textContent ?? '' }, '在生产环境使用严格模式。')
    expect(pA.querySelector('a')).not.toBeNull() // 链接还在
    expect(pA.outerHTML).toBe(beforeA) // 原文没被动过
    // 路线 B：往原文自己的文本属性里追加
    const docB = parseHTML(html)
    const pB = docB.querySelector('p')!
    pB.textContent += '\n在生产环境使用严格模式。'
    expect(pB.querySelector('a')).toBeNull() // 链接消失
    expect(pB.childNodes.length).toBe(1) // 只剩一个纯文本节点
  })

  it('幂等：同块重复调用只保留一份译文——节点数不变、两次拿到同一个节点', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const target = blocks.find((b) => b.text.includes('three-kilobyte'))!
    const first = renderBilingual(target, '这个库以三 KB 的包体闻名……')
    const second = renderBilingual(target, '这个库以三 KB 的包体闻名……')
    expect(second).toBe(first) // 不是新节点，就是原来那个
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(1) // 全页只有一份译文
    expect(target.element.nextElementSibling).toBe(first)
  })

  it('幂等·重译刷新：同块换新译文再调，节点数不变、文本原地更新', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const target = blocks.find((b) => b.text.includes('three-kilobyte'))!
    const first = renderBilingual(target, '第一版译文')
    const updated = renderBilingual(target, '第二版译文')
    expect(updated).toBe(first) // 还是同一个节点
    expect(first.textContent).toBe('第二版译文') // 文本被刷新
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(1)
  })

  it('整页渲染：14 个块各领一段译文，每段译文紧跟各自原文，原文本体逐字未变', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    for (const b of blocks) renderBilingual(b, `【译】${b.text}`)
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(blocks.length)
    expect(blocks.every((b) => isOwnNode(b.element.nextElementSibling!))).toBe(true)
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before)
  })

  it('isOwnNode：认自己人只看标记属性——原文、页面元素、没打记号的新节点都不是', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const own = renderBilingual(blocks[0], '【译】站点名')
    expect(isOwnNode(own)).toBe(true)
    expect(isOwnNode(blocks[0].element)).toBe(false) // 原文不是自己人
    expect(isOwnNode(doc.querySelector('strong')!)).toBe(false) // 页面自己的元素不是
    const plain = doc.createElement('p') // 没打记号的新节点也不是
    expect(isOwnNode(plain)).toBe(false)
    plain.setAttribute(OWN_ATTR, '1') // 打上记号就是
    expect(isOwnNode(plain)).toBe(true)
  })
})
