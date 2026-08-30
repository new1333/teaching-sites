// tests/02-network-watch.test.js —— 第 2 章：让视频请求现形
// 断言两件事：manifest 报备了监听所需的权限（webRequest API + x.com/twimg 站点权限）；
// shared/video-url.js 的 isLikelyVideoUrl 只认 video.twimg.com 的 .m3u8/.mp4/.ts 视频请求。
// URL 全部是自造的示意地址（按 fixtures 约定，形如 https://video.twimg.com/...），
// 不碰真实页面、不碰网络。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import { isLikelyVideoUrl } from '../src/shared/video-url.js'

describe('manifest：监听所需的报备', () => {
  it('permissions 含 webRequest：领到监听 API 的钥匙', () => {
    expect(manifest.permissions).toContain('webRequest')
  })

  it('host_permissions 同时报备 x.com 与 *.twimg.com：发起方与视频 CDN 都要看得见', () => {
    const hosts = manifest.host_permissions ?? []
    expect(hosts.some((h) => typeof h === 'string' && h.includes('x.com'))).toBe(true)
    expect(hosts.some((h) => typeof h === 'string' && h.includes('twimg.com'))).toBe(true)
  })
})

describe('shared/video-url：认出视频请求', () => {
  it('video.twimg.com 的 m3u8/mp4/ts 算视频请求，带查询参数也算', () => {
    expect(isLikelyVideoUrl('https://video.twimg.com/ext_tw_video/1/pu/pl/AbCdEf.m3u8?tag=12')).toBe(true)
    expect(isLikelyVideoUrl('https://video.twimg.com/amplify_video/1/vid/720x1280/QqRr.mp4')).toBe(true)
    expect(isLikelyVideoUrl('https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/720x1280/seg-0.ts')).toBe(true)
  })

  it('图片、别的域、blob: 门牌都不算', () => {
    expect(isLikelyVideoUrl('https://pbs.twimg.com/media/FxYz1234.jpg')).toBe(false)
    expect(isLikelyVideoUrl('https://x.com/i/api/graphql/AbCdEf/HomeTimeline')).toBe(false)
    expect(isLikelyVideoUrl('blob:https://x.com/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e')).toBe(false)
  })

  it('video.twimg.com 上的非视频扩展名不算；扩展名大小写不敏感', () => {
    expect(isLikelyVideoUrl('https://video.twimg.com/config/client-info.json')).toBe(false)
    expect(isLikelyVideoUrl('https://video.twimg.com/amplify_video/1/vid/720x1280/QqRr.MP4')).toBe(true)
  })

  it('解析不了的字符串安静返回 false，不抛错', () => {
    expect(isLikelyVideoUrl('not a url')).toBe(false)
    expect(isLikelyVideoUrl('')).toBe(false)
  })
})
