---
title: 点击之前先加载：预取与资源提示
---

## 工具箱

这一章不加一行新功能，也不减一个字节——全部手术只是挪时间：让同样的资源在用户点击之前下载，而不是点击之后。给每条路由定策略之前，先调用两块旧积木。

- SSR 数据流——数据在服务端渲染期获取、渲染进 HTML、序列化进 payload、水合复用的整条链路（useAsyncData 契约是它的驱动入口）。判断一条路由点击之后还要等多久，先看它的数据走没走这条链路（第 2 章）。
- payload——随 HTML 内联的 `__NUXT_DATA__` 数据行李，服务端取过数的页面随身携带；一条路由有没有它，决定了预取能不能顺带把数据也备好（第 2 章）。

本章结束，工具箱会多两块：视口预取与资源提示。它们合起来回答两个问题：点击的成本可以挪到哪里，以及浏览器凭什么愿意提前替你下载。

## 没人点击，Network 里却在下载

以生产模式起服（`pnpm build && pnpm start`），打开首页，Network 面板开着——然后把手从鼠标上拿开。加载过程中和加载完后的空闲里，面板会自己冒出几条 `_nuxt` 分块下载，优先级一栏写着 Lowest。没有任何人点击任何东西，浏览器在替你未雨绸缪。

这是预取（prefetch）在工作：对「接下来可能去的地方」提前下载。它不是本章新加的——NuxtLink 的默认行为一直如此，蜗牛商店从没写过一行预取代码。在快照 steps/ch03-hydration/（第 3 章末态、本章动手前）的形态里，页头三条链接全享受这套默认。「收藏」切换得飞快，因为分块早就在缓存里——但迎面仍是一行加载文案，数据要再等约 300 毫秒，白屏一拍照旧。点「商品」则相反：没有任何新下载（代码早就位），页面却按住不动约 0.8 秒，然后商品连同全部内容一次到位。

于是有三个问题要拆。那几条没人点的下载，是谁发起的、为什么挑这个时机？预取预取了什么、又没预取到什么——为什么代码就位了，两种等待一分没少？以及，默认行为对每条链接一视同仁，这买卖对谁都划算吗？本章先看清默认行为，再决定哪些默认值得留、哪些该裁，最后给「本页马上要用、却藏得很深」的资源配上另一类提示。

## 原理：把成本挪进犹豫的时间窗

### 一次点击的账单

点一个站内链接，浏览器要办三件事：拿到新页面的代码、跑组件拿数据、画出来。新页面的代码就是路由分块——代码分割按路由切好的那份（第 3 章）。没有预取时，三件事严格串行在点击之后，其中「拿代码」一段含一次网络往返加下载，弱网上以秒计。

可点击之前有一段被闲置的资产：从页面可交互到用户真的点击，隔着阅读、犹豫、移动鼠标。首页 TTFB 是毫秒级（首屏指标组（第 1 章）），而用户从看清首屏到真的点击一条导航，中间往往隔着好几秒。这几秒里，带宽和 CPU 大多闲着。

预取做的就是把「拿代码」一段挪进这段空闲。成本没有消失——字节照样过网络——但它们在没人等待的时刻过。这与数据直出是同一门手艺的两个方向：SSR 数据流把数据等待搬进服务端渲染期（第 2 章），预取把代码下载搬进用户的犹豫时间窗。窗口越长，这门手艺赚得越多；窗口为零（用户秒点）或网络不允许时，它必须知道收敛。收敛的条件是什么，正是默认行为要拆的部分。

### 视口预取：NuxtLink 的默认行为

**视口预取**——NuxtLink 对进入视口的链接、在浏览器空闲时预取目标页分块的默认行为；2G 或省流网络下自动跳过。官方文档的原话：

```text
"Nuxt automatically includes smart prefetching. That means it detects when a
link is visible (by default), either in the viewport or when scrolling and
prefetches the JavaScript for those pages so that they are ready when the user
clicks the link. Nuxt only loads the resources when the browser isn't busy and
skips prefetching if your connection is offline or if you only have 2g
connection."
```

翻译：Nuxt 自动内置智能预取。它（默认）检测链接何时可见——在视口内或滚动时——并预取那些页面的 JavaScript，让它们在用户点击链接时就绪。Nuxt 只在浏览器不忙时加载这些资源，并在连接离线或只有 2G 网络时跳过预取（nuxt.com/docs/4.x · NuxtLink，文档版本 v4.4.7，2026-09-09 核实）。

这段话里藏着三个条件。逐个看它们守的是什么——机制取自伴生仓安装的 nuxt@4.5.2 产物，与文档口径一致。

| 条件 | 机制 | 反事实：没有这条会怎样 |
| --- | --- | --- |
| 进视口才取 | IntersectionObserver 盯着锚点，相交才触发 | 全部链接一加载就抢跑——首屏还没稳，预取先占了带宽 |
| 浏览器空闲才取 | 应用就绪后再套一层 requestIdleCallback | 预取与水合抢同一条主线程和带宽，可见与可交互都被拖慢 |
| 2G/省流直接跳过 | 读 navigator.connection 的 saveData 与 effectiveType | 弱网用户为「也许会点」的页面，付出「当前页更慢」的代价 |

空闲这条值得多说一句：它把预取排在可交互的账之后——水合的三段成本（下载、解析执行、接管）优先结算，可交互延迟不落幕，预取不动手（第 3 章）。预取的本钱是空闲，不空闲就别花，这是它不伤首屏的全部秘密。

还有一个事实要立此存照：这套判定全部发生在浏览器运行时，SSR 出的 HTML 锚点上没有任何预取痕迹。curl 一份页面源码，你找不出哪条链接会预取、哪条不会——演练里策略表要往锚点上挂显式标注，根子就在这里。

### 裁剪：预取是策略，不是开关

先对付一个流行判断：预取就是把所有页面都提前下载。替它说句公道话——小站总字节有限，「全提前」听起来无害。但每个预取字节都要过同一条带宽、占同一份缓存，对弱网用户是纯伤害；框架自己内置的 2G/省流护栏也说明「无条件全预取」从来不是设计意图。默认行为只是及格线：视口内、空闲、网络允许。哪条链接值得、哪条不值得，是每条路由单独回答的策略问题。

回答它用的正是工具箱里的判定力。给一条路由定预取策略，问两个问题。其一，它被点击的概率多大——页头全站可见的入口和藏在页脚的链接，等待的成本完全不同。其二，预取省得了它哪段等待——预取搬的只有代码段；数据段的账由页面形态决定，客户端取数的页面，数据要等点击后在浏览器里现取，那段白屏预取碰都碰不到（SSR 数据流与 payload 的判定口径（第 2 章））。

NuxtLink 给了三个档位。默认之外，`prefetchOn` 可以换触发时机，两个选项的官方定义：

```text
"`visibility`: Prefetches when the link becomes visible in the viewport.
Monitors the element's intersection with the viewport using the Intersection
Observer API."
"`interaction`: Prefetches when the link is hovered or focused. This approach
listens for `pointerenter` and `focus` events, proactively prefetching
resources when the user indicates intent to interact."
```

翻译：`visibility`——链接进入视口时预取，用 Intersection Observer 监测元素与视口的相交；`interaction`——链接被悬浮或聚焦时预取，监听 `pointerenter` 与 `focus` 事件，在用户表现出交互意图时主动取（出处同上）。

`prefetchOn` 还接受对象形态，按触发器逐项设置。文档在示例旁警告了一句：

```text
"That you probably don't want both enabled!"
```

翻译：你多半不想两个都开着（出处同上）。这句警告背后有一个容易踩的语义：对象不是整体替换默认值，而是逐键回退。伴生仓安装的 nuxt@4.5.2 里，判定函数的核心只有一行：

```js
// 伴生仓 node_modules 内 nuxt/dist/app/components/nuxt-link.js · shouldPrefetch（节选）
typeof props.prefetchOn === 'string' ? props.prefetchOn === mode : props.prefetchOn?.[mode] ?? options.prefetchOn?.[mode]
```

后半句 `props.prefetchOn?.[mode] ?? options.prefetchOn?.[mode]`——只写 `{ interaction: true }` 时，visibility 这个键在对象里找不到，于是回退到全局默认的 true：两个触发器都开着，裁剪不成立。想关掉视口触发，必须显式写 `visibility: false`。第三个档位最干脆：`no-prefetch` 整条链接不预取。

### 资源提示：preload 与 prefetch 的分工

预取照顾「下一页的代码」；另一类需求它管不了——「本页马上要用、却藏得很深」的资源。处理这类需求的机制族叫**资源提示**——用 `<link rel>` 向浏览器申报资源的用途与优先级，让它把资源排进正确的队列、在正确的时机发现。两个最常用的成员，方向正好相反（浏览器平台行为，语义口径见 [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/rel/preload)）。

| | preload | prefetch |
| --- | --- | --- |
| 申报的用途 | 本页马上要用 | 下一次导航可能用 |
| 优先级 | 高，与首屏关键资源同级 | 最低，空闲才取，浏览器可忽略 |
| 用错的代价 | 抢本页关键路径带宽；资源没被用还吃控制台警告 | 白付字节——用户没去那个页面 |
| 典型对象 | CSS 背景图、字体、首屏大图 | 下一页分块、错误页组件 |

第二个流行判断在这里等着：preload 和 prefetch 是一回事，随便加就行。替它说句公道话——两者都写成一行 link 标签，确实像近义词。但方向相反：preload 是抬优先级，prefetch 是降到底线；一个服务本页，一个赌未来。加错方向的伤害实打实——给本页不用的资源加 preload，等于用最高优先级下载一个废物，直接挤占首屏；给永远不会去的页面加 prefetch，是白送字节。于是两条纪律：preload 前确认「真资源」，本页渲染真的会用到它；prefetch 前确认「高概率」，这条导航真的会被走到。

这个家族还有第三位近亲，你其实撞过：`modulepreload`——preload 的 ES 模块变体，同样高优先级、同样服务本页，额外声明「这是模块，依赖关系请提前解析」。把图表分块拉回详情页首屏的正是它（第 3 章）；那笔账的教训在这里同样成立——**优先级提示改变的是排队时机，不是字节总量**，分块该不该进首屏队列，仍是分割与延迟水合说了算。

蜗牛商店首页有一个 preload 的正主：hero 蜗牛插画。它是手写 SVG（2,669 B，文本资产，不引二进制），只出现在 CSS 的 background 里——HTML 里没有 img 标签。浏览器的预加载扫描器（HTML 到手先粗扫一遍属性、提前发现资源的那套机制）只认 HTML 里的 src/href，CSS 里的引用它看不见；这张图的发现要等 CSS 下载并解析完，下载又排在发现之后，串成一线。preload 把发现时机提前到 HTML 解析期，下载与 CSS 并行——对以大图为最大内容的页面，这段时差直接影响 LCP（Core Web Vitals 的加载项（第 1 章））。`as="image"` 必须写对：as 决定请求进哪条优先级队列，也与资源的真实使用做匹配，对不上号就可能出现「预载一份、用时再下一份」的双下载。

prefetch 的产品级用法你其实已经见过。首页 HTML 里 Nuxt 自动生成三条 `<link rel="prefetch">`，指向 404 与 500 错误页的组件分块——本构建实测 3,412 B 与 3,760 B，外加一个 84 B 的共享小分块。错误最好永不发生，但真发生时，它的代码已经在缓存里等着。这也立起一个必须甄别的事实：HTML 里的 rel=prefetch 是 Nuxt 给错误页配的，页头路由的视口预取发生在浏览器运行时——两套机制、两个层面，门槛断言时不能张冠李戴。

## 演练：给导航定策略，给首页配 preload

进场先交改动面。手术清单：

- 一行未改：五个页面族的数据流与模板（商品列表的直出、详情页的图表、搜索/收藏/反例页的客户端取数）、全部 server API、measure 的测量口径；旧门 e2e-ch1/ch2/ch3 的断言一行未动——gate:ch4 会在自己的流程里串行复跑它们。
- 新增：`app/utils/nav-links.ts`（策略表与映射）、`tests/nav-links.test.ts`（10 例）、`scripts/e2e-ch4.mjs`（本章门槛 gate:ch4）、`public/hero-snail.svg`（手写 SVG）。
- 动：`SiteHeader`（表驱动渲染）；首页（hero 容器与 preload）；`main.css`（hero 布局）；`package.json` 与 README 登记 gate:ch4。

### 第一步：策略表——三档与三条理由

策略沉在一张纯数据表里，理由写在注释里跟着策略走——改任何一条策略，必须连理由一起改：

```ts
// companion/app/utils/nav-links.ts · 站点导航的预取策略表（节选：纯数据 + 纯映射，可单测；文件头另有两条工程约束注释）
//
// 策略与理由（改任何一条策略，必须连这里的理由一起改——理由是策略的一部分）：
// - /products   viewport     核心动线：首页主按钮与页头都指向商品列表，保留 NuxtLink 默认的
//                             视口预取——进视口且空闲即取，点击时代码已就位。
// - /search     interaction  次级动线：hover/focus 是更强的意图信号，改为交互触发，省下
//                             「每页空闲都为一个次级目标花字节」的常开成本。
// - /favorites  none         低频目标且仍是客户端取数形态：预取只省代码下载、省不掉数据白屏
//                             等待，页头全站出现意味着成本每页都付——先裁掉，等页面形态升级再评估。

/** 预取策略三档：viewport=保持默认视口预取；interaction=交互触发；none=裁剪（不预取） */
export type NavPrefetchMode = 'viewport' | 'interaction' | 'none'

export interface NavLinkSpec {
  to: string
  label: string
  prefetch: NavPrefetchMode
}

/** 页头导航与预取策略表（SiteHeader 渲染与 tests/nav-links.test.ts 共用） */
export const NAV_LINKS: readonly NavLinkSpec[] = [
  { to: '/products', label: '商品', prefetch: 'viewport' },
  { to: '/search', label: '搜索', prefetch: 'interaction' },
  { to: '/favorites', label: '收藏', prefetch: 'none' },
]

/** 策略 → NuxtLink 预取 props 的纯映射 */
export interface NuxtLinkPrefetchProps {
  noPrefetch?: boolean
  prefetchOn?: { visibility?: boolean; interaction?: boolean }
}

/**
 * 把策略档位翻译成 NuxtLink 的预取 props：
 * - viewport：空对象——不传任何 prop，保持 NuxtLink 默认（prefetch: true + prefetchOn: { visibility: true }）；
 * - none：noPrefetch: true——整条链接不预取；
 * - interaction：prefetchOn 两个键都要显式写——prefetchOn 是按触发器逐项回退默认值的，
 *   只写 { interaction: true } 会保留 visibility 的默认 true，裁剪就不成立。
 */
export function prefetchPropsFor(mode: NavPrefetchMode): NuxtLinkPrefetchProps {
  if (mode === 'none') return { noPrefetch: true }
  if (mode === 'interaction') return { prefetchOn: { visibility: false, interaction: true } }
  return {}
}
```

三条策略就是两个问题的三次作答。/products 留 viewport：核心动线，首页主按钮与页头都指向它，几乎每个访客的第一站；预取成本在空闲付一次，点击省掉一整段网络往返。/search 改 interaction：次级动线，不是每个访客都搜——常开的视口触发会让永不搜索的访客也付下载；hover/focus 是更强的意图信号，鼠标移上来的零点几秒足够完成一次 1.6 KiB 分块的下载（弱网上可能下不完，但点击后的等待里至少已经并行了一半）。/favorites 裁成 none：两个理由叠加——低频目标，且它仍是客户端取数形态，预取省得了它 839 B 的分块，省不掉点击后浏览器里那次约 300 毫秒的数据等待。为一个多数人不点、点了也白等数据的目标在每个页面付预取成本，不划算；哪天页面换成服务端取数，这条要连着理由重新评估。

### 第二步：SiteHeader 接线——行为面与配置面

```vue
<script setup lang="ts">
// companion/app/components/SiteHeader.vue · 站点页头与导航（预取策略由 NAV_LINKS 表驱动）
import { NAV_LINKS, prefetchPropsFor } from '~/utils/nav-links'
</script>

<template>
  <header class="site-header">
    <NuxtLink to="/" class="brand">🐌 蜗牛商店</NuxtLink>
    <nav class="nav">
      <!-- 策略三件套同源：prefetchPropsFor 把档位译成 NuxtLink props（行为面），
           data-prefetch 把档位标注在锚点上（HTML 可见的配置面，gate 与排查锚点）。 -->
      <NuxtLink
        v-for="link in NAV_LINKS"
        :key="link.to"
        v-bind="prefetchPropsFor(link.prefetch)"
        :to="link.to"
        :data-prefetch="link.prefetch"
      >{{ link.label }}</NuxtLink>
    </nav>
  </header>
</template>
```

同源策略落在两个面上。行为面：`v-bind` 把档位译成 NuxtLink 的真 props——`noPrefetch` 关、`prefetchOn` 调，预取行为真的随表变。配置面：`data-prefetch` 把档位标注在锚点上。为什么需要这个标注，原理节已经备好根据——视口预取是浏览器运行时行为，SSR 的 HTML 锚点上没有它的痕迹；策略既然是显式设计，就该有显式的可见面，门槛断言、浏览器排查、代码评审都靠它。构建产物里的形态：

```html
<!-- 构建产物：首页 HTML 查看源码里的三条页头锚点 -->
<a href="/products" class="" data-prefetch="viewport">商品</a>
<a href="/search" class="" data-prefetch="interaction">搜索</a>
<a href="/favorites" class="" data-prefetch="none">收藏</a>
```

### 第三步：首页的 hero preload

hero 插画只经 CSS 引用，正适合做 preload 的教学标本。页面侧只需一行 useHead：

```vue
<script setup lang="ts">
// companion/app/pages/index.vue · 首页（纯静态 SSR；hero 背景图带 preload 提示）
useHead({
  title: '首页',
  // 资源提示：hero 蜗牛插画只出现在 CSS 的 background 里，HTML 的预加载扫描器看不见它——
  // 它的发现要等 CSS 下载并解析完。preload 把发现时机提前到「HTML 解析到这一行」，
  // 下载与 CSS 并行。as="image" 必须写对：它决定浏览器把这笔请求放进哪条优先级队列。
  link: [{ rel: 'preload', as: 'image', href: '/hero-snail.svg' }],
})
</script>
```

渲染进 HTML 的成品是 `<link rel="preload" as="image" href="/hero-snail.svg">`。配套的两件小事：模板里加上 `.hero-art` 渲染容器（preload 指向的资源，本页要真的在用它）；`main.css` 里这个容器用 background 引用 SVG。preload 纪律由此闭合——提示、容器、CSS 引用、可服务的资产，四者指向同一份真资源。

### 第四步：立门槛，先红

按红绿节奏，先立门槛再动手。gate:ch4 的断言分五组：A 策略标注（两页 × 三路由逐一对上，每条路由的策略锚点恰好一条）；B preload 真资源与纪律（首页有 preload、有容器、CSS 有引用、资产可服务；别的页不注入）；C Nuxt 自带 rel=prefetch 的甄别（目标必须不是路由分块，防张冠李戴）；D 编译连线（携带标注的客户端分块里同时有策略表与 props 映射——策略真的接上了 NuxtLink，不是只挂了个 data 属性）；E 旧门不回退（串行复跑 ch1–ch3）。核心节选：

```js
// companion/scripts/e2e-ch4.mjs · 断言组 A/B（节选）
const EXPECTED_STRATEGIES = {
  '/products': 'viewport',
  '/search': 'interaction',
  '/favorites': 'none',
}

for (const [to, mode] of Object.entries(EXPECTED_STRATEGIES)) {
  check(
    strategies[to] === mode,
    `预取策略：${pagePath} 页头 ${to} 锚点标注 data-prefetch="${mode}"（实际 "${strategies[to] ?? '(无)'}"）`,
  )
}

const heroPreloadTag =
  /<link\b[^>]*rel="preload"[^>]*hero-snail\.svg[^>]*>/.exec(html)?.[0] ?? ''
if (pagePath === '/') {
  const as = /as="([^"]*)"/.exec(heroPreloadTag)?.[1]
  check(
    !!heroPreloadTag && as === 'image',
    `关键资源 preload：首页 HTML 含 <link rel="preload" as="image" href="/hero-snail.svg">（实际 as="${as ?? '(无)'}"）`,
  )
  const asset = await requestPage(srv.base, HERO_ASSET)
  check(
    asset.status === 200 && asset.body.length > 500,
    `真资源：${HERO_ASSET} 可服务且非空（${asset.status}，${asset.body.length} B）`,
  )
} else {
  check(!heroPreloadTag, `preload 纪律：${pagePath} 不注入 hero preload（每页只 preload 自己马上要用的资源）`)
}
```

对动手前的形态跑门槛（让脚本完整构建），红得干净，失败项如下。

```text
gate:ch4 —— 10/27 项通过；报告：reports/gate-ch4.json
失败项：
  - 预取策略：/ 页头 /products 锚点标注 data-prefetch="viewport"（实际 "(无)"）
  - 预取策略：/ 页头 /search 锚点标注 data-prefetch="interaction"（实际 "(无)"）
  - 预取策略：/ 页头 /favorites 锚点标注 data-prefetch="none"（实际 "(无)"）
  - 关键资源 preload：首页 HTML 含 <link rel="preload" as="image" href="/hero-snail.svg">（实际 as="(无)"）
  - 真资源：首页 HTML 含 hero-art 渲染容器（preload 指向本页真要用的资产）
  - 真资源：/hero-snail.svg 可服务且非空（404，7355 B）
  - 编译连线：客户端分块含 data-prefetch 标注（SiteHeader 编译产物在位）
  （另 10 条为同型：两页各余下的策略标注与「恰好一条」计数、CSS 引用断言）
```

红在哪儿：27 项里绿的全是脚手架。页面 200、/products 不注入 hero preload 的纪律、Nuxt 自带 prefetch 目标不是路由分块、旧门 ch1–ch3 全绿（动手前形态即第 3 章末态，旧门当然全过）。红的 17 条分三类。策略标注 12 条——两页 × 三路由的档位与计数。真资源 4 条——preload 标签、渲染容器、CSS 引用、资产可服务（404 的响应体正是错误页 HTML，7,355 B）。编译连线 1 条——产物里找不到携带标注的分块。另有 4 项断言以「产物里存在可甄别的对象」为前提——连线的两张表、按实际 link 计数的甄别项——红状态下前提不足、没有登场，总数因此是 27 而非 31。这是能力未实现的红。

### 第五步：转绿，旧门同行

策略表接线、preload 就位后重跑：

```text
gate:ch1 —— 110/110 项通过；报告：reports/gate-ch1.json
gate:ch1 通过
gate:ch2 —— 13/13 项通过；报告：reports/gate-ch2.json
gate:ch2 通过
gate:ch3 —— 15/15 项通过；报告：reports/gate-ch3.json
gate:ch3 通过
gate:ch4 —— 31/31 项通过；报告：reports/gate-ch4.json
gate:ch4 通过
```

红绿之间发生了两件事：策略表编译进了 SiteHeader 所在的共享分块，preload 与 hero 容器进了首页 HTML。31 条断言把策略三档、真资源四证据、自带 prefetch 甄别、编译连线、旧门五件事各钉各的。

### 守住策略表：确定性测试

策略表是纯数据、映射是纯函数，正好落在固定输入测试的射程里，共 10 例，节选三例。

```ts
// companion/tests/nav-links.test.ts · 策略表与映射（节选）
it('核心动线 /products 保留视口预取：默认行为本身就是策略，不许静默丢失', () => {
  const products = NAV_LINKS.find((l) => l.to === '/products')
  expect(products?.prefetch).toBe('viewport')
})

it('三档策略各恰好一条：保留默认 / 交互触发 / 裁剪（教学覆盖完整）', () => {
  for (const mode of MODES) {
    expect(NAV_LINKS.filter((l) => l.prefetch === mode)).toHaveLength(1)
  }
})

it('interaction：关视口、开交互——visibility 显式 false，interaction true', () => {
  // 关键细节：prefetchOn 是按触发器逐项回退默认值的，
  // 只写 { interaction: true } 会保留 visibility 默认 true，裁剪就不成立
  expect(prefetchPropsFor('interaction')).toEqual({
    prefetchOn: { visibility: false, interaction: true },
  })
})
```

表自身也要守：每条路由一条策略、to 不重复、表不夹带文档字段——这个模块进每个页面的共享分块，说明文字写进运行时就是纯负载。

```text
 ✓ tests/chaos.test.ts (5)
 ✓ tests/catalog.test.ts (6)
 ✓ tests/nav-links.test.ts (10)
 ✓ tests/price-trend.test.ts (18)
 ✓ tests/payload.test.ts (4)
 Test Files  5 passed (5)
 Tests       43 passed (43)
```

### 字节对账

性能基线的规矩是对账以存档为锚（第 1 章）。对照取本章动手前的存档 steps/ch03-hydration/reports/gate-ch1.json。现状取 gate:ch4 复跑刷新的 reports/gate-ch1.json，同一套指标组字段。逐页如下。

| 页面 | HTML 字节 | 首屏 JS 字节 | 构成 |
| --- | --- | --- | --- |
| home | 2,859 → 3,183（+324） | 191,202 → 191,636（+434） | HTML：+161 三条策略标注（锚点渲染形态），+163 preload 标签（52 B）与 hero 容器；JS：+245 共享分块、+189 首页自身分块（useHead 的 link 配置） |
| products | 20,467 → 20,628（+161） | 200,584 → 200,829（+245） | 策略标注；共享分块 |
| search | 2,376 → 2,537（+161） | 192,779 → 193,024（+245） | 策略标注；共享分块 |
| favorites | 2,263 → 2,424（+161） | 192,030 → 192,275（+245） | 策略标注；共享分块 |
| detail | 48,533 → 48,694（+161） | 200,812 → 200,996（+184） | 策略标注；共享分块 +245、自身分块 −61（构建压缩的连带波动） |

关键一笔在共享分块：SiteHeader 所在的共享分块从 61,451 B 长到 61,696 B（+245 B），策略表与映射函数编译了进去。共享分块挂在每个页面的首屏清单里——账面五页各记一份名头，网络上每个访客只下载一次，这是代码分割的既有去重语义（第 3 章）。净读：HTML 每浏览一页实付 +161 B，JS 全程实付一次 +245 B。策略管理自己也有成本，这笔成本同样要过指标组的账。

## 验证：亲手摸到预取的时刻

进入伴生仓根目录（本章终态同步快照在 steps/ch04-prefetch-nav/）。

```bash
pnpm gate:ch4        # 构建 + 起服 + 31 项断言（内含旧门 ch1–ch3 串行复跑），应输出「gate:ch4 通过」
pnpm build && pnpm start
```

先猜后跑，三题各锚一环。①`curl -s http://127.0.0.1:4311/ | grep -o 'data-prefetch="[a-z]*"' | sort | uniq -c` 输出几行、各计几？A「一行计 3」B「三行各计 1」C「空」。②路径换成 /products 后，`grep -o 'rel="preload"' | wc -l` 输出几？A「0」B「1」。③首页 `grep -o 'rel="prefetch"' | wc -l` 输出几、指向谁？A「0——裁剪生效了」B「恰 3，指向错误页分块」C「3 个路由各一条」。核对：①三行各 1（viewport/interaction/none 三档各一）；②0——preload 只出现在用它的首页；③恰 3，指向 404/500 错误页组件——被裁的是路由预取，Nuxt 自带的错误页 prefetch 与它是两套机制。

浏览器人工观察（口径互补，必做一次）：DevTools 打开首页，Network 面板开着，勾上 Disable cache。

1. 手离鼠标：加载完后几秒，几条 `_nuxt` 分块以 Lowest 优先级自己出现——商品页分块（视口预取）与错误页分块（HTML 里的 rel=prefetch）。没有任何点击。
2. 鼠标悬到「搜索」上：一条 1.6 KiB 上下的分块立刻开始下载——pointerenter 扣动了交互触发的扳机。
3. 点「搜索」：页面瞬时切换（代码已在），加载文案随即出现，约 600 毫秒后内容到位——预取覆盖了代码段，数据段照付。
4. 点「收藏」：盯住 Network——它的分块此刻才开始下载（被裁剪的路由，点击即取），切换仍然快，数据照等约 300 毫秒。
5. 点「商品」：没有任何新分块（视口预取早备好），页面按住约 0.8 秒等数据，然后一次到位——这段「按住」是预取管不到的数据段，它的去处是缓存与加载状态（第 5 章、第 7 章）。

**定向破坏一：改档位。** 把 `nav-links.ts` 里 /products 的 `'viewport'` 改成 `'none'`。先写预言再动手：gate:ch4 恰好红 2 条——两个页面上 /products 的策略标注（期望 viewport、实际 none）；vitest 恰好红 2 例——「核心动线保留视口预取」与「三档各恰好一条」（viewport 档空了）。哪条没变：锚点「恰好一条」的计数断言、编译连线、preload 全组——它们守的是结构与真资源，不关心单条路由的档位。跑（让脚本完整重建，别设 `SKIP_BUILD=1`），核对预言全中，改回复核 31/31 与 43/43。

**定向破坏二：假提示。** 把首页 useHead 里的 `as: 'image'` 改成 `as: 'font'`。预言：gate:ch4 恰好红 1 条——preload 断言的 as 判定（实际 "font"）；真资源三证据不红——容器、CSS 引用、资产本身都没变。浏览器侧打开首页：预载的那份与 CSS 真正要的这份对不上号，控制台会出现 preload 未使用的警告——一个用最高优先级下载、却救不了任何人的废物。改回复原。

## 自查

1. 新路由 /about 即将上线：静态内容、低频访问、入口在页脚最底部。给它选哪档预取策略？用定策略的两个问题推一遍。
2. `prefetchOn` 只写 `{ interaction: true }`，这条链接最终的触发行为是什么？靠哪一行实现语义确定？/search 的裁剪为什么少了 `visibility: false` 就不成立？
3. 把 hero 插画从 CSS background 改成 `<img src="/hero-snail.svg">`，还需要 preload 吗？发现时机发生了什么变化？
4. 字节账里 HTML 每页 +161 B、共享分块 +245 B。只看首页就走的用户为策略表实付多少？把五页都逛一遍的用户呢？两笔账为什么不相等？

<details>
<summary>参考答案</summary>

1. none。问题一（点击概率）：页脚、低频，预取收益趋近于零；问题二（省哪段）：静态页无数据段，预取只能省代码段——但连视口触发都等不到（页脚要滚到底才进视口），交互触发也无悬停价值。三问都答不划算，裁掉。
2. 两个触发器都开着：interaction 被显式打开，visibility 找不到键就回退全局默认 true。语义由 `props.prefetchOn?.[mode] ?? options.prefetchOn?.[mode]` 这一行逐键回退确定。少了 visibility: false，视口触发仍在——/search 会在每个页面空闲时照取，裁剪目标落空。
3. 不需要。img 的 src 是 HTML 属性，预加载扫描器在 HTML 解析期就能发现它，下载天然与 CSS 并行；再加 preload 是重复提示。preload 的价值在「藏在 CSS/字体等晚发现位置的资源」。
4. 只看首页：245 B（共享分块随首屏一次付清）+ 161 B（首页 HTML）。逛五页：245 B + 5 × 161 B。不相等的原因：共享分块有 HTTP 缓存与跨页复用，一个会话只下载一次；HTML 是每页各自的新文档，每页各付一份标注字节。
</details>

## 收束：把点击的账提前结了

开篇的两笔等待现在可以说清了。那几条没人点的下载，是 NuxtLink 的视口预取与 Nuxt 给错误页配的 rel=prefetch 在并肩工作：视口内、浏览器空闲、网络允许，目标路由的分块提前进缓存。点「商品」时零下载切换——这是预取买到的那一段。它买不到的也看清了：按住的 0.8 秒是数据段的账，预取一个字节管不着；「收藏」的低频叠加上同款数据等待，让它成了被裁的那条。首页的 hero 插画走另一条路——preload 把 CSS 藏着的真资源提前到 HTML 解析期发现。挪时间这门手艺由此有了两个方向的工具：本页的用 preload，下一页的用 prefetch；两头的纪律分别是「真资源」与「高概率」。

工具箱新增两块：视口预取——NuxtLink 默认的导航预取，视口内、空闲、网络门槛三条件，prefetchOn 与 no-prefetch 是它的调节旋钮；资源提示——用 link rel 申报用途与优先级的机制族，preload 服务本页、prefetch 服务未来。迁移到真实项目时先问三句：页头每条链接的预取策略是有意识定的，还是默认值的惯性？preload 清单里有没有本页根本不用的资源？被裁掉的路由，裁的理由今天还成立吗？

预取与 _payload.json 的叠加账，到缓存章一起算（第 5 章）；点击后「等数据再切页」还是「先切页再出数据」，留给加载状态（第 7 章）。
