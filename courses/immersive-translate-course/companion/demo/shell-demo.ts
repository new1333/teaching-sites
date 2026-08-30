import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseHTML } from '../tests/helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR } from '../src/render'
import { startShell } from '../extension/content'

/**
 * 第 9 章 demo：扩展壳上柜——manifest 念一遍、打包产物验一眼、
 * 壳入口在 jsdom 里开机走一遍全链路（第 5/7/8 章的功力从壳里透出来）。
 */

/** 微任务冲刷：观察者交账与假翻译器的 await 链都在微任务里走完——不碰定时器。 */
const settle = async (rounds = 60): Promise<void> => {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

const ownCount = (doc: Document): number => doc.querySelectorAll(`[${OWN_ATTR}]`).length

// —— 第一幕：manifest——浏览器认识这个扩展的唯一凭据 ——
console.log('=== 第一幕：manifest（extension/manifest.json 原文） ===')
console.log(readFileSync(join(process.cwd(), 'extension', 'manifest.json'), 'utf8').trim())
console.log('装配说明：matches=http/https 网页才注入；js 指向打包产物 dist/content.js；')
console.log('run_at=document_idle——Chrome 保证 DOM 齐了再上脚本（不用抢页面启动）。')

// —— 第二幕：打包产物——Chrome 只认一个自包含的 js 文件 ——
const dist = join(process.cwd(), 'extension', 'dist', 'content.js')
console.log('\n=== 第二幕：打包产物（esbuild 把 src/ 与壳打成一个文件） ===')
if (existsSync(dist)) {
  console.log(`extension/dist/content.js 已就位：${(statSync(dist).size / 1024).toFixed(1)} KB（npm run build:ext 产出）`)
} else {
  console.log('extension/dist/content.js 不存在——先跑 npm run build:ext，再加载扩展')
}

// —— 第三幕：壳入口在 jsdom 里开机——真浏览器里的那一段，在这预演 ——
const doc = parseHTML(NEWS_PAGE_HTML)
const blocks = extractBlocks(doc.body)
const before = blocks.map((b) => b.element.outerHTML)
const handle = startShell(doc) // 装配单：preserveInline + useCache + concurrency:2，翻译器=内置假翻译器
await settle()
console.log('\n=== 第三幕：壳在 jsdom 里开机（startShell → observeDynamic → 引擎） ===')
console.log(`译文节点：${ownCount(doc)} 个 | 原文 outerHTML 逐字不变：${blocks.map((b) => b.element.outerHTML).join() === before.join()}`)
const mountP = [...doc.querySelectorAll('p')].find((p) => p.textContent!.includes('add one script tag'))!
console.log('一对双语（第 5 章的功力从壳里透出来——行内 code 不送翻、原样拼回）：')
console.log(`  ${mountP.outerHTML}`)
console.log(`  ${mountP.nextElementSibling!.outerHTML}`)

const p = doc.createElement('p') // 模拟滚动加载：新段落上树
p.textContent = 'The maintainer also published a migration guide covering every breaking change.'
doc.querySelector('article')!.appendChild(p)
await settle()
console.log(`滚动加载 +1 段：译文节点 ${ownCount(doc) - 1} → ${ownCount(doc)}（第 8 章的观察者在岗）`)
handle.disconnect()
const late = doc.createElement('p')
late.textContent = 'This paragraph arrives after the shell said goodbye.'
doc.querySelector('article')!.appendChild(late)
await settle()
console.log(`disconnect 后再 +1 段：译文节点仍 ${ownCount(doc)}——把手干净`)

console.log('\n下一步（真浏览器）：chrome://extensions → 开发者模式 → 加载已解压的扩展程序 → 选 extension/ 目录')
