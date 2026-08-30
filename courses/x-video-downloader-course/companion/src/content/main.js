// src/content/main.js —— 第 5 章装配层：扫描推文注入下载按钮，用消息把状态机跑起来
// （可测逻辑在 src/content/button-state.js 与 src/shared/；本文件只搬运事件与 DOM，不直接测）
import { tweetLinkFrom } from '../shared/badge.js'
import { MSG, isProgressPayload, decodeBytes } from '../shared/messages.js'
import { BUTTON_ATTR, findVideoTweetRoots, nextButtonState, statusIdFromUrl } from './button-state.js'

/** 状态名 → 按钮默认文案；downloading 的文案带进度数字，由 progress 事件现场拼 */
const LABEL = {
  idle: '下载视频',
  detecting: '对号中…',
  ready: '已对上号',
  downloading: '下载中…',
  done: '已存盘',
  error: '失败·点我重试',
}

/** 状态名 → 按钮配色：颜色跟状态走，隔着屏幕一眼看出按钮走到了哪一步 */
const COLOR = {
  idle: '#1d9bf0', // X 蓝
  detecting: '#536471', // 灰
  ready: '#1d9bf0',
  downloading: '#7856ff', // 紫
  done: '#00ba7c', // 绿
  error: '#f4212e', // 红
}

/** @type {Map<string, HTMLButtonElement>} statusId → 它的按钮：进度/完成/失败消息按这张表路由 */
const buttons = new Map()

/** @type {WeakMap<HTMLButtonElement, import('./button-state.js').ButtonState>} 每个按钮自己的状态机 */
const states = new WeakMap()

/** 推一个事件：换状态、换文案；文案给了就用给的（进度数字盖过默认文案） */
function advance(btn, event, label) {
  const next = nextButtonState(states.get(btn) ?? 'idle', event)
  states.set(btn, next)
  btn.textContent = label ?? LABEL[next]
  btn.style.background = COLOR[next]
}

/** 点击：状态机推 click，把带身份证的正式请求发出去；ack 与失败走 sendMessage 的回执 */
function requestDownload(statusId, btn) {
  advance(btn, 'click')
  chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_REQUEST, statusId }, (resp) => {
    if (chrome.runtime.lastError) {
      advance(btn, 'fail') // 消息递不出去（如插件刚重载、旧页面还挂着）——lastError 是回执的另一半
      return
    }
    advance(btn, resp?.ok === true ? 'ack' : 'fail')
  })
}

/** 给一条含视频的推文注入下载按钮，按钮自己带身份证标记 */
function injectButton(root, statusId) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = LABEL.idle
  btn.setAttribute(BUTTON_ATTR, statusId)
  btn.setAttribute(
    'style',
    'display:inline-block;margin:6px 0 0 48px;padding:2px 10px;border:none;' +
      'border-radius:10px;background:#1d9bf0;color:#fff;font-size:12px;line-height:16px;cursor:pointer;'
  )
  btn.addEventListener('click', () => requestDownload(statusId, btn))
  states.set(btn, 'idle')
  root.appendChild(btn)
  buttons.set(statusId, btn)
}

/** 扫一遍：给「含视频、有身份证」的推文补按钮；已注入的跳过，被 X 回收复用的撤旧换新 */
function scan() {
  for (const root of findVideoTweetRoots(document)) {
    const link = tweetLinkFrom(root, location.href)
    const statusId = link === null ? null : statusIdFromUrl(link)
    if (statusId === null) continue // 没有身份证的推文不接单（引用卡等非标准形态）
    const existing = root.querySelector(`button[${BUTTON_ATTR}]`)
    if (existing !== null && existing.getAttribute(BUTTON_ATTR) === statusId) continue
    existing?.remove() // X 回收复用了推文元素：旧按钮属于上一条推文，撤掉重来
    injectButton(root, statusId)
  }
}

scan() // 首屏：第 1 章只做了这一步，往下滚就瞎了——SPA 的坑从这里开始
const observer = new MutationObserver(() => scan()) // 补票机制：DOM 每长出新东西就重扫（自己注入的按钮也会触发，靠标记跳过）
observer.observe(document.body, { childList: true, subtree: true })

// 后台递来的进度/完成/失败：按 statusId 路由到具体某条推文的按钮
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const btn = typeof msg === 'object' && msg !== null ? buttons.get(msg.statusId) : undefined
  if (btn === undefined) return false // 不在册的孤儿消息（按钮已随路由换页消失），安静丢弃
  if (isProgressPayload(msg)) {
    advance(btn, 'progress', `下载中 ${msg.done}/${msg.total}`)
  } else if (msg.type === MSG.DOWNLOAD_DONE) {
    if (typeof msg.bytesB64 === 'string') {
      saveBytes(msg.filename, msg.mime, decodeBytes(msg.bytesB64)) // HLS：整段字节经 base64 编码递来，页面解码落盘
    }
    advance(btn, 'done')
    sendResponse({ ok: true })
  } else if (msg.type === MSG.DOWNLOAD_ERROR) {
    console.log('[xvd] 下载失败：', msg.error)
    advance(btn, 'fail')
  }
  return false // sendResponse 是同步发的，不用给通道留门（那是后台异步回执的规矩）
})

/** 第 4 章的落盘三步：组 Blob、发临时门牌、造链接点一下——全要 DOM，只能在页面世界做 */
function saveBytes(filename, mime, bytes) {
  const blob = new Blob([bytes], { type: mime })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 门牌不能立刻回收：浏览器接住下载要一瞬间，马上 revoke 可能存出空文件
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
}
