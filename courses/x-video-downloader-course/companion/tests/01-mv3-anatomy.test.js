// tests/01-mv3-anatomy.test.js —— 第 1 章：MV3 插件最小骨架
// 断言两件事：manifest 声明的骨架成立（字段齐全、路径值正确、后台文件真实可加载）；
// 角标的可测逻辑（找推文、提取推文链接）在 src/shared/badge.js 里行为正确。
// DOM 与浏览器 API 一律以最小假件从参数注入，不碰真实页面、不碰网络。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import { BADGE_ATTR, findTweetArticles, isStatusHref, tweetLinkFrom } from '../src/shared/badge.js'

describe('manifest：最小 MV3 骨架声明', () => {
  it('manifest_version 必须是 3', () => {
    expect(manifest.manifest_version).toBe(3)
  })

  it('有非空 name 与 x.y.z 形态的 version', () => {
    expect(manifest.name.length).toBeGreaterThan(0)
    expect(manifest.version).toMatch(/^\d+(\.\d+){0,3}$/)
  })

  it('content_scripts 的 matches 覆盖 x.com，js 指向 content 装配层', () => {
    const cs = manifest.content_scripts?.[0]
    expect(cs?.matches?.some((m) => typeof m === 'string' && m.includes('x.com'))).toBe(true)
    expect(cs?.js).toEqual(['src/content/loader.js'])
  })

  it('background.service_worker 指向真实存在、可加载的后台文件', async () => {
    expect(manifest.background?.service_worker).toBe('src/background/sw.js')
    // sw.js 自第 2 章起是带 import 的 ES 模块，动态 import 不再报「不是模块」——「能加载成功」的存在性验证不变
    await expect(import('../src/background/sw.js')).resolves.toBeTruthy()
  })
})

describe('shared/badge：角标的可测逻辑', () => {
  it('isStatusHref：/status/ 后面跟数字才算推文链接', () => {
    expect(isStatusHref('/somebody/status/1740000000000000000')).toBe(true)
    expect(isStatusHref('https://x.com/somebody/status/1740000000000000000/photo/1')).toBe(true)
    expect(isStatusHref('/somebody')).toBe(false)
    expect(isStatusHref('/somebody/status/abc')).toBe(false)
  })

  it('findTweetArticles：返回全部推文根元素，跳过已贴过角标的', () => {
    const fresh = { hasAttribute: (name) => name !== BADGE_ATTR }
    const done = { hasAttribute: () => true }
    const root = {
      querySelectorAll: (selector) =>
        selector === 'article[data-testid="tweet"]' ? [fresh, done, fresh] : [],
    }
    const found = findTweetArticles(root)
    expect(found).toHaveLength(2)
    expect(found[0]).toBe(fresh)
  })

  it('tweetLinkFrom：相对链接归一成绝对 URL，拿去当角标悬停提示', () => {
    const article = {
      querySelector: (selector) =>
        selector === 'a[href*="/status/"]'
          ? { getAttribute: () => '/somebody/status/1740000000000000000' }
          : null,
    }
    expect(tweetLinkFrom(article, 'https://x.com/home')).toBe(
      'https://x.com/somebody/status/1740000000000000000'
    )
  })

  it('tweetLinkFrom：链接不是 /status/数字 形态时返回 null', () => {
    const article = { querySelector: () => ({ getAttribute: () => '/explore' }) }
    expect(tweetLinkFrom(article, 'https://x.com/home')).toBeNull()
    const empty = { querySelector: () => null }
    expect(tweetLinkFrom(empty, 'https://x.com/home')).toBeNull()
  })
})
