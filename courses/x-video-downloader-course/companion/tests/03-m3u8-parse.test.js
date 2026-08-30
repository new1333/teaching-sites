// tests/03-m3u8-parse.test.js —— 第 3 章：拆开播放列表
// 断言三件事：playlistKindOf 按 URL 形态认出 master/media/mp4；
// m3u8.js 解析 master（变体/带宽/分辨率/编码）与 media（分片/时长/EXT-X-MAP）两形态 fixture；
// pickVariant 默认按带宽最高选档、可限 maxHeight、筛不进任何档时抛 NoVariantError。
// fixture 全部是自造的示意样本（符合 RFC 8216），测试只读文件文本，不碰网络。

import { describe, it, expect } from 'vitest'
import masterText from '../fixtures/master.m3u8?raw'
import mediaTsText from '../fixtures/media-ts.m3u8?raw'
import mediaFmp4Text from '../fixtures/media-fmp4.m3u8?raw'
import { playlistKindOf } from '../src/shared/video-url.js'
import {
  parseMasterPlaylist,
  parseMediaPlaylist,
  pickVariant,
  PlaylistParseError,
  NoVariantError,
} from '../src/shared/m3u8.js'

describe('shared/video-url：playlistKindOf 按 URL 形态分级', () => {
  it('X 形态：/pl/ 下直接挂 .m3u8 是 master，再进一层目录是 media', () => {
    expect(playlistKindOf('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key.m3u8?tag=12')).toBe('master')
    expect(playlistKindOf('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/1.m3u8')).toBe('media')
    expect(playlistKindOf('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/list.m3u8')).toBe('media')
  })

  it('mp4 直链是 mp4；分片与解析不了的字符串是 unknown——分片和坏值都不是清单', () => {
    expect(playlistKindOf('https://video.twimg.com/amplify_video/1/vid/720x1280/QqRr.mp4')).toBe('mp4')
    expect(playlistKindOf('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-0.ts')).toBe('unknown')
    expect(playlistKindOf('https://video.twimg.com/config/client-info.json')).toBe('unknown')
    expect(playlistKindOf('not a url')).toBe('unknown')
  })
})

describe('m3u8：解析 master playlist', () => {
  it('fixture 五个变体：带宽、分辨率、编码都拆出来；末档纯音频没有分辨率', () => {
    const { variants } = parseMasterPlaylist(masterText)
    expect(variants).toHaveLength(5)
    expect(variants[0]).toEqual({
      url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/1.m3u8',
      bandwidth: 2176000,
      width: 1280,
      height: 720,
      codecs: 'avc1.640028,mp4a.40.2',
    })
    const audioOnly = variants[4]
    expect(audioOnly.bandwidth).toBe(86000)
    expect(audioOnly.width).toBeUndefined()
    expect(audioOnly.height).toBeUndefined()
  })

  it('CODECS 引号里的逗号不是属性分隔符——拆属性要看得见引号', () => {
    const { variants } = parseMasterPlaylist(masterText)
    expect(variants[0].codecs).toBe('avc1.640028,mp4a.40.2')
    expect(variants[0].width).toBe(1280)
  })
})

describe('m3u8：解析 media playlist（.ts 形态）', () => {
  it('fixture 六个 .ts 分片：时长、地址、targetDuration 齐全，没有 EXT-X-MAP', () => {
    const list = parseMediaPlaylist(mediaTsText)
    expect(list.targetDuration).toBe(3)
    expect(list.segments).toHaveLength(6)
    expect(list.segments[0]).toEqual({
      url: 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-0.ts',
      duration: 2.002,
    })
    expect(list.mapUrl).toBeNull()
    const total = list.segments.reduce((sum, s) => sum + s.duration, 0)
    expect(total).toBeCloseTo(11.478, 3)
  })
})

describe('m3u8：解析 media playlist（fMP4/EXT-X-MAP 形态）', () => {
  it('EXT-X-MAP 的 URI 拆成 mapUrl，分片是 .m4s', () => {
    const list = parseMediaPlaylist(mediaFmp4Text)
    expect(list.mapUrl).toBe('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/init.mp4')
    expect(list.segments).toHaveLength(4)
    for (const seg of list.segments) expect(seg.url).toMatch(/\.m4s$/)
  })
})

describe('m3u8：pickVariant 选档', () => {
  const { variants } = parseMasterPlaylist(masterText)

  it('默认选 BANDWIDTH 最高的那档', () => {
    expect(pickVariant(variants).height).toBe(720)
    expect(pickVariant(variants).bandwidth).toBe(2176000)
  })

  it('maxHeight 限高：最高不超过 360 行时选 640x360', () => {
    const pick = pickVariant(variants, { maxHeight: 360 })
    expect(pick.width).toBe(640)
    expect(pick.height).toBe(360)
  })

  it('限得太低一档都不剩时抛 NoVariantError——纯音频档没有高度，不参与限高', () => {
    expect(() => pickVariant(variants, { maxHeight: 100 })).toThrow(NoVariantError)
    expect(() => pickVariant([])).toThrow(NoVariantError)
  })
})

describe('m3u8：坏清单要报得出错在哪', () => {
  it('第一行不是 #EXTM3U 抛 PlaylistParseError，message 点名标签', () => {
    expect(() => parseMasterPlaylist('https://video.twimg.com/a.m3u8')).toThrow(PlaylistParseError)
    expect(() => parseMasterPlaylist('https://video.twimg.com/a.m3u8')).toThrow(/EXTM3U/)
  })

  it('EXT-X-STREAM-INF 缺 BANDWIDTH（RFC 8216 必填）抛错并点名', () => {
    const bad = '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=640x360\nhttps://video.twimg.com/a/b.m3u8'
    expect(() => parseMasterPlaylist(bad)).toThrow(PlaylistParseError)
    expect(() => parseMasterPlaylist(bad)).toThrow(/BANDWIDTH/)
  })

  it('EXT-X-STREAM-INF 后面没等到地址行就结束，抛错点名标签', () => {
    const dangling = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000'
    expect(() => parseMasterPlaylist(dangling)).toThrow(PlaylistParseError)
    expect(() => parseMasterPlaylist(dangling)).toThrow(/EXT-X-STREAM-INF/)
  })

  it('解析器拿反了也会响：master 文本像 media 一样死在结构上，media 文本没有变体', () => {
    expect(() => parseMediaPlaylist(masterText)).toThrow(PlaylistParseError)
    expect(() => parseMediaPlaylist(masterText)).toThrow(/EXTINF/)
    const noTarget = '#EXTM3U\n#EXTINF:2.0,\nhttps://video.twimg.com/a/seg-0.ts\n'
    expect(() => parseMediaPlaylist(noTarget)).toThrow(/EXT-X-TARGETDURATION/)
    expect(() => parseMasterPlaylist(mediaTsText)).toThrow(PlaylistParseError)
    expect(() => parseMasterPlaylist(mediaTsText)).toThrow(/EXT-X-STREAM-INF/)
  })
})
