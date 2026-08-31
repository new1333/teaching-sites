import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { LEGACY_PAGE_HTML } from '../src/fixtures/legacy-page'
import { DIGEST_PAGE_HTML } from '../src/fixtures/digest-page'
import { extractBlocks, type TranslatableBlock } from '../src/extract'
import { detectMainContent, weighRegion, type RegionMass } from '../src/content'
import { createEngine } from '../src/engine'
import { createCountingTranslator, createFakeTranslator } from '../src/translate'

/**
 * 第 6 章 demo：认正文区——并排打印「被排除区域 vs 选中区域」的可译块清单。
 * 三幕：① 语义地标版面（main/article 都在，密度裁决选更紧的）
 *      ② 同一篇文章的 div 汤版面（地标缺席，密度兜底）
 *      ③ 认错的现场（正文住在链接里的摘要页）——启发式的边界不打码。
 */

const PREVIEW = 52

function preview(text: string): string {
  return text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text
}

function label(el: Element): string {
  const tag = el.tagName.toLowerCase()
  return el.id ? `#${el.id}` : el.className ? `${tag}.${el.className}` : tag
}

/** 并排打印全页清单：选中区域打勾，被排除区域打叉并注明它住在哪。 */
function printSideBySide(title: string, root: HTMLElement, picked: Element): void {
  console.log(`\n=== ${title} ===`)
  const inMain = (b: TranslatableBlock): boolean => picked.contains(b.element)
  const all = extractBlocks(root)
  console.log(`全页 ${all.length} 块 → 选中区域 ${label(picked)}（${all.filter((b) => inMain(b)).length} 块）`)
  all.forEach((b, i) => {
    const mark = inMain(b) ? '✓ 正文区' : `✗ 排除·住在 ${label(b.element.closest('header, .sidebar, #top, #side, #foot, .digest, .promo') ?? root)}`
    console.log(`${String(i + 1).padStart(2)}. ${mark.padEnd(14)} ${b.element.tagName.toLowerCase().padEnd(4)} ${preview(b.text)}`)
  })
}

function printMass(el: Element): void {
  const m: RegionMass = weighRegion(el)
  const density = m.textChars === 0 ? 0 : m.linkChars / m.textChars
  console.log(
    `  ${label(el).padEnd(14)} 文字分量 ${String(m.textChars).padStart(4)} 字 · 链接密度 ${(density * 100).toFixed(0).padStart(3)}% · 得分 ${Math.round(m.textChars * (1 - density))}`,
  )
}

// —— 第一幕：语义地标版面——main 与 article 都在，密度裁决选更紧的 ——
const news = parseHTML(NEWS_PAGE_HTML)
const newsPicked = detectMainContent(news.body)!
console.log('=== 第一幕：fixture 新闻页，detectMainContent 认出的容器 ===')
console.log(`选中：${newsPicked.tagName.toLowerCase()}（候选：main、article——main 包着侧栏，同量级取最深）`)
printMass(news.querySelector('main')!)
printMass(newsPicked)
printMass(news.querySelector('.sidebar')!)
printSideBySide('第一幕清单：被排除区域 vs 选中区域', news.body, newsPicked)

const newsCounting = createCountingTranslator(createFakeTranslator())
const newsStats = await createEngine({ translator: newsCounting.translator, mainContentOnly: true }).run(news.body)
console.log(`成绩单：${newsStats.blocks} 块渲染 / ${newsStats.requests} 次请求（全页 14 块 14 单——省下的 4 单就是站点名与侧栏）`)

// —— 第二幕：div 汤版面——同一篇文章，一个语义标签都没有 ——
const legacy = parseHTML(LEGACY_PAGE_HTML)
const legacyPicked = detectMainContent(legacy.body)!
console.log('\n=== 第二幕：div 汤版面（main/article 缺席，密度兜底） ===')
console.log('候选容器分量表（托着 ≥3 个可译块的容器）：')
for (const sel of ['#page', '#top', '#content', '#side', '#foot']) printMass(legacy.querySelector(sel)!)
console.log(`选中：${label(legacyPicked)}（同量级取最深——#page 分数最高但包着全页，#content 是更紧的那个）`)
printSideBySide('第二幕清单：被排除区域 vs 选中区域', legacy.body, legacyPicked)

// —— 第三幕：认错的现场——正文整个住在链接里的摘要页 ——
const digest = parseHTML(DIGEST_PAGE_HTML)
const digestPicked = detectMainContent(digest.body)!
console.log('\n=== 第三幕：链接摘要页——启发式认错了 ===')
for (const sel of ['.digest', '.promo']) printMass(digest.querySelector(sel)!)
console.log(`认成：${label(digestPicked)}（真正的正文 .digest 被当成导航晾在一边——正文住在链接里，链接密度反噬）`)

console.log('\n（第三幕是如实展示：启发式快、够用、不保证全对——认错的场景登记在书末差异清单）')
