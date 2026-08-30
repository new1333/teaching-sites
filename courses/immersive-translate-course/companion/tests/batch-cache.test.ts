import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { SHOP_PAGE_HTML } from '../src/fixtures/shop-page'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { isOwnNode } from '../src/render'
import { createCountingTranslator, createFakeTranslator, type Translator } from '../src/translate'
import { createEngine } from '../src/engine'
import { chunkByBudget, createLimiter } from '../src/batch'
import { createTranslationCache } from '../src/cache'

/** 第 7 章测试：批量、去重与缓存——重复段落只请求一次、并发峰值不超上限、二次 run 零请求。 */

/** 把微任务队列放空：让「已放行的请求收尾、排队者补位」全部落定，再断言现场。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * 闸门翻译器：每次调用先记一笔在飞，然后停在测试手里——不 open 不返回。
 * 并发控制没有它就只能测「快不快」，有了它才能测「同时几个在飞」。
 */
function createGateTranslator(): { translator: Translator; open(): void; peak(): number; inFlight(): number } {
  let active = 0
  let peak = 0
  const gates: Array<() => void> = []
  const translator: Translator = {
    async translate(texts) {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => gates.push(resolve))
      active--
      return texts.map((t) => `【译】${t}`)
    },
  }
  return { translator, open: () => gates.shift()!(), peak: () => peak, inFlight: () => active }
}

describe('chunkByBudget · 按字符预算打包', () => {
  it('装满一袋换一袋：顺序不乱、每袋不超预算——贪心装袋，不回头重排', () => {
    const a = 'a'.repeat(10)
    const b = 'b'.repeat(10)
    const c = 'c'.repeat(10)
    expect(chunkByBudget([a, b, c], 20)).toEqual([[a, b], [c]]) // 第三件装不下，自己开新袋
    expect(chunkByBudget([], 100)).toEqual([]) // 没货不开袋
  })

  it('超大件自己一袋且不切件：超过预算的段落独占一单，邻居各归各袋', () => {
    const huge = 'x'.repeat(50)
    expect(chunkByBudget(['short', huge, 'tiny'], 30)).toEqual([['short'], [huge], ['tiny']])
    expect(chunkByBudget([huge], 30)).toEqual([[huge]]) // 全场只有它也照开一单——不切件
  })
})

describe('createLimiter · 并发上限队列', () => {
  it('峰值不超上限：6 个任务进 2 个窗口，先来的先补位，全程最多 2 个在飞', async () => {
    const limit = createLimiter(2)
    let active = 0
    let peak = 0
    const gates: Array<() => void> = []
    const tasks = Array.from({ length: 6 }, (_, i) =>
      limit(async () => {
        active++
        peak = Math.max(peak, active)
        await new Promise<void>((resolve) => gates.push(resolve))
        active--
        return i
      }),
    )
    expect(peak).toBe(2) // 提交完立刻看得见：只有两个任务真的在跑，其余在排队
    expect(gates.length).toBe(2)
    gates.shift()!() // 放走队头那个
    await flush()
    expect(peak).toBe(2) // 队伍补位一个，峰值纹丝不动
    expect(gates.length).toBe(2)
    for (let i = 0; i < 6; i++) {
      // 放行剩下的：开一扇闸放一个，队伍里再补一个——补上的闸要等下一轮 flush 才出现
      for (const open of gates.splice(0)) open()
      await flush()
    }
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3, 4, 5]) // 结果与提交顺序一一对应
    expect(peak).toBe(2)
  })

  it('结果与异常都透传：任务成功传值、失败传拒，崩掉的任务不堵窗口', async () => {
    const limit = createLimiter(1)
    await expect(limit(async () => 'ok')).resolves.toBe('ok')
    await expect(limit(async () => { throw new Error('503') })).rejects.toThrow('503')
    await expect(limit(async () => 'next')).resolves.toBe('next') // 前面崩了，后面照常进场
    expect(createLimiter(0)).toBeTypeOf('function') // 上限 0 不炸：钳到 1，一个窗口慢慢来
  })
})

describe('createTranslationCache · 内容寻址缓存', () => {
  it('同文本同命中：键就是内容本身——重复 set 覆盖不新增，miss 返回 undefined', () => {
    const cache = createTranslationCache()
    expect(cache.get('Add to cart')).toBeUndefined() // 没翻过的话，缓存里没有它
    cache.set('Add to cart', '加入购物车')
    expect(cache.get('Add to cart')).toBe('加入购物车')
    cache.set('Add to cart', '放入购物车') // 同一句话第二次进缓存：覆盖，不是第二条
    expect(cache.size()).toBe(1)
    expect(cache.get('Add to cart')).toBe('放入购物车')
  })
})

describe('引擎批量档 · 去重', () => {
  it('重复段落只请求一次：37 块 26 句送出、Add to cart 十二张卡片只付一次钱，块块有译文', async () => {
    const doc = parseHTML(SHOP_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator, concurrency: 2 }).run(doc.body)
    expect(stats.blocks).toBe(37) // 省请求不省渲染：37 块全部拿到译文
    expect(stats.requests).toBe(3) // 26 句按字符预算装成 3 单
    const sent = counting.batches.flat()
    expect(sent.length).toBe(26) // 送出去的只有互不相同的 26 句
    expect(sent.filter((t) => t === 'Add to cart').length).toBe(1) // 同一句话全场只送了一次
    for (const cta of doc.querySelectorAll('p.cta')) {
      expect(isOwnNode(cta.nextElementSibling!)).toBe(true) // 12 张卡片的译文一张不少
      expect(cta.nextElementSibling!.textContent).toBe('【译】Add to cart')
    }
  })

  it('去重的键是送翻文本不是屏显文字：看着一样的两段，占位记号不同就各翻各的', async () => {
    const doc = parseHTML('<div><p>Same <strong>words</strong> here</p><p>Same words here</p></div>')
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator, preserveInline: true, concurrency: 1 }).run(doc.body)
    const sent = counting.batches.flat()
    expect(stats.blocks).toBe(2)
    expect(new Set(sent).size).toBe(2) // 「Same ⟦0⟧words⟦/0⟧ here」≠「Same words here」——两个不同的键都出了门
    expect(sent).toContain('Same words here') // 纯文本那段送的就是它本来的样子
    expect(stats.requests).toBe(1) // 两个键互不相同，但字符预算装得下——同袋出门
  })
})

describe('引擎批量档 · 并发上限', () => {
  it('并发峰值不超上限：上限 2 时任意时刻最多 2 单在飞，队头完成队尾补位', async () => {
    const doc = parseHTML(SHOP_PAGE_HTML)
    const gate = createGateTranslator()
    const done = createEngine({ translator: gate.translator, concurrency: 2 }).run(doc.body) // 不 await：请求停在闸门上
    await flush()
    expect(gate.inFlight()).toBe(2) // 恰好两单在飞，第三单在柜台排队
    gate.open() // 放走一单
    await flush()
    expect(gate.inFlight()).toBe(2) // 队尾立刻补位——窗口永远不空转也不超员
    gate.open()
    gate.open()
    const stats = await done
    expect(gate.peak()).toBe(2) // 从头到尾没超过上限
    expect(stats).toEqual({ blocks: 37, requests: 3, cached: 0 })
  })
})

describe('引擎批量档 · 内容寻址缓存', () => {
  it('二次 run 零请求：同一引擎翻第二页同样的内容，账单一单不增，cached 记满 26', async () => {
    const counting = createCountingTranslator(createFakeTranslator())
    const engine = createEngine({ translator: counting.translator, useCache: true }) // 只开缓存，不开并发
    const first = await engine.run(parseHTML(SHOP_PAGE_HTML).body)
    expect(first).toEqual({ blocks: 37, requests: 3, cached: 0 })
    expect(counting.batches.flat().length).toBe(26) // 首轮：26 句全部出门
    const second = await engine.run(parseHTML(SHOP_PAGE_HTML).body) // 换一棵新树，同一台引擎
    expect(second).toEqual({ blocks: 37, requests: 0, cached: 26 }) // 二轮：一单不发，句句命中
    expect(counting.batches.flat().length).toBe(26) // 账本一笔没涨——这就是「零请求」的凭据
  })
})

describe('引擎批量档 · 降级', () => {
  it('一单 503 整页不倒：同单的块保留原文，其余块照常双语，失败的请求也记账', async () => {
    const flaky: Translator = {
      async translate(texts) {
        if (texts.some((t) => t.includes('plugin system'))) throw new Error('503 Service Unavailable')
        return texts.map((t) => `【译】${t}`)
      },
    }
    const counting = createCountingTranslator(flaky)
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = [...doc.querySelectorAll('h1,h2,h3,p,li')].filter((el) => el.textContent.includes('plugin system'))
    const stats = await createEngine({ translator: counting.translator, concurrency: 2 }).run(doc.body)
    expect(stats.requests).toBe(counting.batches.length) // 引擎账本与观察孔互证：发过的单都算数
    expect(stats.blocks).toBe(13) // 装着超长段落的那一单失败，同单的块跟着降级
    expect(blocks[0].nextElementSibling === null || !isOwnNode(blocks[0].nextElementSibling)).toBe(true) // 原文原样躺着
    expect(doc.querySelectorAll('[data-duo]').length).toBe(13)
  })
})
