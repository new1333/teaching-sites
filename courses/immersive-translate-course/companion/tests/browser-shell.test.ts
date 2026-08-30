import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseHTML } from './helpers'
import { NEWS_PAGE_HTML } from '../src/fixtures/news-page'
import { extractBlocks } from '../src/extract'
import { OWN_ATTR } from '../src/render'
import { startShell } from '../extension/content'

/** 第 9 章测试：扩展壳——manifest 声明可解析且关键字段正确；壳入口把整套引擎装配到给定 DOM 上。 */

/** 微任务冲刷：观察者交账与假翻译器的 await 链都在微任务里走完——不碰定时器（同第 8 章）。 */
async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}

describe('extension/manifest.json · 扩展的身份证', () => {
  // npm test 的 cwd 恒为 companion/（与全部 demo 脚本同一约定）；
  // 不用 import.meta.url——jsdom 环境下它经 vite 改写不再是 file: 协议
  const manifest = JSON.parse(readFileSync(join(process.cwd(), 'extension', 'manifest.json'), 'utf8'))

  it('MV3 与必备字段：manifest_version=3、name 与 version 非空——浏览器认扩展的最低门槛', () => {
    expect(manifest.manifest_version).toBe(3)
    expect(typeof manifest.name).toBe('string')
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(typeof manifest.version).toBe('string')
    expect(manifest.version.length).toBeGreaterThan(0)
  })

  it('content_scripts 指到打包产物：js 恰为 dist/content.js、matches 覆盖 http 与 https', () => {
    expect(manifest.content_scripts).toHaveLength(1)
    const cs = manifest.content_scripts[0]
    expect(cs.js).toEqual(['dist/content.js']) // 相对扩展根目录——esbuild 的产出位置
    expect(cs.matches).toContain('http://*/*') // 网页协议才注入：chrome:// 内部页、file:// 都不进
    expect(cs.matches).toContain('https://*/*')
  })

  it('run_at 不早于文档可读：document_idle——DOM 就位之后再上脚本，不跟页面抢启动', () => {
    expect(manifest.content_scripts[0].run_at).toBe('document_idle')
  })
})

describe('startShell · 壳装配', () => {
  it('import 不开火：本测试文件的全局 document 上一个译文也没有——自动上弦只在扩展环境发生', () => {
    // content.ts 的模块尾有「在扩展里就开机」的副作用；chrome.runtime.id 只在扩展上下文存在，
    // vitest/jsdom 里没有——import 它不该有任何译文悄悄上树
    expect(document.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(0)
  })

  it('开机即整页：14 块各得译文、每条译文以【译】开头、原文一字未动', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    startShell(doc)
    await flush()
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
    for (const b of blocks) {
      const zh = b.element.nextElementSibling! // 每块原文的正后方都是自己的译文
      expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
      expect(zh.textContent!.startsWith('【译】')).toBe(true) // 假翻译器：离线、零密钥、内容=原文贴前缀
    }
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 第 3 章的纪律穿过壳依然成立
  })

  it('装配的是全量引擎：行内 code 在译文里原样活回来（第 5 章从壳里照常工作）', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    startShell(doc)
    await flush()
    const mountP = [...doc.querySelectorAll('p')].find((p) => p.textContent!.includes('add one script tag'))!
    const zh = mountP.nextElementSibling!
    expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
    expect(zh.querySelector('code')?.textContent).toBe('mount()') // 深克隆回来的真 code 节点：代码不送翻、逐字拼回
    expect(zh.textContent).toContain('call mount() on any element')
  })

  it('无限滚动跟得上：新段落上树只翻新来的（第 8 章的观察者从壳里上岗）', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    startShell(doc)
    await flush()
    const p = doc.createElement('p')
    p.textContent = 'The maintainer also published a migration guide covering every breaking change.'
    doc.querySelector('article')!.appendChild(p)
    await flush()
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(15) // 只多出一个译文节点
    const zh = p.nextElementSibling!
    expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
    expect(zh.textContent).toBe('【译】The maintainer also published a migration guide covering every breaking change.')
  })

  it('断开把手仍在：disconnect 之后新段落上树不再翻译', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const handle = startShell(doc)
    await flush()
    handle.disconnect()
    const p = doc.createElement('p')
    p.textContent = 'This paragraph arrives after the shell said goodbye.'
    doc.querySelector('article')!.appendChild(p)
    await flush()
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
  })
})
