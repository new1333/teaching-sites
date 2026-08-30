import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR } from '../src/render'
import { createCountingTranslator, createFakeTranslator } from '../src/translate'
import { createEngine } from '../src/engine'
import { observeDynamic } from '../src/observe'

/**
 * 第 8 章 demo：滚动加载与计数器——追加 3 个新段落，只出现 3 个新译文；
 * 顺手把第 3 章埋的 14→28 引信摆上台面：树上 28 块，账上恒 14 单。
 */

/** 微任务冲刷：observer 交账与假翻译器的 await 链都在微任务里走完——不用定时器。 */
const settle = async (rounds = 60): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

const ownCount = () => doc.querySelectorAll(`[${OWN_ATTR}]`).length
const doc = parseHTML(NEWS_PAGE_HTML)
const before = extractBlocks(doc.body).length // 开机前先记静态账：14 块

// 观察者先上岗，引擎再开机——开机自己插的 14 个译文，就是标记过滤的第一场考试
const counting = createCountingTranslator(createFakeTranslator())
const handle = observeDynamic(doc.body, createEngine({ translator: counting.translator }))
await settle()

console.log('=== 第一幕：开机即整页（先上岗、后开机） ===')
console.log(`计数器：${counting.batches.length} 单 | 译文节点：${ownCount()} 个`)
console.log(`静态重抽：${before} → ${extractBlocks(doc.body).length} 块（多出来的 14 个全是刚插的译文——第 3 章的引信就挂在树上）`)
console.log(`账上送翻的没有一句是译文：${counting.batches.flat().every((t) => !t.startsWith('【译】'))}`)

// —— 第二幕：模拟滚动加载——信息流到底了，三个新段落一次上树 ——
const FEED = [
  'Reporters confirmed the library now ships weekly builds.',
  'Community maintainers published a migration guide.',
  'A follow-up post explained the versioning strategy.',
]
let lastP: Element | undefined
for (const text of FEED) {
  const p = doc.createElement('p')
  p.textContent = text
  doc.querySelector('article')!.appendChild(p)
  lastP = p
}
await settle()
console.log('\n=== 第二幕：模拟滚动加载（一次性追加 3 个新段落） ===')
console.log(`计数器：14 → ${counting.batches.length} 单 | 译文节点：14 → ${ownCount()} 个`)
console.log('这一轮真正出门的只有：')
for (const text of counting.batches.flat().filter((t) => FEED.includes(t))) console.log(`  · ${text}`)
console.log('新段落与它的译文（原文在外，译文紧跟其后）：')
console.log(`  ${lastP!.outerHTML}`)
console.log(`  ${lastP!.nextElementSibling!.outerHTML}`)

// —— 第三幕：稳态与断开 ——
const bills = counting.batches.length
await settle()
await settle() // 给「译文生译文」留足发生的时间
console.log('\n=== 第三幕：稳态与断开 ===')
console.log(`再冲刷两轮：计数器纹丝不动（${bills} 单）——译文上树没有引燃任何新翻译`)
handle.disconnect()
const late = doc.createElement('p')
late.textContent = 'This paragraph arrives after the observer said goodbye.'
doc.querySelector('article')!.appendChild(late)
await settle()
console.log(`disconnect 后再追加一段：计数器仍 ${counting.batches.length} 单、译文仍 ${ownCount()} 个——观察者下班，页面静默`)
