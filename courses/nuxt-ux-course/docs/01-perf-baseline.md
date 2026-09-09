---
title: 把『丝滑』变成数字：基线与指标组
---

## 白屏现场：一场吵不出结果的评审会

上线前的体验评审会，常常以同一句话收场：「我觉得挺快的呀。」

设计同学不服：点进商品列表，先看到一行「商品加载中」，要干等一拍内容才出来，这就是白屏。后端同学也不服：接口监控一切正常，首页响应只有几毫秒。负责前端的同学最委屈——这周刚做了一轮优化，感觉上确实顺了一点，但到底快了多少、快在哪一段，拿不出数字。

三个人说的可能都是实话，只是各自盯住了不同的时间窗。要把这场争论裁决掉，靠的不是更多形容词，而是两样东西：一套大家认账的指标口径，和一份优化前就存档的基线数字。

**性能基线**说的是这件事的后一半——优化之前，用一套固定口径测出来、原样存档的一组数字；此后每一次「变快了」的断言都拿它当对照面，口径变了的对比无效。本章要给这套说法装上机械的脚：一个测量脚本、一份 JSON 报告、一道可重复执行的门槛。

白屏现场本身，你马上可以复现。伴生仓是一座刻意做慢的电商演示站「蜗牛商店」：接口带服务端延迟，数据页走客户端取数。安装依赖后以生产模式起服，浏览器打开 `/products`：

```bash
cd courses/nuxt-ux-course/companion
pnpm install
pnpm build && pnpm start   # 默认 4311 端口，可用 PORT 环境变量覆盖
```

你会看到「商品加载中……蜗牛也在努力。」停留大约一秒才让位给商品网格。本章不修它，只负责把它测准——修掉它是数据流改造的事（第 2 章）。

## 把『丝滑』拆成四段：指标口径

「快」是个混合词。从用户敲下回车到能安稳使用，中间至少有四段，每段回答一个独立的问题，各有各的指标。先给出口径总表，再逐段展开：

| 阶段 | 回答的问题 | 代理指标 | 谁能测 |
| --- | --- | --- | --- |
| 到达 | 服务器的回应来了吗 | TTFB、HTML 字节 | node 脚本可测 |
| 可见 | 屏幕上有真内容了吗 | 数据是否随 HTML 到达、payload 字节、LCP | 前两项 node 可测，LCP 要浏览器 |
| 可交互 | 点了有反应吗 | 首屏 JS 字节、INP | 字节 node 可测，INP 要浏览器 |
| 稳定 | 页面跳不跳 | CLS | 要浏览器 |

这张表合起来有个名字：**首屏指标组**——覆盖「到达—可见—可交互—稳定」四个阶段的一组指标搭配。它存在的理由只有一个：单看任何一个指标，都可能把优化力气花错方向。蜗牛商店就是活例，先卖个关子，量完数字再回来对账。

### 到达：TTFB 与 HTML 字节

**TTFB**（Time To First Byte，首字节时间）——从发出请求到收到响应第一个字节经过的时间。它的构成只有两块：服务器算出这份响应的时间，加上一个网络往返。对 SSR 站来说这是第一道门：门没开，后面一切免谈。

在 node 里测它不需要任何特殊设施：记下发请求的时刻 `t0`，收到响应流第一个字节时再记一次，差值就是 TTFB。HTML 字节则是这道门里送出的货有多大，两个字段一起构成「到达」段的完整口径。

这里有个反直觉的事实值得先立此存照：TTFB 快，页面照样可能白屏。蜗牛商店的商品页就是——数字后面见。

### 可见：数据是否随 HTML 到达

HTML 到了，不等于内容到了。同样是 SSR 页面，至少有两种数据路径：一种在服务端就把数据取好、渲染成 HTML 一起发过来；另一种只渲染一个「加载中」的壳，数据要等浏览器下载完 JS、跑起来之后自己再发一次请求去要。用户看到的区别就是「一开就有」和「白等一拍」。

判据可以很土，但很硬：挑一个只可能来自数据的特征串（比如某件商品的名字），看它在不在 HTML 源码里。在，说明数据随 HTML 到达；不在，说明首屏内容要靠第二次请求。顺带记账的还有 payload 字节——Nuxt 会把服务端拿到的数据序列化成一段内联 JSON 注进 HTML，这段载体叫 payload；数据没在服务端取的页面，这里几乎只剩视图状态（第 2 章展开它的完整机制）。

有读者会直觉反驳：SSR 页面的数据不就在 HTML 里吗？这个直觉对了一半——Nuxt 默认在服务端渲染没错，但「在服务端渲染」不等于「在服务端取数据」。`onMounted` 里发请求的代码照样会在服务端渲染出漂亮的外壳，然后把数据问题留给浏览器。蜗牛商店的商品页就是这个写法，下一节你会亲眼看到它的代价。

### 可交互：首屏 JS 字节

页面画出来了，不等于能点。接管 HTML、响应点击的是浏览器里的 JS：下载、解析、执行、接管，每一步都要时间。这一段的 node 侧代理指标是首屏 JS 字节——HTML 里声明的 `<script src>` 与 `modulepreload` 指向的 `_nuxt` 分块，逐个查文件大小加总。它不是可交互延迟本身，但它是这段成本里最容易对账、也最容易失控的账本。

交互响应本身（INP）要浏览器才能测，node 侧先记字节、后见真章。

### 稳定：CLS

第四段讲布局稳定：文字先出来、图片后到把文字顶下去，按钮在你要点的那一瞬挪了位置。累计布局偏移（CLS）量化这件事，但它纯发生在渲染与交互层，node 侧没有任何代理手段。本章的处理是诚实记账：指标组里给它留位置，测量交给浏览器口径。

## node 代理指标与浏览器指标的分工

有个流行的说法：性能指标是运维的事，前端只管改代码。分工表可以直接拆掉这个说法——四段口径里，一大半字段一个 node 脚本就能量：状态码、TTFB、HTML 字节、payload 字节、首屏 JS 字节、数据是否随 HTML 到达、接口命中计数。不依赖监控平台，不依赖权限审批，前端自己写、自己跑、进自己的门槛脚本。

剩下量不出的那一半有个正式的名字：**Core Web Vitals**（核心网页指标）——Google 定义的三项核心体验指标。加载用 LCP（最大内容绘制）度量；交互响应用 INP 度量；视觉稳定用 CLS 度量。三者的合格线分别是 LCP 不超过 2.5 秒、INP 不超过 200 毫秒、CLS 不超过 0.1。阈值与判定口径的出处是 [web.dev 的 Web Vitals 页](https://web.dev/articles/vitals)（页面 2024-10 更新，2026-09 复核）。

判定口径同样来自该页：不看平均值，按 75 分位——把一段时间的真实访问按耗时排序，取第 75% 位置的值；它达标意味着至少四分之三的访问达标。选这个口径是为了让多数用户的真实体验说了算，而不是让最快的少数访问美化门面。

于是分层很清楚：node 代理指标可以机械化——写进门槛脚本，每次构建后自动断言，数字漂了立刻报警；Core Web Vitals 需要真实浏览器与真实交互，本课程把它作为人工观察信号与优化方向的标尺，不做机械断言。两层各管一段，谁也不冒充谁。这也回答了「为什么不用一个 Lighthouse 分数包打天下」：实验室单次跑分既不稳定，也覆盖不了四段里的机器可判字段。

## 演练：给蜗牛商店装上测量仪

本章的实验场从零搭起：先让「慢」有确定的来源，再用测试守住这份确定性，最后装上测量仪、立起门槛。本章结束态已快照在 `companion/steps/ch01-perf-baseline/`，与根目录一致；此后各章只改根目录，快照不动，方便逐章对比。

### 「慢」的来源：确定性目录与延迟注入

一切测量的前提是可重复，所以「慢」本身也要确定。商品目录由代码生成：24 件商品的名字与类别写死，价格、评分、简介由 id 经固定公式推导，同一份代码永远吐出同一份目录。延迟与故障则集中在一个服务端模块里：

```ts
// companion/server/utils/chaos.ts · 故障注入与命中计数（服务端内存态，进程重启即归零）
// 本章只负责把接口建好并启用默认延迟；故障开关留给后续章节做错误处理与弱网演练。
export type FailMode = 'none' | 'api500'

export interface ChaosState {
  /** null = 使用各端点默认延迟；数字 = 全端点统一覆盖（0 表示全部关延迟） */
  delayMs: number | null
  fail: FailMode
}

/** 各端点的默认服务端延迟——蜗牛商店“刻意做慢”的全部来源，measure 口径的一部分 */
export const DEFAULT_DELAYS: Record<string, number> = {
  '/api/products': 800,
  '/api/products/:id': 500,
  '/api/search': 600,
  '/api/favorites': 300,
}

const state: ChaosState = { delayMs: null, fail: 'none' }
const hits: Record<string, number> = {}

export function recordHit(endpoint: string): number {
  hits[endpoint] = (hits[endpoint] ?? 0) + 1
  return hits[endpoint]
}

export function getHits(): Record<string, number> {
  return { ...hits }
}

export function getChaos(): ChaosState & { defaultDelays: Record<string, number> } {
  return {
    delayMs: state.delayMs,
    fail: state.fail,
    defaultDelays: { ...DEFAULT_DELAYS },
  }
}

export function setChaos(delayMs: number | null, fail: FailMode): void {
  state.delayMs = delayMs
  state.fail = fail
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 每个数据端点进入业务逻辑前调用：先睡出可观察的延迟，再报告本端点是否该失败。
// 返回值而不是直接抛错，是为了让本模块保持纯逻辑、可被 vitest 直接测试。
export async function applyChaos(endpoint: string): Promise<'ok' | 'fail'> {
  const delay = state.delayMs ?? DEFAULT_DELAYS[endpoint] ?? 0
  if (delay > 0) await sleep(delay)
  return state.fail === 'api500' && endpoint === '/api/products' ? 'fail' : 'ok'
}
```

`DEFAULT_DELAYS` 是全站「刻意做慢」的唯一来源：商品列表 800 毫秒、详情 500、搜索 600、收藏 300。`POST /api/_chaos` 可以在运行时注入 `{ delayMs, fail }` 改写它（本章先建好接口，故障注入是后续错误处理与弱网演练的道具）；`GET /api/_hits` 读各端点命中计数。每个数据端点的写法都一样，以商品列表为例。

```ts
// companion/server/api/products/index.get.ts · GET /api/products —— 全量目录（默认 800ms 延迟）
export default defineEventHandler(async () => {
  recordHit('/api/products')
  if ((await applyChaos('/api/products')) === 'fail')
    throw createError({ statusCode: 500, statusMessage: 'chaos: api500' })
  return listCatalog()
})
```

被测的四个数据页里，商品列表是承重反例——首版故意用了「客户端挂载后再取数」的次优写法。

```vue
<script setup lang="ts">
// companion/app/pages/products/index.vue · 商品列表（基线版：onMounted + $fetch 的客户端取数）
import type { Product } from '#shared/types'

useHead({ title: '全部商品' })

// 基线版的已知反例：等组件在浏览器里挂载后才发起请求。
// HTML 先走、数据后到——首屏白等正是后续章节要修的路径，本章只负责把它测准。
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

<template>
  <section>
    <h1>全部商品</h1>
    <p v-if="error" class="state state-error">加载失败：{{ error }}</p>
    <p v-else-if="!products" class="state state-loading">商品加载中……蜗牛也在努力。</p>
    <div v-else class="grid">
      <ProductCard v-for="p in products" :key="p.id" :product="p" />
    </div>
  </section>
</template>
```

`onMounted` 在服务端渲染时不执行，所以 SSR 只输出那句「商品加载中」；商品数据要等浏览器接手后才发请求，再撞上 800 毫秒的注入延迟。目录的推导逻辑长这样（文件开头另有 24 行写死的名字表和四条简介模板，纯数据无逻辑）：

```ts
// companion/server/utils/catalog.ts · listCatalog / getProduct / searchCatalog / favorites
export const CATALOG_SIZE = RAW_ITEMS.length

export function listCatalog(): Product[] {
  return RAW_ITEMS.map(([name, category], index) => {
    const id = index + 1
    return {
      id,
      name,
      category,
      priceYuan: 39 + ((id * 37) % 90) * 3,
      rating: Math.round((3.6 + (id % 14) / 10) * 10) / 10,
      summary: SUMMARY_BY_CATEGORY[category]
        .replaceAll('{name}', name)
        .replaceAll('{id}', String(id)),
    }
  })
}

export function getProduct(id: number): Product | undefined {
  if (!Number.isInteger(id) || id < 1 || id > CATALOG_SIZE) return undefined
  return listCatalog()[id - 1]
}

export function searchCatalog(query: string): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return listCatalog().filter(
    (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  )
}

// 收藏清单：固定 3 件（第 9 章才把它变成可交互的写入）
export function favorites(): Product[] {
  return [2, 8, 15]
    .map((id) => getProduct(id))
    .filter((p): p is Product => p !== undefined)
}
```

### 先红后绿：用测试守住确定性

目录一旦不确定，两次测量之间的任何差异都说不清是优化还是噪声。所以第一块验证物不是测量仪，而是目录的确定性测试。先写测试、后写实现，让它真实地红一次。

```ts
// companion/tests/catalog.test.ts · 商品目录的确定性（节选 2/6 例，先红后绿：目录生成器尚未实现；另 4 例覆盖 getProduct 越界、搜索命中与收藏子集，见伴生仓终态）
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SIZE,
  favorites,
  getProduct,
  listCatalog,
  searchCatalog,
} from '../server/utils/catalog'

describe('商品目录（确定性）', () => {
  it('目录恰好 24 件，id 从 1 连续编号', () => {
    const items = listCatalog()
    expect(items).toHaveLength(CATALOG_SIZE)
    expect(CATALOG_SIZE).toBe(24)
    expect(items.map((p) => p.id)).toEqual(
      Array.from({ length: CATALOG_SIZE }, (_, i) => i + 1),
    )
  })

  it('两次生成的目录逐字段完全一致', () => {
    expect(listCatalog()).toEqual(listCatalog())
  })
})
```

此刻 `server/utils/catalog.ts` 还不存在，跑 `pnpm test`，红得干干净净——是「能力尚未实现」的红，不是环境错误。

```text
FAIL  tests/catalog.test.ts [ tests/catalog.test.ts ]
FAIL  tests/chaos.test.ts [ tests/chaos.test.ts ]
Error: Cannot find module '../server/utils/catalog' imported from
  D:/.../companion/tests/catalog.test.ts
Error: Cannot find module '../server/utils/chaos' imported from
  D:/.../companion/tests/chaos.test.ts
Test Files  2 failed (2)
Tests  no tests
```

补上 `catalog.ts` 与 `chaos.ts` 两个模块，再跑。chaos 的测试是同文件风格，校验三件事：默认延迟 800 毫秒在表、开关可覆盖、命中计数累加。

```text
✓ 商品目录（确定性）(6)
✓ 故障注入与命中计数（内存态）(5)
Test Files  2 passed (2)
Tests       11 passed (11)
```

红绿之间只发生了一件事：目录与延迟从「不存在」变成「存在且确定」。这份确定性是后面所有数字的地基。

### measure：一次输出整组数字

测量仪的核心在 `scripts/lib/measure-core.mjs`，它定义了测谁、用什么特征串判「数据随 HTML 到达」。

```js
// companion/scripts/lib/measure-core.mjs · ROUTES 与 API_ENDPOINTS
/** 关键页面清单：path 为请求路径；probes 为“数据应出现的特征串”（静态文案也算数据面） */
export const ROUTES = [
  { label: 'home',      path: '/',            probes: ['蜗牛商店', '慢慢来'] },
  { label: 'products',  path: '/products',    probes: ['云朵雨伞', '慢炖陶锅'] },
  { label: 'detail',    path: '/products/1',  probes: ['云朵雨伞'] },
  { label: 'search',    path: '/search?q=%E9%9B%A8', probes: ['云朵雨伞'] }, // q=雨
  { label: 'favorites', path: '/favorites',   probes: ['竹柄油纸伞'] },
]

/** 直测的数据端点（默认带服务端延迟，量出来就是延迟后的 TTFB） */
export const API_ENDPOINTS = [{ label: 'api-products', path: '/api/products' }]
```

三个测量原语——计时、payload 提取、首屏 JS 对账——各自只做一件事。

```js
// companion/scripts/lib/measure-core.mjs · requestPage / extractPayloadBytes / firstLoadJs
const round1 = (n) => Math.round(n * 10) / 10

/** 原始 HTTP GET：量状态码、TTFB（首字节）与完整响应体 */
export function requestPage(base, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base)
    const t0 = performance.now()
    const req = http.get(url, (res) => {
      const chunks = []
      let ttfbMs = null
      res.on('data', (chunk) => {
        if (ttfbMs === null) ttfbMs = performance.now() - t0
        chunks.push(chunk)
      })
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          ttfbMs: ttfbMs ?? performance.now() - t0,
          body: Buffer.concat(chunks),
        }),
      )
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

const NUXT_DATA_RE = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/

/** 提取内联 payload（Nuxt 注入的 __NUXT_DATA__ JSON）的字节数；没有则 0 */
export function extractPayloadBytes(html) {
  const m = NUXT_DATA_RE.exec(html)
  return m ? Buffer.byteLength(m[1], 'utf8') : 0
}

/** 首屏 JS：HTML 里 <script src> 与 <link rel=modulepreload> 声明的 _nuxt 分块字节清单 */
export function firstLoadJs(html) {
  const urls = new Set()
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g))
    if (m[1].includes('_nuxt/') && m[1].endsWith('.js')) urls.add(m[1])
  for (const m of html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*>/g)) {
    const href = /href="([^"]+)"/.exec(m[0])?.[1]
    if (href && href.includes('_nuxt/') && href.endsWith('.js')) urls.add(href)
  }
  const chunks = []
  let bytes = 0
  for (const u of urls) {
    const name = u.split('/').pop()
    const file = join(ROOT, '.output', 'public', '_nuxt', name)
    if (!existsSync(file)) continue
    const size = statSync(file).size
    bytes += size
    chunks.push({ file: `_nuxt/${name}`, bytes: size })
  }
  chunks.sort((a, b) => b.bytes - a.bytes)
  return { bytes, count: chunks.length, chunks }
}
```

组装层把每个页面拼成一条完整记录，页面族跑两遍提供重复性证据；命中计数在直测端点之前读取，保证它只反映页面请求触发的服务端调用，不混入测量脚本自己的探测。

```js
// companion/scripts/lib/measure-core.mjs · measureRoute / measureAll
/** 测单个页面：状态/TTFB/HTML 字节/payload 字节/首屏 JS/数据是否随 HTML 到达 */
export async function measureRoute(base, route) {
  const r = await requestPage(base, route.path)
  const html = r.body.toString('utf8')
  return {
    label: route.label,
    path: route.path,
    status: r.status,
    ttfbMs: round1(r.ttfbMs),
    htmlBytes: r.body.length,
    payloadBytes: extractPayloadBytes(html),
    dataWithHtml: {
      probes: route.probes,
      present: route.probes.some((p) => html.includes(p)),
    },
    firstLoadJs: firstLoadJs(html),
  }
}

export async function getJson(base, path) {
  const res = await fetch(new URL(path, base), { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`)
  return res.json()
}

/** 全量测量：关键页面跑两遍（稳定性与重复口径证据）→ 读命中计数 → 直测端点 */
export async function measureAll(base) {
  const passes = []
  for (let i = 0; i < 2; i++) {
    const routes = []
    for (const route of ROUTES) routes.push(await measureRoute(base, route))
    passes.push(routes)
  }
  // 先读命中再直测端点：apiHits 只反映“页面请求”触发的服务端数据调用，
  // 不混入测量脚本自己对 /api/products 的探测请求。
  const apiHits = await getJson(base, '/api/_hits')
  const chaos = await getJson(base, '/api/_chaos')
  const endpoints = []
  for (const e of API_ENDPOINTS) {
    const r = await requestPage(base, e.path)
    endpoints.push({ label: e.label, path: e.path, status: r.status, ttfbMs: round1(r.ttfbMs) })
  }
  return { passes, endpoints, apiHits, chaos }
}
```

入口脚本 `scripts/measure.mjs` 负责「构建 → 起服（4311 端口）→ 测量 → 写报告」，对基线站跑一次并把结果存成对照档案。

```bash
node scripts/measure.mjs --out reports/baseline.json
```

真实输出如下（节选自作者机的一次完整运行）。

```text
页面       状态  TTFB(run1/run2)      HTML      payload  首屏JS     数据随HTML
home       200   8.6   /4.9 ms  2.6 KiB   0.2 KiB  184.8 KiB  true
products   200   8.2   /2.7 ms  2.1 KiB   0.2 KiB  185.6 KiB  false
detail     200   6.5   /4.2 ms  1.9 KiB   0.2 KiB  184.9 KiB  false
search     200   6.9   /8.4 ms  2.2 KiB   0.2 KiB  186.4 KiB  false
favorites  200   5.9   /3.4 ms  2.1 KiB   0.2 KiB  185.6 KiB  false
端点 api-products   状态 200  TTFB 810.1 ms
API 命中计数：{}
```

逐条读这份基线，四段口径各有一个刺眼的数字。

| 指标组字段 | 基线值（/products） | 说明 |
| --- | --- | --- |
| 状态 | 200 | 服务正常，争论不在这一段 |
| TTFB | 8.2 / 2.7 ms | 快得离谱——SSR 只渲染了壳，没等任何数据 |
| HTML 字节 | 2,110 B | 壳很小，因为里面没有商品 |
| payload 字节 | 192 B | 服务端没取数，payload 只剩视图状态 |
| 首屏 JS 字节 | 190,089 B（5 块） | 其中三块共享运行时约 184 KiB，页面自身分块不足 2 KiB |
| 数据随 HTML | false | 「云朵雨伞」们不在 HTML 里，全靠浏览器二次请求 |
| `/api/products` TTFB | 810.1 ms | 注入的 800 ms 延迟几乎原样出现在端点口径里 |
| API 命中计数 | 0 | node 直取页面时一个数据接口都没响——请求是页面 JS 发的 |

现在可以回收开篇那个反直觉的断言了：商品页 TTFB 只有几毫秒，用户却要白等一秒上下。**白屏不白屏，不取决于 TTFB**——取决于数据在哪一段到达。浏览器里的真实时间线是：HTML 毫秒级到达（到达段绿灯）→ 屏幕上是「加载中」（可见段红灯）→ JS 下载执行后再发 `/api/products`、再等 810 毫秒。评审会上设计同学与后端同学各自指着的，正是这条时间线的两端。

顺带注意「API 命中 0」这个字段的微妙：它不是说接口没人调，而是说 node 代理口径看不到页面 JS 发出的调用——浏览器里打开 `/products`，Network 面板会看到那次命中。这正是两层口径分工的实证，也预告了一个反向用法：等数据流改到服务端后，这个字段会变成 1，一行断言就能守住。

### gate:ch1：把口径变成断言

报告是给自己看的，门槛是给机器看的。`scripts/e2e-ch1.mjs`（`pnpm gate:ch1`）自起服务器、复测指标组，按四类断言裁决：

- 口径完整——每个页面的每个字段存在且类型可判定；
- 数值合理——全部 200、字节为正、页面 TTFB 落在 SSR 壳渲染的合理区间；
- 重复稳定——两遍测量的状态、三类字节、数据判定逐一相等，TTFB 差异落在容忍带内；
- 基线事实——刻意设计的慢必须如实出现在数字里。

第四类是本章的灵魂，节选自门槛脚本。

```js
// companion/scripts/e2e-ch1.mjs · 断言组 C：基线事实
const byLabel = Object.fromEntries(run1.map((r) => [r.label, r]))
check(
  byLabel.home.dataWithHtml.present === true,
  '基线事实：首页静态内容随 HTML 直出（present=true）',
)
for (const label of ['products', 'detail', 'search', 'favorites'])
  check(
    byLabel[label].dataWithHtml.present === false,
    `基线事实：${label} 数据不在 HTML 里（客户端取数反例，present=false）`,
  )
for (const endpoint of ['/api/products', '/api/products/:id', '/api/search', '/api/favorites'])
  check(
    (apiHits[endpoint] ?? 0) === 0,
    `基线事实：node 直取页面时 ${endpoint} 命中 0 次（客户端发的请求 node 代理看不到）`,
  )
const api = endpoints.find((e) => e.label === 'api-products')
check(api.status === 200, '基线事实：/api/products 返回 200')
check(
  api.ttfbMs >= 750 && api.ttfbMs <= 5000,
  `基线事实：/api/products TTFB 落在注入延迟 800ms 附近（实际 ${api.ttfbMs}ms）`,
)
check(
  chaos.delayMs === null && chaos.fail === 'none',
  '基线事实：测量时故障开关处于默认态（delayMs=null, fail=none）',
)
```

完整跑一遍（构建、起服、断言、清理，全流程退出码 0）。

```text
gate:ch1 —— 109/109 项通过；报告：reports/gate-ch1.json
gate:ch1 通过
```

重建后重跑、换端口重跑，结果一致：字节两遍完全相同，TTFB 只有几毫秒的本机抖动——数字稳定，差异可解释。基线报告 `reports/baseline.json` 与门槛报告 `reports/gate-ch1.json` 都已随仓库存档，作为此后一切「变快了」的对照面。

## 验证：亲手跑出你的第一份基线

现在轮到你。进入伴生仓根目录（或 `steps/ch01-perf-baseline/` 快照，两者当前一致），先完成安装与全量门槛。

```bash
pnpm install        # postinstall 会自动执行 nuxt prepare 生成类型
pnpm gate:ch1       # 构建 + 起服 + 109 项断言，应输出「gate:ch1 通过」
```

**先猜后跑**：在跑下面这条命令之前，拿纸笔对 `/products` 页面写下三个离散答案。

1. 页面 TTFB：A「20 ms 以内」 B「800 ms 左右」 C「超过 2 s」；
2. 数据随 HTML 到达：true 还是 false；
3. `/api/products` 直测 TTFB：A「20 ms 以内」 B「800 ms 左右」 C「超过 2 s」。

然后执行 `node scripts/measure.mjs --out reports/my-first.json`，打开 JSON 对照。如果你的第 1 题猜了 B——「接口那么慢，页面肯定慢」——你已经体会了本章最重要的一课：接口的 800 毫秒根本不在 SSR 的路径上，页面 TTFB 快与白屏可以同时成立。

**定向破坏一：拆掉延迟，看哪个字段动**。打开 `server/utils/chaos.ts`，找到 `DEFAULT_DELAYS` 表里这一行：

```ts
  '/api/products': 800,
```

把它改成 `'/api/products': 0,`。先写下预言再动手：重跑 `pnpm measure` 后，`/api/products` 的 TTFB 应从 810 ms 一档跌进个位数毫秒；而五个页面的 TTFB、HTML 字节、payload 字节、首屏 JS 字节、数据随 HTML 判定——一个都不该动。注意必须让 measure 重新构建（生产服务器跑的是构建产物，别用 `SKIP_BUILD=1`）。跑完对照：预言全中。解释也直白：这个开关守的只有「到达段·接口视角」的等待时间，页面 HTML 从来没等过它。把 800 改回去，再跑一次 measure，确认 810 ms 一档的 TTFB 复原。

**定向破坏二：污染探针，看口径怎么坏**。打开 `scripts/lib/measure-core.mjs`，把 `ROUTES` 里 products 行的探针 `'云朵雨伞'` 改成 `'商品加载中'`。预言：`SKIP_BUILD=1 node scripts/measure.mjs` 重跑后，products 的「数据随 HTML」翻成 true——而站点一行代码都没动。跑，中。这一变体守的是口径本身：探针必须是只可能来自数据的特征串，拿壳文案当探针，测到的不是数据而是模板。「可见段」的判据坏了，不吵大架，但从此每个数字都可疑。改回 `'云朵雨伞'`，确认回到 false。

最后补上浏览器口径的一次人工观察：`pnpm build && pnpm start` 后打开 `http://127.0.0.1:4311/products`，Network 面板里能看到 HTML 之后那次 800 多毫秒的 `/api/products` 请求——node 报告里「命中 0」的另一半真相。有兴致的话再开 Lighthouse 看一眼 LCP 的量级，对照 2.5 秒的合格线感受基线站离「丝滑」有多远。

三个实验合起来验证的是同一件事：指标组的每个字段各守一段，动 A 不该动 B；动了不该动的，说明测错了东西而不是站变快了。

## 自查

1. 同事汇报：「新站 TTFB 90 ms，非常快，不用再优化了。」指标组里哪两个字段可以直接反驳他？（回查「可见」与「可交互」两节）
2. 假如把商品列表页改成服务端取数、数据渲染进 HTML：TTFB、「数据随 HTML」、`/api/products` 的命中计数、payload 字节，各自往哪个方向动？先写四个答案，再到（第 2 章）里对账。
3. 一个站的 LCP 75 分位值是 2.6 秒，合格吗？75 分位合格保住的是什么？（回查 Core Web Vitals 一节）
4. `{TTFB, LCP, INP, CLS, 首屏 JS 字节}` 里哪些可以只用 node 脚本测？依据是什么？
5. 为什么基线必须在动手优化之前存档？优化做完再补测一份「优化前报告」为什么不行？

<details>
<summary>参考答案</summary>

1. 「数据随 HTML」（false 则首屏白等）与「首屏 JS 字节」（过大则可见不可点）。TTFB 只覆盖到达段。
2. TTFB 上升（SSR 要等接口的 800 ms，大约从 5 ms 涨到 800 ms 量级）；数据随 HTML 变 true；命中计数变 1（请求发生在服务端渲染期，node 口径看得到）；payload 字节显著变大（商品数据序列化进 HTML）。
3. 不合格。LCP 阈值 2.5 秒按 75 分位判定：75 分位值 2.6 秒意味着至少四分之一的访问慢于 2.6 秒，多数达标线没过。
4. TTFB 与首屏 JS 字节（HTTP 计时与产物文件大小，不依赖渲染）；LCP/INP/CLS 分别依赖绘制、交互、布局，必须进浏览器。
5. 优化后再造「优化前」状态，要么靠回滚代码重测（口径与代码都容易走样），要么靠记忆。基线的价值在「同一口径、优化前、原样存档」，事后补测两头都占不住。
</details>

## 收束：回到那场评审会

那场评审会如果再开一次，争论可以逐句重述成口径问题：设计同学说的白屏是「可见段」——数据没随 HTML 到达，浏览器要二次请求再等 810 毫秒；后端同学说的几毫秒是「到达段」——完全正确，但只覆盖了四段里的一段；前端同学的「感觉顺了」现在有了对账方式——跟存档的 `reports/baseline.json` 比，每个数字的变动都能指到具体一段。没有人错，缺的只是同一把尺子。

这把尺子由四块积木拼成，此后全书反复调用：性能基线——固定口径、优化前存档的对照数字，接口是「跑一次测量脚本、把报告存档」；TTFB——请求到首字节的耗时，到达段的计时读数；首屏指标组——四阶段 × 代理指标的搭配表，一次输出整组 JSON，单指标会骗人，指标组不会；Core Web Vitals——LCP/INP/CLS 三项浏览器口径的合格线（2.5 s / 200 ms / 0.1，75 分位判定），作为人工观察信号与优化方向。

你带走的不只是四个词：一台自己写的测量仪（measure 脚本 + 确定性被测试守护的慢站）、一份可对账的基线档案、一道每次改动后可重跑的门槛。迁移到真实项目时先问三个问题：我的四段口径各用什么字段？基线存档了吗？门槛进 CI 了吗？下一站，把这组数字里最刺眼的一个——数据不随 HTML 到达——亲手修掉（第 2 章）。
