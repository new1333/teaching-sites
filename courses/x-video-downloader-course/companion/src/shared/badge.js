// src/shared/badge.js —— 角标的可测逻辑：找推文、提取推文链接（DOM 装配见 src/content/loader.js）

/** 已贴过角标的推文根元素会带上这个标记，重复扫描时跳过 @type {string} */
export const BADGE_ATTR = 'data-xvd-badge'

/**
 * 判断一个 href 是不是「这条推文」的链接：路径里出现 /status/ 加纯数字 id
 * @param {string} href
 * @returns {boolean}
 */
export function isStatusHref(href) {
  return /\/status\/\d+/.test(href)
}

/**
 * @typedef {{ querySelectorAll(selector: string): Iterable<any> }} QueryRootLike
 * @typedef {{ querySelector(selector: string): { getAttribute(name: string): string | null } | null }} QueryOneLike
 */

/**
 * 找出 rootLike 里所有还没贴过角标的推文根元素
 * @param {QueryRootLike} rootLike
 * @param {string} [selector] 推文根元素选择器，X 当前用 article[data-testid="tweet"]
 * @returns {any[]}
 */
export function findTweetArticles(rootLike, selector = 'article[data-testid="tweet"]') {
  return Array.from(rootLike.querySelectorAll(selector)).filter(
    (el) => !el.hasAttribute?.(BADGE_ATTR)
  )
}

/**
 * 从一条推文元素里提取它的链接（归一成绝对 URL），拿去当角标的悬停提示
 * @param {QueryOneLike} articleLike
 * @param {string} base 页面当前地址，用于把相对 href 补全成绝对 URL
 * @returns {string | null}
 */
export function tweetLinkFrom(articleLike, base) {
  const a = articleLike.querySelector('a[href*="/status/"]')
  const href = a?.getAttribute('href') ?? ''
  return isStatusHref(href) ? new URL(href, base).href : null
}
