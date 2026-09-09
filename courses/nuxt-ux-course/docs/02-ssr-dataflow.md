---
title: 数据随 HTML 到达：SSR 数据流与 payload
---

## 工具箱

本章调用两块旧积木，先把接口摆上台面：

- 性能基线——固定口径、优化前就存档的对照数字；跑一次测量脚本、把报告存档，此后每个「变快了」都拿它对账（第 1 章）。
- 首屏指标组——一次输出「到达—可见—可交互—稳定」整组字段的测量仪：状态、TTFB、HTML 与 payload 字节、首屏 JS、数据是否随 HTML 到达、接口命中计数，node 侧一把跑全（第 1 章）。

手边有这两块，任何页面都能先测后改、改完复测。本章结束时，你会再多三块。

## 白屏与直出：两条首屏时间线

同样是打开一个商品列表，有的网站让你盯着一片空白干等一拍，有的网站第一眼就有货。这两种体验的分界线，用浏览器菜单里的「查看网页源代码」当场就能划出来：在源码里搜一件商品的名字。搜得到的是直出——内容随第一份 HTML 一起到达；搜不到的是白屏路径——HTML 里只有一个加载占位，真数据要等浏览器下载并执行完 JS、再发一次请求才回来。

伴生站的 `/products` 就是白屏路径的活标本：性能基线报告里，它的 TTFB 是 8.2 / 2.7 毫秒、HTML 2.1 KiB、「数据随 HTML」为 false。首字节的快与内容的慢同框出现——账已经记下，只是还没修。本章把这一页搬到直出路径上，并且每一步都有数字作证。

读到这里你可能有个疑问：Nuxt 不是本来就在服务端渲染吗，数据怎么反而没跟过去？回答它需要拆开一条完整的链路：数据在哪一段被获取、以什么形态到浏览器、客户端接管时从哪里取数。

## 原理：数据在哪一段被获取

把「数据从接口到屏幕」的全程看成一条链路，它有个名字：**SSR 数据流**——数据在服务端渲染期间被获取、直接渲染进 HTML、同时序列化进 payload 的整条链路；客户端不需要第二次请求就能拿到首屏数据。白屏路径缺的不是渲染，是这条链路的前三环。下面先把两条路径摆在一起，再逐环拆。

### 两种首屏路径对照

同一个商品列表，两种写法，两条时间线。

路径 A（客户端取数，基线形态）：组件在浏览器里挂载后才要数据。

| 时刻 | 发生了什么 |
| --- | --- |
| t0 | 浏览器请求 `/products`；服务端渲染组件，`onMounted` 在服务端不执行，HTML 只含「商品加载中……」 |
| t1 | HTML 到达（基线实测 TTFB 8 毫秒级），屏幕上是加载文案——白屏期开始 |
| t2 | CSS 与约 190 KiB 首屏 JS 下载、解析、执行，组件挂载 |
| t3 | `onMounted` 触发 `$fetch('/api/products')`，撞上注入的 800 毫秒延迟 |
| t4 | 数据回来，商品网格渲染——白屏期结束 |

用户看到真内容的时刻，约等于 HTML 往返＋JS 下载执行＋810 毫秒接口＋渲染。四段里最长的一段（810 毫秒）发生在屏幕已经有壳之后——壳不能当饭吃。

路径 B（服务端取数，本章形态）：渲染期间就把数据取好。

| 时刻 | 发生了什么 |
| --- | --- |
| t0 | 浏览器请求 `/products`；服务端渲染期间执行取数逻辑，等 800 毫秒 |
| t1 | 服务端把商品网格渲染进 HTML，一次发全（本章实测 TTFB 约 830 毫秒）——内容随首字节到达 |
| t2 | JS 下载执行，接管页面；所需数据已在 HTML 自带的 payload 里，不再请求 |

两条路径的差别不在「快不快」，在等待发生在哪一段：路径 A 把最重的等待留在用户看得见的地方，路径 B 把它搬进服务端渲染期，换来首字节即内容。

### payload：随 HTML 到达的数据行李

有一种流传很广的说法：SSR 只是服务端拼 HTML，数据到浏览器后还是会再请求一次。先替这个直觉说句公道话：它来自真实的经验——模板直出的老站确实只管 HTML，SPA 又确实全靠浏览器取数，两头都见过的人自然会这么推。它不成立的边界在于：Nuxt 在这两头之间专门修了一层载体，把服务端取到的数据随 HTML 一起送到浏览器。

这层载体叫 **payload**——Nuxt 把服务端获取的数据序列化成 JSON、以 `<script id="__NUXT_DATA__">` 内联进 HTML 的数据行李；浏览器里的 JS 接管页面时直接从它取数，不重复请求。官方文档的定义原文：

```text
"The payload is a JavaScript object accessible through `useNuxtApp().payload`.
It is used on the client to avoid refetching the same data when the code is
executed in the browser during hydration."
```

翻译：payload 是一个可以通过 `useNuxtApp().payload` 访问的 JavaScript 对象；当代码在浏览器水合期间执行时，客户端用它避免重新获取同样的数据（nuxt.com/docs/4.x · Data Fetching，文档版本 v4.5.2，2026-09-09 核实）。

「水合」在这里第一次出现，先给一句人话定义：水合（hydration）——浏览器里的 JS 接管服务端渲染的 HTML、重建响应式状态与事件监听的过程。本章只用到它「从 payload 取数」的一面，成本的账后续再算（第 3 章）。

反事实检验一下「没有 payload 会怎样」：服务端取好的数据只存在于渲染那次请求的内存里，HTML 发出去就没了；客户端 JS 接管时手里没有数据，要么重新请求一次（白屏路径的等待换了个时点重演），要么干脆没有数据可用。payload 存在的后果可验证：基线 `/products` 的 payload 只有 192 字节——服务端没取数，里面几乎只剩视图状态；改造后是 4528 字节，装着 24 件商品的序列化数据。「payload 字节」因此是口径表里的账本字段：它记录服务端到底取了多少数、随 HTML 送下去了多少。

### useAsyncData 契约：四步链路

第二个常见误会跟着来了：useFetch 不就是 fetch 的封装吗，跟浏览器里直接 fetch 差不多。这个直觉同样有来处——名字里带 fetch，用法也像。但它管的根本不是「发一个请求」，而是一份完整的 **useAsyncData 契约**——Nuxt 服务端数据获取组合式函数的行为约定。约定有四条：同 key 去重、handler 在服务端执行、结果写进 payload、客户端水合时复用。官方文档的原话：

```text
"The `useFetch` and `useAsyncData` composables solve this problem by ensuring
that if an API call is made on the server, the data is forwarded to the client
in the payload."
```

翻译：`useFetch` 与 `useAsyncData` 组合式函数解决了这个问题——确保 API 调用若发生在服务端，数据会经由 payload 转交给客户端（出处同上）。

句中的「这个问题」指的是：在组件 setup 里直接用 `$fetch` 取数，服务端渲染取一遍、浏览器水合后又取一遍，数据被取两次。契约把这两次合并成服务端的一次，并把结果随 HTML 带下去。

展开成四步链路，每一步都有可指认的证据：

| 步骤 | 发生什么 | 怎么指认 |
| --- | --- | --- |
| 1 服务端执行 | SSR 期间 handler 在服务器上跑 | 页面 TTFB 含 800 毫秒数据等待（本章实测 835.5 / 823.2 毫秒） |
| 2 渲染进 HTML | 组件用返回的 data 渲染 | 查看源码能搜到商品名，网格真的在 HTML 里 |
| 3 序列化进 payload | 结果写进 `__NUXT_DATA__` | payload 从 192 字节涨到 4528 字节，且含商品名 |
| 4 水合复用 | 客户端不重新执行 handler，直接取 payload | 一次渲染 `/api/products` 命中恰 1 次；浏览器 Network 面板无第二次请求 |

驱动这四步的是页面里的一个调用：`useAsyncData(key, handler)`。第一个参数 key 是这份数据的名字——同 key 的调用共享同一份数据与状态，官方建议始终自建 key、不要依赖按代码位置自动生成的默认值；第二个参数 handler 是任意的异步取数逻辑。`useFetch(url)` 差不多等于 `useAsyncData(key, () => $fetch(url))`，是这条契约上最常见用法的糖；本章用更通用的 `useAsyncData`，因为 handler 里能装的不止一条 URL。

至于 `$fetch` 本身，官方给它的定位是浏览器侧的事件驱动交互（提交表单、点赞），或者作为 handler 内部的取数工具：

```text
"Beware that using only `$fetch` will not provide network calls de-duplication
and navigation prevention. It is recommended to use `$fetch` for client-side
interactions (event-based) or combined with `useAsyncData` when fetching the
initial component data."
```

翻译：注意，只用 `$fetch` 不会提供网络调用去重与导航等待；推荐把 `$fetch` 用于客户端交互（事件驱动），或在获取组件初始数据时与 `useAsyncData` 结合（出处同上）。

基线页恰恰是「只用 `$fetch`」的形态：请求写在 `onMounted` 里，没有任何机制把它搬进服务端、写进 payload。改造就是把这一处换成契约的入口。

## 演练：把商品列表搬到服务端

进场前先交改动面。手术清单：

- 一行未改：详情、搜索、收藏三个数据页——仍是 `onMounted+$fetch` 的客户端取数反例，留给后续章节；商品目录与延迟注入原样。测量口径也一行未动：`measure-core` 的 ROUTES、探针、字节统计对 SSR 数据流自动出数，`pnpm measure` 不需要为新形态改任何逻辑。
- 新增：`/demo/client-fetch` 反例页（旧商品页原样搬迁，白屏路径永久保留）；`scripts/e2e-ch2.mjs`（本章门槛 gate:ch2）；`tests/payload.test.ts`（payload 探针的纯逻辑测试）。
- 动：`/products` 页本体（手术主体）；gate:ch1 的断言锚点（`/products` 的旧断言改指 `/demo/client-fetch`，测量意图不变）；`measure-core` 开放出 payload 文本探针（`extractPayloadText`，字节统计行为不变）；`package.json` 与 README 登记 gate:ch2。

反例页不是新写的，是搬家的——与基线商品页完全相同的取数写法，原样钉在新路由上：

```vue
<script setup lang="ts">
// companion/app/pages/demo/client-fetch.vue · 反例页：完整保留第 1 章基线的客户端取数商品列表。
// /products 在第 2 章改为 useAsyncData 服务端取数后，这条「HTML 先走、数据后到」的白屏路径
// 原样搬到这里——读者可随时对照两种首屏形态，gate:ch1 的坏页锚点也钉在这一页上。
import type { Product } from '#shared/types'

useHead({ title: '反例：客户端取数' })

// 已知反例（刻意保留，勿改成 useAsyncData）：等组件在浏览器里挂载后才发起请求。
// 服务端渲染时 onMounted 不执行，HTML 只输出加载壳；商品要等浏览器接手后再发请求。
const products = ref<Product[] | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    products.value = await $fetch<Product[]>('/api/products')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '商品加载失败'
  }
})
</script>
```

### 先红：给直出立门槛

按红绿节奏，先立门槛再动页面——此刻 `/products` 还是客户端取数，新门槛应当红在「能力未实现」上。gate:ch2 的核心断言节选如下（另有两组：反例页 `/demo/client-fetch` 必须保持旧形态；同源交叉验证 HTML、payload 与 `/api/products` 原始响应逐字一致，完整脚本见伴生仓）：

```js
// companion/scripts/e2e-ch2.mjs · 断言组 A/B：直出事实与单次命中（节选）
  const page = await requestPage(srv.base, '/products')
  const html = page.body.toString('utf8')
  const payload = extractPayloadText(html)

  check(page.status === 200, `直出事实：/products 返回 200（实际 ${page.status}）`)
  check(
    page.ttfbMs >= 700 && page.ttfbMs <= 5000,
    `直出事实：/products TTFB 含 800ms 数据等待（SSR 等接口，实际 ${round1(page.ttfbMs)}ms）`,
  )
  for (const probe of PROBES)
    check(html.includes(probe), `直出事实：HTML 含商品名「${probe}」（数据渲染进 HTML）`)
  check(payload.length > 0, '直出事实：__NUXT_DATA__ payload 存在')
  for (const probe of PROBES)
    check(
      payload.includes(probe),
      `直出事实：payload 含同源数据「${probe}」（服务端结果序列化进 __NUXT_DATA__）`,
    )

  // ---- B. 单次命中：一次 /products 渲染只触发 1 次 /api/products（水合复用 payload，不重复请求）----
  // 必须在任何直测 /api/products 的请求之前读取，否则会混入本脚本自己的探测。
  const hitsAfterRender = await getJson(srv.base, '/api/_hits')
  check(
    (hitsAfterRender['/api/products'] ?? 0) === 1,
    `单次命中：一次 /products 渲染恰触发 1 次 /api/products（实际 ${hitsAfterRender['/api/products'] ?? 0}）`,
  )
```

跑起来，红得干干净净：

```text
gate:ch2 —— 5/13 项通过；报告：reports/gate-ch2.json
失败项：
  - 直出事实：/products TTFB 含 800ms 数据等待（SSR 等接口，实际 9.5ms）
  - 直出事实：HTML 含商品名「云朵雨伞」（数据渲染进 HTML）
  - 直出事实：HTML 含商品名「慢炖陶锅」（数据渲染进 HTML）
  - 直出事实：payload 含同源数据「云朵雨伞」（服务端结果序列化进 __NUXT_DATA__）
  - 直出事实：payload 含同源数据「慢炖陶锅」（服务端结果序列化进 __NUXT_DATA__）
  - 单次命中：一次 /products 渲染恰触发 1 次 /api/products（实际 0）
  - 反例仍在：渲染反例页不增加服务端命中（客户端发的请求 node 代理看不到，实际 0）
  - 同源交叉：1 号商品的简介在 API 响应、HTML、payload 三处逐字一致（同一次获取）
```

红在哪儿：服务器起得来、页面请求得到、计数读得出——脚手架全绿；红的 8 条全是「直出能力不存在」：TTFB 9.5 毫秒说明 SSR 没等数据，HTML 与 payload 里没有商品名，命中 0 说明服务端根本没取过数。这是能力未实现的红，不是环境错误。

### 手术：给 /products 换数据引擎

改动只在 `<script setup>` 的取数方式。模板从「错误 / 加载 / 数据」三态简化为「错误 / 数据」两态——等待已经搬进服务端渲染期，页面级加载分支没有存在的理由了。

```vue
<script setup lang="ts">
// companion/app/pages/products/index.vue · 商品列表（第 2 章版：useAsyncData 服务端取数）
import type { Product } from '#shared/types'

useHead({ title: '全部商品' })

// 四步链路的前三步都从这一行发生：SSR 期间在服务端执行 handler → 渲染进 HTML → 结果序列化进 payload。
// 显式 key 'products'：同 key 去重，客户端水合时直接从 payload 取数，不再第二次请求 /api/products。
// 旧的反例写法（onMounted + $fetch）完整保留在 /demo/client-fetch，供对照与门槛锚定。
const { data: products, error } = await useAsyncData('products', () =>
  $fetch<Product[]>('/api/products'),
)
</script>

<template>
  <section>
    <h1>全部商品</h1>
    <p v-if="error" class="state state-error">加载失败：{{ error.statusCode ?? error.message }}</p>
    <div v-else-if="products" class="grid">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
```

重新构建，跑门槛：

```text
gate:ch2 —— 13/13 项通过；报告：reports/gate-ch2.json
gate:ch2 通过
```

红绿之间只发生了一件事：取数从「浏览器挂载后」搬到「服务端渲染期」，并挂到契约上。13 条断言各自指认了链路的一环。

### 手术：gate:ch1 的锚点迁移

改掉 `/products` 的数据路径，先立的门槛立刻会喊疼：gate:ch1 把两件事写成基线事实断言——`/products` 数据不在 HTML（present=false）、node 直取页面时 `/api/products` 命中 0。这两件事都被本章的手术改变了。处理方式不是删断言，而是迁移锚点——把「已知坏页」的角色从 `/products` 移交给 `/demo/client-fetch`。

```js
// companion/scripts/e2e-ch1.mjs · 断言组 C 的锚点手术（节选）
  // 第 2 章起 /products 改为服务端取数（present=true），客户端取数反例的测量锚点移到 /demo/client-fetch。
  // 本组断言的意图不变：测量仪能正确判定「已知坏页」；detail/search/favorites 仍是客户端取数，断言原样。
  for (const label of ['detail', 'search', 'favorites'])
    check(
      byLabel[label].dataWithHtml.present === false,
      `基线事实：${label} 数据不在 HTML 里（客户端取数反例，present=false）`,
    )
  const demo = await requestPage(srv.base, '/demo/client-fetch')
  const demoHtml = demo.body.toString('utf8')
  check(demo.status === 200, `基线事实：反例页 /demo/client-fetch 返回 200（实际 ${demo.status}）`)
  check(
    !demoHtml.includes('云朵雨伞') && !demoHtml.includes('慢炖陶锅'),
    '基线事实：client-fetch 反例页数据不在 HTML 里（旧 /products 形态，present=false）',
  )
  for (const endpoint of ['/api/products/:id', '/api/search', '/api/favorites'])
    check(
      (apiHits[endpoint] ?? 0) === 0,
      `基线事实：node 直取页面时 ${endpoint} 命中 0 次（客户端发的请求 node 代理看不到）`,
    )
  // /api/products 自第 2 章起由 /products 的 SSR 在服务端调用：两遍测量恰好命中 2 次。
  // 等号成立的同时意味着：浏览器（含反例页）发出的请求一次也不在里面——node 口径仍然看不到它们。
  check(
    (apiHits['/api/products'] ?? 0) === 2,
    `基线事实：/api/products 命中恰为两遍 SSR 渲染数 2（实际 ${apiHits['/api/products'] ?? 0}）`,
  )
```

复跑老门槛：

```text
gate:ch1 —— 110/110 项通过；报告：reports/gate-ch1.json
gate:ch1 通过
```

109 变 110：被改变的 2 条断言各改写为 1 条（反例页 present=false、命中恰为 SSR 渲染数），另加反例页存活检查 1 条。口径完整、数值合理、基线事实、重复稳定四类意图一条没少；「测量仪能判定已知坏页」这件事由 `/demo/client-fetch` 接棒。

### 守住探针：payload 判定的纯逻辑测试

gate:ch2 判定「payload 含同源数据」靠的是 `extractPayloadText`——本次给测量库新增的只读工具，把已有的字节提取逻辑开放出文本形态；measure 的输出不受影响。探针自身先要被测试守住（固定 HTML 片段，无网络无时间）。

```ts
// companion/tests/payload.test.ts · payload 探针（纯逻辑，固定 HTML fixture，无网络无时间）
import { describe, expect, it } from 'vitest'
import { extractPayloadBytes, extractPayloadText } from '../scripts/lib/measure-core.mjs'

const FIXTURE_DATA = '["preload",{"id":1,"name":"云朵雨伞","summary":"雨天出门的第一道防线，雨具区第 1 号慢销款。"}]'
const FIXTURE_HTML = [
  '<!DOCTYPE html><html lang="zh-CN"><head>',
  '<script src="/_nuxt/entry.abcd1234.js" crossorigin><\/script>',
  '<script type="application/json" id="__NUXT_DATA__" data-src="/products">',
  FIXTURE_DATA,
  '<\/script>',
  '<script>window.other = 1<\/script>',
  '</head><body><h1>全部商品</h1></body></html>',
].join('')

const SHELL_HTML =
  '<!DOCTYPE html><html><head></head><body><p>商品加载中……蜗牛也在努力。</p></body></html>'

describe('payload 探针（__NUXT_DATA__ 提取）', () => {
  it('有内联 payload 时提取出原始 JSON 文本，同源数据逐字在内', () => {
    const text = extractPayloadText(FIXTURE_HTML)
    expect(text).toBe(FIXTURE_DATA)
    expect(text).toContain('云朵雨伞')
    expect(text).toContain('雨天出门的第一道防线')
  })

  it('提取止于 __NUXT_DATA__ 的闭合标签，不吞并后续 script', () => {
    expect(extractPayloadText(FIXTURE_HTML)).not.toContain('window.other')
  })

  it('客户端取数的壳页面提取为空串，字节数为 0', () => {
    expect(extractPayloadText(SHELL_HTML)).toBe('')
    expect(extractPayloadBytes(SHELL_HTML)).toBe(0)
  })

  it('字节数等于提取文本的 UTF-8 编码长度（中文按字节计）', () => {
    expect(extractPayloadBytes(FIXTURE_HTML)).toBe(Buffer.byteLength(FIXTURE_DATA, 'utf8'))
    expect(extractPayloadBytes(FIXTURE_HTML)).toBeGreaterThan(FIXTURE_DATA.length)
  })
})
```

```text
✓ tests/chaos.test.ts (5)
✓ tests/payload.test.ts (4)
✓ tests/catalog.test.ts (6)
Test Files  3 passed (3)
Tests       15 passed (15)
```

### 指标组复测：前后对账

`pnpm measure` 对新形态自动出数。与基线档案对账，`/products` 一行，逐字段如下：

| 指标组字段 | 基线（改造前） | 本章（改造后） | 方向与解释 |
| --- | --- | --- | --- |
| TTFB | 8.2 / 2.7 ms | 835.5 / 823.2 ms | 上升——等待搬进服务端渲染期 |
| HTML 字节 | 2,110 B | 20,239 B | 上升——装着 24 张真实商品卡片 |
| payload 字节 | 192 B | 4,528 B | 上升——从视图状态变为全目录序列化 |
| 首屏 JS 字节 | 190,089 B（5 块） | 199,183 B（5 块） | 上升 8.9 KiB——异步数据运行时进了首屏 |
| 数据随 HTML | false | true | 本章目标 |
| API 命中计数 | `{}` | `{ '/api/products': 2 }` | 两遍测量＝两次 SSR 渲染各命中 1 |

换算成体感：基线形态里，用户收到 2 KiB 的空壳后，还要等 JS 下载执行、再等 810 毫秒接口；直出形态里，约 0.83 秒时那 20 KiB 的 HTML 已经带着全部商品到齐。**等待没有消失，只是搬了家**——从用户看得见的地方搬进服务端渲染期，换来可见段翻绿。

代价也如实记账：首屏 JS 涨了 8.9 KiB——`useAsyncData` 的运行时分块（9,265 B）进了首屏加载清单。可交互段这笔账怎么拆、怎么瘦，是水合章的正题（第 3 章）。另外三个数据页的判定与 html/payload 字节一个没动；首屏 JS 却因共享运行时分块变大各涨约 0.6 KiB——没改的页面也会被牵连，这笔账怎么算清，同样交给水合章的字节对账（第 3 章）。

## 验证：亲手让链路现形

进入伴生仓，先跑全量门槛，再做四组动作。

```bash
pnpm gate:ch2              # 构建 + 起服 + 13 项断言，应输出「gate:ch2 通过」
pnpm build && pnpm start   # 生产模式起服（默认 4311 端口）
```

**先猜后跑**：执行 `curl -s http://127.0.0.1:4311/products | grep -o 云朵雨伞 | wc -l`，输出是几？A「恰 0」 B「恰 5」 C「20 以上」。再对 `/demo/client-fetch` 跑同一条命令，输出是几？写下两个答案再动手。核对：products 恰 5，client-fetch 恰 0。5 的构成正是四步链路的物证——渲染面 3 处（卡片的无障碍标签、标题、简介开头）＋ payload 序列化 2 处（name 与 summary 字段）；反例页一处都没有，它的数据压根不在 HTML 里。

**浏览器人工观察**（必做的一次口径互补）：打开 `http://127.0.0.1:4311/products`，Network 面板过滤 `products`——刷新几次，只会看到文档请求与 JS 分块，`/api/products` 一次都不会出现：水合复用让第二次请求没有发生的理由。再开 `/demo/client-fetch` 对照：HTML 之后那笔 810 毫秒的 `/api/products` 就在那里。同源验证再加一刀：查看源码搜「雨天出门的第一道防线」，HTML 正文与 `__NUXT_DATA__` 里各能找到——同一个字符串，来自同一次服务端获取。

定向破坏一：把反例搬回来。把 `/products` 的 `<script setup>` 整段替换成 `/demo/client-fetch` 页里的写法（`onMounted` + `$fetch`，加载分支也一并还原）。先写预言再动手：gate:ch2 将恰好红 8 条、绿 5 条；特别注意 `/demo/client-fetch` 自己的三条（返回 200、present=false、加载壳）一条不红——它们守的是反例页本身，跟 `/products` 怎么写无关。跑（记得让脚本重新构建，别设 `SKIP_BUILD=1`），核对预言全中。把页面改回 useAsyncData 版本再跑，13/13 复原。

定向破坏二（变体）：删掉 await。把 `const { data: products, error } = await useAsyncData(...)` 改成不带 `await` 的写法。预言：gate:ch2 十三条一条不红。跑，中。官方文档专门交代过这一点：

```text
"During server rendering, Nuxt waits for the request to resolve before
serializing the page either way (`<Suspense>`, and `onServerPrefetch` under the
hood), so the fully populated result is always sent to the browser."
```

翻译：服务端渲染期间，无论是否 `await`，Nuxt 都会等请求完成再序列化页面（底层是 `<Suspense>` 与 `onServerPrefetch`），发往浏览器的永远是装好数据的结果（出处同上）。

哪条没变：全部。`await` 守的不是直出，而是你自己 `<script setup>` 里后续代码能否立刻依赖 `data`，以及客户端导航要不要等数据就绪——那是加载状态章的战场（第 7 章）。改回复原。

四组实验各探链路一环。curl 探第 2、3 步——HTML 与 payload 里都有数据；Network 探第 4 步——第二次请求不存在。破坏一证明四步链路真来自 useAsyncData 契约，破坏二证明 `await` 不是直出的守门人。

## 自查

1. gate:ch1 至今断言「detail 数据不在 HTML 里（present=false）」。如果你照本章的写法把详情页也改成 `useAsyncData`，哪条断言会先红？据此说明门槛脚本断言的对象是站点的当前形态，还是测量意图？
2. 直出后 `/products` 的 TTFB 从约 8 毫秒涨到约 830 毫秒。构造一个情境，使「TTFB 变大但体验更好」成立；再构造一个使它不成立。（提示：数据对首屏是否必需、接口延迟的量级。）
3. 在浏览器里打开 `/demo/client-fetch` 并等它加载完成：`/api/_hits` 里 `/api/products` 的计数会 +1 吗？`pnpm measure` 的 node 口径能看到这次请求吗？
4. 本章页面在 handler 里用了 `$fetch`，官方却警告「只用 `$fetch` 不行」。这两处 `$fetch` 的差别在哪？

<details>
<summary>参考答案</summary>

1. 「detail present=false」那条先红。门槛断言的是测量意图——页面形态改变时要同步迁移锚点：本章对 `/products` 做的就是这件事，反例搬去 `/demo/client-fetch`，断言跟着锚点走，意图（测量仪能判定已知坏页）不变。
2. 成立：首屏必需的数据＋中等接口延迟——内容到达时刻整体提前、白屏消失，本章即此例。不成立：接口极慢（比如 5 秒）而数据并非首屏必需——用户对着空白等 5 秒，不如先发壳再补数据；这正是「先切页再取数」的 lazy 形态存在的理由（第 7 章）。
3. 会 +1：浏览器发的请求真实到达服务器，命中计数如实累加。但 measure 看不到——它不执行浏览器 JS。这正是两层口径的分工：计数端点记录「发生了什么」，node 代理只看得到服务端渲染路径上发生了什么。
4. handler 里的 `$fetch` 运行在契约管理下：服务端执行、结果进 payload、同 key 去重；`onMounted` 里裸用的 `$fetch` 没有这套机制——请求只在浏览器发生、数据不进 payload、也不参与去重。

</details>

## 收束：白屏的去处

开篇那条分界线现在可以说清机制了：白屏还是直出，不取决于「是不是 SSR」，取决于首屏数据在哪一段被获取——浏览器挂载后，还是服务端渲染期。蜗牛商店的商品列表已经搬到后者。TTFB 里含着 800 毫秒数据等待，20 KiB 的 HTML 装着 24 张卡片，payload 4.4 KiB，一次渲染命中恰 1——指标组的字段各自指认了四步链路的一环。

你带走三块新积木：SSR 数据流——服务端取数、渲染进 HTML、序列化 payload、水合复用的整条链路，由 `useAsyncData` 驱动，是秒开篇章的底座；payload——随 HTML 内联的 `__NUXT_DATA__` 数据行李，查看源码可见、脚本可断言；useAsyncData 契约——`useAsyncData(key, handler)`：同 key 去重、服务端执行、结果进 payload、客户端复用，页面首屏数据的推荐入口。

迁移到真实项目时先问三句：我的页面查看源码搜得到首屏数据吗？payload 里装了多少字节、值这个价吗？key 起对了吗——同 key 的调用共享同一份数据，不同页面的取数误用同一个 key 会互相覆盖。下一站拆首屏 JS 那笔 8.9 KiB 的账（水合与瘦身，第 3 章）；数据随 HTML 到达解决了「进入页面」的等待，「点击导航」不等数据的 lazy 形态在加载状态章展开（第 7 章）。
