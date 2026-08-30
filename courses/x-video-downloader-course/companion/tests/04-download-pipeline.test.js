// tests/04-download-pipeline.test.js —— 第 4 章：分片下载管线
// 断言四件事：resolveMediaPlaylistUrl 从 master 选出二级清单地址（文本没给就自己取、
// 相对地址按 masterUrl 补全）；downloadSegments 按清单并发抓分片（并发有上限、交货按清单顺序、
// EXT-X-MAP 的 init 单独交货、相对地址按 mediaUrl 补全、失败抛 SegmentFetchError 点名哪片）；
// concatBuffers 字节按序首尾相接；guessFilename 拼出带档位的文件名；manifest 报备本章新要的能力。
// 网络一律走注入的假 fetch，分片「在路上」的时间用纯微任务节拍模拟——不碰网络、不 sleep。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import masterText from '../fixtures/master.m3u8?raw'
import mediaFmp4Text from '../fixtures/media-fmp4.m3u8?raw'
import {
  resolveMediaPlaylistUrl,
  downloadSegments,
  concatBuffers,
  guessFilename,
  SegmentFetchError,
} from '../src/shared/download.js'

// ---------- 假件：Response、fetch、微任务节拍 ----------

/** 把一串数字装进 ArrayBuffer（ArrayBuffer 本体不能直接按内容比，比较走 new Uint8Array） */
function bytesOf(...nums) {
  return new Uint8Array(nums).buffer
}

/** 造一个只带管线用到的两个字段的假 Response：text() 给清单文本，arrayBuffer() 给分片字节 */
function resOf({ text = '', bytes = /** @type {ArrayBuffer | null} */ (null), ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => text,
    arrayBuffer: async () => bytes ?? new ArrayBuffer(0),
  }
}

/** 假 fetch：按 URL 精确映射到假 Response（没映射到的地址一律 404），顺手记下每次被请求的 URL */
function fakeFetch(map) {
  const seen = []
  const fn = async (url) => {
    seen.push(url)
    return map[url] ?? resOf({ ok: false, status: 404 })
  }
  fn.seen = seen
  return fn
}

/** 微任务节拍：await n 拍再继续——不同分片给不同拍数，完成顺序就乱起来了（不用定时器、不 sleep） */
function ticks(n) {
  let p = Promise.resolve()
  for (let i = 0; i < n; i++) p = p.then(() => {})
  return p
}

// ---------- 测试数据：相对地址写法的 media 清单（自造，符合 RFC 8216） ----------

const TS_MEDIA_URL = 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/list.m3u8'
const TS_BASE = 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/'
const TS_MEDIA_TEXT = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:3',
  '#EXTINF:2.002,',
  'seg-a.ts',
  '#EXTINF:2.002,',
  'seg-b.ts',
  '#EXTINF:1.468,',
  'seg-c.ts',
  '#EXT-X-ENDLIST',
].join('\n')

function tsListFetch() {
  return fakeFetch({
    [TS_MEDIA_URL]: resOf({ text: TS_MEDIA_TEXT }),
    [`${TS_BASE}seg-a.ts`]: resOf({ bytes: bytesOf(1, 1) }),
    [`${TS_BASE}seg-b.ts`]: resOf({ bytes: bytesOf(2, 2) }),
    [`${TS_BASE}seg-c.ts`]: resOf({ bytes: bytesOf(3, 3) }),
  })
}

describe('download：resolveMediaPlaylistUrl，从 master 走到 media', () => {
  const MASTER_URL = 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key.m3u8'

  it('masterText 在手就不再发请求：选出带宽最高档，返回它的二级清单地址', async () => {
    const fetchLike = fakeFetch({})
    const { url, variant } = await resolveMediaPlaylistUrl(MASTER_URL, masterText, fetchLike)
    expect(url).toBe('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/1.m3u8')
    expect(variant.height).toBe(720)
    expect(fetchLike.seen).toEqual([]) // 文本都给全了，没理由再敲一次门
  })

  it('masterText 没给就自己取：fetchLike 收到的正是 masterUrl（SW 睡醒后文本早已丢，靠这条路）', async () => {
    const fetchLike = fakeFetch({ [MASTER_URL]: resOf({ text: masterText }) })
    const { url } = await resolveMediaPlaylistUrl(MASTER_URL, null, fetchLike)
    expect(fetchLike.seen).toEqual([MASTER_URL])
    expect(url).toBe('https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/1.m3u8')
  })

  it('变体地址是相对写法时，按 master 自己的 URL 补全——第 3 章立的规矩在这里兑现', async () => {
    const relMaster = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\n360/playlist.m3u8'
    const { url } = await resolveMediaPlaylistUrl(MASTER_URL, relMaster, fakeFetch({}))
    // 相对解析是「顶掉基址的最后一段」：demo-key.m3u8 让位给 360/playlist.m3u8
    expect(url).toBe('https://video.twimg.com/ext_tw_video/1/pu/pl/360/playlist.m3u8')
  })
})

describe('download：downloadSegments，并发抓分片', () => {
  it('.ts 清单：相对分片地址按 mediaUrl 补全后抓取，交货按清单顺序，没有 init', async () => {
    const fetchLike = tsListFetch()
    const { init, segments } = await downloadSegments({ mediaUrl: TS_MEDIA_URL, fetchLike })
    expect(fetchLike.seen[0]).toBe(TS_MEDIA_URL) // 第一个请求永远是清单自己
    expect([...fetchLike.seen.slice(1)].sort()).toEqual(
      [`${TS_BASE}seg-a.ts`, `${TS_BASE}seg-b.ts`, `${TS_BASE}seg-c.ts`].sort()
    )
    expect(init).toBeNull()
    expect(segments.map((b) => Array.from(new Uint8Array(b)))).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ])
  })

  it('fMP4 清单：EXT-X-MAP 的 init 单独交货，拼接时排最前——第 3 章承诺的拼装次序', async () => {
    const mediaUrl = 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/list.m3u8'
    const map = { [mediaUrl]: resOf({ text: mediaFmp4Text }) }
    map['https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/init.mp4'] = resOf({
      bytes: bytesOf(0x66, 0x74, 0x79, 0x70), // 'ftyp'——fMP4 的开头四个字节
    })
    for (let i = 1; i <= 4; i++) {
      map[`https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/seg-${i}.m4s`] = resOf({
        bytes: bytesOf(0x30 + i),
      })
    }
    const { init, segments } = await downloadSegments({ mediaUrl, fetchLike: fakeFetch(map) })
    expect(init).toBeTruthy()
    expect(segments).toHaveLength(4)
    if (init === null) throw new Error('fMP4 清单应当交出 init——上面断言已拦住，这里让类型也相信')
    const whole = concatBuffers([init, ...segments]) // 拼装次序由调用方定：init 永远排最前
    expect(Array.from(whole.slice(0, 4))).toEqual([0x66, 0x74, 0x79, 0x70])
    expect(whole.length).toBe(8)
  })

  it('并发有上限：concurrency=2 时同时在飞的请求峰值恰好是 2', async () => {
    let active = 0
    let peak = 0
    const fetchLike = async (url) => {
      if (url === TS_MEDIA_URL) return resOf({ text: TS_MEDIA_TEXT })
      active += 1
      if (active > peak) peak = active
      await ticks(3) // 每片都在天上飞 3 拍，两条泳道必然同时各压着一片
      active -= 1
      return resOf({ bytes: bytesOf(0) })
    }
    await downloadSegments({ mediaUrl: TS_MEDIA_URL, fetchLike, concurrency: 2 })
    expect(peak).toBe(2)
  })

  it('完成顺序故意打乱（靠后的片先落地），交货顺序仍按清单——结果按下标归位，先完成的不插队', async () => {
    const fetchLike = async (url) => {
      if (url === TS_MEDIA_URL) return resOf({ text: TS_MEDIA_TEXT })
      const tag = /seg-(\w)\.ts$/.exec(url)
      const i = (tag?.[1] ?? 'a').charCodeAt(0) - 97 // a=0 b=1 c=2
      await ticks(9 - i * 3) // c 先落袋、a 最后——完成顺序与清单相反
      return resOf({ bytes: bytesOf(i + 1) })
    }
    const { segments } = await downloadSegments({ mediaUrl: TS_MEDIA_URL, fetchLike, concurrency: 3 })
    expect(segments.map((b) => new Uint8Array(b)[0])).toEqual([1, 2, 3])
  })

  it('onProgress 一次不落：每抓完一片报一次，最后一声 done=total', async () => {
    const events = []
    await downloadSegments({
      mediaUrl: TS_MEDIA_URL,
      fetchLike: tsListFetch(),
      onProgress: (e) => events.push({ ...e }),
    })
    expect(events.map((e) => e.done)).toEqual([1, 2, 3])
    expect(events.at(-1)).toEqual({ done: 3, total: 3 })
  })

  it('某片 404：抛 SegmentFetchError，message 点名哪个地址、什么状态、第几片', async () => {
    const fetchLike = fakeFetch({
      [TS_MEDIA_URL]: resOf({ text: TS_MEDIA_TEXT }),
      [`${TS_BASE}seg-a.ts`]: resOf({ bytes: bytesOf(1, 1) }),
      // seg-b.ts 故意不映射——对它就是 404
      [`${TS_BASE}seg-c.ts`]: resOf({ bytes: bytesOf(3, 3) }),
    })
    const p = downloadSegments({ mediaUrl: TS_MEDIA_URL, fetchLike })
    await expect(p).rejects.toThrow(SegmentFetchError)
    await expect(p).rejects.toThrow(/seg-b\.ts/)
    await expect(p).rejects.toThrow(/404/)
  })
})

describe('download：拼接与命名', () => {
  it('concatBuffers：ArrayBuffer 与 Uint8Array 混着进，字节按序首尾相接；空表进、空表出', () => {
    const glued = concatBuffers([bytesOf(1, 2), new Uint8Array([3]), bytesOf(4, 5)])
    expect(Array.from(glued)).toEqual([1, 2, 3, 4, 5])
    expect(concatBuffers([]).length).toBe(0)
  })

  it('guessFilename：带高度拼出档位段，纯音频档没有高度就整段省去', () => {
    expect(guessFilename('1740000000000000000', { ext: 'mp4', height: 720 })).toBe(
      'x-video-1740000000000000000-720p.mp4'
    )
    expect(guessFilename('1740000000000000000', { ext: 'ts' })).toBe(
      'x-video-1740000000000000000.ts'
    )
  })
})

describe('manifest：本章新要的能力报备', () => {
  it('permissions 含 downloads、声明了 action——下载 API 与工具栏图标都得先报备', () => {
    expect(manifest.permissions).toContain('downloads')
    expect(manifest.action).toBeTruthy()
  })
})
