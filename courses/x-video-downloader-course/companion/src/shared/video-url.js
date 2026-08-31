// src/shared/video-url.js —— 认出「这是视频请求」的可测逻辑（装配见 src/background/sw.js）

/** X 的视频资源都从这个主机下发 @type {string} */
const VIDEO_HOST = 'video.twimg.com'

/** 视频路径的扩展名形态：m3u8 播放列表、mp4 直链、ts 分片 @type {RegExp} */
const VIDEO_EXT = /\.(m3u8|mp4|ts)$/i

/**
 * 判断一个 URL 是不是视频资源请求：主机是 video.twimg.com，且路径以 .m3u8/.mp4/.ts 结尾。
 * 解析不了的字符串安静返回 false——网络监听器里不值得为一个坏 URL 抛错
 * @param {string} url
 * @returns {boolean}
 */
export function isLikelyVideoUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return parsed.hostname === VIDEO_HOST && VIDEO_EXT.test(parsed.pathname)
}

/**
 * 按 URL 形态给视频资源分级：mp4 直链是 'mp4'；m3u8 再分两级——
 * X 目前的形态是 master 直接挂在 /pl/<id>.m3u8，media playlist 在 /pl/ 下再进一层目录。
 * 分片（.ts/.m4s）、解析不了的字符串、认不出的形态都返回 'unknown'。
 * URL 形态是 X 的易变细节：这里只是先猜一层，最终是 master 还是 media 以清单内容为准
 * @param {string} url
 * @returns {'master' | 'media' | 'mp4' | 'unknown'}
 */
export function playlistKindOf(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return 'unknown'
  }
  const path = parsed.pathname
  if (/\.mp4$/i.test(path)) return 'mp4'
  if (/\.m3u8$/i.test(path)) {
    if (/\/pl\/[^/]+\/.+\.m3u8$/i.test(path)) return 'media'
    if (/\/pl\/[^/]+\.m3u8$/i.test(path)) return 'master'
  }
  return 'unknown'
}
