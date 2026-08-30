---
title: 把按钮放上推文：SPA 世界的 DOM 注入
---

# 把按钮放上推文：SPA 世界的 DOM 注入

第 4 章结账时立了三张欠条：消息类型 `'xvd-save-file'` 是裸字符串；`lastVideo` 活不过 service worker 休眠；下载入口是工具栏图标，不是推文上的按钮。还有更早的一张——第 1 章那个角标，只在首次加载的推文上出现。这一章四张一起清。

先回到那个角标。第 1 章你装载插件、刷新 x.com，首屏每条推文左下角多出一个小蓝标，挺好。然后你往下滚了两屏，又点进一条推文详情、按返回——新出现的推文，一个角标都没有。页面明明「翻页」了，你的代码却像睡着了一样：**角标消失、页面不刷新、你的代码只跑了一次**。刷新一下 F5，角标又全回来了。这不是 bug 写崩了，是 bug 写在了错误的假设上——而第 1 章的假设「页面加载时跑一遍扫描，就够了」正是那个错误。

## 翻页是假动作：SPA 从不重新加载

你可能以为点进一条推文、按返回，浏览器重新加载了页面——体感上就是跳页。X 没有跳。它是 SPA（single-page application，单页应用）：整个应用只加载一次，之后所有的「翻页」都是 JS 把旧 DOM 换成新 DOM，浏览器从头到尾没有重新加载过。别急着信这句话，两行代码就能亲手验证。在 x.com 任意页面的 Console 里：

```js
// 用法示例：给当前的 JS 世界盖个戳，再数一数真导航发生了几次
window.__xvd = '我还在'
performance.getEntriesByType('navigation').length // → 1
```

然后点进任意一条推文详情、返回，回到同一个 Console 再跑一遍：

```js
// 用法示例：路由切换之后——同一个 Console，同一个世界
window.__xvd // → '我还在'：变量还活着，JS 世界从没换过
performance.getEntriesByType('navigation').length // → 还是 1：一次真导航也没多
```

`window.__xvd` 还在，说明这是同一个 JS 世界；导航记录还是 1 条，说明浏览器只在你第一次打开时真正加载过。中间的「翻页」，在浏览器看来只是页面自己改自己的 DOM——像舞台剧换布景，剧场从不散场。

为什么 X 要这么做？做个反事实就明白：假如每次点击都真加载，X 几 MB 的 JS 要重新下载解析、滚动位置清零、正在播放的视频全部中断。换 DOM 只动变化的部分，快、而且状态不丢。代价落到了别人头上——落到了所有「在页面加载时跑一遍」的代码头上，包括你的 content script。

第 1 章讲过它的生命周期，现在这个知识变成牙齿了：content script 随文档注入，文档不死，它不再来第二次。文档恰恰永远不死（SPA），所以你在里面写的 `for (const article of findTweetArticles(document))` 只扫过首屏那一遍。往后 X 长出的每一条新推文，你都看不见。

解法的方向也就定了：不是「再跑一遍」，而是「DOM 长出新东西时通知我」。

## MutationObserver：DOM 长出东西时通知我

你习惯的 click、scroll 是「用户做了什么」的事件。DOM 被页面 JS 改了，没有这种事件——浏览器为此提供了另一个 API：MutationObserver（变动观察器）。一句话：**给 DOM 装一个监控摄像头，你指定的容器里长出或变化了什么，它就回调通知你**（这是浏览器原生 API，不是插件专属，任意网页里都能用）。它取代的是老的 Mutation Events——老方案每个变动同步触发一次回调，页面改一百处就打断一百次，已被 DOM 标准废弃；新方案把变动记录攒起来、异步批量回调，天生适合「X 一次滚动改几十处」的场景。

先亲手跑一个最小的。任意页面的 Console：

```js
// 用法示例：先装监控，再自己制造两次 DOM 变动
let count = 0
const observer = new MutationObserver((records) => {
  count += records.length // records 是这次攒下的变动清单，每项是一条变动记录
})
observer.observe(document.body, { childList: true, subtree: true })

const div = document.createElement('div')
document.body.appendChild(div) // 变动 1：body 直接多了个孩子
div.appendChild(document.createElement('span')) // 变动 2：div 内部又多了个孩子
console.log('立刻读：', count) // 先猜：是 2 还是 0？
setTimeout(() => console.log('下一拍读：', count), 0)
```

两个参数各管一摊：`childList: true` 监控「直接孩子的增删」；`subtree: true` 把监控范围扩到整棵子树——没有它，变动 2（孙子辈出生）你根本收不到通知。回调时机最容易猜错：**立刻读是 0，下一拍读才是 2**。回调不在 `appendChild` 里同步执行——DOM 标准把变动记录排进队列，等当前脚本跑完（微任务检查点）才一次性回调。同一批同步变动合成一次调用、带一组记录，这就是「攒起来批量通知」。

每条变动记录（MutationRecord）长这样：`type`（childList/attributes）、`target`（谁的直接孩子变了——注意是直接父节点，不是你 observe 的根）、`addedNodes` / `removedNodes`（长了谁、删了谁）。整棵子树插入时只有插入点一条记录、`addedNodes` 里是整棵子树的根——所以「顺着记录增量找新推文」可以做，但教学版选更笨也更稳的路：回调里整页重扫一遍，几十条 `article` 的 `querySelectorAll` 是微秒级，X 的滚动撑不爆它。这一简化连同它的代价，登记在差异清单附录。

## 工牌比衣服可靠：锚点选择器

要找推文的根元素，你得写选择器。你可能以为 class 选择器最顺手——`querySelector('.css-1dbjc4n')` 谁都会写。X 恰恰是反例：它的 class 名是构建工具生成的无语义哈希名，只服务样式表，一次改版、甚至一次重新构建就可能整体换掉。拿它当锚点，等于把插件拴在一件天天换的衣服上。

更稳的锚点 X 自己留好了：`data-testid`——「给自动化测试用的工牌」。衣柜里的衣服天天换，工牌号不变；X 的前端测试自己也要靠它定位元素，所以它比 class 稳定得多。写本书时，推文的根元素是 `article[data-testid="tweet"]`。按本书的时效性约定，**这是需要现场核对的易变细节，不是背书的快照**——核对只要三步：

1. 在 x.com 任意一条推文上右键「检查」，DevTools 的 Elements 面板会停在某个元素上；
2. 往上找几层，找到 `article` 元素（DevTools 里元素标签旁直接显示属性名）；
3. 确认它带着 `data-testid="tweet"`。若 X 改了名，改 `findVideoTweetRoots` 的默认参数那一处就行——选择器集中在一个常量里，正是为了这一天。

## 按钮不是一次点击：五态状态机

入口要从工具栏图标换成推文上的按钮，按钮可比图标忙。它在生命周期里会收到五种事件，还来自两条不同的通道：用户点击它；`sendMessage` 的回执告诉它「后台对上号了」；后台逐条递来的分片进度；完成；失败。你可能以为按钮就是 onclick 干一件事——一旦事件从多个源头异步乱入，「该不该响应这次点击」「这个进度是不是刚才那次下载的」就会糊成一团。

收编它的是状态机（state machine）：把生命周期明确划成几个状态、规定谁只能变到谁，不在表里的迁移一律非法。本书的按钮是正程五态加一个失败态，像电梯楼层灯：待命时全灭，之后对号中、已对上号、下载中、已存盘各亮各的——每个灯只在自己的条件下亮。

| 当前状态 ＼ 事件 | click（点击） | ack（回执：对上号） | progress（进度） | done（完成） | fail（失败） |
| --- | --- | --- | --- | --- | --- |
| idle 待命 | detecting | 非法 | 非法 | 非法 | 非法 |
| detecting 对号中 | detecting（吸收） | ready | 非法 | 非法 | error |
| ready 已对上号 | ready（吸收） | 非法 | downloading | done | error |
| downloading 抓分片中 | downloading（吸收） | 非法 | downloading（停留） | done | error |
| done 已存盘 | done（吸收） | 非法 | 非法 | 非法 | 非法 |
| error 失败 | detecting（重试） | 非法 | 非法 | 非法 | 非法 |

这张表里藏着三个设计决定。忙碌态对 click 一律自旋吸收——用户在下载中狂点也不会重发请求。error 吃 click 回到 detecting——失败可重试，不是死刑。最要紧的是那些「非法」格：**表里没有的组合当场抛错**。没发过请求就来 ack、已完成又冒出进度——乱序、迟到、伪造的消息会在这里现形，而不是演成「按钮行为看心情」。状态机的价值不在能转，在不能转的被拦住。

## 消息协议：裸字符串退役

状态机的粮食来自消息传递（runtime messaging）——第 1 章立过的规矩：两个世界没有共享内存，通话靠互发消息，一单一回执，像前台与后厨之间传菜的小票。第 4 章已经用了它，但用的是裸字符串 `'xvd-save-file'`：拼错了没人管、两端各自理解、收到什么都硬接。裸字符串有三宗罪，一一对上药方：

第一宗，类型没有唯一事实源。两端各写各的字符串，改一端忘一端，消息静默失联。药方：常量表 `MSG`，放进 `shared/messages.js`，页面与后台 import 同一张表——类型从此只有一个写处。第二宗，来路不明的消息直接进处理逻辑。Chrome 官方文档的安全一节写得直白：来自 content script 的消息「might have been crafted by an attacker」。所以官方要求「validate and sanitize all input」，先验再用。药方：守卫函数在门口验形状——类型对、承重字段在场且类型正确才放行，其余一律拒收。第三宗，回执时序。`onMessage` 监听器收到的第三个参数 `sendResponse` 是回执单，官方规则：**默认必须同步调用**；要异步回（我们的对号要先 `await` 一趟 storage），「return a literal `true` … will keep the message channel open」，返回字面量 `true` 给通道留门。忘了这句，异步的 `sendResponse` 白叫，对方只收到一个 undefined——本章验证清单里有一条专门踩这个坑。

第四宗最阴险：**通道只传 JSON 可序列化的值**。官方文档原话——消息通道「use JSON serialization」，过不了 `JSON.stringify` 的值会被强转。而我们的 HLS 路径偏偏要递二进制：拼好的整段视频字节是 `ArrayBuffer`，直递过去，到达页面手里就是 `{}`——判不出是字节，存盘那步根本不执行，按钮却照样走完、亮起「已存盘」。不编码不是报错，是静默丢数据。解法是后台先把字节编码成 base64 字符串再上通道，页面收到再解码组 Blob。体积账决定了选 base64 而不是把字节摆成数字数组：数字数组每个字节最多花 4 个字符（`255,`），膨胀约 4 倍；base64 只涨 4/3。这笔账连着通道的另一道天花板——消息上限 64 MiB：20 MB 的视频走数字数组约膨胀到 80 MB，当场超限；走 base64 约 27 MB，还在门内。编码还有个亲手可验的坑：`String.fromCharCode` 一次展开的参数有限，得分块；块长还得取 3 的倍数——非 3 倍数的块会带出 `=` 填充，几块拼起来就不是合法 base64，解码当场抛错（测试里专门用跨块长度踩这条边界）。

本书的正式协议四型，全载 `statusId`（点击的那条推文的数字身份证，拿来把消息路由回它自己的按钮）：

| 常量 | 方向 | 载荷 | 何时发 |
| --- | --- | --- | --- |
| `DOWNLOAD_REQUEST` | 页面→后台 | statusId | 按钮被点 |
| `DOWNLOAD_PROGRESS` | 后台→页面 | statusId、done、total | 每抓完一份分片（仅 HLS；mp4 无分片不发） |
| `DOWNLOAD_DONE` | 后台→页面 | statusId、filename；HLS 另带 mime、bytesB64（整段字节经 encodeBytes 编码） | 文件备好（mp4 后台已落盘；HLS 字节编码后随票递来，页面解码落盘） |
| `DOWNLOAD_ERROR` | 后台→页面 | statusId、error | 管线失败 |

最后一笔账：**哪条推文的什么视频，怎么对上号**。两个世界各知一半——页面摸得到推文（DOM 里的 `/status/` 链接），但视频真地址只在网络请求里；后台看得见网络请求，却不知道请求属于哪条推文。谁也不许越界，那就记账。后台被动监听时，把「这个标签页最近看到的 master 清单或 mp4 直链」记进账本；点击时页面把 statusId 递过去，后台从账本领取，statusId 写进文件名。账本不能是 `lastVideo` 那样的模块变量——它住在 SW 进程内存里，30 秒休眠就归零（第 4 章那张欠条）。新家是 `chrome.storage.session`：会话级存储，数据在扩展加载期间留存。官方对它的原话——「cleared if the extension is disabled, reloaded, updated, and when the browser restarts」，扩展停用、重载、更新或浏览器重启才清空。它也是官方点名推荐给 service worker 存状态的地方。睡一觉醒来账还在；消息会把睡着的 SW 叫醒，醒来第一件事就是去账本取——这正是官方文档教的 MV3 模式。钥匙是 manifest 里新报备的 `"storage"` 权限。诚实交代账本的边界：它记的是「这个标签页最近看到的视频」，时间线上隔了几条再点旧推文的按钮，领到的可能是最近那条——按媒体 id 精确对号超出教学版，登记在差异清单附录。

## 演练：测试先行，把按钮长出来

目标形态三件新东西：`src/shared/messages.js`（常量表+守卫）、`src/content/button-state.js`（状态机、身份证、找含视频推文）、`src/content/main.js`（DOM 装配），外加 `loader.js` 重写、`sw.js` 演进、manifest 报备新能力。可测逻辑照全书约定住前两个文件，装配层不直接测。

### 第一步：测试，先看红

测试分六组：常量与守卫、二进制过通道（协议侧）；状态机、推文身份证、找含视频的推文（按钮侧，用最小假件——跟第 1 章测 `badge.js` 同款：只装 `querySelector` / `querySelectorAll` 的普通对象）；manifest（报备侧）。状态机组把迁移表整个走一遍——正程全链、mp4 无进度路径、失败三路、重试、忙碌吸收、非法抛错。先看协议侧：

```js
// tests/05-inject-ui.test.js —— 第 5 章：把按钮放上推文（SPA 世界的 DOM 注入）
// 断言四组事：消息协议成立——MSG 常量表是两个世界共用的唯一类型事实源，两个守卫只放形状合法的消息
// 进门（第 4 章的裸字符串消息在这里升级成正式协议），二进制过通道必须先编码（通道默认 JSON 序列化，
// ArrayBuffer 直递到达就是 {}——反例当场证伪）；按钮状态机成立——正程五态按表迁移、失败态三路
// 可达、非法迁移当场抛错（消息乱序、迟到、伪造在这里现形），statusIdFromUrl 提取推文身份证，
// findVideoTweetRoots 用 data-testid 锚点只挑含视频的推文；manifest 报备本章新要的能力
// （storage 权限 + web_accessible_resources 恰好放开装配模块、只对 X 两域放开）。
// DOM 与消息一律以最小假件从参数注入——不碰真实页面、不碰网络、不 sleep。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import {
  MSG,
  isDownloadRequest,
  isProgressPayload,
  encodeBytes,
  decodeBytes,
} from '../src/shared/messages.js'
import { nextButtonState, statusIdFromUrl, findVideoTweetRoots } from '../src/content/button-state.js'

describe('messages：常量表与守卫', () => {
  it('MSG 四个类型互不相等、都以 xvd- 开头——类型只有这一张事实源', () => {
    const types = [
      MSG.DOWNLOAD_REQUEST,
      MSG.DOWNLOAD_PROGRESS,
      MSG.DOWNLOAD_DONE,
      MSG.DOWNLOAD_ERROR,
    ]
    expect(new Set(types).size).toBe(4)
    for (const t of types) expect(t.startsWith('xvd-')).toBe(true)
  })

  it('isDownloadRequest：type 与非空字符串 statusId 都在场才放行', () => {
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: '1740000000000000000' })).toBe(true)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: '1' })).toBe(true)
  })

  it('isDownloadRequest：缺 statusId、statusId 非字符串、type 不符、根本不是对象——一律拒收', () => {
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST })).toBe(false)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_REQUEST, statusId: 123 })).toBe(false)
    expect(isDownloadRequest({ type: MSG.DOWNLOAD_DONE, statusId: '1' })).toBe(false)
    expect(isDownloadRequest(null)).toBe(false)
    expect(isDownloadRequest('xvd-download-request')).toBe(false)
    expect(isDownloadRequest(42)).toBe(false)
  })

  it('isProgressPayload：done/total 是非负整数、done ≤ total、total ≥ 1 才放行（statusId 路由字段不碍事）', () => {
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, statusId: '1', done: 0, total: 12 })).toBe(true)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 12, total: 12 })).toBe(true)
  })

  it('isProgressPayload：越界、负数、非整数、total 为 0、type 不符、不是对象——一律拒收', () => {
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 13, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: -1, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 1.5, total: 12 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_PROGRESS, done: 0, total: 0 })).toBe(false)
    expect(isProgressPayload({ type: MSG.DOWNLOAD_DONE, done: 1, total: 2 })).toBe(false)
    expect(isProgressPayload(null)).toBe(false)
  })
})

describe('messages：二进制过通道——JSON 序列化只认能 stringify 的值', () => {
  /** 确定性的假字节串：不用随机数，两次运行完全一致 */
  function fakeBytes(n) {
    const out = new Uint8Array(n)
    for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) % 256
    return out
  }

  it('反例当场证伪：ArrayBuffer 直接过 JSON 通道，到达就是空对象——不编码就是静默丢数据', () => {
    // JSON.parse(JSON.stringify(...)) 是 Chrome 消息通道 JSON 序列化的最小等价物
    const through = JSON.parse(JSON.stringify({ bytes: fakeBytes(3).buffer }))
    expect(through).toEqual({ bytes: {} })
  })

  it('encodeBytes 产出 base64 字符串，JSON 往返无损；空字节串编码为空字符串', () => {
    expect(encodeBytes(new Uint8Array([1, 2, 3]))).toBe('AQID')
    const b64 = encodeBytes(fakeBytes(5))
    expect(JSON.parse(JSON.stringify({ bytesB64: b64 }))).toEqual({ bytesB64: b64 })
    expect(encodeBytes(new Uint8Array(0))).toBe('')
  })

  it('decodeBytes(encodeBytes(x)) 还原同一串字节——含 0/255 边界与跨块长度（49151/49152/49153）', () => {
    for (const n of [2, 49151, 49152, 49153]) {
      const bytes = fakeBytes(n)
      bytes[0] = 0
      bytes[n - 1] = 255
      const back = decodeBytes(encodeBytes(bytes))
      expect(back.length).toBe(n)
      expect(back[0]).toBe(0)
      expect(back[n - 1]).toBe(255)
      expect(Array.from(back.slice(1, 40))).toEqual(Array.from(bytes.slice(1, 40)))
    }
    expect(decodeBytes('').length).toBe(0)
  })
})
```

后半是状态机、身份证、找推文与 manifest 四组。非法迁移那几条要绕过编译器：`'zzz'`、`'limbo'` 是故意的坏值，先用 `@type {any}` 装箱再传——拦住它应该是状态机在运行期干的事。

```js
// tests/05-inject-ui.test.js —— 后半：状态机、身份证、找推文、manifest 报备
describe('button-state：五态状态机', () => {
  it('正程全链：idle --click--> detecting --ack--> ready --progress--> downloading --done--> done', () => {
    /** @type {import('../src/content/button-state.js').ButtonState} */
    let s = 'idle'
    s = nextButtonState(s, 'click')
    expect(s).toBe('detecting')
    s = nextButtonState(s, 'ack')
    expect(s).toBe('ready')
    s = nextButtonState(s, 'progress')
    expect(s).toBe('downloading')
    s = nextButtonState(s, 'progress') // 后续分片：留在原地，进度只更新文案不换状态
    expect(s).toBe('downloading')
    s = nextButtonState(s, 'done')
    expect(s).toBe('done')
  })

  it('mp4 直链没有分片进度：ready --done--> done 一步到位', () => {
    expect(nextButtonState('ready', 'done')).toBe('done')
  })

  it('失败三路都能进 error；error 吃 click 重试回 detecting', () => {
    expect(nextButtonState('detecting', 'fail')).toBe('error')
    expect(nextButtonState('ready', 'fail')).toBe('error')
    expect(nextButtonState('downloading', 'fail')).toBe('error')
    expect(nextButtonState('error', 'click')).toBe('detecting')
  })

  it('忙碌中重复点击被吸收：detecting/ready/downloading 吃 click 原地不动，done 吃 click 不返工', () => {
    expect(nextButtonState('detecting', 'click')).toBe('detecting')
    expect(nextButtonState('ready', 'click')).toBe('ready')
    expect(nextButtonState('downloading', 'click')).toBe('downloading')
    expect(nextButtonState('done', 'click')).toBe('done')
  })

  it('表里没有的组合是非法迁移：抛 Error 点名是谁——乱序、迟到、伪造的消息在这里现形', () => {
    expect(() => nextButtonState('idle', 'ack')).toThrow() // 没发过请求，哪来的回执
    expect(() => nextButtonState('idle', 'done')).toThrow()
    expect(() => nextButtonState('detecting', 'progress')).toThrow() // 还没对上号就来进度
    expect(() => nextButtonState('done', 'progress')).toThrow() // 完成后又冒出进度
    const unknownEvent = /** @type {any} */ ('zzz') // 装成「编译期不认识」的事件——状态机还得在运行期把它拦下来
    expect(() => nextButtonState('idle', unknownEvent)).toThrow()
    const unknownState = /** @type {any} */ ('limbo')
    expect(() => nextButtonState(unknownState, 'click')).toThrow() // 不认识的状态
  })
})

describe('button-state：推文身份证', () => {
  it('statusIdFromUrl：/status/ 后面的数字串提出来——photo 后缀、query 参数、twitter.com 域都不碍事', () => {
    expect(statusIdFromUrl('https://x.com/somebody/status/1740000000000000000')).toBe('1740000000000000000')
    expect(statusIdFromUrl('https://x.com/somebody/status/1740000000000000000/photo/1')).toBe('1740000000000000000')
    expect(statusIdFromUrl('https://twitter.com/somebody/status/1740000000000000000?s=20')).toBe('1740000000000000000')
  })

  it('statusIdFromUrl：不是状态页、id 不是数字、URL 解析不了——返回 null，不抛错', () => {
    expect(statusIdFromUrl('https://x.com/home')).toBeNull()
    expect(statusIdFromUrl('https://x.com/somebody/status/abc')).toBeNull()
    expect(statusIdFromUrl('/somebody/status/1740000000000000000')).toBeNull() // 相对地址先归一（badge.tweetLinkFrom 的活）
    expect(statusIdFromUrl('not a url')).toBeNull()
  })
})

describe('button-state：找含视频的推文', () => {
  /** 造一个假推文根：videoHere 决定它内部有没有 <video> */
  function fakeTweet(videoHere) {
    return {
      querySelector: (sel) => (sel === 'video' ? (videoHere ? { tagName: 'VIDEO' } : null) : null),
    }
  }

  it('默认锚 article[data-testid="tweet"]：只挑内部有 video 的，纯文字推文不进单', () => {
    const videoTweet = fakeTweet(true)
    const textTweet = fakeTweet(false)
    const root = {
      querySelectorAll: (sel) => (sel === 'article[data-testid="tweet"]' ? [videoTweet, textTweet] : []),
    }
    expect(findVideoTweetRoots(root)).toEqual([videoTweet])
  })

  it('选择器可传入覆盖：X 改锚点名时改这一处；没有匹配返回空数组', () => {
    const root = {
      querySelectorAll: (sel) => (sel === 'div[data-thing="post"]' ? [fakeTweet(true)] : []),
    }
    expect(findVideoTweetRoots(root, 'div[data-thing="post"]')).toHaveLength(1)
    expect(findVideoTweetRoots({ querySelectorAll: () => [] })).toEqual([])
  })
})

describe('manifest：本章新要的能力报备', () => {
  it('permissions 含 storage：storage.session 的钥匙——对号账本要活过 SW 休眠', () => {
    expect(manifest.permissions).toContain('storage')
  })

  it('web_accessible_resources 恰好放开装配模块四个文件，且只对 X 两域放开；loader.js 本身不用放开', () => {
    const war = manifest.web_accessible_resources?.[0]
    expect(war?.resources).toContain('src/content/main.js')
    expect(war?.resources).toContain('src/content/button-state.js')
    expect(war?.resources).toContain('src/shared/badge.js')
    expect(war?.resources).toContain('src/shared/messages.js')
    expect(war?.resources).not.toContain('src/content/loader.js') // 声明式注入的 content script 不走网页门
    expect(war?.matches).toEqual(['https://x.com/*', 'https://twitter.com/*'])
  })
})
```

想亲眼看本章的「红」：把 `src/shared/messages.js` 临时移出 `src` 再跑——本章套件整组失败（`Cannot find module '../src/shared/messages.js'`），连带红到依赖它的装配与对账测试；移回来恢复 76 绿。这是本章的红。

### 第二步：messages.js——两个世界共用一张表

协议模块全文，常量与守卫各就各位：

```js
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
```

### 第三步：button-state.js——一张表管住全部迁移

状态机做成数据：`TRANSITIONS` 一张表，行是状态、列是事件、格是下一状态。函数体只剩查表与抛错——规则全在数据里，加状态改表，不改逻辑：

```js
// src/content/button-state.js —— 下载按钮的可测逻辑：状态机、推文身份证、找含视频的推文
// （DOM 装配见 src/content/main.js；迁移规则全住在这里，装配层只负责搬运事件）

/** 下载按钮自带的标记：值是它所属推文的 statusId——重扫时凭它跳过已注入的；
 * X 回收复用推文元素（虚拟列表）换了内容时，凭它发现「旧按钮属于上一条推文」撤旧换新 @type {string} */
export const BUTTON_ATTR = 'data-xvd-download'

/**
 * @typedef {'idle' | 'detecting' | 'ready' | 'downloading' | 'done' | 'error'} ButtonState
 *   正程五态：idle（等点击）→ detecting（对号中）→ ready（已对上号）→ downloading（抓分片中）→ done（已存盘）；
 *   外加一个失败态 error（可重试回 detecting）
 * @typedef {'click' | 'ack' | 'progress' | 'done' | 'fail'} ButtonEvent
 *   click 来自用户；ack/done/fail 来自 sendMessage 的回执；progress/done/fail 来自后台递来的消息
 */

/**
 * 迁移表：行是当前状态，列是事件，格是下一状态；忙碌态重复 click 走自旋（吸收，不重发请求）。
 * 表里没有的（状态, 事件）组合就是非法迁移——状态机的价值不在「能转」，在「不能转的被拦住
 * @type {Record<ButtonState, Partial<Record<ButtonEvent, ButtonState>>>}
 */
const TRANSITIONS = {
  idle: { click: 'detecting' },
  detecting: { click: 'detecting', ack: 'ready', fail: 'error' },
  ready: { click: 'ready', progress: 'downloading', done: 'done', fail: 'error' },
  downloading: { click: 'downloading', progress: 'downloading', done: 'done', fail: 'error' },
  done: { click: 'done' },
  error: { click: 'detecting' },
}

/**
 * 推一个事件，返回下一状态。表外的组合是非法迁移，抛 Error 点名是谁——
 * 乱序、迟到、伪造的消息都会在这里现形，而不是糊成一团「按钮行为看心情」
 * @param {ButtonState} state 当前状态
 * @param {ButtonEvent} event 到来的事件
 * @returns {ButtonState} 下一状态
 */
export function nextButtonState(state, event) {
  const row = TRANSITIONS[state]
  if (row === undefined) {
    throw new Error(`nextButtonState：不认识的状态 '${String(state)}'`)
  }
  const next = row[event]
  if (next === undefined) {
    throw new Error(`nextButtonState：非法迁移 ${state} + ${String(event)}`)
  }
  return next
}

/**
 * 从 x.com / twitter.com 的状态页 URL 提取推文数字 id（/status/ 后面那串）。
 * 提不出（不是状态页、id 不是数字、URL 解析不了）安静返回 null——推文没有身份证，按钮不注入
 * @param {string} url 绝对 URL；相对 href 请先用 shared/badge.js 的 tweetLinkFrom 归一
 * @returns {string | null}
 */
export function statusIdFromUrl(url) {
  let pathname
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const m = /\/status\/(\d+)/.exec(pathname)
  return m === null ? null : m[1]
}

/**
 * 找出 root 里「含视频的推文」根元素：默认锚 article[data-testid="tweet"]，且内部真有 <video>。
 * X 的 class 是构建产物、改版就变；data-testid 是它留给自动化测试的工牌——锚点跟工牌走
 * @param {{ querySelectorAll(selector: string): Iterable<any> }} rootLike
 * @param {string} [selector] 推文根选择器；现场核对后 X 若改了名，改这一处
 * @returns {any[]}
 */
export function findVideoTweetRoots(rootLike, selector = 'article[data-testid="tweet"]') {
  return Array.from(rootLike.querySelectorAll(selector)).filter(
    (el) => el.querySelector?.('video') != null
  )
}
```

两个旧相识在这里各领新职：`tweetLinkFrom`（第 1 章拿去当角标悬停提示）归一链接、`statusIdFromUrl` 从归一结果里抠身份证；`findVideoTweetRoots` 只挑内部真有 `<video>` 的推文——纯文字推文不进单，视频元素晚长出来的推文等观察器下次回调补票。

### 第四步：装配——loader 换岗、manifest 开口、main.js 首登场

先解决一个新问题：装配要用模块了（`main.js` import 三个模块），但 `content_scripts` 声明式注入的脚本不是 ES 模块——Chrome 至今不支持把 content script 直接声明成 module。惯用法是两段式：入口声明经典脚本，由它动态 `import()` 真正的模块。动态 import 的地址必须是 `chrome.runtime.getURL()` 拼出的 `chrome-extension://` 绝对地址——相对地址会按页面的源解析，直接跑偏。被 import 的模块要过网页这扇门，必须在 manifest 的 `web_accessible_resources`（网页可达资源）里报备。这扇门默认关死：一个扩展资源都不对网页开放。官方的理由是防「fingerprint extensions」——网页能借此探测到你装了什么。所以开口要最小：恰好四个被 import 的文件、只对 X 两域开。`loader.js` 自己不用报备，官方原话：「Content scripts themselves do not need to be allowed」。

manifest 第 5 章末形态，比第 4 章多出 `storage` 权限与资源开口：

```jsonc
// companion/manifest.json —— 第 5 章末形态：storage 权限 + web_accessible_resources 最小开口
{
  "manifest_version": 3,
  "name": "X 视频下载器（教学版）",
  "version": "0.2.0",
  "permissions": ["webRequest", "downloads", "storage"],
  "action": {},
  "host_permissions": ["https://x.com/*", "*://*.twimg.com/*"],
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["src/content/loader.js"]
    }
  ],
  "web_accessible_resources": [
    {
      "resources": [
        "src/content/main.js",
        "src/content/button-state.js",
        "src/shared/badge.js",
        "src/shared/messages.js"
      ],
      "matches": ["https://x.com/*", "https://twitter.com/*"]
    }
  ],
  "background": { "service_worker": "src/background/sw.js", "type": "module" }
}
```

第 1 章的 loader 是十几行扫描贴角标；现在换岗成四行的摆渡人，角标退役：

```js
// src/content/loader.js —— 第 5 章装配层入口：content_scripts 声明的经典脚本，只干一件事——
// 动态 import 把真正的装配模块拉进来。content script 不支持静态 import 声明，模块要用
// chrome.runtime.getURL 拿到 chrome-extension:// 绝对地址再 import()，被 import 的模块
// 必须在 manifest 的 web_accessible_resources 里报备过（相对地址不行：它会按页面源解析）
;(async () => {
  await import(chrome.runtime.getURL('src/content/main.js'))
})().catch((err) => {
  console.log('[xvd] 装配模块加载失败：', err instanceof Error ? err.message : err)
})
```

真正的装配在 `main.js`，首登场给全貌。看的时候盯三处：`scan` 首尾各一遍（首屏一遍、观察器回调里一遍——本章主角就这两行）；`buttons` 这张 `statusId → 按钮` 的表（后台递来的消息凭它路由）；`onMessage` 里 `sendResponse` 是同步发的、不用 `return true`（那是后台异步回执才要的规矩）：

```js
// src/content/main.js —— 第 5 章装配层：扫描推文注入下载按钮，用消息把状态机跑起来
// （可测逻辑在 src/content/button-state.js 与 src/shared/；本文件只搬运事件与 DOM，不直接测）
import { tweetLinkFrom } from '../shared/badge.js'
import { MSG, isProgressPayload, decodeBytes } from '../shared/messages.js'
import { BUTTON_ATTR, findVideoTweetRoots, nextButtonState, statusIdFromUrl } from './button-state.js'

/** 状态名 → 按钮默认文案；downloading 的文案带进度数字，由 progress 事件现场拼 */
const LABEL = {
  idle: '下载视频',
  detecting: '对号中…',
  ready: '已对上号',
  downloading: '下载中…',
  done: '已存盘',
  error: '失败·点我重试',
}

/** 状态名 → 按钮配色：颜色跟状态走，隔着屏幕一眼看出按钮走到了哪一步 */
const COLOR = {
  idle: '#1d9bf0', // X 蓝
  detecting: '#536471', // 灰
  ready: '#1d9bf0',
  downloading: '#7856ff', // 紫
  done: '#00ba7c', // 绿
  error: '#f4212e', // 红
}

/** @type {Map<string, HTMLButtonElement>} statusId → 它的按钮：进度/完成/失败消息按这张表路由 */
const buttons = new Map()

/** @type {WeakMap<HTMLButtonElement, import('./button-state.js').ButtonState>} 每个按钮自己的状态机 */
const states = new WeakMap()

/** 推一个事件：换状态、换文案；文案给了就用给的（进度数字盖过默认文案） */
function advance(btn, event, label) {
  const next = nextButtonState(states.get(btn) ?? 'idle', event)
  states.set(btn, next)
  btn.textContent = label ?? LABEL[next]
  btn.style.background = COLOR[next]
}

/** 点击：状态机推 click，把带身份证的正式请求发出去；ack 与失败走 sendMessage 的回执 */
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

/** 给一条含视频的推文注入下载按钮，按钮自己带身份证标记 */
function injectButton(root, statusId) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = LABEL.idle
  btn.setAttribute(BUTTON_ATTR, statusId)
  btn.setAttribute(
    'style',
    'display:inline-block;margin:6px 0 0 48px;padding:2px 10px;border:none;' +
      'border-radius:10px;background:#1d9bf0;color:#fff;font-size:12px;line-height:16px;cursor:pointer;'
  )
  btn.addEventListener('click', () => requestDownload(statusId, btn))
  states.set(btn, 'idle')
  root.appendChild(btn)
  buttons.set(statusId, btn)
}

/** 扫一遍：给「含视频、有身份证」的推文补按钮；已注入的跳过，被 X 回收复用的撤旧换新 */
function scan() {
  for (const root of findVideoTweetRoots(document)) {
    const link = tweetLinkFrom(root, location.href)
    const statusId = link === null ? null : statusIdFromUrl(link)
    if (statusId === null) continue // 没有身份证的推文不接单（引用卡等非标准形态）
    const existing = root.querySelector(`button[${BUTTON_ATTR}]`)
    if (existing !== null && existing.getAttribute(BUTTON_ATTR) === statusId) continue
    existing?.remove() // X 回收复用了推文元素：旧按钮属于上一条推文，撤掉重来
    injectButton(root, statusId)
  }
}

scan() // 首屏：第 1 章只做了这一步，往下滚就瞎了——SPA 的坑从这里开始
const observer = new MutationObserver(() => scan()) // 补票机制：DOM 每长出新东西就重扫（自己注入的按钮也会触发，靠标记跳过）
observer.observe(document.body, { childList: true, subtree: true })

// 后台递来的进度/完成/失败：按 statusId 路由到具体某条推文的按钮
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const btn = typeof msg === 'object' && msg !== null ? buttons.get(msg.statusId) : undefined
  if (btn === undefined) return false // 不在册的孤儿消息（按钮已随路由换页消失），安静丢弃
  if (isProgressPayload(msg)) {
    advance(btn, 'progress', `下载中 ${msg.done}/${msg.total}`)
  } else if (msg.type === MSG.DOWNLOAD_DONE) {
    if (typeof msg.bytesB64 === 'string') {
      saveBytes(msg.filename, msg.mime, decodeBytes(msg.bytesB64)) // HLS：整段字节经 base64 编码递来，页面解码落盘
    }
    advance(btn, 'done')
    sendResponse({ ok: true })
  } else if (msg.type === MSG.DOWNLOAD_ERROR) {
    console.log('[xvd] 下载失败：', msg.error)
    advance(btn, 'fail')
  }
  return false // sendResponse 是同步发的，不用给通道留门（那是后台异步回执的规矩）
})

/** 第 4 章的落盘三步：组 Blob、发临时门牌、造链接点一下——全要 DOM，只能在页面世界做 */
function saveBytes(filename, mime, bytes) {
  const blob = new Blob([bytes], { type: mime })
  const blobUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = blobUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 门牌不能立刻回收：浏览器接住下载要一瞬间，马上 revoke 可能存出空文件
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
}
```

两处细节值得多说一句。其一，自己注入按钮本身就是一次 DOM 变动，会触发观察器再扫一遍——`BUTTON_ATTR` 的值与 statusId 对得上就跳过，循环到第二遍自然停住；防自激的不是开关，是幂等的扫描。其二，X 的时间线是虚拟列表：滚出视口的推文元素会被回收、塞给新推文复用。同一个 `article` 换了内容，旧按钮还挂在上面、属于上一条推文——所以核对的是「标记值是否等于当前推文的 statusId」，对不上就撤旧换新，而不是看见有标记就闭眼跳过。

### 第五步：sw.js——账本、对号、回推

后台的演进分三块。先看对号账本，`lastVideo` 那行模块变量整个退役：

```js
// src/background/sw.js —— 本章新增：对号账本（reportPlaylist 在前；import 列表本章补了 encodeBytes，终态 import 清单见伴生仓 sw.js 头部）
/**
 * 账本里的一条：这个标签页最近看到的 master 清单或 mp4 直链
 * @typedef {{ kind: 'master' | 'mp4', url: string }} VideoEntry
 */

/**
 * @param {number} tabId
 * @returns {string}
 */
const LOG_KEY = (tabId) => `xvd:video:${tabId}`

/**
 * 把「这个标签页最近看到的视频」记进会话存储。key 按标签页分账，两个标签页各看各的视频互不覆盖
 * @param {number} tabId
 * @param {'master' | 'mp4'} kind
 * @param {string} url
 */
async function rememberVideo(tabId, kind, url) {
  await chrome.storage.session.set({ [LOG_KEY(tabId)]: { kind, url } })
}

/**
 * 取某标签页的账。SW 睡一觉醒来先来这儿取——账本在浏览器手里，不在进程内存里
 * @param {number} tabId
 * @returns {Promise<VideoEntry | null>}
 */
async function recallVideo(tabId) {
  const key = LOG_KEY(tabId)
  const bag = await chrome.storage.session.get(key)
  return /** @type {VideoEntry | null} */ (bag[key] ?? null)
}
```

key 按标签页分账是第 4 章欠下的另一笔：全局一个 `lastVideo`，两个标签页各播一条视频就互相覆盖。webRequest 的 `details.tabId` 现成告诉我们请求来自哪个标签页，账就记在谁名下。

下载的执行沿第 4 章两条路径原样走，只换三样：文件名用推文真正的 status id（第 4 章从视频 URL 里抠数字的临时办法退役）；进度不再打日志，逐条回推给按钮；整段字节先经 `encodeBytes` 编码再上通道（第四宗的药方落在这里）：

```js
// src/background/sw.js —— 本章新增：sendTab 与 runDownload（heightFromUrl 原样在前）
/**
 * 递消息给指定标签页的 content script；没人接（页面里没有我们的代码）也要打日志，不许静默吞掉
 * @param {number} tabId
 * @param {Record<string, unknown>} msg
 */
async function sendTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg)
  } catch (err) {
    console.log('[xvd] 页面没接住消息：', err instanceof Error ? err.message : err)
  }
}

/**
 * 把一条视频按第 4 章的管线跑到底：mp4 一行落盘；HLS 选档、并发抓分片、字节拼接，
 * 进度逐段回推，整段字节递回页面世界落盘（SW 里没有 URL.createObjectURL）。
 * 文件名用推文真正的 status id——第 4 章从视频 URL 抠数字的临时办法到此退役
 * @param {number} tabId
 * @param {string} statusId 请求下载的那条推文的数字 id
 * @param {{ kind: 'master' | 'mp4', url: string }} entry 账本里对上号的那条视频
 */
async function runDownload(tabId, statusId, entry) {
  if (entry.kind === 'mp4') {
    const filename = guessFilename(statusId, { ext: 'mp4', height: heightFromUrl(entry.url) })
    await chrome.downloads.download({ url: entry.url, filename })
    await sendTab(tabId, { type: MSG.DOWNLOAD_DONE, statusId, filename })
    return
  }
  const { url: mediaUrl, variant } = await resolveMediaPlaylistUrl(entry.url, null, fetch)
  const { init, segments } = await downloadSegments({
    mediaUrl,
    fetchLike: fetch,
    onProgress: ({ done, total }) => {
      void sendTab(tabId, { type: MSG.DOWNLOAD_PROGRESS, statusId, done, total })
    },
  })
  const bytes = concatBuffers(init ? [init, ...segments] : segments) // init 存在时排最前
  await sendTab(tabId, {
    type: MSG.DOWNLOAD_DONE,
    statusId,
    filename: guessFilename(statusId, { ext: init ? 'mp4' : 'ts', height: variant.height }),
    mime: init ? 'video/mp4' : 'video/mp2t',
    bytesB64: encodeBytes(bytes), // 通道只传 JSON 可序列化值——ArrayBuffer 直递到达就是 {}，必须先编码
  })
}
```

最后一截是注册区全景。webRequest 监听器的骨架还是第 2 章的，只把记账那行改走 `rememberVideo`；按钮请求的入口守卫先验形状，账本取来对上号就回 ack，之后的成败一律走消息回推；工具栏点击退成一句指路的日志。注释里那句 `return true` 是全章最容易漏的一行——去掉它，账还没取完通道就关了：

```js
// src/background/sw.js —— 第 5 章末注册区：webRequest 记账改走账本，按钮请求入口，工具栏退役
// chrome 全局只在浏览器后台里存在；Node 测试环境 import 本文件时它缺席，先看一眼再注册
if (typeof chrome !== 'undefined') {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isLikelyVideoUrl(details.url)) return
      console.log('[xvd] 视频请求', details.url)
      const kind = playlistKindOf(details.url)
      if (kind === 'master' || kind === 'media') void reportPlaylist(details.url)
      if (kind === 'master' || kind === 'mp4') {
        void rememberVideo(details.tabId, kind, details.url) // 记在这个标签页名下，休眠不死
      }
    },
    { urls: ['https://x.com/*', 'https://*.twimg.com/*'] }
  )

  // 按钮的下载请求：守卫先验形状，对上号就 ack，之后进度/完成/失败走消息回推
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!isDownloadRequest(msg)) {
      sendResponse({ ok: false, error: '不认识的消息：形状不是下载请求' })
      return false
    }
    const tabId = sender.tab?.id
    if (tabId === undefined) {
      sendResponse({ ok: false, error: '消息没有来处的标签页' })
      return false
    }
    void (async () => {
      /** @type {VideoEntry | null} */
      let entry = null
      try {
        entry = await recallVideo(tabId)
      } catch (err) {
        sendResponse({
          ok: false,
          error: `读对号账本失败：${err instanceof Error ? err.message : String(err)}`,
        })
        return
      }
      if (entry === null) {
        sendResponse({ ok: false, error: '这个标签页还没播过视频——先播放一次，再点推文上的按钮' })
        return
      }
      sendResponse({ ok: true, kind: entry.kind }) // ack：哪条推文的什么视频，对上号了
      try {
        await runDownload(tabId, msg.statusId, entry)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        await sendTab(tabId, { type: MSG.DOWNLOAD_ERROR, statusId: msg.statusId, error })
      }
    })()
    return true // 回执在 await 之后才发（storage 是异步的）：不返回 true，通道当场关门、sendResponse 白叫
  })

  // 工具栏图标退役：入口搬到了每条含视频推文的按钮上（manifest 的 action 声明保留）
  chrome.action.onClicked.addListener(() => {
    console.log('[xvd] 入口已搬到推文上的「下载视频」按钮')
  })
}
```

两道门槛再跑一遍收工：`pnpm run typecheck` 安静通过；`pnpm test` 显示 `Tests  76 passed (76)`——本章 19 个在 `tests/05-inject-ui.test.js` 那行（累计口径见第 1 章）。写作途中还有一次「2 条红」值得知道：逻辑模块写完、manifest 还没报备时，红的恰好是 manifest 那两条——权限与资源开口没到位，测试说得清清楚楚。

## 验证：滚起来，点下去

本章的可感知面在真浏览器里：按钮要跟着滚动与路由走，要按状态变色走完全程。逐条来：

- [ ] 在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`（`tests/05-inject-ui.test.js` 那行应显示 (19 tests)）；再跑 `pnpm run typecheck`：应无任何报错输出。
- [ ] 在 chrome://extensions 的插件卡片上点刷新图标重新装载（manifest 变了必须重载），再刷新 x.com 首页。首屏含视频的推文左下角应出现蓝色「下载视频」按钮；纯文字推文不应有任何按钮；第 1 章的角标不再出现（已由按钮接岗）。
- [ ] 现场核对锚点（时效性约定）：在一条含视频的推文上右键「检查」，在 Elements 里向上找到 `article`，它的属性面板应显示 `data-testid="tweet"`。若 X 已改名，页面上应看不到任何按钮——把 `src/content/button-state.js` 里 `findVideoTweetRoots` 的默认参数改成新名，重载后按钮应重新出现。
- [ ] 往下滚动两屏：新出现的含视频推文上，按钮应自动出现——不用刷新、不用点任何东西。第 1 章埋的「角标只认首屏」在此收账。
- [ ] 点进一条含视频推文的详情页再返回：详情页与返回后的时间线，按钮都应在。
- [ ] 点一条推文上的按钮，盯住它的文案与颜色：应依次走过「下载视频」（蓝）→「对号中…」（灰）→「已对上号」（蓝）→「下载中 k/M」（紫，M 为这条视频选定档位的真实分片数；mp4 直链没有这一步）→「已存盘」（绿）；随后下载栏应出现 `x-video-<推文数字id>-….mp4|ts`，文件名里的数字 id 应与这条推文链接（右键推文上的时间戳「复制链接」，或点进详情页看地址栏）里 `/status/` 后面的数字一致——这是「哪条推文的什么视频」对上号的直接证据。HLS 文件双击应能播放；若二进制没编码就上通道，你会得到一个打不开的空壳文件，而按钮照样显示「已存盘」。
- [ ] 先猜后跑：播放一条视频后，等约 1 分钟让 service worker 休眠再点按钮。休眠判据：chrome://extensions 的插件卡片上，service worker 一行应显示为非活动/inactive。先猜：按钮会像第 4 章那样报「还没看到过视频」吗？应看到按钮照常走完全程、文件照常落盘——账本住在 storage.session 里，睡一觉还在。
- [ ] 先猜后跑：点完一条视频的下载后，在下载未完成时连点按钮两三次。按钮文案与状态应毫无变化（忙碌态吸收点击，不重发请求），下载栏最终只应出现一个文件。
- [ ] 定向破坏：把 `src/background/sw.js` 里 `onMessage` 监听器末尾的 `return true` 改成 `return false`，重载扩展后点按钮。先猜：下载还会成功吗？按钮会显示什么？应看到：文件照常下载（`runDownload` 不依赖回执），但按钮很快变「失败·点我重试」（红）——异步的 `sendResponse` 递不回来，ack 丢了；随后页面 Console 应出现 `Error: nextButtonState：非法迁移 error + progress`——迟到的进度消息撞上 error 态，被状态机当场拦下。改回 `return true` 重载，一切恢复。
- [ ] （可选）在同一浏览器开两个标签页，各播放一条不同的视频，分别点各自推文的按钮：两次下载的文件应对应各自标签页看到的视频——账本按标签页分账的证据。

## 收束

现在可以回答开篇的角标悬案了：X 是单页应用，页面从不重新加载；content script 随文档注入、只跑一次；第 1 章那遍扫描扫过的首屏 DOM 早被换血，新推文它根本没见过。三件套凑齐，角标消失不是玄学。而你现在手里有 MutationObserver：DOM 每长出新东西就重扫一遍，滚动、路由、虚拟列表回收复用，全部自动补票。

第 4 章的三张欠条也清了：`'xvd-save-file'` 裸字符串退役，换成 `MSG` 常量表加两个守卫——类型只有一张事实源，不认识的消息门口拒收；二进制也领了渡船——通道只传 JSON 可序列化的值，整段视频字节先编码成 base64 再上路，不然到达就是 `{}`、静默丢数据；`lastVideo` 模块变量退役，换成按标签页分账的 `storage.session` 账本，SW 睡醒账还在；工具栏图标退役，入口搬到每条含视频推文的按钮上，五态状态机管住它的一生，`return true` 给异步回执留门。对号机制如约交卷并如实记账：按标签页账本领取、statusId 写进文件名；「隔几条点旧推文可能领到最近视频」的边界，登记在差异清单附录。第 6 章算总账：本章新开的两个口子——`storage` 权限与 `web_accessible_resources`——在商店和用户眼里各值一句「凭什么」，连同 host_permissions 与 CORS 豁免的完整规则，一并算清。

### 自查

1. 预测：用户在「对号中…」和「下载中 k/M」两个阶段各狂点按钮三次，后台会收到几条 `DOWNLOAD_REQUEST`？靠的是状态机的哪个性质？
2. 迁移题：X 某次改版把推文根元素从 `article[data-testid="tweet"]` 改成了别的形式。你的插件会出现什么现象？要改几处代码？若当初锚点用的是 class 选择器，同样的改版还多一层什么风险？
3. 设计题：把 `LOG_KEY` 从按标签页分账改成全局一个固定键（模拟第 4 章的 `lastVideo`），两个标签页各播一条视频后分别点各自的按钮，会下到哪两条视频？这个思想实验说明「分账」和「storage.session」分别解决了 `lastVideo` 的哪一半问题？

::: details 参考答案
1. 恰好 1 条——click 事件在 detecting/downloading 态走自旋吸收，`requestDownload` 只在状态真的迁走时才发消息；这是表驱动迁移里「忙碌态对 click 停留原地」那一列的性质，不是靠额外的防抖代码。可回看状态迁移表与 `requestDownload`。
2. 现象：所有按钮消失（`findVideoTweetRoots` 匹配不到根元素），已有点的下载不受影响；只改默认参数那一处（或调用时传入覆盖）。class 方案的风险在于改版换 class 你同样全盲，但 class 连正常版本都不稳定（随构建变），你可能在一周内的任意一次线上重建后悄悄失明，而不是在一次大改版后显眼地失明。可回看「工牌比衣服可靠」一节。
3. 两边都会下到「全局最后被记住的那一条」——后播的覆盖先播的，先播的标签页点按钮领到的是别人家的视频。分账解决「谁看到的记在谁名下」（覆盖问题），storage.session 解决「记下的东西活不过 SW 休眠」（存活问题）；`lastVideo` 两条都占。可回看「消息协议」一节的对号账本与验证清单的休眠一条。
:::
