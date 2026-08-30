---
title: 让代码跑在 x.com 上：MV3 插件的最小骨架
---

# 让代码跑在 x.com 上：MV3 插件的最小骨架

x.com 是别人的页面。你没有它一行源码的写权限；在 DevTools 里改两句，一刷新就被打回原形。会写 JS 的你，对它一直只有「读」的份。

但今天要跨过一条线：装上一个十几行代码的小插件，刷新 x.com——推文上会多出一枚 X 自己从来没放过的小角标。别人的页面上，有一小块从此写着你的名字。

这一章我们把「住进别人页面」的最小骨架搭起来：一份 manifest.json 说明书、一个贴角标的 content script、一个空着的 service worker（后台）。分清这两个「世界」各自能做什么，是后面所有章节的地基。

## 插件不是黑魔法

你可能以为，插件能改浏览器里的页面，靠的是什么黑魔法——普通网页脚本被同源策略看得死死的，插件的代码凭什么能进去？

其实每一步都是白纸黑字的正式通道。浏览器插件（扩展，browser extension）——装进浏览器的小程序，能在你访问的网页里和浏览器本身做事。它进页面不靠越权：你在一份声明文件里写清楚「我要碰哪些网站、我的代码放在哪」；装载时浏览器读过这份声明、你亲手点了确认；之后每次打开匹配的页面，是浏览器自己把你的代码放进那个页面。**x.com 从头到尾没有被入侵——被说服的是你的浏览器，不是对方的服务器。**

这份声明文件，就是插件的唯一入口。

## manifest.json：插件世界的 package.json

浏览器凭什么放一段陌生代码进你的页面？先看说明书。每个插件必须带一份 manifest.json——插件叫什么、版本多少、代码在哪、想碰哪些站，全写在这一个文件里。你在 npm 项目里写惯了 package.json，这里是一模一样的角色：一份「我是谁、我要什么、我的代码在哪」的清单。

说明书本身也有规范版本。Manifest V3——Chrome 给插件说明书定的第三代规范，也是如今商店唯一接受的一代；文件第一行的 `"manifest_version": 3`，就是在声明「我按 V3 的规矩来」。

本章的 manifest.json 全文如下：

```jsonc
// 拼版·教学示意：manifest 在第 1 章末的形态；终态全文见第 6 章「manifest 是公示文件」一节
{
  "manifest_version": 3,
  "name": "X 视频下载器（教学版）",
  "version": "0.1.0",
  "content_scripts": [
    {
      "matches": ["https://x.com/*", "https://twitter.com/*"],
      "js": ["src/content/loader.js"]
    }
  ],
  "background": { "service_worker": "src/background/sw.js" }
}
```

每个字段一句大白话：

| 字段 | 本章的值 | 它是什么 |
| --- | --- | --- |
| `manifest_version` | `3` | 按哪一代规范写这份说明书 |
| `name` | `X 视频下载器（教学版）` | 插件在浏览器里显示的名字 |
| `version` | `0.1.0` | 版本号，浏览器靠它判断要不要升级 |
| `content_scripts` | 见上方代码 | 「哪些代码、放进哪些页面」的登记表 |
| `background` | 见上方代码 | 插件后台的登记处 |

`matches` 里那条 `https://x.com/*` 叫匹配模式（match pattern）：协议、主机、路径三段，星号是通配符。它就是你的第一份报备——范围之外的页面，浏览器一个字符都不会替你注入。后续章节还要向浏览器要更多能力，靠的是权限声明——manifest 里向浏览器报备的能力清单。它分两类：API 权限说「我要用什么浏览器能力」，站点权限（host_permissions）说「我要访问哪些站」。本章一个都还没要，`matches` 是唯一圈定的范围。

## 两个世界：能碰页面的，和能用浏览器的

manifest 登记了两处代码，它们住在两个完全不同的环境里。像一家餐厅的前台服务员和后厨：都能干活，但后厨摸不到餐桌，服务员进不了冷库。

content script（内容脚本）——跑在你访问的页面里的插件代码，本章贴角标就是它干的。它和页面共享同一棵 DOM 树：读得到推文，插得进角标。但它的 JS 变量住在一个隔离世界（isolated world）里：你声明的变量页面看不到，页面的变量它也拿不到——共享的是桌面，不是对方的抽屉。它还拿不到绝大多数浏览器 API：`chrome.webRequest`、`chrome.downloads` 这些都不能直接调，能直接用的只剩 `chrome.runtime`（跟后台传话）、`chrome.storage`（存取数据）等寥寥几个。

service worker（插件后台）——插件的后台代码，登记在 `background` 字段里。方向正好相反：它拿得到浏览器级 API（监听网络、下载文件、存数据），但没有页面也没有 DOM，`document`、`alert` 一律不存在；而且干完活约 30 秒没动静就会被浏览器休眠，有事件再来唤醒它。

| | content script（页面世界） | service worker（插件后台） |
| --- | --- | --- |
| 能做什么 | 读写页面 DOM、贴角标、听页面事件 | 调浏览器 API：网络监听、下载、存储 |
| 不能做什么 | 直接调多数 `chrome.*` API，出不了页面 | 没有 DOM，碰不到任何具体页面 |
| 活多久 | 页面在，它在 | 事件来了醒，空闲约 30 秒休眠 |
| 本章的角色 | 在推文上贴角标 | 空着，报一声到 |

为什么要劈成两摊？浏览器把「能摸页面的代码」和「能用浏览器的代码」关进不同的笼子，各自只发最少的能力。反事实摆在那儿：假如混在一起，一段能改任何页面 DOM 的代码，同时能读你全部网络流量——用户没法「只信一半」，权限就没了粒度。两个世界之间也没有共享内存，正式通道只有互发消息，后面接通下载管线时会用到。

## 演练：把骨架搭出来

companion 目录本身就是扩展根——装载时选的是它。结构：

```text
companion/                ← 扩展根：装载时选的就是这个目录
├─ manifest.json          ← 唯一入口：说明书
├─ src/
│  ├─ content/loader.js   ← content script 装配层：贴角标
│  ├─ background/sw.js    ← service worker：本章空置
│  └─ shared/badge.js     ← 可测逻辑：找推文、取链接
├─ tests/                 ← 本章测试（vitest）：manifest 骨架 + badge 逻辑
└─ package.json 等        ← 测试与类型检查的工程文件，不属于扩展本体
```

### 第一步：空着的 service worker

```js
// 拼版·教学示意：这是后台文件 sw.js 在第 1 章末的初始形态（只有报到一行）。
// 第 2 章起它长出网络监听、第 4 章下载、第 5 章账本，终态以伴生仓 src/background/sw.js 为准。
console.log('[xvd] service worker 已启动')
```

MV3 的后台必须是一个 service worker 文件。本章它唯一的工作是报到——装载后你在浏览器里能看到这行输出，证明「另一个世界」活着。下一章监听网络流量的活儿，就派给它。

### 第二步：值得测的逻辑下沉 shared

贴角标要回答两个问题：哪些元素是推文？这条推文的链接是什么？这两件事不碰浏览器也能说清楚，所以写成纯函数放进 `src/shared/badge.js`，测试直接喂假数据就能验证。整个模块一次给全：

```js
// src/shared/badge.js —— 角标的可测逻辑：找推文、提取推文链接（DOM 装配见 src/content/loader.js）

/** 已贴过角标的推文根元素会带上这个标记，重复扫描时跳过 @type {string} */
export const BADGE_ATTR = 'data-xvd-badge'

/**
 * 判断一个 href 是不是「这条推文」的链接：路径里出现 /status/ 加纯数字 id
 * @param {string} href
 * @returns {boolean}
 */
export function isStatusHref(href) {
  return /\/status\/\d+/.test(href)
}

/**
 * @typedef {{ querySelectorAll(selector: string): Iterable<any> }} QueryRootLike
 * @typedef {{ querySelector(selector: string): { getAttribute(name: string): string | null } | null }} QueryOneLike
 */

/**
 * 找出 rootLike 里所有还没贴过角标的推文根元素
 * @param {QueryRootLike} rootLike
 * @param {string} [selector] 推文根元素选择器，X 当前用 article[data-testid="tweet"]
 * @returns {any[]}
 */
export function findTweetArticles(rootLike, selector = 'article[data-testid="tweet"]') {
  return Array.from(rootLike.querySelectorAll(selector)).filter(
    (el) => !el.hasAttribute?.(BADGE_ATTR)
  )
}

/**
 * 从一条推文元素里提取它的链接（归一成绝对 URL），拿去当角标的悬停提示
 * @param {QueryOneLike} articleLike
 * @param {string} base 页面当前地址，用于把相对 href 补全成绝对 URL
 * @returns {string | null}
 */
export function tweetLinkFrom(articleLike, base) {
  const a = articleLike.querySelector('a[href*="/status/"]')
  const href = a?.getAttribute('href') ?? ''
  return isStatusHref(href) ? new URL(href, base).href : null
}
```

三个函数各有分工。`isStatusHref` 认 URL 形态：X 的推文链接都带 `/status/` 加一串数字 id。`findTweetArticles` 用页面自带的 `querySelectorAll` 找推文根元素，并跳过贴过角标的——`data-xvd-badge` 标记防重复。`tweetLinkFrom` 在推文里找第一个 `/status/` 形态的链接，用 `new URL(href, base)` 把相对地址补全成绝对 URL。注意它们都不认识 `document`：DOM 能力一律从参数进来。这是全书贯穿的约定——**值得测的逻辑必须住在测试喂得到的地方，装配层越薄越好。**

### 第三步：装配层贴角标

```js
// 拼版·教学示意：loader.js 在第 1 章末的初始形态（纯贴角标装配，可测逻辑在 src/shared/badge.js）。
// 第 4 章它长出落盘监听、第 5 章重写为动态 import 入口，终态全文见第 5 章「演练」一节。
import { BADGE_ATTR, findTweetArticles, tweetLinkFrom } from '../shared/badge.js'

const LABEL = '视频下载器'

for (const article of findTweetArticles(document)) {
  const link = tweetLinkFrom(article, location.href)
  if (!link) continue

  const badge = document.createElement('span')
  badge.textContent = LABEL
  badge.title = link
  badge.setAttribute(
    'style',
    'display:inline-block;margin:6px 0 0 48px;padding:2px 8px;' +
      'border-radius:10px;background:#1d9bf0;color:#fff;font-size:12px;line-height:16px;'
  )
  article.setAttribute(BADGE_ATTR, link)
  article.appendChild(badge)
}
```

真正的 DOM 代码只有这十来行：遍历推文、造一个 `span`、挂上悬停提示、打防重复标记、追加进推文。样式是内联的——零构建的工程，少一个文件是一份清净。样式里那抹蓝 `#1d9bf0` 是 X 的品牌蓝：贴在别人的页面上，总得入乡随俗。

### 第四步：先猜，再跑测试

companion 里已备好本章测试。跑之前先猜两题：

1. `isStatusHref('/somebody/status/abc')` 返回 `true` 还是 `false`？
2. manifest 把 `matches` 改成 `https://example.com/*`（先别真改），x.com 上还会有角标吗？

在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`——测试按章只增不改，全书每章一个测试文件、每个文件一行；本章的 8 个就在 `tests/01-mv3-anatomy.test.js` 那行：4 条断言 manifest 骨架（V3、名字与版本、注入范围、后台文件真实存在），4 条断言 badge 逻辑。上面两题的答案就藏在里面：`abc` 不是数字，`false`；报备范围之外没有注入，没有角标。

## 验证：把它装进浏览器

测试绿只证明逻辑对；插件终究是装给浏览器用的。这一步的官方说法叫装载未打包扩展（load unpacked）——开发阶段的装载方式：把一个本地文件夹直接挂进浏览器，不用上传商店。逐条来：

- [ ] 在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`（全书累计口径）；`tests/01-mv3-anatomy.test.js` 那行应显示 (8 tests)。
- [ ] 打开 `chrome://extensions`，打开右上角「开发者模式」开关：页面顶部应出现「加载已解压的扩展程序」按钮。
- [ ] 点击该按钮，选中 companion 目录本身（不是它的上级，也不是 `src`）：列表应出现「X 视频下载器（教学版）」卡片，卡片上应看不到红色 Errors 字样。
- [ ] 打开或刷新 `https://x.com` 并登录：时间线前几条推文的左下角（转发、点赞那一排附近）应出现蓝底白字的「视频下载器」角标。若一枚都没有，多半是时间线还没渲染完——稍等几秒再刷新一次。
- [ ] 鼠标悬停在某枚角标上停一秒：应看到一条提示气泡，内容是这条推文的完整链接（含 `/status/` 和一串数字）。
- [ ] 回到 `chrome://extensions`，点击插件卡片上的「service worker」蓝色链接：打开的 DevTools Console 应显示一行 `[xvd] service worker 已启动`。
- [ ] 先猜后跑：把 manifest 里 `matches` 的 `https://x.com/*` 改成 `https://example.com/*`，在扩展卡片点刷新图标，再刷新 x.com。页面上应看不到任何角标。改回原值、两处再刷新，角标应重新出现。

最后一条如实地消失又回来，你就亲手验证了本章的核心命题：**注入范围由 manifest 报备决定，浏览器照单执行。**

## 收束

现在可以回答开篇了：那枚角标从哪来？manifest.json 报备范围，浏览器点头放行，content script 被放进 x.com 的页面，纯函数认出推文，装配层把角标贴上去。没有魔法，只有一条报备过的正式通道，和两个各司其职的世界。

留一个现象给你：往下滚两屏，新加载出来的推文上一枚角标都没有；点进一条推文再返回，新出现的也一样。X 是单页应用——只加载一次页面的应用，之后所有「翻页」都是 JS 换 DOM，浏览器从不重新加载。而 content script 只在页面加载时跑一次，新长出来的推文没人管。谁来贴角标？这个问题第 5 章解决——那时你会给 DOM 装上监控摄像头。

### 自查

1. 为什么贴角标的逻辑放在 `src/shared/badge.js`，而 `loader.js` 里几乎只剩装配？把逻辑写进 loader 会失去什么？
2. 预测：把 `sw.js` 里的 `console.log` 删掉、留一个只剩注释的文件，插件还能装载吗？角标还会出现吗？
3. 想让「点击角标」就触发一次后台下载：这行点击监听代码该写进哪个文件？下载那个动作又为什么没法写进同一个文件？

::: details 参考答案
1. 测试跑在 Node 里，没有页面。纯函数加「DOM 能力从参数注入」，测试才能直接喂假数据；逻辑沉进 loader，就只能在真实浏览器里人肉验证。
2. 能装载，角标照常出现。manifest 只要求 `background` 指向一个真实存在的合法脚本文件，只剩注释也是合法的；本章贴角标从头到尾不经过后台。
3. 监听写在 `src/content/loader.js`——点击发生在页面的 DOM 上，只有页面世界摸得到。下载要调 `chrome.downloads`，那是浏览器级 API，只在 service worker 世界里存在，content script 直接调不到（它直接可用的只有 `chrome.runtime`、`chrome.storage` 等寥寥几个）。跨世界协作靠消息传递：前台 `chrome.runtime.sendMessage` 发出、后台监听——第 5 章会把这条线接通。
:::
