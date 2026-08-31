// src/background/sw.js —— 第 5 章后台：被动监听在前记账，按钮请求在后跑管线
//（可测逻辑在 src/shared/；对号账本住 chrome.storage.session——模块变量活不过 SW 休眠，
// 会话存储休眠不死、浏览器重启才清，这正是官方推荐给 SW 存状态的地方）
import { isLikelyVideoUrl, playlistKindOf } from '../shared/video-url.js'
import { parseMasterPlaylist, parseMediaPlaylist, pickVariant } from '../shared/m3u8.js'
import {
  resolveMediaPlaylistUrl,
  downloadSegments,
  concatBuffers,
  guessFilename,
} from '../shared/download.js'
import { MSG, isDownloadRequest, encodeBytes } from '../shared/messages.js'

console.log('[xvd] service worker 已启动')

/**
 * 取一份 m3u8 来拆：master 报档位报告，media 报分片数；失败也打日志，不许静默吞掉
 * @param {string} url 抓到的清单地址（host_permissions 已报备过 twimg，fetch 不受跨域限制）
 */
async function reportPlaylist(url) {
  try {
    const res = await fetch(url)
    const text = await res.text()
    if (playlistKindOf(url) === 'master') {
      const { variants } = parseMasterPlaylist(text)
      const pick = pickVariant(variants)
      const audioOnly = variants.filter((v) => v.height === undefined).length
      const label = pick.height === undefined ? '纯音频' : `${pick.width}x${pick.height}`
      console.log(`[xvd] 检测到 ${variants.length} 档画质（含 ${audioOnly} 档纯音频），已选 ${label}`)
    } else {
      const { segments } = parseMediaPlaylist(text)
      console.log(`[xvd] 媒体清单：${segments.length} 个分片`)
    }
  } catch (err) {
    console.log('[xvd] 清单解析失败：', err instanceof Error ? err.message : err)
  }
}

// ---------- 对号账本：哪个标签页看过什么视频（storage.session，休眠不死） ----------

/**
 * 账本里的一条：这个标签页最近看到的 master 清单或 mp4 直链
 * @typedef {{ kind: 'master' | 'mp4', url: string }} VideoEntry
 */

/**
 * @param {number} tabId
 * @returns {string}
 */
const LOG_KEY = (tabId) => `xvd:video:${tabId}`

/**
 * 把「这个标签页最近看到的视频」记进会话存储。key 按标签页分账，两个标签页各看各的视频互不覆盖
 * @param {number} tabId
 * @param {'master' | 'mp4'} kind
 * @param {string} url
 */
async function rememberVideo(tabId, kind, url) {
  await chrome.storage.session.set({ [LOG_KEY(tabId)]: { kind, url } })
}

/**
 * 取某标签页的账。SW 睡一觉醒来先来这儿取——账本在浏览器手里，不在进程内存里
 * @param {number} tabId
 * @returns {Promise<VideoEntry | null>}
 */
async function recallVideo(tabId) {
  const key = LOG_KEY(tabId)
  const bag = await chrome.storage.session.get(key)
  return /** @type {VideoEntry | null} */ (bag[key] ?? null)
}

/** mp4 直链的分辨率写在路径里（形如 /vid/720x1280/），顺手抠出高度；HLS 的高度来自选档，用不着它 */
function heightFromUrl(url) {
  const m = /(\d{2,4})x\d{2,4}/.exec(url)
  return m ? Number(m[1]) : undefined
}

/**
 * 递消息给指定标签页的 content script；没人接（页面里没有我们的代码）也要打日志，不许静默吞掉
 * @param {number} tabId
 * @param {Record<string, unknown>} msg
 */
async function sendTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg)
  } catch (err) {
    console.log('[xvd] 页面没接住消息：', err instanceof Error ? err.message : err)
  }
}

/**
 * 把一条视频按第 4 章的管线跑到底：mp4 一行落盘；HLS 选档、并发抓分片、字节拼接，
 * 进度逐段回推，整段字节递回页面世界落盘（SW 里没有 URL.createObjectURL）。
 * 文件名用推文真正的 status id——第 4 章从视频 URL 抠数字的临时办法到此退役
 * @param {number} tabId
 * @param {string} statusId 请求下载的那条推文的数字 id
 * @param {{ kind: 'master' | 'mp4', url: string }} entry 账本里对上号的那条视频
 */
async function runDownload(tabId, statusId, entry) {
  if (entry.kind === 'mp4') {
    const filename = guessFilename(statusId, { ext: 'mp4', height: heightFromUrl(entry.url) })
    await chrome.downloads.download({ url: entry.url, filename })
    await sendTab(tabId, { type: MSG.DOWNLOAD_DONE, statusId, filename })
    return
  }
  const { url: mediaUrl, variant } = await resolveMediaPlaylistUrl(entry.url, null, fetch)
  const { init, segments } = await downloadSegments({
    mediaUrl,
    fetchLike: fetch,
    onProgress: ({ done, total }) => {
      void sendTab(tabId, { type: MSG.DOWNLOAD_PROGRESS, statusId, done, total })
    },
  })
  const bytes = concatBuffers(init ? [init, ...segments] : segments) // init 存在时排最前
  await sendTab(tabId, {
    type: MSG.DOWNLOAD_DONE,
    statusId,
    filename: guessFilename(statusId, { ext: init ? 'mp4' : 'ts', height: variant.height }),
    mime: init ? 'video/mp4' : 'video/mp2t',
    bytesB64: encodeBytes(bytes), // 通道只传 JSON 可序列化值——ArrayBuffer 直递到达就是 {}，必须先编码
  })
}

// chrome 全局只在浏览器后台里存在；Node 测试环境 import 本文件时它缺席，先看一眼再注册
if (typeof chrome !== 'undefined') {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isLikelyVideoUrl(details.url)) return
      console.log('[xvd] 视频请求', details.url)
      const kind = playlistKindOf(details.url)
      if (kind === 'master' || kind === 'media') void reportPlaylist(details.url)
      if (kind === 'master' || kind === 'mp4') {
        void rememberVideo(details.tabId, kind, details.url) // 记在这个标签页名下，休眠不死
      }
    },
    { urls: ['https://x.com/*', 'https://*.twimg.com/*'] }
  )

  // 按钮的下载请求：守卫先验形状，对上号就 ack，之后进度/完成/失败走消息回推
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isDownloadRequest(msg)) {
      sendResponse({ ok: false, error: '不认识的消息：形状不是下载请求' })
      return false
    }
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ ok: false, error: '消息没有来处的标签页' })
      return false
    }
    void (async () => {
      /** @type {VideoEntry | null} */
      let entry = null
      try {
        entry = await recallVideo(tabId)
      } catch (err) {
        sendResponse({
          ok: false,
          error: `读对号账本失败：${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      if (entry === null) {
        sendResponse({ ok: false, error: '这个标签页还没播过视频——先播放一次，再点推文上的按钮' })
        return
      }
      sendResponse({ ok: true, kind: entry.kind }) // ack：哪条推文的什么视频，对上号了
      try {
        await runDownload(tabId, msg.statusId, entry)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await sendTab(tabId, { type: MSG.DOWNLOAD_ERROR, statusId: msg.statusId, error })
      }
    })()
    return true // 回执在 await 之后才发（storage 是异步的）：不返回 true，通道当场关门、sendResponse 白叫
  })

  // 工具栏图标退役：入口搬到了每条含视频推文的按钮上（manifest 的 action 声明保留）
  chrome.action.onClicked.addListener(() => {
    console.log('[xvd] 入口已搬到推文上的「下载视频」按钮')
  })
}
