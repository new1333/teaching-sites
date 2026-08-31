---
title: 视频不在 video 标签里：让它在网络面板现形
---

# 视频不在 video 标签里：让它在网络面板现形

上一章插件已经在 x.com 上跑起来：content script 贴角标，service worker 只报了一声到。还记得那条分工吗——贴角标的手摸得到 DOM，却拿不到浏览器 API；能监听网络的那双手，在后台。这一章轮到后台出手。第 1 章说好的「下一章监听网络流量的活儿，就派给它」，现在兑现。

先做一次只有你能做的观察。打开一条带视频的推文，右键视频点「检查」：Elements 面板里高亮的 `<video>` 标签上，src 是一串 blob:https://x.com/… 开头的地址。把它复制进新标签页打开——blob: 打不开，只有一个错误页或一片空白。再打开 DevTools 的 Network 面板，在过滤框里做一次 m3u8 过滤，播放视频：列表里 video.twimg.com 的请求正一条条滚过，其中就有 .m3u8 结尾的地址。

同一时刻，DOM 里一个打不开的「假地址」，网络里一堆真地址。它们是什么关系？这一章先解释假的那一半，再写一个监听器，把真的那一半抓出来。

## 门牌是假的：blob: 与 MSE

你可能以为 `<video>` 的 src 属性就是视频文件的真实地址——在多数老网站上确实如此，存下这个地址就等于存下了视频。但在 X 上它穿帮了：你刚刚亲手复制过它，打不开。

先认识这串地址。它叫 blob: URL——浏览器给内存里一块数据发的临时门牌，门牌挂在当前页面名下，刷新即作废。它不是硬盘路径，也不是网络位置。不用信我的话，拿浏览器自己的解析器验证：在 DevTools Console 里跑——

```js
// 用法示例：任意页面的 Console 都能跑
const u = new URL('blob:https://x.com/0b1c2d3e')
console.log(u.hostname) // ""——门牌里根本没有主机这一栏
```

hostname 一栏是空的。一个指向网络资源的地址不可能没有主机——这串字符从一开始就没打算被「打开」。

那 X 为什么要把一个打不开的门牌塞进 src？因为视频不是一个现成的文件交给 `<video>` 的。这套机制叫 MSE（媒体源扩展）——一套让页面 JS 自己往 `<video>` 里「喂」视频数据的标准。它为什么存在？一个写死的文件地址，清晰度在指到它的那一刻就定死了；流媒体要的是按网速随时换挡、边下边播。于是播放的分工变成了这样：

```text
Network 面板里的真请求                  页面里的 <video>
──────────────────                    ─────────────────
GET .../playlist.m3u8 ─┐
GET .../seg-0.ts ──────┤  页面 JS 自己 fetch
GET .../seg-1.ts ──────┘
        │  按播放进度 appendBuffer，一段段喂
        ▼
   MediaSource（内存里的缓冲池）
        ▲
        │  src = URL.createObjectURL(mediaSource)
  <video src="blob:https://x.com/…">
```

页面自己向网络要数据，亲手喂进内存里的 MediaSource，再把 MediaSource 的门牌塞给 video.src。你在 DOM 里看到的一切「假」，都是这条流水线的副产品。**src 里那串 blob: 不是视频的地址，是喂食通道的门牌。**

流水线顶端，就是你在 Network 里过滤出来的那个 .m3u8 请求。X 的视频大多走 HLS（HTTP Live Streaming）——苹果发明的流媒体方案：把视频切成几秒一段的小分片，配一张写明「有哪些、在哪下」的清单，播放器边下边播。这张清单就是 m3u8 播放列表——HLS 用的纯文本清单文件。X 也有少量 mp4 直链；两种都从 video.twimg.com 这个主机下发（URL 形态随版本可能变，以你现场看到的为准）。清单长什么样、怎么拆，是下一章的事；本章先解决「把它抓住」。

| | DOM 里的 src | Network 里的请求 |
| --- | --- | --- |
| 长相 | blob:https://x.com/一串 id | https://video.twimg.com/….m3u8 |
| 本质 | 内存数据的临时门牌 | 真正发往服务器的 HTTP 请求 |
| 新标签页打开 | 打不开 | 能打开，看到一份纯文本清单 |
| 刷新页面 | 门牌作废 | 每次播放重新发出 |

## 把 Network 面板变成代码：被动监听

抓地址这件事，你可能以为要「破解」点什么。恰恰相反：**真实地址从来没藏过——它就在你自己浏览器的请求流里**，你刚才用眼睛看了一遍。缺的只是一双不眨的眼：让插件后台替你盯着。

盯的姿势第 1 章留了伏笔——两个世界里只有 service worker 拿得到浏览器级 API。chrome.webRequest 就是那双眼睛，但它不是默认就有的，manifest 里要先报备。这就要动用第 1 章预告过的权限声明，两件套：

- permissions 里写 "webRequest"：领 API 使用资格；
- host_permissions——manifest 里声明「允许访问哪些网站」的清单，它一手划定监听范围。

第二件有个容易被漏的细节：从 Chrome 72 起，一个子资源请求（页面自己再发起的请求——图片、视频这些）要被插件看见，插件必须同时握有「请求目标」和「请求发起者」两个站的权限。视频请求由 x.com 的页面发起、发往 video.twimg.com——所以 host_permissions 里两条都要有，缺哪条，事件都不会送达。

还要泼一盆冷水：webRequest 在 MV3 里只剩一种用法，被动监听——回调里只能看请求流过，不能拦截、不能改写。拦改的 blocking 能力只保留给企业策略安装的扩展（公司 IT 统一管控装上的那种），另有专门 API 接管，讲权限那一章再算总账。对下载器反而正好：要的就是「看见」，不动别人的流量。

## 演练：测试先行，让识别器长出来

监听器要回答的问题只有一个：滚过来的 URL 里，哪个是视频？这件事不碰浏览器也能说清楚。照全书的约定，值得测的逻辑住 shared，装配层越薄越好。

### 第一步：先写测试，看它红

```js
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
```

两组断言：前一组守 manifest 的报备（API 权限、两条站点权限）；后一组守 isLikelyVideoUrl 的判断力——「像不像视频请求」的每种形态各给一例。跑之前先猜两题：

1. isLikelyVideoUrl('https://pbs.twimg.com/media/x.jpg') 返回 true 还是 false？
2. isLikelyVideoUrl('blob:https://x.com/…') 呢？

在 companion 目录跑 pnpm test：`Tests  76 passed (76)`，本章 6 个在 `tests/02-network-watch.test.js` 那行（累计口径见第 1 章）。想亲眼看一次本章的「红」：把 src/shared/video-url.js 临时移出 src 目录再跑——本章套件整组失败（找不到模块），第 1 章那条「后台文件可加载」也会连带红（sw.js import 了识别器）。移回来再跑，恢复 76 绿。这就是「测试先行」的机械证据，也是每章都会重演的仪式。

### 第二步：识别器

```js
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
```

三个动作。new URL 拆地址，拆不动就安静返回 false——监听器滚过的字符串良莠不齐，一个坏值不值得抛错。主机精确等于 video.twimg.com：pbs.twimg.com 的图片、x.com 的接口一律不认。扩展名只看 pathname：查询参数（X 的真请求几乎都带 ?tag=… 之类）不参与判断，大小写不敏感。再跑 pnpm test 恢复 76 绿。猜的那两题答案就在 02 套件里——都是 false，一个死在主机，一个死在「门牌没有主机」。

### 第三步：报备与装配

manifest 演进到本章末的形态：

```jsonc
// 拼版·教学示意：manifest 在第 2 章末的形态（比第 1 章多出 permissions、host_permissions 和 type: "module"）。
// 第 4、5 章再长出 downloads/storage 与 web_accessible_resources，终态全文见第 6 章。
{
  "manifest_version": 3,
  "name": "X 视频下载器（教学版）",
  "version": "0.1.0",
  "permissions": ["webRequest"],
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

新增三处，各有凭据。permissions 领 API 资格；host_permissions 划监听范围——`*.twimg.com` 盖住 twimg 的所有子域（video、pbs 都在内），x.com 那条管「发起者」一侧；background 加 "type": "module"，因为 service worker（下文简称 SW）里写了 import 语句，得声明按 ES 模块加载。

```js
// 拼版·教学示意：sw.js 在第 2 章末的形态（报到 + 被动监听，可测逻辑在 src/shared/video-url.js）。
// 此后逐章演进，终态以伴生仓 src/background/sw.js 为准。
import { isLikelyVideoUrl } from '../shared/video-url.js'

console.log('[xvd] service worker 已启动')

// chrome 全局只在浏览器后台里存在；Node 测试环境 import 本文件时它缺席，先看一眼再注册
if (typeof chrome !== 'undefined') {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (isLikelyVideoUrl(details.url)) {
        console.log('[xvd] 视频请求', details.url)
      }
    },
    { urls: ['https://x.com/*', 'https://*.twimg.com/*'] }
  )
}
```

装配层干三件事：报到（保留第 1 章那行日志）、注册监听、把滚过的 URL 交给识别器。两处值得多看一眼。其一，监听器在文件顶层同步注册：SW 每次被事件唤醒都从头执行一遍脚本，先挂好监听器再接活，睡着也不怕错过。其二，第二个参数是过滤器，写法与 host_permissions 同款匹配模式；但它只决定「订阅哪些」，真正看得到哪些，仍受 host_permissions 管辖。开头那个 typeof chrome 判断是给测试环境的——Node 里没有 chrome 全局，第 1 章那个「后台文件能被 import」的存在性测试才能继续通过；浏览器里这个条件恒为真。

## 验证：在真实浏览器里看它滚日志

测试绿只证明逻辑对；这双眼睛终究要装进浏览器。逐条来：

- [ ] 在 companion 目录运行 pnpm test：终端末尾应显示 Tests 76 passed (76)（全书累计）；tests/02-network-watch.test.js 那行应显示 (6 tests)。
- [ ] 打开 chrome://extensions，在插件卡片上点刷新图标重新装载。manifest 变了必须重载，装载完成后卡片上不应出现红色 Errors 字样。
- [ ] 打开一条含视频的推文，右键视频选「检查」：Elements 面板高亮的 video 节点上，src 应显示 blob:https://x.com/ 开头的一串地址。
- [ ] 把该地址复制到新标签页打开：应看到错误页或一片空白，没有任何视频。
- [ ] 回到 DevTools 的 Network 面板，过滤框输入 m3u8，播放或滚动到视频：列表应出现 video.twimg.com 的 .m3u8 条目。有的视频是 mp4 直链，过滤框换 mp4 再试。
- [ ] 在 chrome://extensions 的插件卡片上点「service worker」蓝色链接：打开的 Console 应显示一行 [xvd] service worker 已启动。
- [ ] 保持该控制台开着，回页面再播放或滚动出一条新的含视频推文：控制台应出现至少 2 条 [xvd] 视频请求 https://video.twimg.com/ 开头的日志。
- [ ] 把同一条视频重播一遍：控制台可能一条新日志都不出现——命中内存缓存的请求对监听器不可见；换一条没播过的视频，日志应恢复滚动。
- [ ] 先猜后跑：猜——把 manifest 里 host_permissions 的 twimg 条目删掉再跑 pnpm test，哪条测试会红？跑完应看到 5 条红（5 failed | 71 passed）。红的是本章 1 条「host_permissions 同时报备 x.com 与 *.twimg.com」，外加第 6 章权限对账的 4 条——manifest 动了土，终检的审计测试当场指认。改回后应恢复 76 passed。
- [ ] 同样的破坏在浏览器里做一遍：删掉 twimg 条目、重新装载、播放新视频，service worker 控制台应一条日志都不出；改回、重新装载、再播一条新视频，日志应重新出现。

最后两条的「一条都不出」，就是 Chrome 72 那条规则亲手摸到的样子：监听范围缺了目标站，事件不再送达。

## 收束

现在可以回答开篇了：src 里那串打不开的 blob:，是 MSE 流水线的门牌——页面自己 fetch 分片、亲手喂进内存，再把门牌挂给 video。真地址一直在网络请求里，而你的插件此刻正替你盯着它：service worker 控制台每滚出一条 [xvd] 视频请求，就是一次「看见了」。全程没有破解任何东西，你只是给浏览器装了一双不眨的眼。

下一章拆开抓到的 .m3u8：那份纯文本清单里写着清晰度和分片，解析它才能选画质。至于这些地址怎么变成硬盘上的一个文件——第 4 章给出完整下载管线。

### 自查

1. 把 host_permissions 里的 https://x.com/* 删掉、只留 twimg 那条，重新装载后播放视频，service worker 控制台会怎样？为什么？
2. 预测：把 VIDEO_EXT 改成 /\.(m3u8|mp4)$/i（去掉 ts），pnpm test 里几条会红？哪条？
3. isLikelyVideoUrl('blob:https://x.com/uuid') 返回 false——具体死在哪一步？

::: details 参考答案
1. 一条日志都不会有。视频请求的发起者是 x.com 页面，Chrome 72 起要求插件对「请求目标」和「发起者」都有权限，事件才送达；删掉 x.com 那条，发起者一侧看不见了。
2. 恰好一条红：「video.twimg.com 的 m3u8/mp4/ts 算视频请求」——seg-0.ts 那行断言变 false。manifest 那两条不受影响。
3. new URL 解析成功、没抛错；但 blob: 地址的 hostname 是空字符串，不等于 video.twimg.com，第一个条件就倒了。可回看「门牌是假的」一节里的 Console 示例，亲手跑一遍。
:::
