import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks, type TranslatableBlock } from '../src/extract'
import { isOwnNode } from '../src/render'
import { createCountingTranslator, createFakeTranslator } from '../src/translate'
import { createEngine } from '../src/engine'
import { splitSegments, renderSegments } from '../src/inline'

/**
 * 第 5 章测试：内联格式保留——占位记号让 strong/a/code 在译文里活回来。
 * 打法：译文文字全部用 dict 钉死，断言只看结构（节点层级一一对应）。
 */

/** 从一张新解析的 fixture 页里捞出目标块——每个测试各用各的树，互不串门。 */
function pageBlock(includes: string): TranslatableBlock {
  return extractBlocks(parseHTML(NEWS_PAGE_HTML).body).find((b) => b.text.includes(includes))!
}

describe('splitSegments · 织出带占位记号的翻译单元', () => {
  it('无内联的块：切出来就是一段，逐字等于第 2 章的直接文本——记号方案不动普通块的账', () => {
    const plain = pageBlock('The library, famous')
    expect(splitSegments(plain)).toEqual([plain.text])
  })

  it('strong 立成对记号：内容夹在 ⟦0⟧…⟦/0⟧ 里随整句送翻，整句上下文不碎', () => {
    expect(splitSegments(pageBlock('significant speedups'))).toEqual([
      'Early users report ⟦0⟧significant speedups⟦/0⟧ in tree-heavy workloads, though some miss the simpler old API.',
    ])
  })

  it('行内 code 立独立记号：代码不进送翻文本——第 2 章剪掉的空隙由记号占位', () => {
    const [unit] = splitSegments(pageBlock('script tag'))
    expect(unit).toBe('To try it, add one script tag to your page and call ⟦0⟧ on any element.')
    expect(unit).not.toContain('mount()')
  })

  it('链接立成对记号：整个 li 的内容就是链接文本，单元首尾就是记号', () => {
    expect(splitSegments(pageBlock('CSS tricks'))).toEqual(['⟦0⟧CSS tricks you forgot⟦/0⟧'])
  })
})

describe('renderSegments · 按索引认亲，重建结构', () => {
  const STRONG_UNIT =
    'Early users report ⟦0⟧significant speedups⟦/0⟧ in tree-heavy workloads, though some miss the simpler old API.'

  it('strong 逐节点对位：译文里文本→strong(译文)→文本，文字来自 dict、原文一字未动', async () => {
    const dict = {
      [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速⟦/0⟧——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。',
    }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    expect(block.element.nextElementSibling).toBe(node) // 插在原文正后方
    expect(isOwnNode(node)).toBe(true)
    expect(node.tagName).toBe('P')
    expect(node.childNodes.length).toBe(3) // 文本 → strong → 文本
    const [before, strong, after] = node.childNodes
    expect(before.textContent).toBe('早期用户报告了')
    expect((strong as Element).tagName).toBe('STRONG')
    expect(strong.textContent).toBe('显著的提速') // 加粗里的文字是被翻过的，不是原文搬运
    expect(after.textContent).toBe('——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。')
    expect(block.element.querySelector('strong')!.textContent).toBe('significant speedups') // 原文的 strong 原地未动
  })

  it('记号跟着译文的语序走：重建按索引认亲、不按位置——strong 挪到句首结构仍在', async () => {
    const dict = {
      [STRONG_UNIT]: '⟦0⟧显著的提速⟦/0⟧——早期用户在树操作密集的工作负载中报告了这一点。',
    }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    expect(node.childNodes.length).toBe(2)
    expect((node.firstChild as Element).tagName).toBe('STRONG') // 译文把加粗短语排到了句首
    expect(node.firstChild!.textContent).toBe('显著的提速')
    expect(node.lastChild!.textContent).toBe('——早期用户在树操作密集的工作负载中报告了这一点。')
  })

  it('code 原样拼回：译文里的 mount() 与原文逐字一致，且是克隆不是原文本尊', async () => {
    const dict = {
      'To try it, add one script tag to your page and call ⟦0⟧ on any element.':
        '试试看：往页面加一个 script 标签，然后对任意元素调用 ⟦0⟧ 即可。',
    }
    const block = pageBlock('script tag')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    const zh = node.querySelector('code')!
    expect(zh.textContent).toBe('mount()') // 代码原样回来：没送翻、没丢
    expect(zh).not.toBe(block.element.querySelector('code')) // 译文里的是克隆，原文的 code 还在原处
    expect(node.childNodes.length).toBe(3)
    expect(node.firstChild!.textContent).toBe('试试看：往页面加一个 script 标签，然后对任意元素调用 ')
    expect(node.lastChild!.textContent).toBe(' 即可。')
  })

  it('链接的 href 活下来：浅克隆带属性，译文链接还指向原来的地方', async () => {
    const dict = { '⟦0⟧CSS tricks you forgot⟦/0⟧': '⟦0⟧你早就忘光的 CSS 技巧⟦/0⟧' }
    const block = pageBlock('CSS tricks')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    const a = node.querySelector('a')!
    expect(a.getAttribute('href')).toBe('/css')
    expect(a.textContent).toBe('你早就忘光的 CSS 技巧')
  })

  it('记号被吞就降级：闭记号丢了，结构放弃、译文保留（残记号剥掉按纯文本渲染）', async () => {
    const dict = {
      // 模拟真实服务吃掉 ⟦/0⟧：开记号还在，闭记号没了
      [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。',
    }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    expect(node.querySelector('strong')).toBeNull() // 格式丢了
    expect([...node.childNodes].every((n) => n.nodeType === 3)).toBe(true) // 纯文本，一根绳子
    expect(node.textContent).toBe('早期用户报告了显著的提速——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。')
  })

  it('陌生记号就降级：译文里冒出对不上号的 ⟦7⟧，同样剥掉按纯文本渲染', async () => {
    const dict = { [STRONG_UNIT]: '⟦7⟧早期用户报告了显著的提速⟦/7⟧，在树操作密集的工作负载中。' }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    expect(node.querySelector('strong')).toBeNull()
    expect(node.textContent).toBe('早期用户报告了显著的提速，在树操作密集的工作负载中。')
  })

  it('幂等：同一块渲染两次只有一个译文节点，第二次是原地刷新（返回同一个节点）', async () => {
    const dict = { [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速⟦/0⟧——旧 API 也有人想念。' }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const first = renderSegments(block, [translated])
    const second = renderSegments(block, [translated])
    expect(second).toBe(first) // 没有第二个译文节点
    expect(block.element.nextElementSibling).toBe(first)
    expect(first.querySelector('strong')!.textContent).toBe('显著的提速') // 结构还在
  })
})

describe('管线接线 · EngineOptions.preserveInline', () => {
  it('preserveInline: true 整页照旧一块一单：14 块 14 单，记号真的去了翻译器，三个内联块结构保留、原文未动', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator, preserveInline: true }).run(doc.body)
    expect(stats).toEqual({ blocks: 14, requests: 14, cached: 0 })
    expect(counting.batches.length).toBe(14) // 占位记号不改变请求形状：还是一块一单
    expect(counting.batches.every((b) => b.length === 1)).toBe(true)
    expect(counting.batches.some((b) => b[0].includes('⟦0⟧'))).toBe(true) // 记号随原文出了门
    const strongZh = blocks.find((b) => b.text.includes('significant speedups'))!.element.nextElementSibling!
    expect(strongZh.querySelector('strong')!.textContent).toBe('significant speedups') // 【译】前缀版整句回来了
    const codeZh = blocks.find((b) => b.text.includes('script tag'))!.element.nextElementSibling!
    expect(codeZh.querySelector('code')!.textContent).toBe('mount()')
    const linkZh = blocks.find((b) => b.text.includes('CSS tricks'))!.element.nextElementSibling!
    expect(linkZh.querySelector('a')!.getAttribute('href')).toBe('/css')
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 只插不改的纪律在接线后继续成立
  })

  it('默认不接线：不开 preserveInline 时第 4 章行为原样——strong 段的译文还是纯文本', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const strongBlock = extractBlocks(doc.body).find((b) => b.text.includes('significant speedups'))!
    await createEngine().run(doc.body)
    const zh = strongBlock.element.nextElementSibling!
    expect(isOwnNode(zh)).toBe(true)
    expect(zh.querySelector('strong')).toBeNull() // 加粗还是消失的——开关默认关
    expect(zh.textContent).toBe(`【译】${strongBlock.text}`)
  })
})
