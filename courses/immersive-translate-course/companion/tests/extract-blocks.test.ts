import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'

/** 第 2 章测试：可译块抽取的行为——全部断言针对 fixture 新闻页，不依赖网络。 */
describe('extractBlocks · 可译块抽取', () => {
  it('从 fixture 新闻页抽出全部可译块（14 个，按文档顺序）', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.map((b) => b.element.tagName.toLowerCase())).toEqual([
      'h1', 'h2', // 站点名、文章标题
      'p', 'p', // 作者行、长段落
      'p', 'p', // 含 strong 的段落、含行内 code 的段落
      'p', // blockquote 里最内层的 p
      'h3', 'li', 'li', 'li', // What is next + 三个列表项
      'h3', 'li', 'li', // 侧栏 Trending + 两个列表项
    ])
  })

  it('导航、页脚、按钮、脚本、独立代码块整棵剪掉，一个块都不出', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.every((b) => !b.element.closest('nav, footer, button, script, pre'))).toBe(true)
    const texts = blocks.map((b) => b.text).join('\n')
    expect(texts).not.toContain('Subscribe') // 按钮
    expect(texts).not.toContain('All rights reserved') // 页脚
    expect(texts).not.toContain('npm install') // pre 代码块
    expect(texts).not.toContain('userId') // script
  })

  it('太短的串不成块：日期「Nov 8」被长度门槛挡住，门槛归零后回来', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.some((b) => b.text === 'Nov 8')).toBe(false)
    const noFloor = extractBlocks(parseHTML(NEWS_PAGE_HTML).body, { minChars: 0 })
    expect(noFloor.some((b) => b.text === 'Nov 8')).toBe(true)
    expect(noFloor.length).toBe(blocks.length + 1)
  })

  it('含 strong 的段落是完整一块，不会从加粗处切断', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    const strongP = blocks.find((b) => b.text.includes('significant speedups'))
    expect(strongP).toBeDefined()
    expect(strongP!.text.startsWith('Early users report')).toBe(true)
    expect(strongP!.text.endsWith('old API.')).toBe(true)
    // 结构也还在块内：strong 是这个块的子节点，没有被切开
    expect(strongP!.element.querySelector('strong')).not.toBeNull()
  })

  it('嵌套块取最内层：blockquote 交出的是它里面的 p，自己不成块', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.some((b) => b.element.tagName === 'BLOCKQUOTE')).toBe(false)
    const quoted = blocks.find((b) => b.text.includes('never touch'))
    expect(quoted?.element.tagName).toBe('P')
    expect(quoted?.element.closest('blockquote')).not.toBeNull()
  })

  it('容器不与子块抢文本：sidebar 自己不成块，h3 与 li 各自成块', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.some((b) => b.element.classList.contains('sidebar'))).toBe(false)
    expect(blocks.some((b) => b.text === 'Trending')).toBe(true)
    expect(blocks.filter((b) => b.text.includes('RSS')).length).toBe(1)
  })

  it('行内 code 不进翻译文本：段落文本里没有 mount()', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    const codeP = blocks.find((b) => b.text.includes('script tag'))
    expect(codeP!.text).toBe(
      'To try it, add one script tag to your page and call on any element.',
    )
  })

  it('跳过规则可注入：skipTags 传 ["p"] 时一个 p 都不出，其余块照旧', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body, { skipTags: ['p'] })
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((b) => b.element.tagName !== 'P')).toBe(true)
    expect(blocks.some((b) => b.element.tagName === 'H1')).toBe(true)
  })

  it('块文本是折叠过空白的干净句子：无首尾空白、无连续空格', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.every((b) => b.text === b.text.trim() && !/\s{2,}/.test(b.text))).toBe(true)
  })
})
