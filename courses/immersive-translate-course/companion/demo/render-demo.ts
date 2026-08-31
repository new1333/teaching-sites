import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR, renderBilingual } from '../src/render'

/**
 * 第 3 章 demo：渲染前后的 HTML 对照——原文子元素逐个还在；
 * 顺手复现钩子里的一行事故，再把幂等摆上柜台。
 * 注意：tsx 跑在纯 Node 里，全局 document 并不存在——
 * 译文节点的出生证来自原文的 ownerDocument，这条路线因此走得通。
 */
console.log(`本 demo 跑在纯 Node 里：全局 document 的类型是 ${typeof document}`)

// 块只抽一遍（渲染之后再抽，译文自己也会被当成新原文——文末专门看这件事）
const doc = parseHTML(NEWS_PAGE_HTML)
const blocks = extractBlocks(doc.body)
const strongP = blocks.find((b) => b.text.includes('significant speedups'))!

// —— 路线 A：插兄弟节点 ——
console.log('\n=== 渲染前：原文（一段带加粗的段落） ===')
console.log(strongP.element.outerHTML)
renderBilingual(strongP, '早期用户报告在树密集的工作负载中有显著提速，不过也有人怀念更简单的旧 API。')
console.log('\n=== 路线 A · renderBilingual 之后 ===')
console.log('原文（一字未动）：')
console.log(strongP.element.outerHTML)
console.log('紧跟其后的译文：')
console.log(strongP.element.nextElementSibling!.outerHTML)
console.log(`子元素点名：strong 还在吗 → ${strongP.element.querySelector('strong') !== null}`)

// —— 路线 B：同事的一行代码 ——
const doc2 = parseHTML(NEWS_PAGE_HTML)
const p2 = extractBlocks(doc2.body).find((b) => b.text.includes('significant speedups'))!.element
p2.textContent += '\n早期用户报告在树密集的工作负载中有显著提速……'
console.log('\n=== 路线 B · 同事的一行代码（textContent +=；jsdom 未实现 innerText，两者同族语义） ===')
console.log(p2.outerHTML)
console.log(`子元素点名：strong 还在吗 → ${p2.querySelector('strong') !== null}`)
console.log('结局：子元素被清掉重建成了纯文本节点——行内结构与监听器一起陪葬。')

// —— 整页渲染 + 幂等 ——
const before = blocks.map((b) => b.element.outerHTML)
for (const b of blocks) renderBilingual(b, `【译】${b.text}`)
const once = doc.querySelectorAll(`[${OWN_ATTR}]`).length
const unchanged = blocks.every((b, i) => b.element.outerHTML === before[i])
for (const b of blocks) renderBilingual(b, `【译】${b.text}`) // 同一批块原样再渲染一遍
const twice = doc.querySelectorAll(`[${OWN_ATTR}]`).length
console.log('\n=== 整页逐块渲染 ===')
console.log(`译文节点数：${once}；原文 outerHTML 逐字未变：${unchanged}`)
console.log('\n=== 幂等：同一批块原样再渲染一遍 ===')
console.log(`译文节点数：${once} → ${twice}（不变——重复调用不产生第二份译文）`)

// —— 抬眼一看：渲染后再跑一遍抽取会怎样 ——
const after = extractBlocks(doc.body)
console.log('\n=== 抬眼一看：渲染后再跑一遍抽取 ===')
console.log(`可译块数：${blocks.length} → ${after.length}（多出来的全是刚插的译文——「译文生译文」的引信）`)
