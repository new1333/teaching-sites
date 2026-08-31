---
title: 拆开播放列表：从 m3u8 到清晰度清单
---

# 拆开播放列表：从 m3u8 到清晰度清单

上一章结束时，service worker 的控制台正替你盯着视频请求，.m3u8 地址一条条滚过。三个问题还摆在桌上：这份 m3u8 打开以后是什么？为什么视频不做成一个文件？地址都抓到了，离「硬盘上的一个文件」还差哪几步？这一章拆前两问。

先做一次上一章卖过关子的观察。从控制台日志里复制一条 .m3u8 地址，粘进新标签页打开：没有画面，也没有播放器——满屏纯文本，几十行 # 开头的英文标签，中间夹着一串串地址。它不像一个视频文件，像一张菜单而不是菜本身。再复制其中一行地址打开——出现的还不是视频，是又一层清单。两层清单，一层写「这个视频备了哪些画质」，一层写「选中的画质分成了哪些段」，每段是一个几秒钟的小文件，术语叫分片（segment）——视频被切成的小段，播放器按清单顺序逐段取用。这一章我们把这两层都拆开：先看懂每一行，再写一个纯函数解析器，让插件自己报出「检测到几档、该选哪档」。

## 清单不是电影：m3u8 到底是什么

你可能以为 m3u8 是一种视频格式——它长在 URL 末尾，地位看起来和 .mp4 一样。刚才的观察已经把它证伪了：.mp4 粘进地址栏能直接播，.m3u8 打开是纯文本，播放器根本不打算认它。**m3u8 不是视频的容器，是一张清单：写明这个视频由哪些资源组成、各在什么地址。**格式就是普通文本，语法规范叫 RFC 8216——HLS 的正式标准文档，苹果写的。本章每个标签「是什么、必须有什么」都以它为准，不靠猜。

为什么视频要配一张清单？做个反事实就清楚了。假如没有清单，播放器拿到一个地址只能闷头下：下多大、一共几段、下完当前这段之后下一段在哪，全都问无门；网速掉了一半，它也无从知道「该换个更小的档」。流媒体要的恰恰是这两件事——按网速换挡、按进度取段。于是 HLS 把「有哪些资源」与资源本体拆开：本体是一堆分片文件，目录是一张纯文本清单。纯文本不是偷懒：生成便宜、改动灵活、任何工具都能直接读，CDN 缓存它也和缓存网页一样容易。

这张目录还分两级。第一级叫 master playlist（一级清单）——只列「本视频备了哪些画质档」，每档一行参数、一行地址，地址指向的不是视频，是第二级清单。第二级叫 media playlist（二级清单）——列「选中的这一档分成了哪些片段」，一行时长、一行地址，地址指向的才是真正的视频分片。两级各画半张图：

```text
# companion/fixtures 里两级清单的结构示意（数字取自 fixture 真实内容）
第一层 master playlist —— https://…/pl/demo-key.m3u8
│ #EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720
│ https://…/pl/demo-key/1.m3u8   ← 每档两行：参数行 + 地址行
│ #EXT-X-STREAM-INF:BANDWIDTH=835000,RESOLUTION=640x360
│ https://…/pl/demo-key/2.m3u8
│ ……（fixture 共 5 档，其中 1 档纯音频）
│
│ 把任意一档的地址粘进浏览器 ↓
│
第二层 media playlist —— https://…/pl/demo-key/1.m3u8
│ #EXTINF:2.002,
│ https://…/ts/seg-0.ts   ← 分片：几秒一段的视频小文件
│ #EXTINF:2.002,
│ https://…/ts/seg-1.ts
│ ……（共 6 对，时长合计 11.478 秒）
│ #EXT-X-ENDLIST
```

锚点还是餐厅：master 是总菜单，只报「本店有哪些档」；media 是单道菜的配方单，一步一步列原料。播放器先翻总菜单挑一档，再照配方单取料。

## 演算：把一份 media playlist 逐行走一遍

解析器要拆的就是这样的文本。演练之前先当一遍人肉解析器——下面这份是伴生仓的 fixture，测试拿它当输入，我们拿它当教材：

```text
# companion/fixtures/media-ts.m3u8 —— 自造的示意 media playlist：6 个 .ts 分片（符合 RFC 8216）
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-0.ts
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-1.ts
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-2.ts
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-3.ts
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-4.ts
#EXTINF:1.468,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/ts/seg-5.ts
#EXT-X-ENDLIST
```

逐行走：

- `#EXTM3U`：文件头徽章。RFC 8216 §4.3.1.1 原话——它必须是每份清单的第一行。解析器拿它当门禁：第一行不是它，后面就不用看了。
- `#EXT-X-VERSION:3`：语法兼容版本号。版本 3 起 EXTINF 的时长允许写小数，更早只许写整数。
- `#EXT-X-TARGETDURATION:3`：全清单最长分片时长的整数上界。RFC §4.3.3.1 的规矩：每个分片的时长四舍五入成整数后，不得超过这个值。播放器拿它当取片节拍器。
- `#EXT-X-MEDIA-SEQUENCE:0`：第一个分片的序号。直播清单会不断滚动：最早的段移出、新段接上，序号往前滚；点播通常是 0。
- `#EXTINF:2.002,`——写给「紧跟在下一行」的那个分片的时长标签，单位秒；RFC §4.3.2.1 规定它只管下一个分片，且每个分片都必须有一个。逗号后面本可以写给人看的标题，这里空着。
- 不带 `#` 的行：地址行。`seg-0.ts`——.ts 是 MPEG-TS 封装的小段视频，HLS 最早的分片形态。
- 六对「时长 + 地址」重复同样的结构：2.002 × 5 加 1.468，合计 11.478 秒。这份「视频」的真身，就是六个几秒钟的小文件按清单排队。
- `#EXT-X-ENDLIST`：终点标记，清单封版、不会再长出新分片。直播清单没有它；X 的视频是点播，有。

还有一条规则要现在立下，第 4 章发请求时就会用到：清单里的地址可以是相对写法（只写 `seg-0.ts` 不写主机），RFC 8216 §4.1 规定「任何相对 URI 都按包含它的那份清单的 URL 解析」。X 抓到的清单多写绝对地址，但规则是通用的，浏览器一行就能验证：

```js
// 用法示例：任意 Console 都能跑——相对地址以清单自己的 URL 为基准补全
new URL('seg-0.ts', 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/x.m3u8').href
// → 'https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/seg-0.ts'
```

本课的解析器先按原文返回地址，补全留到下载那一步做。

## 一个视频，不止一份文件

你可能以为一个视频只有一份文件——服务器上存一个 xx.mp4，谁来看都发它。master 清单会当面推翻这个直觉。

```text
# companion/fixtures/master.m3u8 —— 自造的示意 master playlist：5 档变体（末档纯音频）
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2176000,RESOLUTION=1280x720,CODECS="avc1.640028,mp4a.40.2"
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/1.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=835000,RESOLUTION=640x360,CODECS="avc1.64001f,mp4a.40.2"
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/2.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=412000,RESOLUTION=480x270,CODECS="avc1.640015,mp4a.40.2"
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/3.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=216000,RESOLUTION=320x180,CODECS="avc1.64000d,mp4a.40.2"
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/4.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=86000,CODECS="mp4a.40.2"
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/5.m3u8
```

**同一个视频，服务器上预先压好了多份不同画质的拷贝**——这就是清晰度变体（variant）：每一档一份自己的 media 清单、一套自己的分片，1080p 的一套、360p 的另一套，互不共用。为什么这么费？回到上一节的反事实：不备多档，就没法按网速换挡。备好了，播放器在 master 里按带宽挑一档，网速变了还能中途换。

每档的「报名信息」都写在 `#EXT-X-STREAM-INF:` 这一行——一档变体的参数行，下一行是它的清单地址：

- `BANDWIDTH=2176000`（带宽）——这一档播起来每秒最多要吞多少数据，单位 bit/s。RFC §4.3.4.2 原话：每个 EXT-X-STREAM-INF 都必须带它。折算一下体感：2176000 ÷ 8 = 272000，约每秒 272 KB。
- `RESOLUTION=1280x720`：分辨率，宽 x 高。可选项——注意第五档就没有它。
- `CODECS="avc1.640028,mp4a.40.2"`：编码点名，视频 H.264 的一档加 AAC 音频。值带引号，而且引号里有逗号——这个细节马上会让解析器多写几行。
- 末档 `BANDWIDTH=86000`、没有 RESOLUTION、CODECS 只有音频：纯音频档。X 真的会备这一档，下载器把它当视频存下来就闹笑话了。

| | master playlist | media playlist |
| --- | --- | --- |
| 管什么 | 有哪些画质档 | 这一档分成了哪些片段 |
| 参数/时长标签 | EXT-X-STREAM-INF（BANDWIDTH 必填） | EXTINF（每个分片一个） |
| 地址行指向 | 下一份 media playlist | 分片文件（.ts / .m4s） |
| 特有的行 | RESOLUTION、CODECS | TARGETDURATION、EXT-X-MAP（下一节拆）、ENDLIST |
| 本章 fixture | 5 档（含 1 档纯音频） | 6 个 .ts 分片 / 4 个 .m4s 分片 |

## fMP4：先取一张解码说明书

把 X 现在常用的另一形态也拆了。下面这份 media 清单的分片不是 .ts，是 .m4s：

```text
# companion/fixtures/media-fmp4.m3u8 —— 自造的示意 fMP4 形态：EXT-X-MAP + 4 个 .m4s 分片
#EXTM3U
#EXT-X-VERSION:6
#EXT-X-TARGETDURATION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-MAP:URI="https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/init.mp4",BYTERANGE="712@0"
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/seg-1.m4s
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/seg-2.m4s
#EXTINF:2.002,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/seg-3.m4s
#EXTINF:1.468,
https://video.twimg.com/ext_tw_video/1/pu/pl/demo-key/fmp4/seg-4.m4s
#EXT-X-ENDLIST
```

多出的第一行主角是 `#EXT-X-MAP`——指向初始化分片的标签：它指路的那份数据，是解析器在啃任何分片之前必须先拿到的「解码说明书」（解码参数）。为什么 .ts 形态没有它？.ts 的每一段自带开头信息，切段随处可切；fMP4（fragmented MP4，碎片化的 MP4 容器）把说明书抽出来单放一份，所有 .m4s 分片共用。RFC §4.3.2.5 对它有两条硬规定：URI 属性必填、值是引号字符串；清单里用了它，兼容版本就得 ≥ 6（若清单不含 I-frames-only 标记则是 ≥5——那种清单本课不涉及）——对照上面第二行 `#EXT-X-VERSION:6`，对上了。

`BYTERANGE="712@0"` 是可选属性：说明书不必单独成文件，可以是某个文件从 0 字节起的 712 个字节。本课不实现字节区间下载，只读 URI；同类简化还有「多份 EXT-X-MAP 中途换说明书」按点播单一说明书处理。这些差异都登记在附录《本课程简化了什么》。

对下载器来说，两种形态的差别最终只有一句话：fMP4 要先抓 init.mp4，再抓分片；.ts 直接抓分片。init 拼在哪个位置，第 4 章的管线里见。

## 演练：测试先行，让解析器长出来

目标清楚了：一个能拆两级清单、能选档的纯函数模块。照全书约定，值得测的逻辑住 `src/shared/`，装配层不直接测。

### 第一步：fixtures 与测试，先看红

三份 fixture 就是上面看过的三份文本，测试从文件读它们。但工程是零依赖的，没装 Node 的类型包，读文本走 vite 的 `?raw` 后缀（整文件读成字符串），另补一个六行的类型声明。

```ts
// tests/fixtures-raw.d.ts —— 给「?raw 整文件读文本」的 import 一个类型（vite/vitest 的约定后缀）。
// 工程没装 @types/node，读 fixture 文本走 ?raw 而不是 node:fs，测试环境零 Node API。
declare module '*?raw' {
  const content: string
  export default content
}
```

本章测试全文如下，先读一遍再跑：

```js
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
```

```js
// tests/03-m3u8-parse.test.js —— 后半：选档与坏清单的报错
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
```

跑之前先猜两题：

1. `parseMediaPlaylist` 拆 .ts 那份 fixture，返回值里的 `mapUrl` 是什么？
2. `playlistKindOf('https://video.twimg.com/…/ts/seg-0.ts')` 返回 `'master'`、`'media'`、`'mp4'` 还是 `'unknown'`？

想亲眼看本章的「红」：把 `src/shared/m3u8.js` 临时移出 `src` 再跑——本章套件整组失败（`Cannot find module '../src/shared/m3u8.js'`），第 1 章的「后台可加载」也会连带红（装配层已经 import 了解析器）；移回来即恢复 76 绿。这就是测试先行的机械证据。

### 第二步：解析器

错误类型与数据形状先行：

```js
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
```

接着是属性表拆解——注意它怎么看得见引号：

```js
// src/shared/m3u8.js —— 属性表拆解（引号里的逗号不是分隔符）
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
```

要是无脑 `split(',')`，`CODECS="avc1.640028,mp4a.40.2"` 会在引号里被劈成两半，第五档的属性表直接错位。所以逐字符走一遍，引号内外的逗号区别对待。然后是 master 解析：

```js
// src/shared/m3u8.js —— master 解析：STREAM-INF 与下一行地址配成变体
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
```

三个设计决定。第一，行号从 1 数起，报错带着它——排查清单问题的人要的是「第几行」，不是堆栈。第二，`BANDWIDTH` 缺失是抛错而不是静默跳过：RFC 说它必填，缺了它这档根本没法参与比带宽。第三，`RESOLUTION` 有则拆 `width`/`height`、无则整个属性不出现在对象里——纯音频档于是天然可识别：`height` 是 `undefined`。

media 解析同构，多管一个 `EXT-X-MAP`：

```js
// src/shared/m3u8.js —— media 解析：EXTINF 与下一行地址配成分片，EXT-X-MAP 记为 mapUrl
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
```

`EXTINF` 先记在 `pendingExtinf` 里，等下一行地址来了配对——这正是 RFC「只管下一个分片」的直译。两个解析器拿反了都会响：master 文本喂给 media 解析器，死在「地址行前面没有 EXTINF」；反过来死在「没有变体」。报错信息都在互相提醒「是不是喂错了清单」。

最后是选档：

```js
// src/shared/m3u8.js —— 选档：默认带宽最高，可限高
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
```

一句提醒藏在「纯音频档没有高度，不参与限高」里：**带宽最高的档，不一定是有画面的档**——真遇到过把纯音频档当 4K 下载的下载器。限高筛掉所有有分辨率的档时，宁可抛 `NoVariantError` 也不悄悄退回纯音频。

### 第三步：playlistKindOf，按 URL 先猜一层

解析器认内容，但装配层还需要一个更便宜的问题：一个滚过来的 URL，值不值得取回来拆？`src/shared/video-url.js` 里新增（`isLikelyVideoUrl` 原样在它上面）：

```js
// src/shared/video-url.js —— playlistKindOf：按 URL 形态分级
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
```

规则取自 X 当前的 URL 形态：master 挂在 `/pl/<id>.m3u8`，media 在 `/pl/` 下再进一层目录。这是猜，不是承诺——URL 形态是 X 的易变细节，现场可核对（验证清单里有一条），形态变了改这两个正则就行；到底是谁，最终以清单内容为准。注意 `.ts` 分片落进 `'unknown'`：它确实不是清单，`isLikelyVideoUrl` 管「是不是视频资源」，它管「是不是清单」，两个问题两层答案。

### 第四步：装配，让控制台报出档位

```js
// 拼版·教学示意：sw.js 在第 3 章末的形态（看见清单就取来拆开，可测逻辑在 src/shared/m3u8.js）。
// 第 4、5 章再长出下载与账本，终态以伴生仓 src/background/sw.js 为准。
import { isLikelyVideoUrl, playlistKindOf } from '../shared/video-url.js'
import { parseMasterPlaylist, parseMediaPlaylist, pickVariant } from '../shared/m3u8.js'

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

// chrome 全局只在浏览器后台里存在；Node 测试环境 import 本文件时它缺席，先看一眼再注册
if (typeof chrome !== 'undefined') {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isLikelyVideoUrl(details.url)) return
      console.log('[xvd] 视频请求', details.url)
      const kind = playlistKindOf(details.url)
      if (kind === 'master' || kind === 'media') void reportPlaylist(details.url)
    },
    { urls: ['https://x.com/*', 'https://*.twimg.com/*'] }
  )
}
```

监听器骨架是第 2 章的，多了一步：识别为清单的请求，取回文本交给解析器。对 fixture 那样的 master，控制台会打出 `[xvd] 检测到 5 档画质（含 1 档纯音频），已选 1280x720`；media 清单打出分片数；`.ts` 分片什么也不追加——`playlistKindOf` 说是 `unknown`，不值得每个分片都惊动解析器。SW 里 fetch twimg 不受跨域限制，凭据是第 2 章报备过的 host_permissions——跨域豁免的完整账，下载管线落地时再算。解析失败也打日志：监听器里错不起，但更不能装没看见。

在 companion 目录跑两道门槛：`pnpm run typecheck` 安静通过；`pnpm test` 显示 `Tests  76 passed (76)`——本章 13 个在 `tests/03-m3u8-parse.test.js` 那行（累计口径见第 1 章）。开头那两题的答案都在里面：`mapUrl` 是 `null`（.ts 形态没有 EXT-X-MAP），`seg-0.ts` 是 `'unknown'`。

## 验证：打开真的清单，看报告

测试绿只证明解析器对 fixture 诚实；这一章的另一半验证在真浏览器里。逐条来：

- [ ] 在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`（`tests/03-m3u8-parse.test.js` 那行应显示 (13 tests)）；再跑 `pnpm run typecheck`：应无任何报错输出（pnpm 会先回显一行要跑的命令，那不是报错）。
- [ ] 打开一条含视频的推文并播放：service worker 控制台先滚出 `[xvd] 视频请求 https://video.twimg.com/…m3u8`，随后应出现一行 `[xvd] 检测到 N 档画质…已选 WxH`——N 与 WxH 是这条视频的真实档数，与 fixture 的 5 档不必相同。
- [ ] 把控制台里 master 形态的地址（`/pl/` 后直接跟文件名的那条）粘进新标签页打开：第一行应显示 `#EXTM3U`，往下有若干 `#EXT-X-STREAM-INF` 行，每行含 `BANDWIDTH=` 数值和 `RESOLUTION=` 宽高。
- [ ] 数一数页面上 `EXT-X-STREAM-INF` 的行数，与控制台报告的 N 对比：结果应是两个数字相等。若 X 仍备纯音频档，其中还应有一档不出现 `RESOLUTION=`；没有也不影响其余各条——形态随版本可能变。
- [ ] 从打开的 master 里复制一档的地址，粘进新标签页：应看到 `#EXTINF:` 行与分片地址逐对排列；若这档是 fMP4 形态，应有一行 `#EXT-X-MAP:URI="…"`（.ts 形态则没有这行，可再换一档找）。
- [ ] 控制台对这条 media 清单应输出一行 `[xvd] 媒体清单：X 个分片`，X 与你在页面上数到的 `#EXTINF` 行数一致。
- [ ] 若手头有 mp4 直链的视频（Network 里过滤 mp4）：控制台应只滚 `[xvd] 视频请求 …mp4`，不出现档位报告——`playlistKindOf` 判它 `'mp4'`，没有清单可拆。
- [ ] 先猜后跑：猜——把 `fixtures/media-ts.m3u8` 第一行 `#EXTM3U` 删掉再 `pnpm test`，几条红？跑完应看到 2 条红：红的是「六个 .ts 分片」和「解析器拿反了」两条——第二处红在报错信息对不上 `EXT-X-STREAM-INF`（绿的总数随全书累计口径走，以终端为准）。改回后恢复 76 绿。
- [ ] 先猜后跑：把 `fixtures/master.m3u8` 末档的 `BANDWIDTH=86000` 改成 `BANDWIDTH=9999999` 再跑：应看到 4 条红（4 failed | 72 passed）。本章两条：「五个变体」死在期望 86000、「默认选最高档」死在选出来的是纯音频（height 是 `undefined`）。另有下一章选档管线的 2 条——同一份 fixture，下游测试同吃。带宽冠军不一定有画面，这就是亲手按出来的证明。改回恢复。
- [ ] 最后一题留给你：把 `fixtures/media-fmp4.m3u8` 的 `#EXT-X-MAP` 整行删掉，先猜会红几条再跑 `pnpm test`：终端显示的红条数应等于你的猜测（答案见自查第 2 题）。

## 收束

现在可以回答开篇了：粘进浏览器那份「没有画面的纯文本」，你如今能逐行念出来——第一行 `#EXTM3U` 是门禁，`EXT-X-STREAM-INF` 报的是每一档的带宽与分辨率，`EXTINF` 和地址行配成一个个分片，fMP4 还多一张叫 `EXT-X-MAP` 的解码说明书。两层清单各管一层：master 管「有哪些画质」，media 管「这一档有哪些段」。而你的插件不只会念：service worker 看见清单就取回来拆，报出「检测到 N 档、已选哪档」。同一份视频在服务器上是多份拷贝、一堆小文件——现在每一份在你的控制台里都有名有姓。

清单拆开了，地址都在手上，缺的是把地址变成文件的那双手：分片一个个抓回来、按顺序拼上、fMP4 先拼说明书、相对地址按清单 URL 补全——完整下载管线第 4 章见。

### 自查

1. `parseMasterPlaylist` 遇到缺 `BANDWIDTH` 抛错，`playlistKindOf` 认不出的 URL 却只返回 `'unknown'`——同样是「不对」，为什么待遇不同？
2. 预测：删掉 `fixtures/media-fmp4.m3u8` 的 `#EXT-X-MAP` 整行再 `pnpm test`，几条红、哪条？
3. fixture 的 5 档里，`pickVariant(variants, { maxHeight: 200 })` 选哪一档？`{ maxHeight: 120 }` 呢？

::: details 参考答案
1. 解析器读的是「承诺过按 RFC 8216 写」的清单内容，必填项缺失就是坏数据，抛错并把行号喊出来是对的；`playlistKindOf` 做的是没有承诺的 URL 形态猜测，猜不出就诚实说 `'unknown'`，不值得为一个坏 URL 惊动任何人——与第 2 章 `isLikelyVideoUrl` 安静返回 false 同一层道理。可回看「playlistKindOf」一节。
2. 2 条红：「EXT-X-MAP 的 URI 拆成 mapUrl」——`mapUrl` 变成 `null`，断言不等；外加下一章的「init 单独交货、拼接时排最前」——同一份 fixture，下游同吃。分片相关断言照旧绿，4 个分片还在。（实测 `2 failed | 74 passed`。）
3. `{ maxHeight: 200 }`：候选只剩 320x180（其余视频档 270/360/720 都超线），选 320x180、带宽 216000。`{ maxHeight: 120 }`：连 180 也超线，纯音频档没有高度不参选，一档不剩，抛 `NoVariantError`。可回看「选档」一节。
:::
