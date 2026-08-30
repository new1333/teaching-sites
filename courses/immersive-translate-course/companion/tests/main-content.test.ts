import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { LEGACY_PAGE_HTML } from '../src/fixtures/legacy-page'
import { DIGEST_PAGE_HTML } from '../src/fixtures/digest-page'
import { extractBlocks } from '../src/extract'
import { detectMainContent, weighRegion } from '../src/content'
import { createEngine } from '../src/engine'
import { createCountingTranslator, createFakeTranslator } from '../src/translate'

/** 第 6 章测试：主内容识别——语义地标圈候选、密度裁决挑正文；会猜错的场景如实断言，不粉饰。 */
describe('detectMainContent · 主内容识别', () => {
  it('fixture 新闻页认出 <article>：main 也入围但包着侧栏，密度与深度裁决选更紧的', () => {
    const picked = detectMainContent(parseHTML(NEWS_PAGE_HTML).body)!
    expect(picked.tagName).toBe('ARTICLE')
    expect(picked.querySelector('h2')!.textContent).toContain('version 2.0') // 正文标题在选中区域内
    expect(picked.querySelector('.sidebar')).toBeNull() // 侧栏不在正文区里
  })

  it('认完正文区，可译块 14 → 10：站点名与侧栏标签出局，作者行随正文保留（第 2 章的承诺账）', () => {
    const body = parseHTML(NEWS_PAGE_HTML).body
    const all = extractBlocks(body)
    const kept = extractBlocks(detectMainContent(body)!)
    expect(all.length).toBe(14)
    expect(kept.length).toBe(10)
    const texts = kept.map((b) => b.text)
    expect(texts).not.toContain('The Daily Byte') // 站点名 h1 在页头，不在正文区
    expect(texts.some((t) => t.includes('Trending'))).toBe(false) // 侧栏标签出局
    expect(texts.some((t) => t.includes('RSS'))).toBe(false) // 侧栏推荐出局
    expect(texts.some((t) => t === 'By Jane Doe')).toBe(true) // 作者行是正文的署名，跟着正文翻
  })

  it('语义标签缺席时密度兜底：div 汤版面认出 #content，可译块 17 → 10', () => {
    const body = parseHTML(LEGACY_PAGE_HTML).body
    const picked = detectMainContent(body)!
    expect(picked.id).toBe('content')
    // 17 块里有两块是 div 汤特有的伤：导航链接拼进 #top 自己的直接文本、
    // Privacy 链接撑起 #foot——正是「导航被翻译」在无语义版面上的机制现场
    expect(extractBlocks(body).length).toBe(17)
    expect(extractBlocks(picked).length).toBe(10)
  })

  it('两个密度的分量账：正文区文字沉、链接稀；侧栏文字轻、链接密', () => {
    const body = parseHTML(LEGACY_PAGE_HTML).body
    const contentMass = weighRegion(body.querySelector('#content')!)
    const sideMass = weighRegion(body.querySelector('#side')!)
    expect(contentMass.textChars).toBeGreaterThan(sideMass.textChars) // 文字密度：正文区文字更沉
    expect(contentMass.linkChars).toBe(0) // 正文区的字一个都不住在链接里
    expect(sideMass.linkChars / sideMass.textChars).toBeGreaterThan(0.8) // 链接密度：侧栏几乎全是链接
  })

  it('启发式会猜错（如实断言）：正文整个住在链接里的摘要页，被当成导航晾在一边', () => {
    const body = parseHTML(DIGEST_PAGE_HTML).body
    const digestMass = weighRegion(body.querySelector('.digest')!)
    expect(digestMass.linkChars / digestMass.textChars).toBeGreaterThan(0.9) // 摘要正文的链接密度比导航还高
    const picked = detectMainContent(body)!
    expect(picked.className).toBe('promo') // 认错：选了推销区的锅炉板——边界登记差异清单
  })

  it('认不出正文返回 null：零散单块的页面没有「区域」可言', () => {
    const doc = parseHTML('<body><div><p>Only one lonely paragraph sits on this page.</p></div></body>')
    expect(detectMainContent(doc.body)).toBeNull()
  })
})

describe('mainContentOnly 接线 · 引擎只翻正文区', () => {
  it('mainContentOnly: true：计数翻译器 14 → 10 单，账本里没有站点名与侧栏', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator, mainContentOnly: true }).run(doc.body)
    expect(stats).toEqual({ blocks: 10, requests: 10, cached: 0 })
    const sent = counting.batches.flat()
    expect(sent.some((t) => t === 'The Daily Byte')).toBe(false) // 站点名不花额度
    expect(sent.some((t) => t.includes('Trending') || t.includes('RSS'))).toBe(false) // 侧栏不花额度
    expect(sent.some((t) => t === 'By Jane Doe')).toBe(true) // 作者行照翻
  })

  it('默认关：不传 mainContentOnly 时行为与第 4 章一致（14 单，全页照翻）', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator }).run(doc.body)
    expect(stats.requests).toBe(14)
    expect(counting.batches.flat().some((t) => t.includes('RSS'))).toBe(true) // 侧栏在账上——默认行为一寸不变
  })

  it('认不出就全翻：null 不罢工，降级回整页', async () => {
    const doc = parseHTML('<body><div><p>Only one lonely paragraph sits on this page.</p></div></body>')
    const stats = await createEngine({ mainContentOnly: true }).run(doc.body)
    expect(stats).toEqual({ blocks: 1, requests: 1, cached: 0 })
    expect(doc.querySelectorAll('p').length).toBe(2) // 原文加译文：照翻不误
  })

  it('与 preserveInline 叠加：正文区收窄后，第 5 章的格式保留照常工作', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({
      translator: counting.translator,
      mainContentOnly: true,
      preserveInline: true,
    }).run(doc.body)
    expect(stats).toEqual({ blocks: 10, requests: 10, cached: 0 })
    const strongZh = [...doc.querySelectorAll('[data-duo]')].find((n) => n.querySelector('strong'))
    expect(strongZh).toBeDefined() // 收窄进来的 strong 段，译文里的加粗照样活下来
    expect(strongZh!.querySelector('strong')!.textContent).toBe('significant speedups')
  })
})
