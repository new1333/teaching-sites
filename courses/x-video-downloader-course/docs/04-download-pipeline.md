---
title: 把播放列表变回一个文件：分片下载管线
---

# 把播放列表变回一个文件：分片下载管线

上一章结束时，service worker 已经能把抓到的 m3u8 拆成档位与分片清单，控制台报着「检测到 5 档画质（含 1 档纯音频），已选 1280x720」。两个尾巴还挂在读者面前：这些地址怎么变成硬盘上的一个文件？还有第 3 章末立下的两条规矩——fMP4 的初始化分片拼装时排最前、清单里的相对地址以清单自身的 URL 补全——说好下载管线落地时兑现。

这一章先把管线一口气写完，再在最后一步撞墙。场景是这样的：选档、抓分片、拼字节，一路顺得可疑，控制台眼看着分片计数滚到 4/4，一个几 MB 的 Uint8Array 就攥在手里。接下来顺手一行，把这块数据变成能下载的东西：

```js
// 用法示例：在 service worker 里给拼好的字节发一个 blob: 门牌（天真版，马上撞墙）
const blob = new Blob([bytes], { type: 'video/mp4' })
const blobUrl = URL.createObjectURL(blob)
```

`TypeError: URL.createObjectURL is not a function`。不是拼错了变量名——这行代码搬到页面的 Console 里跑得好好的，唯独在 service worker 控制台里当场抛错。分片都抓下来了，字节也拼好了，就差「存」这最后一步，偏偏卡死在这里：**后台环境没有 DOM，拼好了存不了**。这一章就从这堵墙开始：先弄清它为什么撞不破，再把管线劈成两半，让两个世界各干自己擅长的那一半。

## 抓网络的手，管不了存盘

你可能以为后台脚本无所不能——它连你的全部网络流量都看得见，存个文件算什么。这堵墙正好用来修正这个直觉。

先认识撞墙的主角。URL.createObjectURL——把一块内存数据注册成一个 blob: 门牌的 API。第 2 章你在 `<video>` 的 src 里见过它发的门牌；现在你自己要发一个，才发现 SW 里根本没有这个函数。MDN 的备注写得直白：这个特性「available in Web Workers, except for Service Workers」。连普通的 Web Worker 都配了它，唯独 Service Worker 没有。理由也给了：「due to its potential to create memory leaks」，有内存泄漏风险。泄漏从哪来？blob: 门牌的回收靠「创建它的文档」兜底：文档一关，它发的门牌全部作废。SW 没有文档，寿命又不定——门牌发出去就可能永远没人收。做个反事实就明白这不是偷懒：假如浏览器硬塞给你，一个下载器每存一个视频漏一个门牌，装着十几个插件的浏览器最先遭殃。所以这不是「还没实现」，是「故意不给」。

那把存盘搬去页面世界做？页面世界有 DOM，createObjectURL 随便用。可是它抓不到分片。第 3 章末许过一笔账：SW 里 fetch twimg 不受跨域限制，凭据是报备过的 host_permissions——现在算清它。这待遇有个名字：CORS 豁免——manifest 的 host_permissions 里报备过的站点，扩展后台向它们发请求，不受网页世界跨域规则（CORS）的约束。Chrome 官方文档《Cross-origin network requests》写得很清楚。扩展的 service worker 可以「talk to remote servers outside of its origin」。条件原话是「as long as the extension requests host permissions」——只要报备过，就能跨域。但同一页紧跟着一句关键限制。content script 里的跨域请求一律照旧对待。官方原话是「are always treated as such … even if the extension has host_permissions」——**报备过也不豁免**。它替页面干活，浏览器就按页面的身份管它。

两边一对账，架构就被能力边界挤定了型：

```text
service worker（后台世界）              content script（页面世界）
────────────────────────              ────────────────────────
host_permissions → CORS 豁免 ✓         DOM、Blob、createObjectURL ✓
fetch video.twimg.com 分片             new Blob(bytes) → 发 blob: 门牌
chrome.downloads、chrome.tabs          <a download> 点击落盘
URL.createObjectURL ✗（没有 DOM）      fetch video.twimg.com ✗（跨域照管）
        │                                     ▲
        └──────── 消息传递：整段字节 ──────────┘
```

抓网络的手在后台，管存盘的手在页面，天生不在一起。第 1 章立过一条规矩：两个世界没有共享内存，正式通道只有互发消息，「后面接通下载管线时会用到」——用到的时候到了。

## 两种落盘：让浏览器替你存，或造个链接让页面点

再看一个大概率已有的直觉：你可能以为下载就是把一个 URL 存下来——浏览器的下载确实如此，一个 URL 进去，一个文件出来。mp4 直链正是这种，所以它好办。但 HLS 视频在服务器上从来不是「一个文件」：是一张清单加一堆几秒的小分片。**你最后拿到的那个文件，是你在客户端亲手拼出来的产物**——服务器上从来没有存在过它。这就是同一枚插件图标背后，两条路径重量悬殊的原因。

两种落盘方式，各住一个世界。chrome.downloads——插件后台专用的下载 API：给一个 URL 和可选的文件名，浏览器替你把下载做完。凭据是 manifest 里 permissions 报备 `"downloads"`（官方要求：You must declare the "downloads" permission）。文件名参数的约束官方也写死了：相对下载目录的路径，可以有子目录；绝对路径、空路径、含 `..` 的路径直接报错。a[download]——页面侧的落盘方式：造一个带 `download` 属性的 `<a>` 标签，把 `href` 指向内存数据，`click()` 一下，浏览器把数据存成文件。它的约束来自 MDN 的原文：download 属性「only works for same-origin URLs, or the blob: and data: schemes」。只对同源 URL 生效，blob: 和 data: 是仅有的例外。

为什么 blob: 能过同源这一关？第 2 章说过门牌带出身：页面用 createObjectURL 自己造的门牌，登记的出身就是这个页面，同源自然成立。反过来试：直接 `a.href = 'https://video.twimg.com/…m3u8'` 再加 download 属性会怎样？跨源 URL，属性被浏览器无视，点击变成打开或预览，不落盘。所以 a[download] 搭配的永远是 blob: 门牌——先把字节装进 Blob，再发门牌，再点链接。

Blob 在这里首次正式登场：Blob 是浏览器把「内存里的一段字节数据」打包成的对象，构造时附带一个 MIME 类型（如 `video/mp4`），它不是文件，只是数据加类型的一层包装；门牌挂的正是它。

| | chrome.downloads | a[download] |
| --- | --- | --- |
| 住哪个世界 | service worker（浏览器 API） | content script（DOM） |
| 要什么凭据 | permissions 报备 `downloads` | 无需报备，但 href 必须同源或 blob:/data: |
| 输入是什么 | 一个 URL（浏览器自己去下） | 内存里的 Blob（数据必须已在手） |
| 本章职责 | mp4 直链一行落盘 | HLS 拼装后的整段字节 |

分工随之定案：mp4 直链天生一个 URL，SW 里一行 `chrome.downloads.download` 完事；HLS 的分片必须由 SW 抓（豁免只在它手里），产物是内存字节，必须递回页面世界用 a[download] 落盘。

## 拼接为什么合法：你在做播放器做过的事

字节拼接——把按顺序取回的分片原样首尾相接——凭什么接出来的东西能播？回想第 2 章那条 MSE 流水线：播放器本来就是页面 JS 自己 fetch 分片、按清单顺序一段段喂给 MediaSource 的。下载管线做的每一步都与播放器同构：同一张清单、同一批分片、同一个顺序，唯独终点从「喂给 `<video>`」换成「喂给文件」。**播放器按这个顺序能播，你按这个顺序拼出来就能放**——拼接的合法性不靠任何「合并工具」，靠的是顺序本身。

两条第 3 章立的规矩在这里兑现。其一，fMP4 的初始化分片（EXT-X-MAP 指向的那份「解码说明书」）拼装时排最前：播放器要先读说明书再啃分片，文件同理，init 永远在第 0 位。其二，清单里的相对地址以清单自身的 URL 补全（RFC 8216 §4.1），落到代码是 `new URL(相对地址, 清单URL)` 一行。这一行有个我亲手踩过的坑：相对解析的规则是「顶掉基址的最后一段」，`360/playlist.m3u8` 配上 `…/pl/demo-key.m3u8`，得到的是 `…/pl/360/playlist.m3u8`——不是塞进 demo-key 目录里。任意 Console 一行就能复核：

```js
// 用法示例：任意 Console 可跑——相对解析顶掉基址的最后一段
new URL('360/playlist.m3u8', 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key.m3u8').href
// → 'https://video.twimg.com/ext_tw_video/1/pu/pl/360/playlist.m3u8'
```

最后是速度问题。并发抓取——同时开几个请求抓分片、按清单原顺序交货。分片几秒一段、动辄几十段：串行下载的总时长等于各段之和，并发后上限之内的路程可以重叠。为什么不干脆全开？几十个请求同时砸向 CDN 不礼貌，也把节奏交给浏览器内部的连接排队去猜；自己定上限（本章默认 4），行为礼貌且可测。并发带来一个新问题：完成顺序乱了，交货顺序不能乱——解法在实现里，先卖个关子。

## 演练：测试先行，让管线长出来

目标形态：`src/shared/download.js` 四个导出加一个错误类——`resolveMediaPlaylistUrl`（master 到 media 的选档与补全）、`downloadSegments`（按清单并发抓分片）、`concatBuffers`（字节拼接）、`guessFilename`（文件名），以及 `SegmentFetchError`。网络照全书约定从参数注入（fetchLike），测试喂假 fetch 就能验证整条管线。

### 第一步：假件与测试，先看红

假件三件套。`resOf` 造一个假 Response，只装管线用到的两个方法：`text()` 给清单文本、`arrayBuffer()` 给分片字节。`fakeFetch` 按 URL 精确映射到假 Response，没映射到的地址一律 404，顺手把每次被请求的 URL 记进 `seen`——补全对不对、有没有多发请求，都靠它对账。`ticks` 是微任务节拍：`await` n 拍再继续，给不同分片配不同拍数，完成顺序就能人为编排——全部走微任务，不碰定时器、不 sleep。测试数据除了第 3 章的两份 fixture，另造一份相对地址写法的 .ts 清单。fixture 里的地址全是绝对写法，补全这条腿要专门的样本：

```js
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
```

```js
// tests/04-download-pipeline.test.js —— 后半：四组断言
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
```

跑之前先猜两题：

1. `resolveMediaPlaylistUrl` 收到的 `masterText` 已经是完整清单文本，它还会发网络请求吗？
2. 三片分片里，让 seg-c 最先完成、seg-a 最后完成，返回的 `segments[0]` 装的是谁的字节？

想亲眼看本章的「红」：把 `src/shared/download.js` 临时移出 `src` 再跑——红的除了本章 12 个，还有第 1 章那条「后台文件真实存在、可加载」：本章起 sw.js import 了管线，管线不在，后台文件也加载不了。两条报错正好对照着看：本章测试报 `Cannot find module '../src/shared/download.js'`，第 1 章那条报的是 `'../shared/download.js' imported from …/sw.js`——依赖长成这样，谁的缺位会砸到谁，测试说得清清楚楚。移回来即恢复 76 绿。这就是本章的红。

### 第二步：download.js，从选档到拼接

错误类与网络形状先行。`FetchLike` 只约定 fetch 用得到的两件东西（`text`/`arrayBuffer` 两个方法加 `ok`/`status`）——真 fetch 满足它，假 fetch 只需装得下这些：

```js
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
```

第一个函数只做一段路：从 master 地址走到 media 地址。注意 `masterText` 允许传 `null`——SW 睡一觉就丢光内存，用户点图标时 master 文本往往早没了，这条「自己重取」的路才是装配层的日常：

```js
// src/shared/download.js —— resolveMediaPlaylistUrl：选档并补全二级清单地址
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
```

拆清单与选档全是第 3 章的老函数，本章只添补全那一行。接着是一份独立的「抓一份」：任何失败——网络抛错也好、状态码不对也好——都翻译成带身份的 SegmentFetchError：

```js
// src/shared/download.js —— fetchJob：抓一份，失败要报得出死因
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
```

主角是 `downloadSegments`。前半程直白：取清单、解析、把每行地址补全成绝对地址、装进一张任务表——init 若有则排在队首，`slot` 记下每份的归位地址。后半程是并发池，全部机关两行：光标 `cursor++` 发号，`segments[job.slot]` 按下标归位：

```js
// src/shared/download.js —— downloadSegments：并发抓取，交货按清单序
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
```

并发池开 `concurrency` 条泳道，每条循环「领号—抓—归位」。两件事值得多看一眼。第一，`cursor++` 不用加锁：JS 单线程，两条泳道只在 `await` 处轮转，同步的取号不会劈叉。第二，**完成顺序与交货顺序从此解耦**：谁先落地谁先归位，但归位地址是发号时定死的下标——测试里 seg-c 故意最先完成，`segments[0]` 依然是 seg-a 的字节，靠的就是这一条。

收尾两个小函数。拼接收 ArrayBuffer 与 Uint8Array 混装；命名在高度缺席时（纯音频档没有分辨率）整段省去档位，硬拼出 `-undefinedp` 才是事故：

```js
// src/shared/download.js —— 拼接与命名
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
```

在 companion 目录跑两道门槛：`pnpm run typecheck` 安静通过；`pnpm test` 显示 `Tests  76 passed (76)`——本章 12 个在 `tests/04-download-pipeline.test.js` 那行（累计口径见第 1 章）。开头两题的答案都在里面：masterText 给全了就一个请求都不发（`seen` 是空的）；交货永远按清单序，`segments[0]` 是 seg-a。

### 第三步：装配——先撞墙，再拆墙

manifest 先报备两样新能力：

```jsonc
// 拼版·教学示意：manifest 在第 4 章末的形态（比第 3 章多出 downloads 权限与 action 工具栏入口）。
// 第 5 章再长出 storage 与 web_accessible_resources，终态全文见第 6 章。
{
  "manifest_version": 3,
  "name": "X 视频下载器（教学版）",
  "version": "0.1.0",
  "permissions": ["webRequest", "downloads"],
  "action": {},
  "host_permissions": ["https://x.com/*", "*://*.twimg.com/*"],
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["src/content/loader.js"]
    }
  ],
  "background": { "service_worker": "src/background/sw.js", "type": "module" }
}
```

`permissions` 加 `"downloads"` 是 `chrome.downloads` 的钥匙。`"action": {}` 声明工具栏入口——不配图标时浏览器给默认图标，不设 popup 时点击才会触发 `chrome.action.onClicked` 事件，这正是我们要的「点图标干活」。

后台的增量分三块。先记住「最近看到的视频」，再配两个从 URL 里抠文件名素材的小工具。

```js
// 拼版·教学示意：第 4 章新增的「记住最近视频」与文件名小工具（第 5 章由账本接替 lastVideo）。
// 终态以伴生仓 src/background/sw.js 为准。
/**
 * 最近看到的视频（只记 master 清单与 mp4 直链）。模块变量活不过一次 SW 休眠——
 * 睡醒后这里是 null，点图标只会提示「先播放一条」，这是第 5 章按推文下载要接掉的短板
 * @type {{ kind: 'master' | 'mp4', url: string } | null}
 */
let lastVideo = null

/** 从视频 URL 里抠一串够长的数字当文件名指纹；抠不到就退回 'video'（X 的路径形态随版本可能变） */
function idFromUrl(url) {
  const m = /(\d{6,})/.exec(url)
  return m ? m[1] : 'video'
}

/** mp4 直链的分辨率写在路径里（形如 /vid/720x1280/），顺手抠出高度；HLS 的高度来自选档，用不着它 */
function heightFromUrl(url) {
  const m = /(\d{2,4})x\d{2,4}/.exec(url)
  return m ? Number(m[1]) : undefined
}
```

说明一下文件名指纹：`idFromUrl` 抠的是视频 URL 路径里的长数字（X 的媒体 id），不是推文的 status id——够用来对账「哪条视频」，但别拿它当推文编号去拼 x.com 链接；这条临时简化下一章即退役（文件名改用真正的推文 status id），故不占差异清单条目。

点击处理是两条路径的分岔口：

```js
// 拼版·教学示意：第 4 章的 onToolbarClick（mp4 一行落盘、HLS 抓完拼完递字节）。
// 第 5 章入口搬进推文按钮后此函数退役；递字节的写法藏着一个暗坑，见块后说明。
/**
 * 工具栏图标被点：最近看到的是 mp4 直链就一行落盘；是 HLS 就走完整管线——
 * 选档、并发抓分片、字节拼接，然后把整段字节递回页面世界存盘（SW 里没有 URL.createObjectURL）
 * @param {{ id?: number }} tab 点击发生的标签页，消息要有接收方——图标请在 x.com 的页面上点
 */
async function onToolbarClick(tab) {
  if (tab.id === undefined) return // 类型守卫：onClicked 递来的 tab 一定带 id，这里只为让下面 sendMessage 拿到 number
  if (!lastVideo) {
    console.log('[xvd] 还没看到过视频——先在 x.com 播放一条，趁 SW 没睡再点图标')
    return
  }
  try {
    if (lastVideo.kind === 'mp4') {
      await chrome.downloads.download({
        url: lastVideo.url,
        filename: guessFilename(idFromUrl(lastVideo.url), {
          ext: 'mp4',
          height: heightFromUrl(lastVideo.url),
        }),
      })
      return
    }
    const { url: mediaUrl, variant } = await resolveMediaPlaylistUrl(lastVideo.url, null, fetch)
    const { init, segments } = await downloadSegments({
      mediaUrl,
      fetchLike: fetch,
      onProgress: ({ done, total }) => console.log(`[xvd] 分片 ${done}/${total}`),
    })
    const bytes = concatBuffers(init ? [init, ...segments] : segments) // init 存在时排最前
    await chrome.tabs.sendMessage(tab.id, {
      type: 'xvd-save-file',
      filename: guessFilename(idFromUrl(mediaUrl), { ext: init ? 'mp4' : 'ts', height: variant.height }),
      mime: init ? 'video/mp4' : 'video/mp2t',
      bytes: bytes.buffer,
    })
  } catch (err) {
    console.log('[xvd] 下载失败：', err instanceof Error ? err.message : err)
  }
}
```

mp4 路径真的只有一行 `chrome.downloads.download`。HLS 路径把管线串起来：`resolveMediaPlaylistUrl` 传 `null` 让它自己重取 master（SW 大概率刚被点击事件唤醒，第 3 章那点内存早没了）；`downloadSegments` 的进度挂到控制台日志；拼装时 `init` 排最前；最后 `chrome.tabs.sendMessage` 把整段字节、文件名、MIME 一起递给点击所在的标签页。递字节不是零成本——两个世界没有共享内存，消息传的是拷贝；一个几十 MB 的视频要在内存里多住一份，教学版认了这笔账，也登记在差异清单。还要先立一块警示牌：下面这行 `bytes: bytes.buffer`，下一章会被证明**从来没能把字节送过去**——消息通道有自己的规矩，那颗雷下一章第一脚就踩响，修法也一并给。

消息的接收端在 content script，也就是 `loader.js` 的新增段——本章 bug-story 的解法就在这里。

```js
// 拼版·教学示意：第 4 章给 loader.js 长出的落盘监听段（贴角标的原样在前）。
// 这段与 sw.js 的 bytes.buffer 是同一颗雷的两半，下一章重写，终态全文见下一章「演练」。
// chrome 全局在页面世界里恒在；Node 测试环境 import 本文件时它缺席，先看一眼再注册（与 sw.js 同款守卫）
if (typeof chrome !== 'undefined') {
  // 后台把拼好的整段字节递过来：组 Blob、发临时门牌、造链接点一下存盘——
  // 这三步全要 DOM，只能在页面世界做；这也是本章 bug-story 的解法本身
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'xvd-save-file') return
    const blob = new Blob([msg.bytes], { type: msg.mime })
    const blobUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = blobUrl
    a.download = msg.filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    // 门牌不能立刻回收：浏览器接住下载要一瞬间，马上 revoke 可能存出空文件
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
    sendResponse({ ok: true })
  })
}
```

开篇那行抛错的 `URL.createObjectURL`，在页面世界里健在：同样的字节、同样的 API，换到有 DOM 的环境一步到位。监听器最后 `sendResponse({ ok: true })` 回执——全书约定，收到消息必须回话。门牌要等 10 秒再回收：浏览器接住下载需要一瞬间，立刻 revoke 可能存出空文件。还有一处没展开：消息类型 `'xvd-save-file'` 是本章的临时裸字符串，正式的消息协议（常量表加守卫函数）第 5 章抽成 `shared/messages.js`，这里先简单同步地实现，不越界。

最后把点击接上网——监听器骨架是第 2 章的，多两行：

```js
// 拼版·教学示意：第 4 章末的监听器注册区（第 2 章骨架 + lastVideo 记忆与 action 点击）。
// 第 5 章记账改走账本，终态以伴生仓 src/background/sw.js 为准。
if (typeof chrome !== 'undefined') {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isLikelyVideoUrl(details.url)) return
      console.log('[xvd] 视频请求', details.url)
      const kind = playlistKindOf(details.url)
      if (kind === 'master' || kind === 'media') void reportPlaylist(details.url)
      if (kind === 'master' || kind === 'mp4') lastVideo = { kind, url: details.url }
    },
    { urls: ['https://x.com/*', 'https://*.twimg.com/*'] }
  )
  chrome.action.onClicked.addListener((tab) => void onToolbarClick(tab))
}
```

`lastVideo` 只记 master 清单与 mp4 直链：media 清单不记，免得覆盖掉带着档位信息的 master。门槛再跑一遍收工：`pnpm run typecheck` 安静，`pnpm test` 76 个全绿。

## 验证：两条路径，文件可播放

测试绿只证明管线对假件诚实；这一章的另一半验证在真浏览器里——标准是「磁盘上出现一个能播放的文件」。逐条来：

- [ ] 在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`（`tests/04-download-pipeline.test.js` 那行应显示 (12 tests)）；再跑 `pnpm run typecheck`：应无任何报错输出。
- [ ] 在 chrome://extensions 的插件卡片上点刷新图标重新装载（manifest 变了必须重载）；点浏览器工具栏的拼图图标，把「X 视频下载器（教学版）」钉到工具栏——工具栏应出现本插件的图标。
- [ ] 先猜后跑：点开 service worker 控制台，输入 `typeof URL.createObjectURL` 回车——先猜是 `'function'` 还是 `'undefined'`。应显示 `'undefined'`；再到 x.com 任意页面的 DevTools Console 跑同一行，应显示 `'function'`。一行代码，两个世界。
- [ ] mp4 路径：找一条 mp4 直链的视频（Network 面板过滤 mp4，播放后确认 SW 控制台滚出 `…mp4`），趁 SW 醒着点工具栏图标：浏览器下载栏应出现一个 `x-video-…-….mp4` 文件；双击应能直接播放。文件名里的档位段（若有）应与 URL 路径里的 `宽x高` 数字一致。一时找不到 mp4 直链视频可跳过此条，其余各条不受影响。
- [ ] HLS 路径（第 4 章形态）：播放一条 m3u8 视频，等 SW 控制台出现 `[xvd] 检测到 N 档画质…`，点工具栏图标：控制台应逐行滚出 `[xvd] 分片 1/M` 直到 `[xvd] 分片 M/M`（M 是这条视频选定档位的真实分片数）——到这一步，第 4 章能兑现的都兑现了。「递字节落盘」那最后一跳在本章形态下有暗坑：页面侧会回执成功，下载栏却不出文件。雷在哪、怎么修，下一章开章踩响；HLS 全程落盘的验证以第 5 章清单为准。
- [ ] 双击刚下载的文件验证「文件可播放」：mp4 应被系统播放器直接播放；.ts 用 VLC（或你机器上认得 TS 的播放器）打开，应看到画面从头播到尾，进度条总时长与原视频一致。
- [ ] 先猜后跑：切到一个非 x.com 的标签页（比如一个空白页），趁 SW 醒着（刚播放过视频）点工具栏图标：SW 控制台应出现 `[xvd] 下载失败：Could not establish connection…`——消息递出去了，那个页面里没有你的 content script 接。
- [ ] 先猜后跑：播放一条视频后，等约 30 秒让 SW 休眠。再点工具栏图标：SW 控制台应出现 `[xvd] 还没看到过视频——先在 x.com 播放一条…`——`lastVideo` 是模块变量，随休眠归零。（若拿不准 SW 是否睡着，就多等一会儿再点；以控制台这句输出为准。）
- [ ] 先猜后跑：把 `src/shared/download.js` 里 `fetchJob` 的 `if (!res.ok)` 那两行（连同大括号）删掉再 `pnpm test`：应看到恰好 1 条红——「某片 404」死在没抛错；其余 75 条照绿，因为其他测试的假 fetch 全是 `ok: true`。想想没有这层翻译会发生什么：404 的响应体会被当成空片拼进文件——静默存出一个坏文件，比抛错可怕得多。改回恢复 76 绿。

## 收束

现在可以回答开篇那晚的 TypeError 了：`URL.createObjectURL` 是页面世界的 API，后台从来没有过——而且不是还没实现，是算过泄漏账后故意不给的。所以解法不是绕过它，而是把「存盘」这最后一步交还给天生有 DOM 的世界。SW 抓分片（CORS 豁免只在它手里）、拼字节（init 排最前），把整段字节用消息递回页面。content script 组 Blob、发门牌、`a[download]` 点一下落盘。抓网络的手和管存盘的手，隔着一条消息握在了一起。

第 2 章承诺的「抓到的播放列表地址怎么变成一个文件」，现在的答案是两条路径：mp4 直链一行 `chrome.downloads.download`；HLS 完整管线——选档、相对地址按清单 URL 补全、并发抓分片按下标归位、字节拼接、跨世界递字节、门牌落盘。第 3 章的两个尾巴也都兑现了：EXT-X-MAP 的 init 在拼装时排最前（fMP4 测试里第一个断言就是它），相对 URI 补全在 `resolveMediaPlaylistUrl` 和 `downloadSegments` 里各就各位。

你的插件第一次真正「能用」了一半：点一下图标，mp4 直链的视频磁盘上就多出一个能双击播放的文件。HLS 还差最后一跳——那一跳里埋着下一章的第一颗雷，也埋着把按钮放上每条推文的正事；host_permissions 与 CORS 豁免的完整账，第 6 章算清。

### 自查

1. mp4 直链为什么不走「SW 抓字节、递回页面、a[download] 落盘」这条流水线，而是一行 `chrome.downloads.download`？
2. 预测：删掉 `fetchJob` 里的 `if (!res.ok)` 翻译层再 `pnpm test`，几条红、哪条？在真实网络里，这个删除会以什么方式坑你？
3. 迁移题：五个分片 seg-a 到 seg-e、`concurrency: 2`，实际完成顺序是 e、b、a、d、c——返回数组的 `[0]` 到 `[4]` 各装谁？若抓 seg-d 时抛了 `SegmentFetchError`，seg-e 和 seg-b 的字节此刻在哪、整个 `downloadSegments` 最终以什么收场？

::: details 参考答案
1. 两种落盘的适用面不同：`chrome.downloads` 吃的是 URL，mp4 直链天生一个 URL，浏览器自己下载最省事；a[download] 吃的是内存 Blob，专供拼装产物。反过来硬配也不行——把视频真地址塞给 `a.href` 加 download 属性，跨源 URL 属性被无视，不会落盘。可回看「两种落盘」一节的对照表。
2. 恰好 1 条红：「某片 404」——假 fetch 明明 404，函数却安静交货，`rejects.toThrow` 等来的是 resolve。真实网络里的坑更阴险：404 响应体（通常是错误页 HTML）会被当成一个分片拼进文件，存出一个播到一半就坏的文件——不报错的坏，比报错难排查一个量级。可回看验证清单最后一条。
3. `[0]`a、`[1]`b、`[2]`c、`[3]`d、`[4]`e——每个任务领号时就定死了归位下标，谁先完成都按下标落座，顺序与完成顺序无关。seg-d 抛错时，e、b 的字节已经躺在返回数组的对应槽位里（归位即写、不等同伴）；但整条 `Promise.all` 会让 `downloadSegments` 以 rejected 收场，那些已到位的字节随之作废——调用方拿到的是一个异常，不是半个文件。机制可回看「downloadSegments」一节的并发池讲解。
:::
