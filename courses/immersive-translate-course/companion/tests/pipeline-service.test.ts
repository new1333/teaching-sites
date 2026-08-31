import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR, isOwnNode } from '../src/render'
import { createCountingTranslator, createFakeTranslator, type Translator } from '../src/translate'
import { createEngine } from '../src/engine'

/** 第 4 章测试：翻译服务抽象与管线组装——依赖注入、确定性假翻译器、一键整页双语、逐块降级。 */

describe('createFakeTranslator · 确定性假翻译器', () => {
  it('同输入同输出：两次调用结果逐项相同、条数与顺序不丢——测试可预测的全部前提', async () => {
    const fake = createFakeTranslator()
    const first = await fake.translate(['Hello integration page', 'Goodbye'])
    const second = await fake.translate(['Hello integration page', 'Goodbye'])
    expect(first).toEqual(second) // 确定性：没有随机、没有时间、没有网络
    expect(first).toEqual(['【译】Hello integration page', '【译】Goodbye'])
    expect(first.length).toBe(2) // 进多少条出多少条
  })

  it('词典优先、缺省兜底：dict 命中的原文给指定译文，没命中的走默认前缀', async () => {
    const fake = createFakeTranslator({ Hello: '你好' })
    expect(await fake.translate(['Hello', 'Goodbye'])).toEqual(['你好', '【译】Goodbye'])
  })
})

describe('createCountingTranslator · 计数包装器', () => {
  it('行为原样转发、批原样记账：每次调用各记一笔，顺序与内容都是调用现场', async () => {
    const { translator, batches } = createCountingTranslator(createFakeTranslator({ Hello: '你好' }))
    const out = await translator.translate(['Hello', 'Bye'])
    expect(out).toEqual(['你好', '【译】Bye']) // 译文来自被包住的翻译器，包装器不掺和
    await translator.translate(['Third'])
    expect(batches).toEqual([
      ['Hello', 'Bye'],
      ['Third'],
    ])
  })
})

describe('createEngine().run · 管线组装', () => {
  it('一键整页双语：不传 translator 也能跑（内置假翻译器），14 块逐块成对，原文一字未动', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    const stats = await createEngine().run(doc.body) // 零配置、零网络、零密钥
    expect(stats).toEqual({ blocks: 14, requests: 14, cached: 0 }) // cached 本章恒 0
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
    for (const b of blocks) {
      const zh = b.element.nextElementSibling! // 每块原文的正后方都是自己的译文
      expect(isOwnNode(zh)).toBe(true)
      expect(zh.textContent).toBe(`【译】${b.text}`) // 译文内容来自假翻译器，不是手填
    }
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 第 3 章的纪律在管线里继续成立
  })

  it('依赖注入可换实现：换一个词典假翻译器，引擎一行没改、产出跟着变', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const engine = createEngine({ translator: createFakeTranslator({ 'The Daily Byte': '每日字节' }) })
    await engine.run(doc.body)
    const h1 = doc.querySelector('header h1')!
    expect(h1.nextElementSibling?.textContent).toBe('每日字节') // 命中词典的块换了译文
    expect(h1.textContent).toBe('The Daily Byte') // 原文没动
  })

  it('计数观察孔数出请求账单：14 块逐块各发一单，账本与引擎统计对得上', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const textsBefore = extractBlocks(doc.body).map((b) => b.text) // 跑之前抽好，跑完树就变了
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator }).run(doc.body)
    expect(counting.batches.length).toBe(textsBefore.length) // 一块一单：14 单
    expect(counting.batches.every((b) => b.length === 1)).toBe(true) // 每单一条
    expect(counting.batches.flat()).toEqual(textsBefore) // 顺序也是文档顺序
    expect(stats.requests).toBe(counting.batches.length) // 引擎账本与观察孔互相印证
  })

  it('逐块失败降级：一块 503，整页不倒——失败块保留原文无译文，其余照常双语', async () => {
    const flaky: Translator = {
      async translate(texts) {
        if (texts[0].includes('plugin system')) throw new Error('503 Service Unavailable')
        return texts.map((t) => `【译】${t}`)
      },
    }
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    const target = blocks.find((b) => b.text.includes('plugin system'))!
    const stats = await createEngine({ translator: flaky }).run(doc.body) // 不向上抛
    expect(stats.blocks).toBe(13) // 挂了一块
    expect(stats.requests).toBe(14) // 失败的那次也真发过——请求数照记
    expect(target.element.nextElementSibling === null || !isOwnNode(target.element.nextElementSibling)).toBe(true)
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(13)
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 失败块的原文也一字未动
  })

  it('引擎与树解耦：同一引擎实例可跑任意棵树，空树零请求零译文', async () => {
    const engine = createEngine() // 装配一次
    // 空文本容器永不成块（第 2 章的不变量）——整页抽不出块，零请求零译文
    const empty = parseHTML('<div></div>')
    expect(await engine.run(empty.body)).toEqual({ blocks: 0, requests: 0, cached: 0 })
    const doc = parseHTML('<div><p>Hello integration test page</p></div>')
    expect(await engine.run(doc.body)).toEqual({ blocks: 1, requests: 1, cached: 0 }) // 换一棵照跑
  })
})
