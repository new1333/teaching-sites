// src/shared/messages.js —— 两个世界之间的正式消息协议：类型常量表 + 形状守卫 + 二进制编码
// 第 4 章的 'xvd-save-file' 是裸字符串：拼错没人管、两端各自理解、来了什么消息都得硬接。
// 常量表让两个世界 import 同一个名字（类型只有一张事实源）；
// 守卫把「不认识的消息」在门口拒收——Chrome 官方文档明说 content script 发来的消息
// 要当不可信输入校验，处理逻辑只该见到形状正确的消息。
// 通道还默认 JSON 序列化（官方原文 use JSON serialization）：过不去 JSON.stringify 的值会被
// 强转——ArrayBuffer 递过去到达就是 {}。二进制必须自己编码，encodeBytes/decodeBytes 是那条渡船。

/** 消息类型常量表：全书唯一的类型事实源，页面与后台都 import 这一张表 @type {Record<string, string>} */
export const MSG = {
  /** 页面→后台：这条推文（statusId）要下载，请把「哪条推文的什么视频」对上号 */
  DOWNLOAD_REQUEST: 'xvd-download-request',
  /** 后台→页面：分片进度 done/total（mp4 直链没有分片，不发这条） */
  DOWNLOAD_PROGRESS: 'xvd-download-progress',
  /** 后台→页面：文件备好了——mp4 已由后台落盘；HLS 的整段字节经 encodeBytes 编码随消息递来，由页面落盘 */
  DOWNLOAD_DONE: 'xvd-download-done',
  /** 后台→页面：下载失败，error 说明死因 */
  DOWNLOAD_ERROR: 'xvd-download-error',
}

/**
 * 守卫：这条消息是一条形状合法的下载请求吗？
 * 只认「type 对、statusId 是非空字符串」的形状；别的类型、缺字段、字段类型不对、
 * 根本不是对象，一律 false——门口拒收，绝不放进处理逻辑
 * @param {any} msg 收到的消息（可能是任何东西）
 * @returns {boolean}
 */
export function isDownloadRequest(msg) {
  if (msg === null || typeof msg !== 'object') return false
  if (msg.type !== MSG.DOWNLOAD_REQUEST) return false
  return typeof msg.statusId === 'string' && msg.statusId.length > 0
}

/**
 * 守卫：这条消息是一条形状合法的分片进度吗？
 * done/total 必须都是整数，且 done ≥ 0、total ≥ 1、done ≤ total；
 * 多出来的字段（如 statusId 路由字段）不碍事——守卫查的是承重字段在场且合法
 * @param {any} msg 收到的消息（可能是任何东西）
 * @returns {boolean}
 */
export function isProgressPayload(msg) {
  if (msg === null || typeof msg !== 'object') return false
  if (msg.type !== MSG.DOWNLOAD_PROGRESS) return false
  if (!Number.isInteger(msg.done) || !Number.isInteger(msg.total)) return false
  return msg.done >= 0 && msg.total >= 1 && msg.done <= msg.total
}

/** base64 分块大小：必须是 3 的倍数（49152 = 3×16384）——非 3 倍数的块编码会带出 = 填充，
 * 拼接后整串就不是合法 base64；同时 48KiB 一块也远够不着 String.fromCharCode 展开参数的上限 @type {number} */
const B64_CHUNK = 3 * 0x4000

/**
 * 把二进制编码成能过 JSON 消息通道的 base64 字符串（体积约为原来的 4/3——每 3 字节编成 4 个字符）。
 * 通道只传 JSON 可序列化的值，ArrayBuffer 直递会变 {}——静默丢数据；分块是为绕开
 * String.fromCharCode 一次展开的参数上限，与消息 64 MiB 上限一起，是这条通道的两道天花板
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
export function encodeBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let b64 = ''
  for (let at = 0; at < view.length; at += B64_CHUNK) {
    b64 += btoa(String.fromCharCode(...view.subarray(at, at + B64_CHUNK)))
  }
  return b64
}

/**
 * encodeBytes 的逆运算：base64 字符串还原成字节
 * @param {string} b64
 * @returns {Uint8Array}
 */
export function decodeBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let at = 0; at < bin.length; at++) out[at] = bin.charCodeAt(at)
  return out
}
