---
title: 权限的代价：CSP、CORS 与上架清单
---

# 权限的代价：CSP、CORS 与上架清单

结账之前，先把三章里攒下的欠条摆上桌。第 2 章说：MV2 时代 webRequest 还能拦改请求，为什么 MV3 只留了观察？第 4 章说：host_permissions 与 CORS 豁免的完整规则，第 6 章算清。第 5 章说：storage 权限与 web_accessible_resources 每个值一句「凭什么」，权限总账一并算清。这一章三张欠条一起清，清完把整本书压成一个能上架的 zip。

先看两个现象。第一个你大概撞见过：插件下架在视频下载类工具里是家常便饭，商店里这一类插件隔三差五消失。知名下载器 SaveFrom.net Helper 在 2025 年末又下架了一次——公开报道里它已是惯犯，每次都倒在政策审查上。第二个更久远：2019 年 6 月，Chromium 官方博客发了一篇解释文章，宣布 Manifest V3 将用新的声明式 API 取代 webRequest 的拦截能力。文章发出去的几周里，整个广告拦截插件社区震动——uBlock Origin 的作者公开批评，EFF——电子前沿基金会，一个知名的数字权利组织——连发多篇文章反对。两年半后它还在发，标题是《Google's Manifest V3 Still Hurts Privacy, Security, and Innovation》。这场战争打了七年：2021 年 1 月 MV3 随 Chrome 88 转正；2024 年 10 月 9 日 Google 官方博客宣布开始在正式版禁用 MV2 扩展，uBlock Origin 的 MV2 版随之对数千万用户失效；按官方时间表，2026 年 8 月 31 日——就在你读这一章的这周——商店里剩余的 MV2 扩展全部移除。

这就是「blocking webRequest 被砍」事件的上半场：Google 动了插件的万能钥匙，整个依赖它的社区原地爆炸。下半场在本章中段。但先回答一个更近的问题——这一切跟你有什么关系？关系在 manifest 里。**你的 manifest 每多要一项权限，用户和商店都会多问一句：凭什么。**答不上的那项，就是下一次下架名单上的一项。本章做的事：把全书 manifest 的每一项逐个过堂，写一个核对脚本机械地问「凭什么」，最后打包出商店认的 zip。

## manifest 是公示文件，不是内部配置

你可能以为权限弹窗只是走过场——用户闭眼点「添加扩展程序」，要什么权限根本没人看。半对半错：用户确实常闭眼，但商店不闭眼，而且用户睁眼时看得一清二楚。manifest 里的每一项权限都会翻译成公示语句，印在安装确认弹窗与已装扩展的详情页里。你随时可以亲手验证：在 chrome://extensions 打开任一已装扩展的「详情」，权限区逐条列在那里——公示句读起来像「读取和更改你访问的所有网站上的数据」这样。要了 `"`<all_urls>`"` 这种全站权限，公示句会吓到人；要了用不上的权限，审核员会问；问了答不上，轻则拒审重则下架。过度索权是插件遭拒审乃至下架的常见原因——不是理论风险，是商店日常。

所以这一章的立场叫权限最小化——只报备功能真正用到的最小能力集，多一项都是负债。它不是道德姿态，是三笔实打实的账：用户侧，公示句越短越敢装；审核侧，每项权限都要答得出用途；安全侧，权限就是插件的爆炸半径——扩展失守时，损失范围就是它要到的权限划定的范围，官方权限文档的最小权限原则正建立在这笔账上。

最小化靠感觉不行，得靠核对。本章的验证物就是一台对账机：manifest 每项能力，要么在代码里找到使用证据，要么红。先看清核对的对象——全书 manifest 终态，与 `companion/manifest.json` 逐字一致：从第 1 章的长出来，到第 5 章封顶，本章一字未动。

```jsonc
// companion/manifest.json —— 全书终态：权限审计的唯一对象（第 6 章起不再演进）
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

十项在册能力：`permissions` 三项、`host_permissions` 两项、`action` 一项、web_accessible_resources（下表简称 WAR）四个文件。逐项凭什么，下面三节算清。

## 万能钥匙被收走：MV3 砍掉 blocking webRequest 的来龙去脉

先看砍掉的到底是什么。MV2 时代，`chrome.webRequest` 的监听器可以带 `"blocking"`——你的 JS 站在每一条网络请求的路上，同步决定放行、取消、改写或重定向。

```js
// 用法示例：MV2 时代的阻断写法（companion 是 MV3，仓里没有这段——它就是被砍的那种代码）
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (adServerRe.test(details.url)) {
      return { cancel: true } // 拦下这条请求——广告拦截器的心脏就是这个返回值
    }
    return {} // 放行
  },
  { urls: ['<all_urls>'] },
  ['blocking'] // 第三个参数：申请阻断权——每个请求都停下来等你的 JS 表态
)
```

这就是万能钥匙：全浏览器的每一条请求，都同步路过你的代码。广告拦截器靠它活着；间谍软件也靠它——看尽一切流量，随手改掉任何响应。Google 给出的砍除理由落在两头：性能（每条请求都要停下来跑一遍扩展 JS，浏览器被拖慢）与隐私安全（这个能力遭滥用的面太大）。官方迁移文档的原话：「We are deprecating the blocking capabilities of the webRequest API」。为什么砍？原话核心是「to improve the privacy, security, and performance」——宾语 the extensions ecosystem，插件生态。落到中文：隐私、安全、性能，三头都为生态。

拦改的活没有消失，换了雇主：declarativeNetRequest（声明式网络请求，简称 DNR）。你的 JS 不再站在路上，而是事先把规则表交给浏览器，由浏览器原生代码逐条匹配执行。同样是「屏蔽某域的请求」，MV3 的写法是一份数据：

```jsonc
// 用法示例：DNR 静态规则——同一件事，从「每次请求回调你的 JS」变成「浏览器查一张表」
[
  {
    "id": 1,
    "priority": 1,
    "action": { "type": "block" },
    "condition": { "urlFilter": "||ads.example", "resourceTypes": ["script", "image"] }
  }
]
```

代价与收益都在「声明式」三个字里。收益：浏览器批量执行规则，快；规则是静态数据，审核看得懂。代价：规则必须在装货前写好，做不到「等页面 JS 告诉我这条请求该不该拦」——广告拦截社区炸的就是这一条。EFF 的原话只有一句：「We reject declarativeNetRequest as a replacement for blocking webRequest」。他们的理由：DNR 表达不了 blocking webRequest 的全部能力，不配当替代品。技术上这个判断至今成立——uBlock Origin 的 MV3 版（uBlock Origin Lite）能力确实不如 MV2 版。战争还是打完了。

最后落到你身上。MV3 的文档写明：`webRequestBlocking`「is only available to policy installed extensions」。翻译过来：只剩企业策略安装的扩展能阻断。豁免口子也写在原文里——「granted access via the waiver process」（获豁免审批的新扩展）。普通扩展的 webRequest 只剩一种用法：观察。而我们的插件从第 2 章起就只观察——`onBeforeRequest` 看见视频地址，记账，从不返回 cancel。**那一刀砍的是拦改，不是观察；我们从头就站在没被砍的那半边。**这不是运气，是选型时就把「下载器要的是看见流量，不是改写流量」想清楚了——权限最小化在 API 选择上的投影。

## host_permissions 与 CORS 豁免：完整规则

第 4 章抓分片时说过一句话先欠着：SW 里的 `fetch` 不受跨域限制，凭的是 host_permissions。现在把完整规则摆出来。先回忆网页世界的 CORS（跨源资源共享）：网页 JS 向别的域发请求，对方不点头（响应头没说允许），浏览器就把结果扣下。写网页被 CORS 教育过的人，会以为这条规矩天下通用。插件世界恰恰在这件事上开了口子——但只开在一边。

| 请求从哪发出 | 跨域规则 |
| --- | --- |
| 网页 JS，包括 content script | 永远按同源策略走。host_permissions 不给页面世界开后门 |
| 扩展进程（service worker、扩展页） | 对 host_permissions 报备过的站点，fetch 豁免 CORS |

第二行是第 4 章管线的地基：m3u8 与分片都住 `video.twimg.com`，我们的 SW 对它 fetch，不用 twimg 点头——因为 manifest 替我们提前报备过。第一行是很多插件的坑：在 content script 里直接 fetch 外域，照样撞 CORS 墙。官方文档的原话：「Cross-origin requests are always treated as such in content scripts」。后半句在同页：「even if the extension has host permissions」。翻译：content script 里的跨域请求永远按跨域对待，报备了也不豁免。页面世界永远按网页的规矩来。所以跨域抓取要递消息回 SW，让扩展进程出手。这也补上了第 4 章欠条的另一半：抓取全程住 SW，不只因为它没有 DOM 限制，还因为跨域豁免只在那一侧生效。

host_permissions 自己还有一条容易漏的规则，第 2 章用过但没展开：**要观察一条请求，得同时握住请求的目标站与发起方两个域的权限。**官方 webRequest 文档的规则从 Chrome 72 起生效：要拦看一条请求，host permissions 得同时盖住请求的 URL 与发起方。原文的关键句是「both the requested URL and the request initiator」。为什么有这条规则？做个反事实：只报 twimg 不报 x.com，你照样能看见所有网站（不止 X）向 twimg 发的请求——在别的网站上你的插件突然能看见一部分流量，这扇后门太大。Chrome 72 的两站规则把观察范围钉死成「你的地盘上发生的、跟你报备过的目标站的」请求。演算一遍我们的场景：x.com 的页面（发起方）向 video.twimg.com（目标站）要 m3u8，需要两项权限——`https://x.com/*` 与 twimg。恰好就是 manifest 里的那两项，一项不多。

写这些模式要守一套语法（匹配模式，match patterns），规则不长：

- 三段式：`scheme://host/path`，缺一不可——path 哪怕是通配 `/*` 也要写；
- scheme 本课只用到 `http`、`https` 与 `*`（http/https 都匹配）；语法还认 `file` 等，但 host 权限里它要用户另行授权，本课不碰；
- host 的 `*` 只能出现在开头当子域通配：`*.twimg.com` 合法，`video.*.com` 不合法；
- path 在 host_permissions 里被浏览器忽略，报备站点级权限时惯例写 `/*`；
- `<all_urls>` 是全通配——能不用就不用，它是商店审核的高危信号。

照这套语法，我们两项各自的凭什么。`https://x.com/*`——发起方权限，只为看见请求，协议收死 https（X 全站 https，多报协议就是多要）；`*://*.twimg.com/*`——目标站权限兼 fetch 豁免依据，域收死 twimg 子域，协议放宽一档给 http 留余量。为什么协议敢放宽：视频地址从页面流量里来，协议不由我们定；域不放宽，放宽协议不扩大站点面。

还剩一个悬了五章的细节：`twitter.com` 为什么在两处 matches 里报备，却不在 host_permissions？因为它们报备的不是同一种东西。`matches` 报备的是「往哪些页面注入代码」——这就是注入的全部手续，不需要 host_permissions 配合；host_permissions 报备的是「读哪些流量、跨域取哪些数据」。旧链接落到 twitter.com 域时按钮要照样出现，所以它在注入清单里；但视频流量的发起方与目标都不在 twitter.com 名下（它只是重定向跳板），要它的站点权限没有任何用途——按最小化原则，不给。

## 全书权限总账：十项，各有凭什么

现在逐项过堂。表格是索引，每项的「机械证据」就是本章核对脚本在源码里找的东西。

| 项 | 引入 | 凭什么 | 机械证据 |
| --- | --- | --- | --- |
| `webRequest` | 第 2 章 | 观察视频请求（MV3 只剩这种用法） | sw.js 注册 `chrome.webRequest.onBeforeRequest` |
| `downloads` | 第 4 章 | mp4 直链一行落盘 | sw.js 调 `chrome.downloads.download` |
| `storage` | 第 5 章 | 对号账本活过 SW 休眠（storage.session，重启才清） | sw.js 读写 `chrome.storage.session` |
| `action` | 第 4 章 | 工具栏入口引入；第 5 章入口搬到推文按钮，图标保留指路 | sw.js 仍注册 `chrome.action.onClicked` |
| `https://x.com/*` | 第 2 章 | 发起方权限（两站规则的前一半） | 监听过滤器里有这个模式 |
| `*://*.twimg.com/*` | 第 2 章 | 目标站权限 + fetch 跨域豁免（后一半） | 监听过滤器里有这个模式 |
| WAR · `main.js` | 第 5 章 | loader 动态 import 的装配模块 | 装配链 import 闭包里有它 |
| WAR · `button-state.js` | 第 5 章 | main.js import 的状态机 | 同上 |
| WAR · `badge.js` | 第 5 章 | main.js import 的链接归一 | 同上 |
| WAR · `messages.js` | 第 5 章 | main.js import 的协议表（bytesB64 的渡船也住这） | 同上 |

第 5 章欠的「一句凭什么」补齐在最后四行：web_accessible_resources 的每个值，凭「装配链真的要 import 它」。这扇门默认关死（第 5 章说过，防网页探测插件指纹），开口的粒度是单个文件。所以每个文件都得是「页面世界真的要 import 的那一个」，四个不多不少：少一个，main.js 的某条 import 在页面世界里 404，按钮全灭；多一个（比如把 sw.js 也塞进去），没人用它，纯增加被探测面。

总账里还有一个反面的教训值得单说：代码里出现得最多的 chrome API，恰恰不在账上。`chrome.tabs.sendMessage` 在 sw.js 里递消息给页面——不需要 `tabs` 权限。官方规则：`tabs` 权限只管读标签页的敏感信息（url、title、图标）；sendMessage 只需要一个标签页编号，不碰敏感字段。写网页的直觉会说「我用了 tabs API，得报 tabs 权限」——报了就是过度索权，公示句里多一句吓人的「读取你的浏览记录」。最小化的一半功夫在「每项都有用」，另一半在「没用的不报」。

表里两项只有一行账的，这里各补两句。`downloads`：它的公示句是「管理你的下载」——引入动机是 mp4 直链那「一行落盘」；HLS 的整段字节走页面侧 a[download]，不占这把钥匙。两条落盘路径各用各的钥匙，谁也不替谁多要。`action`：第 4 章为工具栏入口引入，第 5 章入口搬进推文按钮后它退役成一句指路日志。声明保留是刻意的：这个工程从第 1 章起测试只增不改（append-only），删声明就得连旧章断言一起改——账本「只增不破」的规矩比省一行 manifest 值钱；真上架若不要工具栏入口，删声明、改断言、重跑核对脚本，一步都不能省。

## CSP：只许跑包里的代码

新概念登场：CSP（内容安全策略）——Content Security Policy，一份「只允许从哪加载什么」的白名单。网页世界它由服务器响应头下发；插件世界它内置在平台里，manifest 可以收紧、不许放宽。

MV3 给扩展页面划了条只能收紧、不能放宽的线。脚本与插件资源只许来自扩展自己——`script-src` 收在 `'self'` 一族，`object-src 'self'`；`unsafe-eval`、远程地址一律写不进去。官方文档明说这是下限（minimum）：写宽直接报错，再紧随你。配合另一条铁律——远程代码禁令：扩展的全部逻辑必须在包里。官方原话：「all of your extension's logic must be part of the extension package」。

为什么卡这么死？看洞是怎么开的。MV2 时代 CSP 宽松，插件可以引用远程脚本。于是出现一种玩法：送审的版本干干净净，过审后从远程拉一包恶意代码进来——审核审的是包裹 A，跑起来的是包裹 B。商店的人工审核再严，也追不上运行时才到达的代码。MV3 把这个洞焊死：**审核过的就是跑着的。**反事实检验：没有这条禁令，下架了的恶意插件把代码挪到自家服务器，商店下架形同虚设——有了它，包被移除，代码就没了着落。

对我们意味着什么？几乎零成本，因为本书从第 1 章就选了零构建、零运行时依赖：src 全本地、无 CDN、无 eval、无远程脚本。当时是为了让 companion 目录直接可装载；到上架这一步，同一选型直接满足 CSP 与远程代码禁令。你可以亲手感受这条防线：在 Console 里对任何扩展页面 fetch 一段远程脚本再 eval，控制台当场报 CSP 拒绝。

## 打包 zip 与上架清单

最后一站：把这本书变成一个 zip。打包 zip——把扩展目录压成 Chrome Web Store 唯一认的归档格式，manifest.json 必须在压缩包根上（不能套一层文件夹）。上架流程四步：注册开发者账号（一次性 5 美元注册费，官方明码标价，交完终身有效）；上传 zip；填商店资料（截图、描述、隐私政策）；等审核——自动扫描加人工审查。

人工审查的三条常见红线，本插件逐条对表。单一用途政策（single purpose）：官方要求扩展能用一句话讲清唯一的用途——「下载你在 X 上有权保存的视频」恰好是一句话。权限最小化：本章核对脚本全绿的那张对账表，就是提交时的底气。代码合规：CSP 与远程代码禁令，上一节刚过。

第四条红线要诚实交代：版权。商店政策不允许扩展协助下载无权保存的内容，视频下载类插件是重点关照对象——SaveFrom.net Helper 的反复下架就是前车之鉴。本插件拿去真上架，大概率倒在这条上，这是课程设计时就接受的边界：我们止步于「上架形状的完整演练」——zip 是真 zip、清单是真清单、核对是真核对——发布渠道则留在自己手里（装载自用）。这也是本章的法律边界，与第 1 章的约定一字不差：

> 本课程仅用于学习浏览器扩展开发：请只下载你拥有版权或已获明确授权的内容，遵守 X 服务条款与当地著作权法。

## 演练：核对脚本先红后绿

目标形态三件新东西，全在 `companion/scripts/`：`audit-rules.mjs`（纯规则）、`audit-manifest.mjs`（对账 CLI）、`package.mjs`（打包）。manifest 与 src 一行不动——本章的演进全在验证侧，这正是审计的性质：受审对象不变，审判标准建成代码。

### 第一步：测试，先看红

测试断言规则函数本身：权限双向对账、host 通配覆盖、WAR 闭包、打包取舍，最后拿真仓终态跑一遍全家桶。先看头部与真仓组：

```js
// tests/06-permissions-publish.test.js —— 第 6 章：权限的代价（CSP、CORS 与上架清单）
// 断言五组事：权限对账成立——auditPermissions 双向核对，报备了没人用的「多余」与用了没报备的
// 「缺失」都当场红（商店审核要问的「凭什么」，上架前先被自己的脚本问一遍；chrome.tabs.sendMessage
// 这类不需要 permissions 的调用不在账上，不算漏报）；host 对账成立——patternCovers 的协议/子域通配
// 规则要盖得住监听过滤器里的每个模式，盖不住任何流量的站点权限算多余；action 对账成立——
// manifest 声明与代码注册互为充要；WAR 对账成立——从 loader 出发的 import 闭包恰好等于
// web_accessible_resources 报备清单（少一项页面加载失败、多一项白暴露、门开到没注入的域算越界）；
// 打包清单成立——selectZipFiles 只放行 manifest.json 与 src/，测试与工具链文件一律进不了 zip。
// 最后拿真仓终态跑一遍全家桶：manifest 十项能力逐项对上号、零 finding。
// 规则全是纯函数：fixture manifest 与假源码文本从参数注入——不碰真实文件系统、不碰网络、不 sleep。

import { describe, it, expect } from 'vitest'
import manifest from '../manifest.json'
import swJs from '../src/background/sw.js?raw'
import loaderJs from '../src/content/loader.js?raw'
import mainJs from '../src/content/main.js?raw'
import buttonStateJs from '../src/content/button-state.js?raw'
import badgeJs from '../src/shared/badge.js?raw'
import messagesJs from '../src/shared/messages.js?raw'
import videoUrlJs from '../src/shared/video-url.js?raw'
import m3u8Js from '../src/shared/m3u8.js?raw'
import downloadJs from '../src/shared/download.js?raw'
import {
  patternCovers,
  auditPermissions,
  auditHosts,
  auditAction,
  auditWar,
  auditManifest,
  importClosure,
  selectZipFiles,
} from '../scripts/audit-rules.mjs'

/** 真仓全部源码：相对扩展根的路径 → 文本（auditManifest / importClosure 的 files 形参） */
const REAL_FILES = {
  'src/background/sw.js': swJs,
  'src/content/loader.js': loaderJs,
  'src/content/main.js': mainJs,
  'src/content/button-state.js': buttonStateJs,
  'src/shared/badge.js': badgeJs,
  'src/shared/messages.js': messagesJs,
  'src/shared/video-url.js': videoUrlJs,
  'src/shared/m3u8.js': m3u8Js,
  'src/shared/download.js': downloadJs,
}

describe('真仓终态：全书权限总账', () => {
  it('auditManifest 零 finding：permissions 三项、host 两项、action、WAR 四文件全部对上号', () => {
    const { findings } = auditManifest(manifest, REAL_FILES)
    expect(findings).toEqual([])
  })

  it('importClosure：从 loader 出发的闭包恰好是 WAR 报备的四个文件（入口自己不算——声明式注入不走网页门）', () => {
    expect(importClosure(REAL_FILES, ['src/content/loader.js'])).toEqual([
      'src/content/button-state.js',
      'src/content/main.js',
      'src/shared/badge.js',
      'src/shared/messages.js',
    ])
  })
})
```

fixture 组的样子，以权限对账为例——好账坏账都造一遍：

```js
// tests/06-permissions-publish.test.js —— fixture 组节选：双向对账（多余与缺失各造一个）
describe('auditPermissions：报备了没人用算多余，用了没报备算缺失', () => {
  it('真仓代码 + 真仓 manifest：零 finding——三项权限各有 chrome.* 调用对上号', () => {
    expect(auditPermissions(manifest, Object.values(REAL_FILES).join('\n'))).toEqual([])
  })

  it('多余：permissions 里塞 "tabs"（代码从不碰 chrome.tabs）→ 指名 tabs 的多余 finding', () => {
    const planted = { ...manifest, permissions: [...(manifest.permissions ?? []), 'tabs'] }
    const findings = auditPermissions(planted, Object.values(REAL_FILES).join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('多余')
    expect(findings[0]?.item).toContain('tabs')
  })

  it('缺失：代码用 chrome.storage.session 但 manifest 不报 storage → 指名缺失', () => {
    const stripped = { ...manifest, permissions: ['webRequest', 'downloads'] }
    const findings = auditPermissions(stripped, Object.values(REAL_FILES).join('\n'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('缺失')
    expect(findings[0]?.item).toContain('storage')
  })

  it('chrome.tabs.sendMessage / chrome.runtime 不在账上：代码只有这类调用时，permissions 空着也零 finding', () => {
    const code = 'chrome.tabs.sendMessage(1, { hi: 1 })\nchrome.runtime.onMessage.addListener(() => {})'
    expect(auditPermissions({ permissions: [] }, code)).toEqual([])
  })
})
```

在 companion 目录跑 `pnpm test`：本章 18 个测试整组失败，报 `Cannot find module '../scripts/audit-rules.mjs'`——规则模块还不存在，前五章 58 个照旧绿。`pnpm run package` 同样报模块缺失。这是本章的红，两件验证物一起红。

### 第二步：规则做成数据——audit-rules.mjs

规则的骨架是两张账本加一组探针。账本记「凭什么」，探针在源码文本里找「真的在用」。

```js
// companion/scripts/audit-rules.mjs —— manifest 权限核对的规则表与纯函数（CLI 与测试共用；不含任何 I/O）
// 第 6 章的验证物：商店审核会问「这个权限凭什么」，上架前先被自己的脚本问一遍。
// 每条规则双向对账——报备了没人用算「多余」（过度索权），用了没报备算「缺失」（运行时被拒）。
// 纯逻辑全部住在这里：audit-manifest.mjs 负责读文件与打印，测试直接喂 fixture manifest 与源码文本。

/** 核对结论里的一条 @typedef {{ kind: '多余' | '缺失' | '越界', item: string, detail: string }} Finding */

/**
 * permissions 逐项账：manifest 里报备的每个 API 权限，都必须对上代码里真实的 chrome.* 调用。
 * probe 是代码证据探针——在 src/ 全部源码拼成的文本里找不到匹配，这项权限就答不上「凭什么」
 * @type {Record<string, { chapter: number, why: string, probe: RegExp }>}
 */
export const PERMISSION_LEDGER = {
  webRequest: {
    chapter: 2,
    why: '被动监听视频请求：onBeforeRequest 只观察不拦改（MV3 里 webRequest 只剩这种用法）',
    probe: /chrome\.webRequest\./,
  },
  downloads: {
    chapter: 4,
    why: 'chrome.downloads.download 落盘 mp4 直链',
    probe: /chrome\.downloads\./,
  },
  storage: {
    chapter: 5,
    why: 'storage.session 对号账本——SW 休眠不死、浏览器重启才清',
    probe: /chrome\.storage\./,
  },
}

/**
 * host_permissions 逐项账：why 给人读（覆盖哪个流量、豁免哪条跨域）；
 * 机械证据由 auditHosts 另行核验——每个模式必须盖得住代码里出现过的监听过滤器
 * @type {Record<string, { chapter: number, why: string }>}
 */
export const HOST_LEDGER = {
  'https://x.com/*': {
    chapter: 2,
    why: '请求的发起方在 x.com——Chrome 72 起要同时握住目标站与发起方才看得见流量',
  },
  '*://*.twimg.com/*': {
    chapter: 2,
    why: '视频真身在 twimg：监听目标站，也是 SW fetch 抓清单/分片的跨域豁免依据（协议放宽一档，域不放宽）',
  },
}
```

host 覆盖的判定是本章最细的纯函数——通配规则做进数据流。

```js
// companion/scripts/audit-rules.mjs —— patternCovers：宽模式盖不盖得住窄模式
/**
 * 把「<scheme>://<host>/<path>」形态的匹配模式拆成三段里的前两段。
 * 拆不动（如 <all_urls>、file:///）返回 null——那类形态本课用不到，交给人工核对
 * @param {string} pattern
 * @returns {{ scheme: string, host: string } | null}
 */
export function parsePattern(pattern) {
  const m = /^(\*|https?):\/\/([^/]+)\//.exec(pattern)
  return m === null ? null : { scheme: m[1], host: m[2] }
}

/**
 * 宽模式能否盖住窄模式。scheme：'*' 吃任何具体协议，具体协议吃不了 '*'；
 * host：相等，或宽端 '*.domain' 形态吃窄端的裸域与子域；路径不参与——host_permissions 里路径本就被忽略
 * @param {string} wide
 * @param {string} narrow
 * @returns {boolean}
 */
export function patternCovers(wide, narrow) {
  const w = parsePattern(wide)
  const n = parsePattern(narrow)
  if (w === null || n === null) return wide === narrow
  if (w.scheme !== '*' && w.scheme !== n.scheme) return false
  return hostCovers(w.host, n.host)
}

/** host 段的覆盖判定：通配只认 '*.domain' 前缀形态（匹配模式语法本就只允许这一种） */
function hostCovers(wide, narrow) {
  if (wide === narrow) return true
  if (wide.startsWith('*.')) {
    const base = wide.slice(2)
    if (narrow.startsWith('*.')) return narrow.slice(2) === base
    return narrow === base || narrow.endsWith('.' + base)
  }
  return false
}
```

对账函数都是同一形状：吃 manifest 与代码文本，吐 finding 数组。以 permissions 为例——hosts、action 同构，都在同一文件。

```js
// companion/scripts/audit-rules.mjs —— auditPermissions：双向对账
/**
 * permissions 对账：manifest 报备的每项必须有代码证据；代码碰过的账内 API 必须已报备。
 * 账外命名空间（chrome.tabs / chrome.runtime / chrome.action 这类不需要 permissions 的调用）不算账
 * @param {Record<string, unknown> & { permissions?: string[] }} manifest
 * @param {string} code src/ 全部源码拼成的文本
 * @returns {Finding[]}
 */
export function auditPermissions(manifest, code) {
  const findings = []
  const declared = manifest.permissions ?? []
  for (const p of declared) {
    const ledger = PERMISSION_LEDGER[p]
    if (ledger === undefined) {
      findings.push({
        kind: '多余',
        item: `permissions: ${p}`,
        detail: '规则表里没有它的用途账——要么补账，要么删掉',
      })
      continue
    }
    if (!ledger.probe.test(code)) {
      findings.push({
        kind: '多余',
        item: `permissions: ${p}`,
        detail: `报备了但代码不碰 chrome.${p}——商店审核问「凭什么」时答不上`,
      })
    }
  }
  for (const [api, ledger] of Object.entries(PERMISSION_LEDGER)) {
    if (ledger.probe.test(code) && !declared.includes(api)) {
      findings.push({
        kind: '缺失',
        item: `permissions: ${api}`,
        detail: `${ledger.why}——用了没报备，运行时直接被拒`,
      })
    }
  }
  return findings
}
```

WAR 的对账最有味道——「报备清单是否恰好」不用人眼盯，从 loader 出发算 import 闭包。

```js
// companion/scripts/audit-rules.mjs —— importClosure 与 auditWar：报备清单 = 装配链闭包
/**
 * 从 content_scripts 入口出发算 import 闭包：loader 的动态 getURL import、模块的静态 import 都算边。
 * 返回「被 import 拉进来的全部文件」——入口本身不算（声明式注入不走网页门，不需要报备）
 * @param {Record<string, string>} files 相对扩展根的路径 → 源码文本
 * @param {string[]} entries content_scripts[].js 入口清单
 * @returns {string[]}
 */
export function importClosure(files, entries) {
  const seen = new Set()
  const queue = [...entries]
  while (queue.length > 0) {
    const cur = /** @type {string} */ (queue.shift())
    if (seen.has(cur) || !(cur in files)) continue
    seen.add(cur)
    queue.push(...importEdges(files[cur], cur))
  }
  for (const e of entries) seen.delete(e)
  return [...seen].sort()
}

/**
 * web_accessible_resources 对账：报备清单必须恰好等于装配链的 import 闭包。
 * 缺一项页面世界里 import 404、装配模块加载失败；多一项是白暴露（网页能借此探测扩展）；
 * matches 超出 content_scripts 注入范围算越界——门开到了没人看守的地方
 * @param {{ content_scripts?: { js?: string[], matches?: string[] }[], web_accessible_resources?: { resources?: string[], matches?: string[] }[] }} manifest
 * @param {Record<string, string>} files
 * @returns {Finding[]}
 */
export function auditWar(manifest, files) {
  const findings = []
  const injectMatches = (manifest.content_scripts ?? []).flatMap((cs) => cs.matches ?? [])
  const entries = (manifest.content_scripts ?? []).flatMap((cs) => cs.js ?? [])
  const needed = importClosure(files, entries)
  const granted = (manifest.web_accessible_resources ?? []).flatMap((w) => w.resources ?? [])
  for (const res of needed) {
    if (!granted.includes(res)) {
      findings.push({
        kind: '缺失',
        item: `web_accessible_resources: ${res}`,
        detail: '装配链 import 了它但没报备——页面世界里 404，模块加载失败',
      })
    }
  }
  for (const res of granted) {
    if (!needed.includes(res)) {
      findings.push({
        kind: '多余',
        item: `web_accessible_resources: ${res}`,
        detail: '没人 import 它——网页多探得到一个扩展文件，白暴露',
      })
    }
  }
  for (const w of manifest.web_accessible_resources ?? []) {
    for (const m of w.matches ?? []) {
      if (!injectMatches.includes(m)) {
        findings.push({
          kind: '越界',
          item: `web_accessible_resources matches: ${m}`,
          detail: '这个域不在 content_scripts 注入范围里——门开到了没人看守的地方',
        })
      }
    }
  }
  return findings
}
```

打包清单的取舍规则也是同文件里最短的一个纯函数——zip 只装扩展本体。

```js
// companion/scripts/audit-rules.mjs —— selectZipFiles：打包取舍
/**
 * 打包文件清单的取舍规则：扩展本体只有 manifest.json 与 src/。
 * 测试、fixture、脚本、依赖、构建产物、工程配置一律进不了 zip——商店上传的是扩展，不是工程
 * @param {string[]} paths companion 根下的全部相对路径（'/' 分隔）
 * @returns {string[]}
 */
export function selectZipFiles(paths) {
  return paths.filter((p) => p === 'manifest.json' || p.startsWith('src/'))
}
```

### 第三步：对账表 CLI——audit-manifest.mjs

CLI 只干三件事：读 manifest、把 src/ 收成「路径 → 文本」的表、跑规则打印对账结果。有任何 finding 就 `process.exit(1)`——挂进 CI，过度索权进不了包。

```js
// companion/scripts/audit-manifest.mjs —— 权限核对 CLI：manifest 每项能力对账「凭什么」，多余/缺失当场红
// 规则全在 audit-rules.mjs（纯函数，测试直接喂 fixture 验证）；本文件只读文件、拼源码、打印对账表。
// 退出码：全部对上号 0；有任何 finding 1——把它挂进 CI 或发布前自查，过度索权进不了包。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERMISSION_LEDGER, HOST_LEDGER, auditManifest } from './audit-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递式收 src/ 下全部文件（'/' 分隔的相对路径），排序保证两次运行清单一致 */
function walkSrc(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSrc(full))
    else out.push(full)
  }
  return out
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const srcFiles = walkSrc(join(ROOT, 'src'))
const files = {}
for (const full of srcFiles) {
  const rel = full.slice(join(ROOT).length + 1).replaceAll('\\', '/')
  files[rel] = readFileSync(full, 'utf8')
}

const { findings, checked } = auditManifest(manifest, files)

console.log('manifest 权限核对 —— companion/manifest.json（证据：src/ 全部源码）')
console.log('  permissions:')
for (const p of manifest.permissions ?? []) {
  const ledger = PERMISSION_LEDGER[p]
  console.log(`    √ ${p.padEnd(12)} 第 ${ledger?.chapter ?? '?'} 章 · ${ledger?.why ?? '（规则表外——人工核对）'}`)
}
console.log('    · chrome.tabs / chrome.runtime 出现在代码里但不需要 permissions（sendMessage 不读标签页敏感信息）')
console.log('  host_permissions:')
for (const h of manifest.host_permissions ?? []) {
  console.log(`    √ ${h.padEnd(22)} 第 ${HOST_LEDGER[h]?.chapter ?? '?'} 章 · ${HOST_LEDGER[h]?.why ?? '（账本外——人工核对）'}`)
}
console.log('  action:')
console.log('    √ action 在册：第 4 章工具栏入口引入，第 5 章入口搬到推文按钮，sw.js 仍注册 onClicked 指路')
console.log('  web_accessible_resources:')
for (const res of manifest.web_accessible_resources?.[0]?.resources ?? []) {
  console.log(`    √ ${res}（装配链 import 闭包恰好这四个文件，只对 X 两域开）`)
}

if (findings.length > 0) {
  console.log(`\n核对 ${checked} 项，${findings.length} 条不对账：`)
  for (const f of findings) console.log(`  × [${f.kind}] ${f.item} —— ${f.detail}`)
  process.exit(1)
}
console.log(`\n核对 ${checked} 项全对上号，无多余项`)
```

在 companion 目录跑 `node scripts/audit-manifest.mjs`，对账表如下。

```text
# companion 运行输出——node scripts/audit-manifest.mjs
manifest 权限核对 —— companion/manifest.json（证据：src/ 全部源码）
  permissions:
    √ webRequest   第 2 章 · 被动监听视频请求：onBeforeRequest 只观察不拦改（MV3 里 webRequest 只剩这种用法）
    √ downloads    第 4 章 · chrome.downloads.download 落盘 mp4 直链
    √ storage      第 5 章 · storage.session 对号账本——SW 休眠不死、浏览器重启才清
    · chrome.tabs / chrome.runtime 出现在代码里但不需要 permissions（sendMessage 不读标签页敏感信息）
  host_permissions:
    √ https://x.com/*        第 2 章 · 请求的发起方在 x.com——Chrome 72 起要同时握住目标站与发起方才看得见流量
    √ *://*.twimg.com/*      第 2 章 · 视频真身在 twimg：监听目标站，也是 SW fetch 抓清单/分片的跨域豁免依据（协议放宽一档，域不放宽）
  action:
    √ action 在册：第 4 章工具栏入口引入，第 5 章入口搬到推文按钮，sw.js 仍注册 onClicked 指路
  web_accessible_resources:
    √ src/content/main.js（装配链 import 闭包恰好这四个文件，只对 X 两域开）
    √ src/content/button-state.js（装配链 import 闭包恰好这四个文件，只对 X 两域开）
    √ src/shared/badge.js（装配链 import 闭包恰好这四个文件，只对 X 两域开）
    √ src/shared/messages.js（装配链 import 闭包恰好这四个文件，只对 X 两域开）

核对 10 项全对上号，无多余项
```

### 第四步：压出可上传的 zip——package.mjs

打包用 fflate（devDependency——扩展运行时依旧零依赖，压 zip 是开发侧的事）。两个硬约束都来自商店与核对的真实要求：manifest 必须在 zip 根；两次打包逐字节一致——所以固定 mtime，压完当场解包自检：

```js
// companion/scripts/package.mjs —— 打包：把扩展本体压成 dist/x-video-downloader.zip（Chrome Web Store 上传格式）
// 取舍规则在 audit-rules.mjs 的 selectZipFiles（纯函数，测试直接验证）：zip 只装 manifest.json 与 src/。
// 两条硬约束都来自商店的真实要求：manifest.json 必须在 zip 根；两次打包逐字节一致（固定 mtime，
// 可复现的包才谈得上核对）——打包完当场解包自检，清单对不上直接 throw。

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, unzipSync } from 'fflate'
import { selectZipFiles } from './audit-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ZIP_PATH = join(DIST, 'x-video-downloader.zip')

/** 递式收 companion 根下全部文件（'/' 分隔相对路径）；node_modules 与 dist 不进清单 */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const names = selectZipFiles(walk(ROOT).map((f) => f.slice(ROOT.length + 1).replaceAll('\\', '/'))).sort()
if (!names.includes('manifest.json')) throw new Error('打包清单里没有 manifest.json——商店只认 zip 根上的 manifest')

/** @type {Record<string, Uint8Array>} */
const bag = {}
for (const n of names) bag[n] = new Uint8Array(readFileSync(join(ROOT, n)))

// 固定修改时间：不固定的话 zip 元数据每次都变，两次打包不可能逐字节一致
const zipped = zipSync(bag, { level: 9, mtime: new Date(Date.UTC(2026, 0, 1)) })

mkdirSync(DIST, { recursive: true })
writeFileSync(ZIP_PATH, zipped)

// 打包自检：当场解包，核对清单与 manifest 位置
const back = unzipSync(zipped)
const got = Object.keys(back).sort()
if (JSON.stringify(got) !== JSON.stringify(names)) {
  throw new Error(`打包自检失败：zip 内容与文件清单不一致\n  清单：${names.join(', ')}\n  zip 里：${got.join(', ')}`)
}

console.log(`打包完成：dist/x-video-downloader.zip（${names.length} 个文件，${(zipped.length / 1024).toFixed(1)} KiB）`)
console.log('  zip 根上就是 manifest.json 与 src/——商店上传要求的形状：')
for (const n of names) console.log(`    ${n}（${(bag[n].length / 1024).toFixed(1)} KiB）`)
```

跑 `pnpm run package`，清单如下。

```text
# companion 运行输出——pnpm run package
打包完成：dist/x-video-downloader.zip（10 个文件，19.6 KiB）
  zip 根上就是 manifest.json 与 src/——商店上传要求的形状：
    manifest.json（0.7 KiB）
    src/background/sw.js（7.4 KiB）
    src/content/button-state.js（3.6 KiB）
    src/content/loader.js（0.6 KiB）
    src/content/main.js（5.3 KiB）
    src/shared/badge.js（1.6 KiB）
    src/shared/download.js（6.4 KiB）
    src/shared/m3u8.js（7.7 KiB）
    src/shared/messages.js（4.0 KiB）
    src/shared/video-url.js（1.6 KiB）
```

两道门槛收工：`pnpm run typecheck` 安静通过；`pnpm test` 显示 `Tests  76 passed (76)`——前五章 58 个加本章 18 个。脚本侧还有个小机关值得一眼：工程没装 `@types/node`，脚本用到的几个 `node:` API 在 `scripts/node-api.d.ts` 里声明了恰好用到的签名——类型门槛照跑，依赖面不扩。

## 验证：跑起来，装回去

本章的可感知面是三个产物：全绿的对账表、可复现的 zip、以及「zip 解开真能跑」。逐条来（先说明一处口径：把 zip 直接拖到 chrome://extensions 页面上装不动——实测拖放通道只认商店来源，控制台报「No dragged path」。所以装载验证走「解压后加载」，验证的是同一件事：zip 里的文件形状对不对、能不能跑）：

- [ ] 在 companion 目录运行 `pnpm test`：终端末尾应显示 `Tests  76 passed (76)`；再跑 `pnpm run typecheck`：应无任何报错输出。
- [ ] 运行 `node scripts/audit-manifest.mjs`：应打印出 permissions 三项、host 两项、action、WAR 四个文件的 √ 对账表，末行应为「核对 10 项全对上号，无多余项」。
- [ ] 运行 `pnpm run package`：dist 目录应出现 x-video-downloader.zip，清单应显示 10 个文件且 manifest.json 排在第一行。
- [ ] 可复现检查：连跑两次 `pnpm run package`，两次的 zip 哈希应完全相同（Windows 用 `certutil -hashfile dist\x-video-downloader.zip SHA256` 比对两串输出，应一字不差）。
- [ ] 用解压工具打开 zip：根上应直接看到 manifest.json 与 src/ 文件夹，不应多套一层目录——商店上传要求的形状。
- [ ] 把 zip 解压到任意临时目录（例如 dist/unpacked），在 chrome://extensions 开发者模式下选「加载已解压的扩展程序」指向该目录。应出现「X 视频下载器（教学版）」卡片且无红色「错误」按钮；刷新 x.com，含视频推文上的「下载视频」按钮应照常出现——zip 里这套文件真能跑。验证完可在卡片上点「移除」，避免与 companion 目录那份重名并存。
- [ ] 先猜后跑：往 manifest.json 的 permissions 数组里塞一项 `"tabs"`（别的都不动），重跑 `node scripts/audit-manifest.mjs`。先猜：会全绿还是出红？应看到 `× [多余] permissions: tabs` 一条、退出码变为 1；删掉 `"tabs"` 恢复全绿——过度索权在上架前先遭自己的脚本拦下，这就是这台对账机的用途。
- [ ] 定向破坏：把 host_permissions 里的 `https://x.com/*` 整项删掉，重跑核对脚本。应看到 `× [缺失] host_permissions: https://x.com/*` 一条——发起方模式没了权限盖住；twimg 那项不应变红（它仍盖得住自己的过滤器）。改回后应恢复全绿。
- [ ] 亲眼见一次「公示」：在 chrome://extensions 打开任一已装扩展的「详情」页，滚到网站访问权限/权限区。应看到逐条列出的权限语句，例如「读取和更改你访问的所有网站上的数据」。你的 manifest 将来也会这样公示：装的时候在确认弹窗里，装完在详情页里。

## 收束

开篇那两个现象现在可以亲口解释了。商店里隔三差五消失的下载插件，多数不是「技术故障」：它们倒在公示出来的权限与用途上——要了答不上「凭什么」的权限，或用途踩了版权线。而 2019 年那场大战，砍掉的是 webRequest 的拦改权。MV2 的万能钥匙——每条请求同步路过你的 JS——就此上缴；拦改的活交给 declarativeNetRequest 的规则表，观察的活留给 webRequest。七年后，商店里再无 MV2。我们的插件从头只用观察，一刀没砍到；且此刻你手里的核对脚本对 10 项在册能力逐项报出了「凭什么」，那张表就是商店审核员将来看的表。

三张欠条清账。第 2 章的：blocking webRequest 为何被砍、拦改归了谁——本章连同时间线与官方口径一起算清。第 4 章的：host_permissions 与 CORS 豁免的完整规则——扩展进程 fetch 对报备站点豁免、content script 永不豁免、两站规则、匹配模式语法，齐了；这也补全了「抓取为什么全程住 SW」的最后一角。第 5 章的：storage 凭账本要活过休眠、WAR 四文件凭装配链闭包恰好、matches 凭注入范围——总账表一行一句。manifest 全书终态在本章正文全文给出，此后不再演进；下一章的全链路对账将以它为定本，把从点击到落盘的每一跳再串一遍。

最后重申这条贯穿全书的边界——它理应与你写完最后一个文件时的一致。本课程仅用于学习浏览器扩展开发：只下载你拥有版权或已获明确授权的内容，遵守 X 服务条款与当地著作权法。

### 自查

1. 预测：把 sw.js 里整个 webRequest 监听注册删掉，manifest 不动。核对脚本会怎么报？浏览器里插件还能装载吗、还能用吗？这两个答案为什么不一致？
2. 迁移题：一个 MV2 插件想屏蔽 `tracker.example.net` 的图片，迁到 MV3 后同样的活怎么写？我们这本书从头到尾没写过这种代码——凭什么是我们不受影响？
3. 边界题：content script 里直接 `fetch('https://video.twimg.com/x.m3u8')` 会撞上什么？哪条官方规则判了它死刑？那第 5 章的整段视频字节为什么能安全到达页面世界？

::: details 参考答案
1. 脚本报 `× [多余] permissions: webRequest`——报备了但代码不碰。浏览器里照样装载（多余的权限声明不是装载错误），按钮也在，但 SW 控制台不再滚视频地址、账本永远空、点按钮得到「这个标签页还没播过视频」。不一致的根源：核对脚本按「最小化」审判，浏览器只按「合法性」审判——声明的权限没用上不违法，但商店审核与用户公示都会看见它。可回看「manifest 是公示文件」与演练第一步的 fixture 组。
2. 用 declarativeNetRequest 写一条静态规则：`action.type` 取 `"block"`，条件里 `urlFilter` 匹配 `tracker.example.net`、`resourceTypes` 填 `["image"]`。我们不受影响是因为 MV3 砍的只是 blocking（拦改），webRequest 的观察用法完整保留，而下载器要的是看见流量记账，从第 2 章起就没拦改过任何请求。可回看「万能钥匙被收走」一节。
3. 撞 CORS：请求从页面世界发出，官方规则是 content script 发起的跨域请求永远按同源策略走，不管 host_permissions 报备了什么。整段字节能到页面，是因为它不是页面 fetch 的——SW 抓取（豁免侧）拼好后编码成 base64（bytesB64）走消息通道递过来，页面只做解码与落盘。可回看「host_permissions 与 CORS 豁免」的对账表与第 5 章的消息协议。
:::
