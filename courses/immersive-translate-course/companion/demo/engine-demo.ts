import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { OWN_ATTR } from '../src/render'
import { createCountingTranslator, createFakeTranslator, type Translator } from '../src/translate'
import { createEngine } from '../src/engine'

/**
 * 第 4 章 demo：createEngine({ translator }).run(root) 一键把整页变双语。
 * 三幕：① 默认档一键整页（零网络零密钥）② 计数观察孔数请求 ③ 一块 503，整页不倒。
 */

// —— 第一幕：一键双语——词典版假翻译器注入，引擎全程不认识任何真实服务 ——
const dict = { 'Lightweight DOM library hits version 2.0': '轻量 DOM 库发布 2.0 版' }
const doc = parseHTML(NEWS_PAGE_HTML)
const stats = await createEngine({ translator: createFakeTranslator(dict) }).run(doc.body)
console.log('=== 第一幕：createEngine({ translator: createFakeTranslator(dict) }).run(doc.body) ===')
console.log(`成绩单：${stats.blocks} 块渲染 / ${stats.requests} 次请求 / ${stats.cached} 次缓存命中`)
console.log('\n=== 整页双语 HTML（main 区域） ===')
console.log(doc.querySelector('main')!.outerHTML)

// —— 第二幕：数请求——依赖注入顺手开的观察孔 ——
const doc2 = parseHTML(NEWS_PAGE_HTML)
const counting = createCountingTranslator(createFakeTranslator())
const stats2 = await createEngine({ translator: counting.translator }).run(doc2.body)
console.log('\n=== 第二幕：createCountingTranslator 数出的请求账单 ===')
console.log(`块数 ${stats2.blocks}，发出的请求 ${counting.batches.length} 单，每单条数：${counting.batches.map((b) => b.length).join(' + ')}`)
console.log(`第一单内容：${JSON.stringify(counting.batches[0])}`)
console.log('（一块一单的串行朴素版——打包与省钱后面单章细算）')

// —— 第三幕：逐块失败降级——一块 503，整页不倒 ——
const doc3 = parseHTML(NEWS_PAGE_HTML)
const flaky: Translator = {
  async translate(texts) {
    if (texts[0].includes('plugin system')) throw new Error('503 Service Unavailable')
    return texts.map((t) => `【译】${t}`)
  },
}
const stats3 = await createEngine({ translator: flaky }).run(doc3.body)
// 指认失败块：正文段落里找「不是自己人、且内容命中」的那个（译文节点没有 class，光 :not([class]) 会认错）
const failed = [...doc3.querySelectorAll('article > p:not([class])')].find(
  (p) => !p.hasAttribute(OWN_ATTR) && p.textContent.includes('plugin system'),
)!
console.log('\n=== 第三幕：一块 503 ===')
console.log(`成绩单：${stats3.blocks} 块渲染 / ${stats3.requests} 次请求（失败那次也真发过）；页面译文节点：${doc3.querySelectorAll(`[${OWN_ATTR}]`).length}`)
console.log('挂掉那段的原文（原样躺着，身后没有译文）：')
console.log(failed.outerHTML)
console.log('其余 13 块照常双语，异常没有炸出 run。')
