import { parseHTML } from '../tests/helpers'
import { SHOP_PAGE_HTML } from '../src/fixtures/shop-page'
import { createCountingTranslator, createFakeTranslator, type Translator } from '../src/translate'
import { createEngine } from '../src/engine'
import { extractBlocks } from '../src/extract'

/**
 * 第 7 章 demo：请求账单——N 个段落 → M 个请求，二次运行 0 请求。
 * 三幕：① 朴素档（第 4 章的引擎）跑商品页的事故现场 ② 批量档去重＋打包＋限流 ③ 缓存档二次运行零请求。
 */

/** 在飞峰值观察器：包住任意翻译器，记「同一时刻最多几单在飞」。 */
function createPeakTranslator(inner: Translator): { translator: Translator; peak(): number } {
  let active = 0
  let peak = 0
  return {
    peak: () => peak,
    translator: {
      async translate(texts) {
        active++
        peak = Math.max(peak, active)
        await null // 让出一线微任务：让「同时在飞」有机会重叠、看得见
        try {
          return await inner.translate(texts)
        } finally {
          active--
        }
      },
    },
  }
}

const blockCount = extractBlocks(parseHTML(SHOP_PAGE_HTML).body).length
console.log(`商品列表页：${blockCount} 个可译块（12 张卡片 × 3 块 + 页头 1 块，其中 12 张卡片写着同一句 Add to cart）`)

// —— 第一幕：朴素档——第 4 章的引擎原样跑，一块一单的事故现场 ——
const doc1 = parseHTML(SHOP_PAGE_HTML)
const counting1 = createCountingTranslator(createFakeTranslator())
const stats1 = await createEngine({ translator: counting1.translator }).run(doc1.body)
console.log('\n=== 第一幕：朴素档（不加任何选项） ===')
console.log(`成绩单：${stats1.blocks} 块渲染 / ${stats1.requests} 次请求 / ${stats1.cached} 次缓存命中`)
console.log(`请求账单：${counting1.batches.length} 单，每单条数：${counting1.batches.map((b) => b.length).join(' + ')}`)
console.log(`"Add to cart" 出门次数：${counting1.batches.flat().filter((t) => t === 'Add to cart').length}（12 张卡片，同一句话付了 12 次钱）`)

// —— 第二幕：批量档——去重、按字符预算打包、并发上限 ——
const doc2 = parseHTML(SHOP_PAGE_HTML)
const counting2 = createCountingTranslator(createFakeTranslator())
const peak2 = createPeakTranslator(counting2.translator)
const stats2 = await createEngine({ translator: peak2.translator, concurrency: 2 }).run(doc2.body)
const sent2 = counting2.batches.flat()
console.log('\n=== 第二幕：批量档（concurrency: 2） ===')
console.log(`成绩单：${stats2.blocks} 块渲染 / ${stats2.requests} 次请求 / ${stats2.cached} 次缓存命中`)
console.log(`请求账单：${blockCount} 块 → ${new Set(sent2).size} 句（去重） → ${counting2.batches.length} 单（按字符预算装袋）`)
console.log(`每单条数：${counting2.batches.map((b) => b.length).join(' + ')}`)
console.log(`"Add to cart" 出门次数：${sent2.filter((t) => t === 'Add to cart').length}（去重之后，12 张卡片只付一次钱）`)
console.log(`在飞峰值：${peak2.peak()} / 上限 2（单数再多，同时在飞的不超过窗口数）`)

// —— 第三幕：缓存档——第一轮翻完，第二轮零请求 ——
const counting3 = createCountingTranslator(createFakeTranslator())
const engine3 = createEngine({ translator: counting3.translator, concurrency: 2, useCache: true })
const first = await engine3.run(parseHTML(SHOP_PAGE_HTML).body)
console.log('\n=== 第三幕：缓存档（useCache: true，叠在批量档上），同一台引擎翻两页 ===')
console.log(`第一页：${first.blocks} 块渲染 / ${first.requests} 次请求 / ${first.cached} 次缓存命中`)
const billsAfterFirst = counting3.batches.length
const second = await engine3.run(parseHTML(SHOP_PAGE_HTML).body) // 新的一棵树，同一台引擎
console.log(`第二页：${second.blocks} 块渲染 / ${second.requests} 次请求 / ${second.cached} 次缓存命中`)
console.log(`账本两轮合计 ${counting3.batches.length} 单（首轮 ${billsAfterFirst} 单，第二轮一单没发）——没有缓存，第二页要再花 ${billsAfterFirst} 单`)
