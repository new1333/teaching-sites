---
title: 从点击到落盘：全链路对账
---

# 从点击到落盘：全链路对账

插件是你亲手写的，从第 1 章的最小骨架一路长到今天。但现在闭眼复盘一次：鼠标点下「下载视频」后的第一毫秒，代码先跑在哪个世界？m3u8 是在哪被拆开的？分片是在哪、被谁并发抓回来的？整段字节又是在哪拼成一个文件、怎么过的河？从点击到落盘，每一跳发生在哪个环境、调了哪个 API——你现在能报出来吗？

写完就能跑的项目，很多人报不出。能跑与能讲清之间，隔着一条**「凭什么非它不可」**：为什么是这个世界、为什么是这个 API、换个地方行不行。这一章不写一行新代码，做一件毕业前最值得做的事——把从点击到落盘的全链路一跳一跳对账，每一跳都报出环境、API 与「凭什么」；对完账，把全书建立的概念清点一遍，收口贯穿全书的总问题。建议把 companion 的 `sw.js` 与 `main.js` 开在旁边，每读到一跳就去代码里指认它。

## 前情回顾：六章攒下了什么

用六个问题过一遍来路，都答得上就直接往下走：

- 第 1 章：插件凭什么能跑在 x.com 上？——manifest 报备，content script 与 service worker 两个世界各就各位。
- 第 2 章：为什么 `<video>` 里的地址是假的？——blob: 门牌盖住了 MSE，真地址只活在网络请求里。
- 第 3 章：一份纯文本清单怎么读？——master/media 两级清单，按 BANDWIDTH 选最高档。
- 第 4 章：清单怎么变文件？——mp4 一行落盘；HLS 并发抓、字节拼、跨环境存盘。
- 第 5 章：按钮怎么长在从不重载的页面上？——MutationObserver 补票、状态机、消息协议。
- 第 6 章：每一项权限凭什么？——十项在册能力逐项对账，压出可复现的 zip。

## 两个前提：点击之前必须已经发生的事

推演从点击开始，但有两件事得先就位。它们是前几章埋好的，各算一跳。

### 前提一（跳 0a）：按钮为什么已经在页面上——页面世界

manifest 的 `content_scripts.matches` 命中 x.com 的那一刻，浏览器把 loader.js 放进页面（能摸 DOM、拿不到多数浏览器 API 的隔离世界）。loader 只干一件事：动态 import 真正的装配模块。

```js
// src/content/loader.js · 动态 import（文件主体全文）
;(async () => {
  await import(chrome.runtime.getURL('src/content/main.js'))
})().catch((err) => {
  console.log('[xvd] 装配模块加载失败：', err instanceof Error ? err.message : err)
})
```

凭什么绕这一手：content script 是经典脚本，不支持静态 `import` 声明；要引入模块，得用 `chrome.runtime.getURL` 拿到 `chrome-extension://` 绝对地址再 `import()`。而且 import 的目标文件必须在 manifest 的 web_accessible_resources 里报备过——相对地址会按页面源解析，不报备就过不了浏览器这一关。main.js 进来后 `scan()` 给含视频的推文注入按钮，MutationObserver 盯着 DOM 长出新东西就重扫。X 是 SPA、页面从不重载，这套补票机制就是滚动、跳转之后按钮还在的原因。

### 前提二（跳 0b）：账本为什么已经记好了——后台世界

点按钮之前你总得先播放视频。播放器向 video.twimg.com 请求 master 清单的那一刻，SW 里的被动监听就看见了：

```js
// src/background/sw.js · onBeforeRequest 被动监听（节选）
    (details) => {
      if (!isLikelyVideoUrl(details.url)) return
      console.log('[xvd] 视频请求', details.url)
      const kind = playlistKindOf(details.url)
      if (kind === 'master' || kind === 'media') void reportPlaylist(details.url)
      if (kind === 'master' || kind === 'mp4') {
        void rememberVideo(details.tabId, kind, details.url) // 记在这个标签页名下，休眠不死
      }
    },
```

`rememberVideo` 把这条视频记进 `chrome.storage.session`，key 按标签页分账。凭什么非它不可：SW 空闲约 30 秒，浏览器就把它休眠掉，模块变量活不过一觉；会话存储休眠不死、浏览器重启才清——账本必须放在浏览器手里，不能放在进程内存里。这一跳记下的不是「视频下载了」，是「这个标签页看过什么」：等点击到来，后台凭它对上号。

## 从点击到落盘：主链九跳

前提就位，推演正式开始。先看全景，再逐跳对账：

```text
// 拼版·教学示意——点击→落盘全链路时序总览（跳位编号与下文对账表一致，非源码）
页面世界（content script）                后台世界（service worker）
──────────────────────────               ──────────────────────────
[0a] 按钮注入 + MutationObserver          [0b] webRequest 看见 master
                                          （点击之前，两个前提各就各位）

[1] click → sendMessage(REQUEST) ───────▶ [2] 守卫验形 → 翻账本 → 回 ack
    ◀──────────── ack {ok, kind} ────────┤
[按钮 detecting → ready]                  [3] fetch master → 拆档位 → 选最高
                                          [4] 四泳道并发抓分片（按下标归位）
    ◀──── PROGRESS {done,total} ──────────┤ [5] 每完成一片回推一次
[按钮 ready → downloading]                [6] concatBuffers 拼整段字节
    ◀──── DONE {bytesB64,…} ──────────────┤ [7] encodeBytes：base64 过河
[8] decodeBytes → Blob → a[download]          （岔路 [7′]：mp4 有 URL，
[9] advance('done')：按钮转绿                  chrome.downloads 后台一行落盘）
```

### 第一阶段·发令（跳 1–2）

跳 1（页面世界）：点击变成消息。click 事件先进状态机——`idle → detecting`，按钮变灰显示「对号中…」，随后带身份证的正式请求发出去：

```js
// src/content/main.js · requestDownload（全文）
function requestDownload(statusId, btn) {
  advance(btn, 'click')
  chrome.runtime.sendMessage({ type: MSG.DOWNLOAD_REQUEST, statusId }, (resp) => {
    if (chrome.runtime.lastError) {
      advance(btn, 'fail') // 消息递不出去（如插件刚重载、旧页面还挂着）——lastError 是回执的另一半
      return
    }
    advance(btn, resp?.ok === true ? 'ack' : 'fail')
  })
}
```

环境与 API：content script；DOM 事件、`chrome.runtime.sendMessage`、MSG 常量表。凭什么：按钮长在 DOM 里，只有页面世界摸得到；而两个世界不共享内存，能跨世界递话的只有消息通道——statusId（推文数字 id）就是这张小票上的身份证。

跳 2（后台世界）：收信、翻账本、回 ack。消息到达 SW——如果它正睡着，这条消息就是唤醒它的那一根线。守卫先验形状，再按来处（`sender.tab.id`）翻账本：

```js
// src/background/sw.js · onMessage 监听（节选）
      if (entry === null) {
        sendResponse({ ok: false, error: '这个标签页还没播过视频——先播放一次，再点推文上的按钮' })
        return
      }
      sendResponse({ ok: true, kind: entry.kind }) // ack：哪条推文的什么视频，对上号了
```

```js
// src/background/sw.js · 同一监听器的最后一行
    return true // 回执在 await 之后才发（storage 是异步的）：不返回 true，通道当场关门、sendResponse 白叫
```

环境与 API：service worker；`chrome.runtime.onMessage`、`chrome.storage.session`（recallVideo）。凭什么：把收到的消息当不可信输入、先验形状再处理，是官方文档的口径；账本为什么住 storage.session，前提二算过。ack 回到页面，按钮 `detecting → ready`（「已对上号」）。

### 第二阶段·后台管线（跳 3–6）

`runDownload` 接手。账本里那条若是 mp4 直链，走的是岔路（见跳 7 的岔路）；主路是 HLS——

跳 3（后台世界）：取 master 清单、选档。`resolveMediaPlaylistUrl(entry.url, null, fetch)` 重新 fetch master 清单——masterText 传 null 就是让它自己取，SW 睡一觉，内存里什么都没剩。`parseMasterPlaylist` 拆出变体表，`pickVariant` 选 BANDWIDTH 最高的一档；相对地址以清单自身 URL 补全。凭什么抓取全程住 SW：fetch 的 CORS 豁免只在扩展进程这一侧生效——host_permissions 报备过 twimg，SW 里的 fetch 不受跨域限制；content script 发起的跨域请求永远按同源策略走，报备了也不豁免。解析与选档是纯函数、住在 shared：逻辑可测，跑在数据所在的 SW。

跳 4（后台世界）：排队、并发抓分片。

```js
// src/background/sw.js · runDownload（节选）
  const { url: mediaUrl, variant } = await resolveMediaPlaylistUrl(entry.url, null, fetch)
  const { init, segments } = await downloadSegments({
    mediaUrl,
    fetchLike: fetch,
    onProgress: ({ done, total }) => {
      void sendTab(tabId, { type: MSG.DOWNLOAD_PROGRESS, statusId, done, total })
    },
  })
  const bytes = concatBuffers(init ? [init, ...segments] : segments) // init 存在时排最前
```

`downloadSegments` 取 media 清单、`parseMediaPlaylist` 拆出分片表，排成任务队——EXT-X-MAP 的初始化分片（若有）排队首，其后按清单序；四条泳道用光标领任务并发抓，完成乱序、交货按下标归位。凭什么：并发压墙钟时间，下标归位保住顺序——顺序错了文件就废了。每完成一份，onProgress 触发一次跳 5。

跳 5（后台 → 页面）：进度回推。`sendTab` 经 `chrome.tabs.sendMessage` 递 DOWNLOAD_PROGRESS `{ statusId, done, total }`；页面按 statusId 路由到具体按钮，`ready → downloading`，文案现场拼成「下载中 3/6」。凭什么：进度看得见，用户才不会在四十秒的静默里连点三次——状态机的自旋吸收正是防这个的第二道保险。

跳 6（后台世界）：字节拼接。`concatBuffers` 把 init（若有）与全部分片原样首尾相接成一个 Uint8Array。凭什么：同一档清晰度的分片是同编码参数的流，字节按序相接就是可播放的文件；fMP4 的 init 必须排最前，否则解码器读不懂后续分片。

### 第三阶段·过河（跳 7）

拼好的字节躺在 SW 的内存里，落盘却需要发门牌的 `URL.createObjectURL` 和点链接的 `a[download]`——这两个只在页面世界（Blob 在 SW 里也造得出，但没有门牌、点不了链接，照样落不了盘；第 4 章撞的就是这堵墙）。方向只能反过来：把字节送回页面。

```js
// src/background/sw.js · runDownload（节选）
  await sendTab(tabId, {
    type: MSG.DOWNLOAD_DONE,
    statusId,
    filename: guessFilename(statusId, { ext: init ? 'mp4' : 'ts', height: variant.height }),
    mime: init ? 'video/mp4' : 'video/mp2t',
    bytesB64: encodeBytes(bytes), // 通道只传 JSON 可序列化值——ArrayBuffer 直递到达就是 {}，必须先编码
  })
```

凭什么非 base64 不可：消息通道默认 JSON 序列化，通道会把过不了序列化的值强转掉——ArrayBuffer 直递，到达就是 `{}`，整段视频静默丢失。`encodeBytes` 把字节分块编成 base64 字符串（体积约为原来的 4/3，每 3 字节编成 4 个字符）过河，这就是那条渡船。文件名此刻定本：`x-video-<statusId>-<height>p.<ext>`，statusId 是推文真正的数字 id——第 4 章从视频 URL 里抠数字的临时办法，第 5 章已经退役。

岔路 7′（后台世界）：mp4 直链根本没有清单与分片，URL 本身就是文件：

```js
// src/background/sw.js · runDownload（节选）
  if (entry.kind === 'mp4') {
    const filename = guessFilename(statusId, { ext: 'mp4', height: heightFromUrl(entry.url) })
    await chrome.downloads.download({ url: entry.url, filename })
    await sendTab(tabId, { type: MSG.DOWNLOAD_DONE, statusId, filename })
    return
  }
```

环境与 API：SW；`chrome.downloads`（mp4 的尺寸数字从 URL 路径的尺寸段抠来拼进文件名）。凭什么：chrome.downloads 吃的是 URL——URL 在手，让浏览器替你存就行，字节根本不必过河；HLS 的字节只存在于内存、没有 URL 可给，才只好走「拼好 → 编码 → 过河 → 页面落盘」的长路。**两条路的分岔不在想不想省事，在数据形态：有地址走地址，只有字节就走字节。**

### 第四阶段·落盘收官（跳 8–9）

跳 8（页面世界）：解码、组 Blob、落盘。

```js
// src/content/main.js · onMessage 监听（节选）
  } else if (msg.type === MSG.DOWNLOAD_DONE) {
    if (typeof msg.bytesB64 === 'string') {
      saveBytes(msg.filename, msg.mime, decodeBytes(msg.bytesB64)) // HLS：整段字节经 base64 编码递来，页面解码落盘
    }
    advance(btn, 'done')
```

```js
// src/content/main.js · saveBytes（节选）
function saveBytes(filename, mime, bytes) {
  const blob = new Blob([bytes], { type: mime })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
```

`decodeBytes` 把 base64 还原成字节，Blob 装箱，`createObjectURL` 发临时门牌，造一个带 download 属性的链接点一下——浏览器接住，写进下载目录，磁盘上出现可播放的文件。门牌 10 秒后才 revoke：立刻回收可能存出空文件。凭什么这一跳必须在页面：`createObjectURL` 与 `a[download]` 只在页面世界（Blob 哪边都造得出，但门牌与链接是 DOM 侧的）——第 4 章「service worker 没有 DOM」那堵墙的另一面，到这里两边的分工全部对上。

跳 9（页面世界）：状态收官。`advance(btn, 'done')`：`downloading → done`，按钮转绿显示「已存盘」。失败路同样闭环：管线任何一环抛错，SW 递 DOWNLOAD_ERROR，按钮转红「失败·点我重试」——error 态点 click 回 detecting，可重试；消息递不出去（如插件刚重载、旧页面还挂着），`chrome.runtime.lastError` 兜住，按钮同样走 fail。

### 全链路对账表

一表收齐（环境三选一：页面 = content script；后台 = service worker；「后台 → 页面」= 消息过河）：

| # | 跳 | 环境 | API | 凭什么非它不可 |
|---|---|---|---|---|
| 0a | 注入按钮 | 页面 | content_scripts 声明、chrome.runtime.getURL、MutationObserver | 只有页面世界摸得到 DOM；SPA 不重载，靠 observer 补票 |
| 0b | 记账 | 后台 | chrome.webRequest.onBeforeRequest、chrome.storage.session | 只有 SW 能看流量；账本要活过休眠，只能放浏览器手里 |
| 1 | 点击发消息 | 页面 | DOM 事件、chrome.runtime.sendMessage、状态机 | 按钮在 DOM 里；跨世界只有消息一条路 |
| 2 | 收信对号 | 后台 | chrome.runtime.onMessage、形状守卫、storage.session | 消息当不可信输入先验形状；账本按 tabId 对号 |
| 3 | 取清单选档 | 后台 | fetch（CORS 豁免侧）、parseMasterPlaylist、pickVariant | 豁免只在扩展进程侧；解析选档是纯函数，可测 |
| 4 | 并发抓分片 | 后台 | fetch、parseMediaPlaylist、泳道光标 | 下标归位保顺序，并发压时间 |
| 5 | 进度回推 | 后台 → 页面 | chrome.tabs.sendMessage | 进度看得见，用户才不狂点 |
| 6 | 字节拼接 | 后台 | concatBuffers | 同编码参数的流按序相接即可播放 |
| 7 | 整段过河 | 后台 → 页面 | encodeBytes（base64）、chrome.tabs.sendMessage | 通道 JSON 序列化，ArrayBuffer 直递变 {}；SW 无 DOM 落不了盘 |
| 7′ | 岔路：mp4 落盘 | 后台 | chrome.downloads.download、guessFilename | 有 URL 就让浏览器存，字节不必过河 |
| 8 | 解码落盘 | 页面 | decodeBytes、Blob、URL.createObjectURL、a[download] | createObjectURL 与 a[download] 只在页面世界（Blob 两边都有） |
| 9 | 状态收官 | 页面 | 状态机迁移、chrome.runtime.lastError | done/error 各有出口，重试有路 |

## 概念对账清单：这本书在你身上建立了什么

术语表 38 条，按建立它们的章归位——右端是「读者已能做什么」，不是定义复读：

| 章 | 建立的概念（术语表条目） | 你已能做什么 |
|---|---|---|
| 1 | 浏览器插件（扩展）、Manifest V3、manifest.json、未打包扩展、content script、service worker（插件后台）、权限声明 | 把本地文件夹以未打包扩展挂进 chrome://extensions；说清两个世界各能干什么、不能干什么 |
| 2 | blob: URL、MSE（媒体源扩展）、被动监听、host_permissions、HLS、m3u8 播放列表 | 在 DevTools 里亲手分辨假地址与真请求；写被动监听盯住 video.twimg.com 的流量 |
| 3 | master playlist、media playlist、EXTINF、分片、EXT-X-STREAM-INF、BANDWIDTH、清晰度变体、EXT-X-MAP | 拿一份纯文本清单拆出档位与分片表，按带宽选出最高画质（.ts 与 fMP4 两种形态都认） |
| 4 | chrome.downloads、a[download]、Blob、URL.createObjectURL、字节拼接、并发抓取、CORS 豁免 | 把清单变文件：mp4 一行落盘；HLS 并发抓、按序拼、跨环境存盘 |
| 5 | SPA、MutationObserver、data-testid 锚点、状态机、消息传递 | 在从不重载的页面里持续注入 UI；用状态机与消息协议把两个世界接成流水线 |
| 6 | CSP（内容安全策略）、打包 zip、Chrome Web Store、权限最小化、MV3 砍掉 blocking webRequest 的来龙去脉 | 为每项权限答出「凭什么」；压出两次逐字节一致的 zip；说清七年迁移战与自己站的位置 |

### 终点对账

课程终点承诺的是「一个装进 Chrome 就能用的 X 视频下载插件（零构建）」。逐项实测，口径写在旁边，欢迎复核：

- 能用：第 6 章装载验证过——zip 解压后加载未打包扩展，刷新 x.com，按钮、下载、落盘全链路可用。
- 零构建：src/ 与 manifest.json 零 npm 依赖；devDependencies（vitest、typescript、fflate、@types/chrome）只服务测试与打包，不进扩展。
- 规模：`wc -l src/*/*.js manifest.json` 实测 **929 行**（含注释与空行，共 10 个文件）。
- 验证：`pnpm test` 实测 **76 个测试全绿**（6 个测试文件，按章 append-only、只增不改）。

## 收束

开篇的闭眼测试现在重考一遍。点击后的第一毫秒，代码跑在页面世界——click 进状态机、消息过河；这条消息唤醒 SW，它翻 storage.session 的账本对号；fetch 在豁免侧拆 master 选档、四条泳道抓分片按下标归位；字节拼好、base64 编码过河；页面解码、组 Blob、发门牌、`a[download]` 一点，浏览器写盘，按钮转绿。每一跳的环境与 API，你现在闭着眼也报得出来——不是背出来的，是每一跳的「凭什么非它不可」你都亲手撞过、亲手写过。

现在收口全书的总问题：「X 的视频，页面上是一串打不开的假地址、网络里是一把几秒的小分片——一个插件怎么把它变回你硬盘上的一个文件？」

答案散在对账表的十二行里，收成一段：页面上打不开的假地址（blob: 门牌）从来不是目标——真地址在播放器自己的网络请求里，被动监听看见它、会话账本记住它；网络上的一把小分片由后台按清单并发抓回、按序字节拼接——**「一个文件」在服务器上从未存在过，是你在内存里拼出来的**；拼好的字节编码过河，交给唯一有 DOM 的页面世界装进 Blob，浏览器替你写进下载目录（mp4 直链则根本不必拼，chrome.downloads 一行）。两个世界各司其职：页面摸 DOM、后台握 API 与豁免；浏览器这位房东管存盘与账本。插件没有破解任何东西——它只是让报备过权限的每一方，在正确的跳位上做了各自唯一能做的事。

最后一条边界，与第 6 章一致：本课程仅用于学习浏览器扩展开发——只下载你拥有版权或已获明确授权的内容，遵守 X 服务条款与当地著作权法。

### 自查

1. 预测：把 manifest 里的 web_accessible_resources 整块删掉，重新装载、刷新 x.com。按钮还会出现吗？不会的话，死的是哪一跳——loader.js 自己为什么没死？
2. 复盘：视频播到一半你离开四十分钟，回来才点按钮——SW 早休眠过一轮了。哪份信息必然还在？哪处设计就是为这一刻而生？如果账本记在 sw.js 的模块变量里，点按钮会得到什么？
3. 边界：把跳 7 消息里的 bytesB64 字段换成 `bytes: 一个 ArrayBuffer` 原样递过去，编码这步全省。按钮会怎么走？文件会落盘吗？为什么？

::: details 参考答案
1. 按钮不会出现。死的是跳 0a 里的动态 import：loader.js 由 content_scripts 直接注入、不经过 web_accessible_resources，所以它自己能跑；但它 import 的 main.js 必须在 WAR 里报备过，页面侧才加载得了——删掉后控制台打出「[xvd] 装配模块加载失败」，scan 从未执行，按钮无从谈起。可回看「前提一」。
2. `chrome.storage.session` 里的对号账本必然还在——它休眠不死、浏览器重启才清；点按钮这条消息本身会唤醒 SW，醒来先翻账本再干活。为这一刻而生的设计，就是把账本从模块变量搬进 storage.session 那一步（第 5 章）。若记在模块变量里，休眠一轮就清零、对不上号，sendResponse 只会回「这个标签页还没播过视频——先播放一次，再点推文上的按钮」。可回看「前提二」与跳 2。
3. 按钮会「正常」走完：字段名换成 bytes 后 `msg.bytesB64` 是 undefined，typeof 检查不过、saveBytes 直接跳过——但下一行 `advance(btn, 'done')` 照常执行，按钮转绿显示「已存盘」，下载栏却空空如也。根源是通道默认 JSON 序列化：ArrayBuffer 直递，到达时已经是强转后的 `{}`，连字符串都不是。失败还是静默的。encodeBytes/decodeBytes 这条 base64 渡船存在的意义，就是不让这一幕发生。可回看跳 7 与跳 8。
:::
