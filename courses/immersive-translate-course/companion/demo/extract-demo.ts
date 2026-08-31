import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks, DEFAULT_MIN_CHARS } from '../src/extract'

/**
 * 第 2 章 demo：打印「引擎眼中的页面」——每个可译块的标签与前 48 个字符，
 * 再跑一遍没有长度门槛的对照，亲眼看门槛挡住了什么。
 */

const PREVIEW = 48

function preview(text: string): string {
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text
}

function printBlocks(title: string, blocks: ReturnType<typeof extractBlocks>): void {
  console.log(`\n=== ${title} ===`)
  blocks.forEach((b, i) => {
    const tag = b.element.tagName.toLowerCase()
    console.log(`${String(i + 1).padStart(2)}. ${tag.padEnd(6)} ${preview(b.text)}`)
  })
  console.log(`共 ${blocks.length} 个可译块`)
}

const doc = parseHTML(NEWS_PAGE_HTML)

const blocks = extractBlocks(doc.body)
printBlocks(`引擎眼中的页面（默认规则，长度门槛 minChars=${DEFAULT_MIN_CHARS}）`, blocks)

const noFloor = extractBlocks(doc.body, { minChars: 0 })
printBlocks('对照：去掉长度门槛 minChars=0', noFloor)

console.log('\n对照可见：多出来的正是「Nov 8」这类不是句子的短串——挡它的是长度门槛，不是标签规则。')
