// src/content/button-state.js —— 下载按钮的可测逻辑：状态机、推文身份证、找含视频的推文
// （DOM 装配见 src/content/main.js；迁移规则全住在这里，装配层只负责搬运事件）

/** 下载按钮自带的标记：值是它所属推文的 statusId——重扫时凭它跳过已注入的；
 * X 回收复用推文元素（虚拟列表）换了内容时，凭它发现「旧按钮属于上一条推文」撤旧换新 @type {string} */
export const BUTTON_ATTR = 'data-xvd-download'

/**
 * @typedef {'idle' | 'detecting' | 'ready' | 'downloading' | 'done' | 'error'} ButtonState
 *   正程五态：idle（等点击）→ detecting（对号中）→ ready（已对上号）→ downloading（抓分片中）→ done（已存盘）；
 *   外加一个失败态 error（可重试回 detecting）
 * @typedef {'click' | 'ack' | 'progress' | 'done' | 'fail'} ButtonEvent
 *   click 来自用户；ack/done/fail 来自 sendMessage 的回执；progress/done/fail 来自后台递来的消息
 */

/**
 * 迁移表：行是当前状态，列是事件，格是下一状态；忙碌态重复 click 走自旋（吸收，不重发请求）。
 * 表里没有的（状态, 事件）组合就是非法迁移——状态机的价值不在「能转」，在「不能转的被拦住
 * @type {Record<ButtonState, Partial<Record<ButtonEvent, ButtonState>>>}
 */
const TRANSITIONS = {
  idle: { click: 'detecting' },
  detecting: { click: 'detecting', ack: 'ready', fail: 'error' },
  ready: { click: 'ready', progress: 'downloading', done: 'done', fail: 'error' },
  downloading: { click: 'downloading', progress: 'downloading', done: 'done', fail: 'error' },
  done: { click: 'done' },
  error: { click: 'detecting' },
}

/**
 * 推一个事件，返回下一状态。表外的组合是非法迁移，抛 Error 点名是谁——
 * 乱序、迟到、伪造的消息都会在这里现形，而不是糊成一团「按钮行为看心情」
 * @param {ButtonState} state 当前状态
 * @param {ButtonEvent} event 到来的事件
 * @returns {ButtonState} 下一状态
 */
export function nextButtonState(state, event) {
  const row = TRANSITIONS[state]
  if (row === undefined) {
    throw new Error(`nextButtonState：不认识的状态 '${String(state)}'`)
  }
  const next = row[event]
  if (next === undefined) {
    throw new Error(`nextButtonState：非法迁移 ${state} + ${String(event)}`)
  }
  return next
}

/**
 * 从 x.com / twitter.com 的状态页 URL 提取推文数字 id（/status/ 后面那串）。
 * 提不出（不是状态页、id 不是数字、URL 解析不了）安静返回 null——推文没有身份证，按钮不注入
 * @param {string} url 绝对 URL；相对 href 请先用 shared/badge.js 的 tweetLinkFrom 归一
 * @returns {string | null}
 */
export function statusIdFromUrl(url) {
  let pathname
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const m = /\/status\/(\d+)/.exec(pathname)
  return m === null ? null : m[1]
}

/**
 * 找出 root 里「含视频的推文」根元素：默认锚 article[data-testid="tweet"]，且内部真有 <video>。
 * X 的 class 是构建产物、改版就变；data-testid 是它留给自动化测试的工牌——锚点跟工牌走
 * @param {{ querySelectorAll(selector: string): Iterable<any> }} rootLike
 * @param {string} [selector] 推文根选择器；现场核对后 X 若改了名，改这一处
 * @returns {any[]}
 */
export function findVideoTweetRoots(rootLike, selector = 'article[data-testid="tweet"]') {
  return Array.from(rootLike.querySelectorAll(selector)).filter(
    (el) => el.querySelector?.('video') != null
  )
}
