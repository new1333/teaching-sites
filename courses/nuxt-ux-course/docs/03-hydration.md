---
title: 看得见点不动：水合成本与瘦身
---

## 工具箱

商品详情页要请进一位重客人：一张手写的价格走势图，连逻辑带样式约一千行。动手之前，先清点这单改造要调用的三块旧积木。

- SSR 数据流——数据在服务端渲染期获取、渲染进 HTML、序列化进 payload、水合复用的整条链路，由 useAsyncData 驱动（第 2 章）。
- payload——随 HTML 内联的 `__NUXT_DATA__` 数据行李，水合时客户端直接从它取数、不重复请求（第 2 章）。
- 性能基线——固定口径、优化前就存档的对照数字；伴生仓里 `reports/` 下的各份 JSON 都是账本，本章每个「变瘦了」都拿存档对账（第 1 章）。

本章结束时，你会再多三块：水合、可交互延迟、代码分割——它们合起来回答一个问题：页面明明画出来了，为什么点不动，以及怎么把这份「点不动」的成本瘦身。

## 可见≠可用的现场

先做一个小实验，只需要浏览器。以生产模式起服，打开 `http://127.0.0.1:4311/products`，DevTools 的 Network 面板开着，给网络加一档节流。商品网格会随 HTML 一起到——这是数据直出的成果，到达段与可见段都是绿的。现在掐着内容刚出现的瞬间，点「看详情」。盯着 Network 面板：这一下点击触发的是一笔 `document` 类型的请求——整个页面被浏览器当作普通链接，走了一趟 1990 年代式的整页跳转。等页面稳定下来再点「← 回商品列表」，同样的一下点击不再产生 `document` 请求，地址变了、页面没刷。同一只鼠标、同一个链接，前后两种行为，中间隔着的只是几秒钟的等待。

这段「内容已经看见、交互还不属于你」的真空，有个名字：**可见不可点**。它的机制载体叫水合（hydration）——浏览器里的 JS 接管服务端渲染的 HTML、重建响应式状态与事件监听的过程；水合完成前，页面可见但不可交互。真空期里的点击并没有排队：链接靠 `href` 兜底，退化成整页跳转；按钮没有原生兜底，点了就是没反应。等价的反事实也成立——如果 JS 永远不来，这个页面永远停留在「能看」：导航永远走整页刷新，任何悬浮、勾选、展开都不存在。

一个流行的判断会说：页面显示出来就等于可以交互。这个直觉来自纯 SPA 的经验——SPA 里内容和交互同生同灭，JS 没跑屏幕就是白的，「看得见」天然蕴含「点得动」。SSR 把这层蕴含拆开了：可见来自 HTML，可交互来自 JS 接管，两件事、两份成本、两条时间线。本章要处理的就是第二条时间线：它有多长、贵在哪、怎么把最重的一段搬走。

## 原理：水合在做什么

### 接管：同一段代码，浏览器里再跑一遍

HTML 到手之后发生了什么，官方渲染文档有一段直白的描述：

```text
"The same JavaScript code that once ran on the server runs on the client (browser)
again in the background ... This is called Hydration. When hydration is complete,
the page can enjoy benefits such as dynamic interfaces and page transitions."
```

翻译：同一段曾在服务端运行过的 JavaScript 代码，会在客户端（浏览器）后台再运行一遍……这就是水合。水合完成之后，页面才能享受动态界面与页面过渡这些能力（nuxt.com/docs/4.x · Rendering，文档版本 v4.5.2，2026-09-09 核实）。

「再跑一遍」具体是三个动作。第一，下载并执行首屏 JS——构建产物里那些 `_nuxt` 分块，此刻才真正变成活代码。第二，重建响应式状态——组件的 setup 重新执行，数据不重新请求，直接从 payload 这个随 HTML 到达的数据行李里取（这份行李的来历与形态，见工具箱里的接口回顾）。第三，把事件监听绑回 DOM——水合前后的界面看起来一模一样，区别只在 DOM 节点上有没有挂监听器。开篇实验里那笔 `document` 请求，就是「还没绑上 `click` 监听、浏览器只能按原生链接处理」的直接后果。

### 可交互延迟：三段成本

从「页面可见」到「能响应输入」的时间差，就是**可交互延迟**——它主要由 JS 的下载、解析与执行、以及水合接管构成，是指标组里「可交互」一段的体验实体。浏览器侧的量化口径是 Core Web Vitals 里的 INP（交互响应，200 毫秒内合格，75 分位判定；node 脚本测不了它，只能人工观察）（第 1 章）。node 侧能替它记账的代理指标，是首屏 JS 字节——不是延迟本身，但它是这段成本里最容易失控、也最容易对账的账本。

第二个流行判断在这里等着：JS 多只是下载慢，不影响点击响应。替它说句公道话：在「带宽是唯一瓶颈、CPU 无限快」的理想网络里，它成立。它失效的边界在于剩下两段成本同样按字节计价——解析与编译发生在主线程，执行与接管（跑组件代码、建响应式状态、遍历 DOM 绑监听）也在主线程，而首次点击恰恰要在这条线程上排队。同样的字节，在低端手机的 CPU 上解析执行得更慢，这是硬件行为，与框架无关。所以三段成本合起来读：下载按带宽计价，解析执行按 CPU 计价，三段都在用户的第一次点击之前。

顺带划清一条边界：payload 只解决「水合时数据从哪来」——省掉一段可能白屏的重复请求，但它一个字节也不省 JS 本身的账。数据行李再轻，接管 HTML 的活代码该多大还是多大。给活代码瘦身，是另一门手艺。

### 代码分割：把不急的字节搬出首屏

这门手艺的总纲叫**代码分割**——构建工具把代码按路由、按组件切成彼此独立的分块，浏览器按需加载，而不是把全站打成一个大包裹。

先盘点已经免费拿到的那一半：路由级分割。Nuxt 的每个页面天然是一个独立分块，进站首屏只加载当前页自己的那一份。指标组里早有证据——每个页面的首屏清单里，页面自身分块只有一至两 KiB，清单的其余部分是多个页面共享的运行时分块；离开当前页去别的页面，才加载别的页面分块。但路由级分割管不到「首屏页面肚子里的重组件」：首屏页面同步引用的组件，会被打进这个页面的分块，随首屏一起到——不管用户此刻急不急着用它。

把「首屏页面里不急的组件」也移出去，Nuxt 给的扳手是 Lazy 前缀：

```text
"By using the `Lazy` prefix you can delay loading the component code until the
right moment ... This is particularly useful if the component is not always needed."
```

翻译：使用 `Lazy` 前缀可以把组件代码的加载推迟到合适的时机。当组件并非总是被需要时，这尤其有用（nuxt.com/docs/4.x · Directory Structure / Components，文档版本 v4.5.2，2026-09-09 核实）。名字里带 Lazy 的是同一个组件的懒形态：模板里写 `<LazyPriceTrendChart>`，构建时就从静态 import 变成动态 import，产出独立分块。

不过这支扳手有它的边界，官方文档同样写得坦白：

```text
"Lazy components are great for controlling the chunk sizes in your app, but they
don't always enhance runtime performance ... as they still load eagerly unless
conditionally rendered."
```

翻译：Lazy 组件很适合控制应用的分块体积，但并不总能改善运行时性能……因为除非条件渲染，它们仍然会被立即加载（出处同上）。演练里会亲手撞上这句话，然后再请出第二支扳手。

到这里，瘦身的思路可以收成三板斧。「分割」——按路由、按组件切分块，让「不在此页」的代码根本不来；「延迟」——Lazy 前缀加延迟水合，让「在此页但不急」的代码离开关键路径；「去重」——共享代码进共享分块，五个页面的首屏清单里都写着那几块共享运行时，但浏览器一次访问只下载一份、导航间复用缓存，账面上重复、网络上不重复。第三板斧也解释了一类常见困惑：明明没改某个页面，它的首屏 JS 字节却动了——共享分块变胖，全体成员跟着长。

## 演练：给详情页装重家伙，再把它请出首屏

进场先交改动面。手术清单：

- 一行未改：商品列表、搜索、收藏、`/demo/client-fetch` 反例页与全部 server API；`measure-core` 的测量口径。
- 新增：`app/utils/price-trend.ts`（走势纯逻辑，341 行）、`app/components/PriceTrendChart.vue`（图表组件，677 行）、`tests/price-trend.test.ts`（18 例）、`scripts/e2e-ch3.mjs`（本章门槛 gate:ch3）、`reports/measure-sync-chart.json`（同步引入形态的「变胖」存档）。
- 动：`/products/:id` 页本体（换数据流 + 挂图表）；`e2e-ch1` 的两条断言锚点（详情页从客户端取数反例毕业为直出好页，总数保持 110 项）；`package.json` 与 README 登记 gate:ch3。

### 第一步：详情页换上服务端数据流

详情页目前还是客户端取数：HTML 先走、数据后到。这个旧形态会把「数据白屏」和「不可交互」搅在同一条时间线上，测不清水合的账。所以第一步先调用既有积木，把数据面换干净——useAsyncData 契约的接口是 `useAsyncData(key, handler)`：同 key 去重、handler 在服务端执行、结果进 payload、客户端水合时复用（第 2 章）。

```vue
<script setup lang="ts">
// companion/app/pages/products/[id].vue · 商品详情（第 3 章终态：useAsyncData + Lazy 图表）
import type { Product } from '#shared/types'

const route = useRoute()

// 数据面：SSR 数据流——HTML 直出商品、结果进 payload、水合复用（不再二次请求）。
// 显式 key 带上商品编号：每件商品一份数据，同 key 去重。
const { data: product, error } = await useAsyncData(
  `product-${route.params.id}`,
  () => $fetch<Product>(`/api/products/${route.params.id}`),
)

useHead({ title: computed(() => product.value?.name ?? '商品详情') })

const notFound = computed(() => error.value?.statusCode === 404)
</script>

<template>
  <section>
    <p v-if="notFound" class="state state-error">这个商品不存在——可能是手滑输错了编号。</p>
    <p v-else-if="error" class="state state-error">加载失败：{{ error.statusCode ?? error.message }}</p>
    <article v-else-if="product" class="detail">
      <h1>{{ product.name }}</h1>
      <p class="meta">{{ product.category }} · ¥{{ product.priceYuan }} · ★{{ product.rating }}</p>
      <p class="summary">{{ product.summary }}</p>
      <p><NuxtLink to="/products" class="button">← 回商品列表</NuxtLink></p>

      <!-- 重组件：价格走势图（手写 SVG，数百行）。Lazy 前缀 = 动态导入；
           hydrate-on-interaction = 延迟水合——SSR 仍直出图表本体，
           客户端把代码拆成按需分块、移出首屏，首次交互（悬浮/点按）才拉取并接管。 -->
      <LazyPriceTrendChart
        hydrate-on-interaction
        :product-id="product.id"
        :category="product.category"
        :base-price-yuan="product.priceYuan"
      />
    </article>
  </section>
</template>
```

（上面是终态；演练按时间线走，图表先以同步形态进场。）

### 第二步：同步引入，先让账面变胖

重客人本体是一张手写 SVG 图表，不引任何第三方图表库。它的清单很长：平滑价格曲线（Catmull-Rom 样条转贝塞尔）、渐变面积、20 日均线、市场参考线、每日成交量柱、区间极值标注、悬浮十字线与提示框、区间切换与键盘微调。全部数据逻辑沉在纯函数模块里，走势由商品编号经固定种子推导。

```ts
// companion/app/utils/price-trend.ts · 走势生成与悬浮命中（节选）
export function generatePriceHistory(
  productId: number,
  basePriceYuan: number,
  days = HISTORY_DAYS,
): PricePoint[] {
  const baseCents = Math.round(basePriceYuan * 100)
  const rand = mulberry32((productId * 2654435761 + 0x9e3779b9) >>> 0)
  return walkSeries(rand, baseCents, 0.018, 0.03, true, days)
}

/** 悬浮命中：给定指针的 SVG x 坐标，返回距离最近的数据点下标。
 *  等距平局时取左侧（严格小于才替换）；越界输入自然夹到首尾点。 */
export function findNearestPoint(
  points: PricePoint[],
  x: number,
  scales: ChartScales,
): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(scales.x(points[i]!.day) - x)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}
```

确定性是刻意的设计约束：伪随机种子、时间轴起点（2025-01-01）、千分位分组全部写死，不读系统时钟、不碰全局随机源。服务端直出与客户端水合因此产出逐字节一致的 SVG，测试也能拿固定输入断言。这一点在「守住纯逻辑」一节会成为硬要求。

先以同步形态进场：模板里写 `<PriceTrendChart ... />`（无前缀，自动导入即静态 import），构建、复测、存档到 `reports/measure-sync-chart.json`。账面立刻长胖——详情页一行，逐字段如下：

| 指标组字段 | 存档（reports/measure.json，改造前末态） | 同步引入图表后 | 方向与解释 |
| --- | --- | --- | --- |
| TTFB | 6.5 / 6.2 ms | 528.1 / 527.3 ms | 上升——SSR 开始等 500ms 详情接口，与列表页同型（数据直出的价） |
| HTML 字节 | 1,957 B | 48,310 B | 上升——商品与图表 SVG 本体直出（180 个交易日加成交量柱） |
| payload 字节 | 199 B | 419 B | 上升——商品数据序列化进行李 |
| 首屏 JS 字节 | 189,948 B（4 块） | 211,299 B（5 块） | 上升 21,351 B——数据流运行时约 8.6 KiB、图表代码约 12.4 KiB 并进页面分块、注册表约 0.35 KiB |
| 数据随 HTML | false | true | 换上 SSR 数据流 |

顺带把列表页的口径数放进来对个参照：`/products` 在同一份存档里是 199,183 B。首屏 JS 字节这套口径从基线档案一路对到本章，每一行涨跌都要能拆出构成——这正是它作为对账对象的价值。

### 第三步：立门槛，先红

按红绿节奏，先立门槛再动手。gate:ch3 把两个对照数字直接写死在断言里——同步形态的实测值，与存档的各页面基线——四组共 15 项。

```js
// companion/scripts/e2e-ch3.mjs · 写死的对照数字与断言组 A/B（节选）
// 1) 同步引入实测：演练第二步存档 reports/measure-sync-chart.json 里 /products/1 的 firstLoadJs。
const SYNC_DETAIL_FIRSTLOAD_JS = 211_299
// 显著下降线：Lazy 分割后至少比同步记录低 8 KiB（搬出的是整个图表分块）。
const LAZY_MAX_DETAIL_FIRSTLOAD_JS = SYNC_DETAIL_FIRSTLOAD_JS - 8 * 1024
// 2) 存档对照：reports/measure.json 里各页面 firstLoadJs。
//    「不回退」允许 2 KiB 容差：注册新组件 + 延迟水合运行时让共享分块每页约 +1.3 KiB（正文有账），
//    量级回退（整块图表代码混进别的页面首屏）仍然会被拦下。
const OTHER_PAGES_CEILING = {
  home: 189_902,
  products: 199_183,
  search: 191_465,
  favorites: 190_733,
}
const CEILING_TOLERANCE = 2 * 1024

check(
  detailJs.bytes <= LAZY_MAX_DETAIL_FIRSTLOAD_JS,
  `瘦身事实：详情页首屏 JS ${detailJs.bytes} B 低于同步引入记录 ${SYNC_DETAIL_FIRSTLOAD_JS} B 至少 8 KiB（实际省 ${SYNC_DETAIL_FIRSTLOAD_JS - detailJs.bytes} B）`,
)
check(
  chartChunks.length > 0 && inFirstLoad.length === 0,
  `分割事实：图表分块不在详情页首屏加载清单（清单 ${detailJs.count} 块：${firstLoadNames.join('、')}）`,
)
```

图表分块的认定与「不是路由分块」的甄别，靠两个机械特征：产物里含 `price-trend-chart` 标记（组件模板的静态类名，minify 后保留）的 JS 文件即图表分块；路由表自己的动态组件清单（构建产物里 `import(...)` 后紧跟路由名 `name:` 的形态）里没有它，说明它是被页面按需引入的组件分块，而不是某个页面的页面分块。同步引入时图表代码会并进路由分块，这一条就会红。

对同步形态跑门槛（记得让脚本完整重建），红得干净：

```text
gate:ch3 —— 12/15 项通过；报告：reports/gate-ch3.json
失败项：
  - 瘦身事实：详情页首屏 JS 211299 B 低于同步引入记录 211299 B 至少 8 KiB（实际省 0 B）
  - 分割事实：图表分块不在详情页首屏加载清单（清单 5 块：CGUZZiqI.js、DfZygMvh.js、BNGwHzgo.js、Cw4nIA37.js、BPV_g7ma.js）
  - 分割事实：图表分块不是路由页面分块（路由表分块 CusggYAi.js、Cw4nIA37.js、B_9CTiiR.js、AT4gOa3c.js、D14tg1aW.js，图表命中 0 个）
```

红在哪儿：服务器起得来、页面请求得到、直出与全站两组全绿——脚手架完好；红的三条全是「瘦身能力不存在」：省 0 B、图表代码在首屏清单第五块里（Cw4nIA37.js 就是详情页分块，13.6 KiB 里装着图表）、它同时是路由分块。这是能力未实现的红。

### 第四步：一个前缀不够，再给一支延迟水合开关

第一支扳手先上：模板里改成 `<LazyPriceTrendChart ...>`。重建，复测——意外来了：详情页首屏 JS 是 211,806 B，比同步形态还多 507 B。分块确实切出来了（12.4 KiB 的图表分块），但详情页 HTML 里的 `modulepreload` 从 7 条变成 8 条，图表分块赫然在列——预加载优先级把它拉回了首屏。原因正是原理节引过的那句官方判断：Lazy 组件「除非条件渲染，否则仍会被立即加载」。图表在服务端渲染中出过场，为了让浏览器水合时不必等网络，Nuxt 把它的分块预载了。分块体积的账瘦了，运行时的账一两没瘦。

第二支扳手是对症的：延迟水合。给组件加上 `hydrate-on-interaction`，把「什么时候接管」也变成可控项。官方文档的定位：

```text
"Nuxt supports this using lazy (or delayed) hydration, allowing you to control
when components become interactive."
```

翻译：Nuxt 通过懒（延迟）水合支持这一点，让你能控制组件何时变为可交互（出处同上）。语义拆开说：SSR 输出不变——图表本体照样直出进 HTML；客户端水合时，这个组件先保持静态 DOM，等首次交互（悬浮、点按、聚焦这类事件）才拉取分块并接管。文档还有两条配套约定值得记住：延迟水合组件的 props 一变，会立即触发水合；每个组件一次只能用一种策略。

重跑门槛，绿了：

```text
gate:ch3 —— 15/15 项通过；报告：reports/gate-ch3.json
gate:ch3 通过
```

红绿之间发生了两件事：图表分块从 `modulepreload` 清单移进了 `prefetch`（低优先级、浏览器空闲时才取），首屏关键路径上不再有它；接管的时机从「页面水合」推迟到「首次交互」。第二件事正是延迟的本义——悬浮提示本来就是用户「要用才发生」的行为，为它预付整段下载解析执行，是把成本放错了时间窗。

### 第五步：老门槛的锚点迁移

详情页换了数据形态，先立的 gate:ch1 会喊疼：它断言「detail 数据不在 HTML 里（present=false）」与「node 直取页面时 /api/products/:id 命中 0 次」。处理方式照旧不是删断言，而是迁移锚点——详情页从「已知坏页」毕业为「直出好页」，反例角色仍由 `/demo/client-fetch` 与搜索、收藏两页承担。

```js
// companion/scripts/e2e-ch1.mjs · 断言组 C 的锚点手术（节选）
// 第 2 章起 /products、本章起 /products/:id 都改为服务端取数（present=true），
// 客户端取数反例的测量锚点仍在 /demo/client-fetch；search/favorites 断言原样。
check(
  byLabel.detail.dataWithHtml.present === true,
  '基线事实：detail 数据随 HTML 直出（第 3 章起服务端取数，present=true）',
)
check(
  (apiHits['/api/products/:id'] ?? 0) === 2,
  `基线事实：/api/products/:id 命中恰为两遍 SSR 渲染数 2（实际 ${apiHits['/api/products/:id'] ?? 0}）`,
)
```

复跑两道旧门：

```text
gate:ch1 —— 110/110 项通过；报告：reports/gate-ch1.json
gate:ch1 通过
gate:ch2 —— 13/13 项通过；报告：reports/gate-ch2.json
gate:ch2 通过
```

gate:ch1 一减一加两轮替换，总数保持 110：口径完整、数值合理、重复稳定、基线事实四类意图一条没少，只是「已知好页」的名单多了一个 detail。gate:ch2 锚的是 `/products` 与反例页，一行未动、自然全绿——旧测试只读不改，是这套门槛能一直跑下去的前提。

### 守住纯逻辑：图表的固定输入测试

图表的交互核心是「指针横坐标 → 最邻近数据点」，生成核心是「商品编号 → 固定走势」。两者都是纯函数，18 例固定输入测试直接钉住，节选两例：

```ts
// companion/tests/price-trend.test.ts · 悬浮命中与走势生成（节选）
// 手工构造的坐标换算：x = day×10，y = 1000−cents——期望值可以手算，不依赖实现
const fakeScales: ChartScales = {
  minCents: 0,
  maxCents: 1000,
  plotLeft: 0,
  plotRight: 100,
  plotTop: 0,
  plotBottom: 100,
  x: (day) => day * 10,
  y: (cents) => 1000 - cents,
}

describe('悬浮命中（最邻近点）', () => {
  // x(day) = day×10：三个点落在 x = 0 / 100 / 200
  const pts = [P(0, 100), P(10, 300), P(20, 200)]

  it('等距平局取左侧', () => {
    expect(findNearestPoint(pts, 50, fakeScales)).toBe(0)
    expect(findNearestPoint(pts, 150, fakeScales)).toBe(1)
  })

  it('越界输入自然夹到首尾', () => {
    expect(findNearestPoint(pts, -30, fakeScales)).toBe(0)
    expect(findNearestPoint(pts, 999, fakeScales)).toBe(2)
  })
})

describe('走势生成（确定性）', () => {
  it('同一商品两次生成逐点相等，不同商品得到不同走势', () => {
    const a1 = generatePriceHistory(1, 129)
    const a2 = generatePriceHistory(1, 129)
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(generatePriceHistory(2, 129))
  })
})
```

平局取左侧这类边界，不写测试就永远只是口头约定；确定性这条则直接守着水合——两处生成不一致，浏览器里就是属性对不上的水合告警加图表整棵重建。

```text
✓ tests/catalog.test.ts (6)
✓ tests/chaos.test.ts (5)
✓ tests/payload.test.ts (4)
✓ tests/price-trend.test.ts (18)
Test Files  4 passed (4)
Tests       33 passed (33)
```

### 指标组复测：字节对账

`pnpm measure` 对终态完整重建复测。同步引入与 Lazy 加延迟水合，详情页一行对账如下。

| 指标组字段（/products/1） | 同步引入（存档 measure-sync-chart.json） | 本章终态（measure.json） | 方向与解释 |
| --- | --- | --- | --- |
| TTFB | 528.1 / 527.3 ms | 546.4 / 523.0 ms | 持平——数据流没动，SSR 仍等 500ms 接口 |
| HTML 字节 | 48,310 B | 48,533 B | 基本持平——图表本体照样直出（+223 B 是交互包装） |
| payload 字节 | 419 B | 419 B | 不变——行李里只有商品数据 |
| 首屏 JS 字节 | 211,299 B（5 块） | 200,812 B（7 块） | 下降 10,487 B——图表分块（12,447 B）移出首屏清单、降级 prefetch，页面分块从 13.6 KiB 瘦回 2.1 KiB |
| 数据随 HTML | true | true | 不回退 |

全站一行：home 191,202 B、products 200,584 B、search 192,779 B、favorites 192,030 B，各自比存档多 1.27～1.37 KiB。这笔「没改的页面也涨了」的账，构成很明确：注册一个新组件、加上延迟水合的运行时帮手，都落在共享分块里，全体页面各记一份名头、网络上只下载一次——去重那板斧的账面与现实。门槛的 2 KiB 容差就是给这笔固定开销留的，量级回退照样拦。

净账算下来：详情页从客户端取数反例走到「数据直出 + 图表直出 + 图表按需接管」，首屏 JS 总共多付约 10.9 KiB（189,948 → 200,812 B）。构成里约 8.6 KiB 是数据流运行时（列表页早已付过同一笔），约 1.3 KiB 是共享的注册与延迟水合成本。图表的 12.4 KiB 本体，则从首屏关键路径搬到了用户第一次把鼠标放上去的那一刻。

## 验证：亲手摸到那半秒

进入伴生仓根目录（本章终态同步快照在 `steps/ch03-hydration/`）。

```bash
pnpm gate:ch3        # 构建 + 起服 + 15 项断言，应输出「gate:ch3 通过」
pnpm build && pnpm start
```

先猜后跑：拿纸笔记三个离散答案。①`curl -s http://127.0.0.1:4311/products/1 | grep -c price-trend-chart` 输出几？A「恰 0」B「恰 1」C「5 以上」。②详情页 HTML 里数一数 `modulepreload` 指向的 `_nuxt` 分块：A「4 块」B「7 块」C「8 块」。③含 `price-trend-chart` 标记的那个分块文件名，会不会出现在这些 `modulepreload` 的 `href` 里？核对：①恰 1——图表本体（含类名的根节点）直出在 HTML 里；②7 块；③不在——它在 `prefetch` 清单里。三题各锚一环：①可见层的直出，②首屏清单的构成，③关键路径的移出。

浏览器人工观察（口径互补，必做一次）：DevTools 节流 Slow 3G 打开 `/products/1`。商品与图表随 HTML 几乎立刻可见——直出把可见段救活了；此刻把鼠标放到图表上，没有十字线、没有提示框——这是「可见不可点」在组件粒度的微缩现场。看 Network 面板：一个 12 KiB 上下、名字带哈希的图表分块正以 `prefetch` 的低优先级在空闲时段下载。第一次悬浮发生时，分块就位、组件接管，十字线与逐日价格出现。再开 Performance 面板刷新一次，观察脚本执行段里已经没有图表那份解析执行——它被挪到了交互之后。最后回到开篇实验：在 `/products` 上掐着内容刚出现点「看详情」，Network 里那笔 `document` 请求就是水合真空的边界。

**定向破坏一：把两支扳手都撤掉。** 将详情页模板里的 `<LazyPriceTrendChart hydrate-on-interaction ...>` 改回无前缀的 `<PriceTrendChart ...>`。先写预言再动手：gate:ch3 恰好红 3 条——瘦身事实（省 0 B）、图表分块不在首屏清单（代码并回页面分块）、图表分块不是路由页面分块（它成了路由分块本身）；其余 12 条一条不红——直出不回退守的是数据面，全站不回退守的是别的页面，它们与详情页怎么引入图表无关。跑（让脚本完整重建，别设 `SKIP_BUILD=1`），核对预言全中，改回复核 15/15。

**定向破坏二（变体）：只撤延迟水合。** 保留 `<LazyPriceTrendChart>`，删掉 `hydrate-on-interaction`。预言：这次红 2 条——瘦身事实与「不在首屏清单」重新翻红（分块被 `modulepreload` 拉回首屏，比同步形态还重 507 B）；「不是路由页面分块」保持绿——分块确实独立存在，只是加载时机错了。哪条没变、它守的是什么：分块的「存在形态」没变，变的是「到达时机」——这正是两支扳手各管一头的证据。改回复原。

## 自查

1. 把图表从详情页的可见区挪进「点击展开」的抽屉（`v-if` 控制，默认收起），还需要延迟水合吗？分块还会进首屏清单吗？（回查原理节引文与演练第四步。）
2. 延迟水合的图表在「可见但未交互」的窗口里，价格数据从哪里来？如果这时它的 props 变了，会发生什么？
3. 首屏 JS 字节：详情页省 10,487 B，其余四页各涨约 1.3 KiB。一个用户把五个页面都逛一遍，这笔交易净赚还是净亏？写出计算。
4. 图表逻辑如果偷偷读了 `Date.now()` 或全局 `Math.random()`，用户会在浏览器里看到什么可观察的症状？为什么测试单跑（node）发现不了它？

<details>
<summary>参考答案</summary>

1. 不需要。`v-if` 不成立时组件不出现在 SSR 输出里，没有「渲染过场」就没有预载的理由，分块只在抽屉第一次打开时加载——条件渲染本身就是一种延迟。延迟水合解决的是「SSR 渲染了、但不必立刻接管」的形态，两者别混用。
2. 从 SSR 直出的静态 DOM 来——图表本体在 HTML 里，数据已经画在 SVG 上，不需要客户端 JS 也能看。props 一变会立即触发水合（官方约定）：框架不能保证旧静态标记还匹配新 props，接管必须马上发生。
3. 净赚。共享分块的 1.3 KiB 只下载一次（缓存复用），四页合计成本仍约 1.3 KiB；详情页省 10,487 B；逛不逛详情页，这笔共享成本都已支付。粗算：支出约 1.3 KiB，收入 10.2 KiB。
4. 服务端渲染的 SVG 属性与客户端水合时重算的不一致，触发水合不匹配：控制台告警，图表子树被丢弃重建（可见的闪烁一下）。单测发现不了，因为测试只跑 node 一侧，没有「两端各算一遍再比对」的场景——这正是把确定性写进设计约束、而不是靠测试兜底的原因。
</details>

## 收束：可见与可用，分开的两张账

开篇那笔「掐着内容刚出现」点出去的整页跳转，现在可以说清机制了。SSR 把「可见」交给了 HTML，把「可用」留给了 JS——下载、解析执行、接管三段都在第一次点击之前，这段真空就是可交互延迟。本章给详情页装上一千行的重图表，又用两支扳手把它的 12.4 KiB 代码搬出这条真空：Lazy 前缀切出独立分块，延迟水合把接管推迟到首次交互；图表本体仍然随 HTML 直出，数据仍然单次命中。字节的账全程有存档可对：211,299 B 的同步形态、211,806 B 的半吊子 Lazy、200,812 B 的终态，每一行涨跌都拆得出构成。

你带走三块新积木：水合——客户端 JS 接管服务端 HTML、重建响应式与监听的过程，成本与 JS 体积正相关；可交互延迟——从可见到可用的时差，下载、解析执行、接管三段成本，INP 是它的浏览器口径；代码分割——按路由与组件切分块按需加载，配合 Lazy 前缀与延迟水合把重组件移出首屏，共享分块去重下载。迁移到真实项目时先问三句：我的首屏清单里有没有「可见即可、不急可点」的重组件？它的分块此刻在 `modulepreload` 还是 `prefetch`？共享运行时的涨跌记账了吗？

首屏 JS 字节这套口径在本书里的角色到此换岗：从「手工对账的账本」交给资产预算章变成「超限即红的预算表」（第 6 章）；`prefetch` 与 `modulepreload` 这对资源提示的完整语义，预取章展开（第 4 章）。
