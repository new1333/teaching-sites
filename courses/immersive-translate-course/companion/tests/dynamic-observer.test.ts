import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR } from '../src/render'
import { createCountingTranslator, createFakeTranslator } from '../src/translate'
import { createEngine, type Engine } from '../src/engine'
import { observeDynamic } from '../src/observe'

/** 第 8 章测试：动态内容适配——MutationObserver 增量翻译、标记过滤防自触发、断开语义。 */

/**
 * 微任务冲刷：MutationObserver 的回调在微任务时机交账，假翻译器的 await 链也在微任务里走——
 * 跑够轮数就让整条链走完，全程不碰定时器（回调时机的语义正文专门讲）。
 */
async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

/** 往 article 末尾追加一个新段落（模拟懒加载/无限滚动上树的新内容）。 */
function appendParagraph(doc: Document, text: string): Element {
  const p = doc.createElement('p')
  p.textContent = text
  doc.querySelector('article')!.appendChild(p)
  return p
}

describe('observeDynamic · 开机与增量', () => {
  it('开机即翻整页：接上就把现有内容翻完——14 块各得译文、原文一字未动、恰 14 单', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    expect(counting.batches.length).toBe(14) // 串行档一块一单：初始整页 14 单
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
    for (const b of blocks) {
      const zh = b.element.nextElementSibling! // 每块原文的正后方都是自己的译文
      expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
      expect(zh.textContent).toBe(`【译】${b.text}`)
    }
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 第 3 章的纪律在观察者手里继续成立
  })

  it('追加新段落只翻新增块：+1 单、送翻文本恰是新段、译文落在它正后方', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    const p = appendParagraph(doc, 'The maintainer also published a migration guide covering every breaking change.')
    await flush()
    expect(counting.batches.length).toBe(15) // 旧 14 块零打扰，只为新段花 1 单
    expect(counting.batches.flat().filter((t) => t.includes('migration guide covering')).length).toBe(1)
    const zh = p.nextElementSibling!
    expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
    expect(zh.textContent).toBe('【译】The maintainer also published a migration guide covering every breaking change.')
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(15) // 只多出一个译文节点
  })

  it('追加整容器只翻里面的块：div 套两段 → +2 单，容器自己（空文本）不成块', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    const box = doc.createElement('div') // 模拟一块新的渲染区域整树上树
    const p1 = doc.createElement('p')
    p1.textContent = 'Community translators began documenting plugin recipes.'
    const p2 = doc.createElement('p')
    p2.textContent = 'The changelog now lists every deprecation with its replacement.'
    box.append(p1, p2)
    doc.querySelector('article')!.appendChild(box)
    await flush()
    expect(counting.batches.length).toBe(16) // 只为容器里的两段各花 1 单
    expect(counting.batches.flat().filter((t) => t.includes('plugin recipes')).length).toBe(1)
    expect(counting.batches.flat().filter((t) => t.includes('every deprecation')).length).toBe(1)
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(16)
    expect(p1.nextElementSibling!.hasAttribute(OWN_ATTR)).toBe(true) // 两段的译文都在各自正后方
    expect(p2.nextElementSibling!.hasAttribute(OWN_ATTR)).toBe(true)
  })
})

describe('observeDynamic · 自触发循环的拆除', () => {
  it('引信拆除：译文上树再入账也不送翻——静态视角树上 28 块，账上恒 14 单', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    await flush() // 再冲刷一轮：给「译文生译文」留足发生的时间——它没有发生
    // 静态视角：渲染后再抽取，14 → 28——第 3 章埋的引信还挂在树上（译文是 p、有直接文本，抽得出来）
    expect(extractBlocks(doc.body).length).toBe(28)
    expect(counting.batches.length).toBe(14) // 动态视角：观察者一分钱没多花
    expect(counting.batches.flat().every((t) => !t.startsWith('【译】'))).toBe(true) // 送翻的没有一句是译文
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14) // 译文下没有再长出译文
  })

  it('同一块不重复翻译：p2 入场不带走 p1——两段各送一次，多轮冲刷单数纹丝不动', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    const p1 = appendParagraph(doc, 'Early adopters reported the guide covers every real pitfall.')
    await flush()
    const p2 = appendParagraph(doc, 'A follow-up note explained the release cadence going forward.')
    await flush()
    // p2 上树时抽取范围是它们共同的父容器，p1 会被重新抽到——但增量只认「新上树的子树」
    expect(counting.batches.flat().filter((t) => t.includes('every real pitfall')).length).toBe(1)
    expect(counting.batches.flat().filter((t) => t.includes('release cadence')).length).toBe(1)
    expect(p1.nextElementSibling!.nextElementSibling).toBe(p2) // p1 的译文后面紧跟 p2：没有第二份译文挤进来
    const bills = counting.batches.length // 16：初始 14 + 新来 2
    await flush()
    await flush()
    expect(counting.batches.length).toBe(bills) // 静下来之后，没有任何echo 再花一单
  })

  it('中性节点不入账：hr、空 div、注释上树——一单没多', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    const article = doc.querySelector('article')!
    article.appendChild(doc.createElement('hr')) // 不在块级清单里，也不持有文本
    article.appendChild(doc.createElement('div')) // 空文本容器永不成块（第 2 章的不变量）
    article.appendChild(doc.createComment('lazy-load boundary')) // 注释节点：入账但不是元素
    await flush()
    expect(counting.batches.length).toBe(14)
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
  })

  it('跳过规则在增量里照常值班：pre>code 与过短文本上树——零新单', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    const pre = doc.createElement('pre') // 代码类整枝剪掉——第 2 章的规则对增量同样生效
    const code = doc.createElement('code')
    code.textContent = 'npm install quickdom@3'
    pre.appendChild(code)
    doc.querySelector('article')!.appendChild(pre)
    appendParagraph(doc, 'Nov 9') // 5 字符：过不了长度门槛
    await flush()
    expect(counting.batches.length).toBe(14)
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
  })
})

describe('observeDynamic · 断开与档位', () => {
  it('断开语义：disconnect 后新内容上树不再翻译，已翻的译文原地保留', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const handle = observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    handle.disconnect()
    appendParagraph(doc, 'This paragraph arrives after the observer said goodbye.')
    await flush()
    expect(counting.batches.length).toBe(14) // 一单没多
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14) // 一个译文没多
  })

  it('批量档从增量入口进场：追加 3 段共 150 字 → 1 单带走（第 7 章的账在观察者身上照算）', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const engine: Engine = createEngine({ translator: counting.translator, concurrency: 2 })
    observeDynamic(doc.body, engine)
    await flush()
    const initial = counting.batches.length
    expect(initial).toBe(5) // 初始 14 句约 600 字按 200 预算装 5 单——第 7 章算过的那笔账
    appendParagraph(doc, 'Maintainers published a migration guide this week.')
    appendParagraph(doc, 'Early adopters shared recipes for common cases.')
    appendParagraph(doc, 'A follow-up post explained the versioning strategy.')
    await flush()
    expect(counting.batches.length).toBe(initial + 1) // 新增 3 块走批量档：装成 1 单
    expect(counting.batches.at(-1)).toEqual([
      'Maintainers published a migration guide this week.',
      'Early adopters shared recipes for common cases.',
      'A follow-up post explained the versioning strategy.',
    ])
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(17) // 3 个新译文一个不少
  })
})
