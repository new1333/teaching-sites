import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { createFakeTranslator } from '../src/translate'
import { createEngine } from '../src/engine'

/**
 * 第 5 章 demo：占位标记法让内联格式在译文里活回来。
 * 三幕：① 原文/译文结构并排对照 ② 记号跟着译文语序走 ③ 记号被吞的降级。
 * 译文文字全部用 dict 钉死——眼睛只看结构。
 */

const STRONG_UNIT =
  'Early users report ⟦0⟧significant speedups⟦/0⟧ in tree-heavy workloads, though some miss the simpler old API.'
const CODE_UNIT = 'To try it, add one script tag to your page and call ⟦0⟧ on any element.'
const LINK_UNIT = '⟦0⟧CSS tricks you forgot⟦/0⟧'

/** 在一张新页面上找目标块（跑引擎前抽好——跑完树就变了）。 */
function blockOf(doc: Document, includes: string) {
  return extractBlocks(doc.body).find((b) => b.text.includes(includes))!
}

// —— 第一幕：并排对照——原文结构 vs 译文结构（strong / 行内 code / 链接） ——
const doc = parseHTML(NEWS_PAGE_HTML)
const targets = ['significant speedups', 'script tag', 'CSS tricks'].map((k) => blockOf(doc, k))
const dict = {
  [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速⟦/0⟧——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。',
  [CODE_UNIT]: '试试看：往页面加一个 script 标签，然后对任意元素调用 ⟦0⟧ 即可。',
  [LINK_UNIT]: '⟦0⟧你早就忘光的 CSS 技巧⟦/0⟧',
}
const stats = await createEngine({ translator: createFakeTranslator(dict), preserveInline: true }).run(doc.body)
console.log('=== 第一幕：createEngine({ translator: createFakeTranslator(dict), preserveInline: true }).run(doc.body) ===')
console.log(`成绩单：${stats.blocks} 块渲染 / ${stats.requests} 次请求 / ${stats.cached} 次缓存命中`)
for (const block of targets) {
  console.log(`\n【${block.element.children.length > 0 ? block.element.children[0].tagName.toLowerCase() : '纯文本'}块】原文  ${block.element.outerHTML}`)
  console.log(`            译文  ${block.element.nextElementSibling!.outerHTML}`)
}

// —— 第二幕：记号跟着译文的语序走——重建按索引认亲，不按位置 ——
const doc2 = parseHTML(NEWS_PAGE_HTML)
const strongP2 = blockOf(doc2, 'significant speedups') // 跑引擎前抽好，跑完树就变了
const reordered = {
  [STRONG_UNIT]: '⟦0⟧显著的提速⟦/0⟧——早期用户在树操作密集的工作负载中报告了这一点。',
}
await createEngine({ translator: createFakeTranslator(reordered), preserveInline: true }).run(doc2.body)
console.log('\n=== 第二幕：译文把加粗短语排到句首 ===')
console.log(`译文  ${strongP2.element.nextElementSibling!.outerHTML}`)
console.log('（strong 认的是 ⟦0⟧ 的索引，不是它在句中的位置——语序怎么挪，结构跟得上）')

// —— 第三幕：记号被吞的降级——格式丢、译文留 ——
const doc3 = parseHTML(NEWS_PAGE_HTML)
const strongP3 = blockOf(doc3, 'significant speedups')
const eaten = {
  // 模拟真实服务吃掉 ⟦/0⟧：开记号活着回来，闭记号没了
  [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。',
}
const stats3 = await createEngine({ translator: createFakeTranslator(eaten), preserveInline: true }).run(doc3.body)
console.log('\n=== 第三幕：闭记号被服务吞掉 ===')
console.log(`成绩单：${stats3.blocks} 块渲染 / ${stats3.requests} 次请求（整页照跑，没炸）`)
console.log(`译文  ${strongP3.element.nextElementSibling!.outerHTML}`)
console.log('（结构放弃、残记号剥掉、译文保留——格式保留是增强，不是生死要件）')
