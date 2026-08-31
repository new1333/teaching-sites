// src/shared/m3u8.js —— 拆 m3u8 播放列表的可测逻辑（装配见 src/background/sw.js）

/** 解析失败时抛出：message 点名出错的行号或标签 @type {string} */
export class PlaylistParseError extends Error {
  /**
   * @param {string} message 点名行号或标签，让人看得出清单错在哪
   */
  constructor(message) {
    super(message)
    this.name = 'PlaylistParseError'
  }
}

/** 选档失败时抛出：变体列表为空，或限高条件把所有档都筛掉了 @type {string} */
export class NoVariantError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message)
    this.name = 'NoVariantError'
  }
}

/**
 * @typedef {{ url: string, bandwidth: number, width?: number, height?: number, codecs?: string }} Variant
 *   一档清晰度变体：地址、带宽必填；分辨率与编码有则拆出（纯音频档没有分辨率）
 * @typedef {{ variants: Variant[] }} MasterPlaylist
 * @typedef {{ url: string, duration: number }} MediaSegment
 * @typedef {{ targetDuration: number, segments: MediaSegment[], mapUrl: string | null }} MediaPlaylist
 */

/**
 * 按逗号拆属性表，但看得见引号：CODECS="avc1.640028,mp4a.40.2" 引号里的逗号不是分隔符
 * @param {string} s 标签冒号后面的整段属性文本
 * @returns {Record<string, string>} 属性名到去引号值的映射
 */
function parseAttrList(s) {
  const attrs = {}
  let pair = ''
  let inQuotes = false
  for (const ch of s) {
    if (ch === '"') inQuotes = !inQuotes
    if (ch === ',' && !inQuotes) {
      attrs[pair.slice(0, pair.indexOf('=')).trim()] = pair.slice(pair.indexOf('=') + 1).trim().replace(/^"|"$/g, '')
      pair = ''
    } else {
      pair += ch
    }
  }
  if (pair.includes('=')) {
    attrs[pair.slice(0, pair.indexOf('=')).trim()] = pair.slice(pair.indexOf('=') + 1).trim().replace(/^"|"$/g, '')
  }
  return attrs
}

const STREAM_INF = '#EXT-X-STREAM-INF:'
const EXTINF = '#EXTINF:'
const MAP = '#EXT-X-MAP:'
const TARGET_DURATION = '#EXT-X-TARGETDURATION:'

/**
 * 解析 master playlist（一级清单）：每个 EXT-X-STREAM-INF 描述一档变体，下一行是它的 media playlist 地址。
 * 地址按原文返回（可能是相对写法），到第 4 章发请求时再以清单自己的 URL 为基准补全
 * @param {string} text 整份清单文本
 * @returns {MasterPlaylist}
 */
export function parseMasterPlaylist(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '#EXTM3U') {
    throw new PlaylistParseError('第 1 行不是 #EXTM3U——这不是一份合法的 m3u8 播放列表')
  }
  /** @type {Variant[]} */
  const variants = []
  /** @type {{ attrs: Record<string, string>, lineNo: number } | null} */
  let pending = null
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith(STREAM_INF)) {
      if (pending) {
        throw new PlaylistParseError(`第 ${pending.lineNo} 行的 EXT-X-STREAM-INF 没等到自己的地址行`)
      }
      pending = { attrs: parseAttrList(line.slice(STREAM_INF.length)), lineNo: i + 1 }
    } else if (line.startsWith('#')) {
      continue // 其余标签（如 EXT-X-MEDIA）与注释，master 解析不关心
    } else if (pending) {
      const bandwidth = Number(pending.attrs.BANDWIDTH)
      if (!Number.isFinite(bandwidth)) {
        throw new PlaylistParseError(
          `第 ${pending.lineNo} 行的 EXT-X-STREAM-INF 缺少必填的 BANDWIDTH（RFC 8216 4.3.4.2）`
        )
      }
      const variant = { url: line, bandwidth }
      const res = pending.attrs.RESOLUTION
      if (res !== undefined) {
        const m = /^(\d+)x(\d+)$/.exec(res)
        if (!m) {
          throw new PlaylistParseError(`第 ${pending.lineNo} 行的 RESOLUTION 不是 WxH 形态：${res}`)
        }
        variant.width = Number(m[1])
        variant.height = Number(m[2])
      }
      if (pending.attrs.CODECS !== undefined) variant.codecs = pending.attrs.CODECS
      variants.push(variant)
      pending = null
    }
  }
  if (pending) {
    throw new PlaylistParseError(`第 ${pending.lineNo} 行的 EXT-X-STREAM-INF 没等到自己的地址行`)
  }
  if (variants.length === 0) {
    throw new PlaylistParseError(
      '整份清单没有一个 EXT-X-STREAM-INF——这不是 master playlist（是不是把 media playlist 喂了进来？）'
    )
  }
  return { variants }
}

/**
 * 解析 media playlist（二级清单）：EXTINF 与下一行地址配成一个分片；EXT-X-MAP 的 URI 记为 mapUrl。
 * BYTERANGE 属性本课不实现字节区间下载，只读 URI
 * @param {string} text 整份清单文本
 * @returns {MediaPlaylist}
 */
export function parseMediaPlaylist(text) {
  const lines = text.split(/\r?\n/)
  if (lines[0].trim() !== '#EXTM3U') {
    throw new PlaylistParseError('第 1 行不是 #EXTM3U——这不是一份合法的 m3u8 播放列表')
  }
  /** @type {number | null} */
  let targetDuration = null
  /** @type {string | null} */
  let mapUrl = null
  /** @type {number | null} */
  let pendingExtinf = null
  /** @type {MediaSegment[]} */
  const segments = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    if (line.startsWith(EXTINF)) {
      const duration = Number.parseFloat(line.slice(EXTINF.length).split(',')[0])
      if (!Number.isFinite(duration) || duration < 0) {
        throw new PlaylistParseError(`第 ${i + 1} 行的 EXTINF 时长不合法：${line}`)
      }
      pendingExtinf = duration
    } else if (line.startsWith(MAP)) {
      const attrs = parseAttrList(line.slice(MAP.length))
      if (!attrs.URI) {
        throw new PlaylistParseError(`第 ${i + 1} 行的 EXT-X-MAP 缺少必填的 URI（RFC 8216 4.3.2.5）`)
      }
      mapUrl = attrs.URI
    } else if (line.startsWith(TARGET_DURATION)) {
      targetDuration = Number.parseInt(line.slice(TARGET_DURATION.length), 10)
      if (!Number.isFinite(targetDuration) || targetDuration < 0) {
        throw new PlaylistParseError(`第 ${i + 1} 行的 EXT-X-TARGETDURATION 不合法：${line}`)
      }
    } else if (line.startsWith('#')) {
      continue // 其余标签（VERSION/MEDIA-SEQUENCE/ENDLIST 等）与本课无关，跳过
    } else {
      if (pendingExtinf === null) {
        throw new PlaylistParseError(
          `第 ${i + 1} 行的分片地址前面没有 EXTINF 时长（master playlist 的地址行不带 EXTINF——是不是喂错了清单？）`
        )
      }
      segments.push({ url: line, duration: pendingExtinf })
      pendingExtinf = null
    }
  }
  if (targetDuration === null) {
    throw new PlaylistParseError(
      '整份清单没有 EXT-X-TARGETDURATION——这不是合法的 media playlist（是不是把 master playlist 喂了进来？）'
    )
  }
  if (segments.length === 0) {
    throw new PlaylistParseError('整份清单一个分片地址都没有')
  }
  return { targetDuration, segments, mapUrl }
}

/**
 * 从变体表里选一档：默认按 BANDWIDTH 最高选；给了 maxHeight 就只在「不超过这么高」的档里选。
 * 纯音频档没有 height，不参与限高——筛得一档不剩时抛 NoVariantError
 * @param {Variant[]} variants parseMasterPlaylist 拆出的变体表
 * @param {{ maxHeight?: number }} [options]
 * @returns {Variant}
 */
export function pickVariant(variants, { maxHeight } = {}) {
  const pool =
    maxHeight === undefined
      ? variants.slice()
      : variants.filter((v) => v.height !== undefined && v.height <= maxHeight)
  if (pool.length === 0) {
    throw new NoVariantError(
      maxHeight === undefined
        ? '变体列表是空的，没有档可选'
        : `maxHeight=${maxHeight} 把所有档都筛掉了（纯音频档没有高度，不参与限高）`
    )
  }
  return pool.reduce((best, v) => (v.bandwidth > best.bandwidth ? v : best))
}
