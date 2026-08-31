// src/shared/download.js —— 分片下载管线的可测逻辑（装配见 src/background/sw.js）
// 网络一律从参数注入（fetchLike），测试喂假 fetch 就能验证整条管线，不碰真实网络
import { parseMasterPlaylist, parseMediaPlaylist, pickVariant } from './m3u8.js'

/** 分片抓取失败时抛出：message 点名哪个地址、什么状态、第几片 @type {string} */
export class SegmentFetchError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'SegmentFetchError'
  }
}

/**
 * @typedef {(...args: any[]) => Promise<{ ok: boolean, status: number, text(): Promise<string>, arrayBuffer(): Promise<ArrayBuffer> }>} FetchLike
 *   只要求 fetch 用到的两个方法（text/arrayBuffer）与 ok/status——真 fetch 满足它，假 fetch 只需装得下这些
 * @typedef {{ url: string, bandwidth: number, width?: number, height?: number, codecs?: string }} Variant
 */

/**
 * 从 master 清单地址走到 media 清单地址：拆变体、选带宽最高的档、把它（可能相对的）地址按 masterUrl 补全。
 * masterText 没给（null）就先用 fetchLike 自己取——SW 睡一觉就丢光内存，点图标时往往只能重取
 * @param {string} masterUrl 抓到的 master 清单地址
 * @param {string | null} masterText 已有的 master 文本；null 表示让函数自己取
 * @param {FetchLike} fetchLike
 * @returns {Promise<{ url: string, variant: Variant }>} url 是选中的 media 清单绝对地址
 */
export async function resolveMediaPlaylistUrl(masterUrl, masterText, fetchLike) {
  let text = masterText
  if (text === null || text === undefined) {
    const res = await fetchLike(masterUrl)
    if (!res.ok) {
      throw new SegmentFetchError(`取 master 清单失败（HTTP ${res.status}）：${masterUrl}`)
    }
    text = await res.text()
  }
  const { variants } = parseMasterPlaylist(text)
  const variant = pickVariant(variants)
  // 第 3 章立的规矩：清单里的相对地址，以清单自己的 URL 为基准补全（RFC 8216 §4.1）
  return { url: new URL(variant.url, masterUrl).href, variant }
}

/**
 * 抓一份 job（清单里的一行地址）：网络抛错与非 2xx 一律翻译成 SegmentFetchError，报得出死因
 * @param {{ url: string, what: string }} job what 是给人看的身份（「第 3/6 片」「初始化分片」）
 * @param {FetchLike} fetchLike
 * @returns {Promise<ArrayBuffer>}
 */
async function fetchJob(job, fetchLike) {
  let res
  try {
    res = await fetchLike(job.url)
  } catch (err) {
    throw new SegmentFetchError(`${job.what}抓取失败（网络错误）：${job.url} ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!res.ok) {
    throw new SegmentFetchError(`${job.what}抓取失败（HTTP ${res.status}）：${job.url}`)
  }
  return res.arrayBuffer()
}

/**
 * 按一份 media 清单把分片全部抓回来：先取清单，EXT-X-MAP 的 init 单独交货（拼装时排最前由调用方定），
 * 其余分片并发抓取——同时在飞不超过 concurrency，交货严格按清单顺序（先完成的不插队，结果按下标归位）。
 * 每抓完一份（init 计入）回调一次 onProgress({ done, total })。任何一份失败抛 SegmentFetchError
 * @param {{ mediaUrl: string, fetchLike: FetchLike, concurrency?: number, onProgress?: (p: { done: number, total: number }) => void }} opts
 * @returns {Promise<{ init: ArrayBuffer | null, segments: ArrayBuffer[] }>} init 无 EXT-X-MAP 时为 null
 */
export async function downloadSegments({ mediaUrl, fetchLike, concurrency = 4, onProgress }) {
  const res = await fetchLike(mediaUrl)
  if (!res.ok) {
    throw new SegmentFetchError(`取 media 清单失败（HTTP ${res.status}）：${mediaUrl}`)
  }
  const list = parseMediaPlaylist(await res.text())
  const n = list.segments.length

  /**
   * @typedef {{ url: string, slot: 'init' | number, what: string }} Job
   * slot 是归位地址：'init' 进 init 口袋，数字进 segments 的对应下标
   */
  /** @type {Job[]} 全部要抓的地址：init 在队首，其后按清单顺序 */
  const jobs = []
  if (list.mapUrl !== null) {
    jobs.push({
      url: new URL(list.mapUrl, mediaUrl).href,
      slot: 'init',
      what: '初始化分片（EXT-X-MAP）',
    })
  }
  list.segments.forEach((seg, i) => {
    jobs.push({ url: new URL(seg.url, mediaUrl).href, slot: i, what: `第 ${i + 1}/${n} 片` })
  })
  const total = jobs.length

  /** @type {ArrayBuffer[]} init 至多一份，单独口袋——拼装时排不排最前由调用方定 */
  const init = []
  /** @type {ArrayBuffer[]} 按清单下标归位——这就是「完成乱序、交货有序」的全部机关 */
  const segments = []
  let done = 0
  let cursor = 0 // 光标发号：每条泳道完成一份就领下一份，天然把在飞数量压在上限内

  async function lane() {
    while (cursor < jobs.length) {
      const job = jobs[cursor++]
      const bytes = await fetchJob(job, fetchLike)
      if (job.slot === 'init') init[0] = bytes
      else segments[job.slot] = bytes
      done += 1
      if (onProgress) onProgress({ done, total })
    }
  }

  const lanes = Math.min(concurrency, jobs.length)
  await Promise.all(Array.from({ length: lanes }, () => lane()))
  return { init: init.length > 0 ? init[0] : null, segments }
}

/**
 * 字节拼接：把几段数据原样首尾相接成一个 Uint8Array。ArrayBuffer 与 Uint8Array 混装都收；
 * 顺序由调用方给定的数组顺序决定——HLS 的规矩是 init 在最前、分片按清单序
 * @param {(ArrayBuffer | Uint8Array)[]} chunks
 * @returns {Uint8Array}
 */
export function concatBuffers(chunks) {
  const views = chunks.map((c) => (c instanceof Uint8Array ? c : new Uint8Array(c)))
  const total = views.reduce((n, v) => n + v.byteLength, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const v of views) {
    out.set(v, at)
    at += v.byteLength
  }
  return out
}

/**
 * 拼下载文件名：x-video-<statusId>-<height>p.<ext>。height 没有就整段省去——
 * 纯音频档没有分辨率，硬塞个 -undefinedp 就闹笑话了
 * @param {string} statusId 推文/视频的数字指纹，用于文件名可读可对账
 * @param {{ ext: string, height?: number }} opts
 * @returns {string}
 */
export function guessFilename(statusId, { ext, height }) {
  const dim = height === undefined ? '' : `-${height}p`
  return `x-video-${statusId}${dim}.${ext}`
}
