---
title: 把开高低收画成图：坐标、缩放与 K 线渲染器
---

# 把开高低收画成图：坐标、缩放与 K 线渲染器

<script setup>
// 本章四张图的数据，全部来自实验场的 export-docs 脚本。
import market from './assets/data/04-market.json'
// 60 个交易日的常规合成行情。
import narrow from './assets/data/04-hammer-narrow.json'
// 同一根锤子，温和行情做邻居。
import wide from './assets/data/04-hammer-wide.json'
// 同一根锤子，剧烈行情做邻居。
</script>

你买过一本形态书。书里的锤子线印得又标准又漂亮：小实体贴着头，一条长下影笔直探底，页边还标着「见底信号」。实盘里你照着找：某天盘面砸出一根长下影，你认出它了，第二天买入，股价继续跌。复盘时你做了一件小事——把行情软件的鼠标滚轮往下一滚，显示区间从两周拉大到两年。刚才还威风凛凛的那根长下影，被纵轴一压，缩成一根不起眼的小蜡烛，混在一排 K 线里，你自己都认不出来。再滚回去，它又变回「锤子」。

同一根 K 线，同一组开高低收，长相却随滚轮变来变去。问题不在眼睛：屏幕上的蜡烛，是价格经过一套换算投出来的像素；换算用的区间一变，像素跟着变。**你看的不是 K 线的属性，是区间的属性**。肉眼判形态之所以不可靠，第一层原因就在这里。

这一章把这套换算写成一个真正的渲染器（把数据翻译成图形的代码）`toSvg`：四个价怎么变成坐标、什么时候该换成按倍数记账的刻度、成交量为什么单独开一张副图。它还是全课程图表的数据出口——你在正文里看到的每一张 K 线图，数据都由本章实验场的导出脚本算出。

## 长相由谁定：从价格到像素

### 成因：屏幕只有像素，价格却有量纲（量纲——数带着的单位身份：元、股、像素，各是各的）

第 3 章把一天的逐笔成交聚成了四个数。这一章回答下一个问题：四个数怎么变成图？屏幕不认识「元」，它只认像素。把价格画上屏幕必须先做一次换算，这套换算规则叫价格坐标系（把价格换算成屏幕像素位置的那套规则，核心是两件事：可见的价格区间是多少、画布有多高）。

区间从哪来？行情软件取「当前屏幕上所有 K 线」的最高价与最低价。滚轮一滚，屏幕上的 K 线换了，区间就换，同一天的长相跟着换——这就是开章那个现象的全部机制。

### 载体：一条换算公式

设可见区间最低价 lo、最高价 hi，主图可用高度 H。价格 p 的纵坐标：

```text
t = (p − lo) / (hi − lo)      第一步：折算成「在区间里走了百分之几」，得到 0 到 1 之间的数
y = 顶部留白 + (1 − t) × H     第二步：翻转（屏幕 y 轴向下），再放大到像素高度
```

第一步就是归一化——把任意范围的一组数按比例折算成 0 到 1 之间的比例，再放大到目标尺寸。区间宽窄、画布大小，都只影响最后那步乘法。先归一化再放大，同一套代码才画得下 10 元的股票，也画得下 3000 点的指数。横坐标简单得多：第 i 根 K 线占第 i 格，时间从左到右。

### 演算：跟着算一遍

用真实数字推一遍。一根阳线：开 10.00、收 10.50、高 11.00、低 9.00。画布总高 300 像素，顶部留白 16、底部留白 20，先关掉成交量副图，主图可用高度 H=264。区间就是它自己：lo=9，hi=11。

- y(11.00)：t=1，顶格，y=16。
- y(9.00)：t=0，y=16+264=280。
- y(10.50)：t=0.75，y=16+0.25×264=82。
- y(10.00)：t=0.5，y=16+0.5×264=148。

于是实体从 82 画到 148，高 66 像素；上影线 16 到 82；下影线 148 到 280。现在给它一个新邻居：一根高 21、低 1 的大波动 K 线。区间变成 1 到 21，跨度 20 元。同一根实体 0.50 元，像素高度 = 0.50 ÷ 20 × 264 = 6.6。**66 像素与 6.6 像素，是同一根 K 线**——差的那 10 倍，就是区间差的那 10 倍。

锚点：往一个固定高度的相框里装下一整段价格，区间越宽，每一元分到的像素越少。

### 亲眼看看：同一根锤子的两种长相

道理推完了，上图。下面两张图的数据都由实验场固定种子算出：各是一段 40 天的合成行情，在第 31 根的位置植入了同一根锤子。它的开高低收是 10.20、10.26、9.00、10.16，下影占全天振幅 92%。两张图里这根 K 线的每个数字完全相同，不同的只有左邻右舍，因而不同的只有纵轴区间。

<KLineChart :candles="narrow.candles" :markers="narrow.markers" title="同一根锤子 · 纵轴区间 1.32 元" />

先看窄图。邻居是一段日内波动 0.6% 的温和行情，纵轴区间只有 1.32 元。锤子自己的振幅 1.26 元，占满纵轴的 95%——长下影顶天立地，教科书插图也不过如此。

<KLineChart :candles="wide.candles" :markers="wide.markers" title="同一根锤子 · 纵轴区间 5.14 元" />

再看宽图。它换了一段日内波动 6% 的剧烈行情做邻居，价格从 8.61 元荡到 13.75 元，纵轴区间 5.14 元。同一根锤子只占纵轴的四分之一。认一认：第一张图里那个标准的「见底信号」，在第二张图里你还能一眼找到吗？形态没变，变的是刻度。所以从下一章起，全书讲三十几种形态，判据全部用数字（影线占比、实体占比），一次也不用「看起来像」。

## 对数坐标：按倍数记账的纵轴

区间是第一层变形，坐标类型是第二层。前面的公式把每 1 元画成等长，这叫线性刻度。它有个盲区：10 元的股票涨 1 元是 +10%，100 元的股票涨 1 元只是 +1%。线性轴给两者同样的像素长度，投资者的体感却差 10 倍。看长周期图、比较不同价位的波动时，人们改用对数坐标（纵轴刻度按价格的对数均匀分布：每翻一倍占等长的一段，涨跌幅才可比）。

演算照旧用数字。区间 10 到 20 元：线性轴的正中是算术中值 15；对数轴的正中是几何均值（相乘开方得来的平均）√(10×20) ≈ 14.14。10→20 与 20→40 各翻一倍，在对数轴上像素距离相等。现在给本章的锤子宽图换上对数刻度，看第三张图。

<KLineChart :candles="wide.candles" :markers="wide.markers" log-scale title="宽图 · 对数坐标" />

还是小。对数刻度重新分配的是「每一段倍数」的像素，救不了「区间太宽、单根 K 线太小」这个根本问题。它的用武之地在别处：一只股票从 5 元涨到 50 元的十年图，线性刻度把 5 元附近的所有波动压成一条缝；对数刻度下，每一程翻倍才等宽。**先定区间，再选刻度，两件事别混成一件**。

锚点：地震震级——每加一级能量差几十倍，震级本身就是对数坐标，报的是倍数不是绝对量。实验场的 logScale 只在区间下限为正时生效；价格恒为正，这条自然满足。

## 成交量副图：另一个量纲，另一套归一化

行情软件的 K 线图下方通常还蹲着一段矮个子柱状图，这就是成交量副图（挂在主图正下方、专门画每天成交量的独立小图）。它为什么单独开一段，不挤进主图？因为量纲不同——主图纵轴的单位是「元」，成交量的单位是「股」，硬塞进同一个纵轴，就得回答「1 元等于多少股」这种没有答案的问题。正确做法是分轴：主图对价格区间归一化，副图对全场最大成交量归一化，量柱高度 = 当天量 ÷ 全场最大量 × 副图满高。量柱红绿跟随当天阳阴，放量长阳与放量长阴一眼分清。

看一张完整的图：60 个交易日的合成行情，主图加成交量副图。标记钉在全场下影占比最长的一根上，2026-02-12，下影占全天振幅 85%。这枚标记怎么找出来的，实验段落里有答案。

<KLineChart :candles="market.candles" :markers="market.markers" title="合成行情 60 个交易日 · 主图与成交量副图" />

## 渐进实验：把渲染器写出来

图到此为止。老规矩：先写测试看它红，再实现让它绿。渲染器输出的是 SVG（一种用纯文本描述矢量图形的格式，浏览器和文档站都能直接渲染）字符串。纯文本有个额外好处：每一行输出都能肉眼审计。

### 先写断言：像素坐标必须能被手算复现

测试只认公共输出，不碰内部。一个技巧：期望坐标不写死任何常量——网格最上那条横线就是最高价的落点，最下那条就是最低价的落点，锚点从输出自己身上取。缩放行为这样断言：

```ts
// tests/candle-rendering.test.ts · 缩放断言（锚点从输出自身取得）
  it('同一根K线，放进宽 10 倍的价格区间，实体与影线的像素长度精确缩小 10 倍', () => {
    const narrow = toSvg([c(10, 11, 9, 10.5)], { ...VOL_ON, showVolume: false })
    const wide = toSvg([c(10, 11, 9, 10.5), c(10, 21, 1, 10)], { ...VOL_ON, showVolume: false })
    const bodyN = num(tagsOf(narrow, 'body')[0], 'height')
    const bodyW = num(tagsOf(wide, 'body')[0], 'height')
    const wickN = num(tagsOf(narrow, 'wick-lower')[0], 'y2') - num(tagsOf(narrow, 'wick-lower')[0], 'y1')
    const wickW = num(tagsOf(wide, 'wick-lower')[0], 'y2') - num(tagsOf(wide, 'wick-lower')[0], 'y1')
    expect(bodyN / bodyW).toBeCloseTo(10, 1)
    expect(wickN / wickW).toBeCloseTo(10, 1)
  })
```

同一根 K 线放进宽 10 倍的区间，实体与影线的像素长度必须精确缩小 10 倍——线性映射的全部承诺就是这句比例。对数刻度这样断言：

```ts
// tests/candle-rendering.test.ts · 对数坐标断言
  // 几何均值 sqrt(10*20) ≈ 14.1421：在对数轴上它正好落在区间正中
  const mid = Math.sqrt(10 * 20)
  const doji = [c(mid, 20, 10, mid)]

  it('对数轴上几何均值落在正中，线性轴上同一价格明显偏下', () => {
    const log = toSvg(doji, { ...VOL_ON, showVolume: false, logScale: true })
    const lin = toSvg(doji, { ...VOL_ON, showVolume: false, logScale: false })
    const [logTop, logBottom] = gridAnchors(log)
    const [linTop, linBottom] = gridAnchors(lin)
    const logBodyY = num(tagsOf(log, 'body')[0], 'y')
    const linBodyY = num(tagsOf(lin, 'body')[0], 'y')
    expect(logBodyY).toBeCloseTo((logTop + logBottom) / 2, 1)
    expect(linBodyY).toBeCloseTo(expectY(mid, 10, 20, [linTop, linBottom]), 1)
    expect(linBodyY - logBodyY).toBeGreaterThan(5) // 线性把 14.14 压得比对数低半格以上
  })
```

构造一根开收都等于几何均值的 K 线（开收同价，实体缩成一点）。对数轴上它落在正中，线性轴上明显偏下——同一组数，两种坐标给出不同的 y，而且都算得出、对得上。本章测试共 13 项：结构上每根 K 线一个 rect 加两条 line、A股配色阳红阴绿、时间从左到右、量柱高度与成交量成正比、空数组与非法价格报错、两次渲染逐字节一致。

### toSvg：映射、蜡烛与量柱

渲染器落在 `src/render/toSvg.ts`，心脏是那个映射函数：

```ts
// src/render/toSvg.ts · 价格到像素的映射（渲染器的心脏）
  // 价格 → 主图 y 坐标：先归一化到 0~1（对数坐标按 log 距离归一化），再翻转进 y 轴向下的屏幕坐标系
  const y = (price: number): number => {
    const t =
      logScale && lo > 0
        ? (Math.log(Math.max(price, 1e-9)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1)
        : (price - lo) / span
    return PAD.top + (1 - t) * mainH
  }
  const f = (x: number): string => x.toFixed(1)
```

映射函数不到十行：先归一化到 0 到 1，对数坐标换成按 log 距离归一化，再翻转放大。守门在前——与第 3 章聚合器同一条纪律：

```ts
// src/render/toSvg.ts · 守门
  if (candles.length === 0) throw new Error('toSvg：candles 不能为空')
  for (let i = 0; i < candles.length; i++) {
    const { open, high, low, close } = candles[i]
    for (const v of [open, high, low, close]) {
      if (!Number.isFinite(v)) throw new Error(`toSvg：第 ${i + 1} 根的开高低收必须是有限数字，收到的是 ${v}`)
    }
    if (high < low || high < Math.max(open, close) || low > Math.min(open, close)) {
      throw new Error(`toSvg：第 ${i + 1} 根的最高/最低价必须包住开盘价与收盘价`)
    }
  }
```

空数组、非有限数、最高最低价包不住开收的，当场抛错，错误信息用中文写清期望。每根 K 线的几何只有三件。

```ts
// src/render/toSvg.ts · 每根K线的几何：一个 rect + 两条 line
  for (let i = 0; i < n; i++) {
    const cd = candles[i]
    const x = PAD.left + i * band
    const cx = x + band / 2
    const color = cd.close >= cd.open ? UP : DOWN
    const yOpen = y(cd.open)
    const yClose = y(cd.close)
    const bodyTop = Math.min(yOpen, yClose)
    const bodyBottom = Math.max(yOpen, yClose)
    parts.push(
      `<line class="wick-upper" x1="${f(cx)}" x2="${f(cx)}" y1="${f(y(cd.high))}" y2="${f(bodyTop)}" stroke="${color}" stroke-width="1"/>`,
      `<line class="wick-lower" x1="${f(cx)}" x2="${f(cx)}" y1="${f(bodyBottom)}" y2="${f(y(cd.low))}" stroke="${color}" stroke-width="1"/>`,
      `<rect class="body" x="${f(x + band * 0.15)}" y="${f(bodyTop)}" width="${f(Math.max(band * 0.7, 1))}" height="${f(Math.max(bodyBottom - bodyTop, 1))}" fill="${color}"/>`,
    )
  }
```

三件套：上影线一条、下影线一条、实体一个 rect。yOpen 与 yClose 谁上谁下不用分方向——取小者做 rect 的顶、取大者做底，阳线阴线同一套算式。实体不足 1 像素时垫到 1，开收同价的 K 线才不会在屏幕上消失。红绿只由「收是否不低于开」决定，与区间和刻度无关。成交量副图：

```ts
// src/render/toSvg.ts · 成交量副图（量纲独立归一化）
  if (hasVolume) {
    const maxVol = Math.max(...candles.map((cd) => cd.volume), 1)
    parts.push(
      `<line x1="${f(PAD.left)}" x2="${f(W - PAD.right)}" y1="${f(volTop)}" y2="${f(volTop)}" stroke="#ced4da" stroke-width="1"/>`,
    )
    for (let i = 0; i < n; i++) {
      const cd = candles[i]
      const x = PAD.left + i * band
      const h = (cd.volume / maxVol) * (VOL_H - 8)
      parts.push(
        `<rect class="vol" x="${f(x + band * 0.15)}" y="${f(volTop + (VOL_H - 6 - h))}" width="${f(Math.max(band * 0.7, 1))}" height="${f(h)}" fill="${cd.close >= cd.open ? UP : DOWN}" opacity="0.55"/>`,
      )
    }
  }
```

量柱对全场最大量归一化，画在主图下方；全场的成交量都是零时，整段副图不画。

### 数据的出口：export-docs 脚本

正文嵌的每一张图，数据都来自 `scripts/export-docs-data.ts`。两张锤子图的做法：合成一段温和行情与一段剧烈行情，在第 31 根的位置植入同一个锤子样本。植入时保留被替换那根的日期标签——序列的日期秩序不被破坏。

```ts
// companion/scripts/export-docs-data.ts · 同一根锤子，两种纵轴区间
/** 锤子样本：小实体贴着头、长下影探到底。窄区间与宽区间两张图里是同一组数字 */
const HAMMER: Candle = {
  date: '2026-03-02',
  open: 10.2,
  high: 10.26,
  low: 9.0,
  close: 10.16,
  volume: 90000,
}
const HAMMER_AT = 30 // 植入位置：两段行情里同一个相对下标
```

```ts
// companion/scripts/export-docs-data.ts · 窄与宽的两段邻居行情
// 窄区间：日内波动 0.6% 的温和行情；宽区间：波动 6% 的剧烈行情，且第 30 根前后正逢一段回落
const calmSeries = generateCandles(createRng(104), { days: 40, startPrice: 10, volatility: 0.006 })
const wildSeries = generateCandles(createRng(213), { days: 40, startPrice: 10, volatility: 0.06 })
const plantHammer = (cs: readonly Candle[]): Candle[] =>
  cs.map((c, i) => (i === HAMMER_AT ? { ...HAMMER, date: c.date } : c))
```

脚本给自己立了守门规矩，任何一条不满足就当场报错，不许把坏图发给正文：

```ts
// companion/scripts/export-docs-data.ts · 数据自身的教学不变量：不成立就当场炸
const narrowSpan = spanOf(narrow)
const wideSpan = spanOf(wide)
const hammerRange = candleAnatomy(HAMMER).range
const sameNumbers = (a: Candle, b: Candle): boolean =>
  ['open', 'high', 'low', 'close', 'volume'].every((k) => a[k as keyof Candle] === b[k as keyof Candle])
if (!sameNumbers(narrow[HAMMER_AT], wide[HAMMER_AT])) {
  throw new Error('两图的锤子不是同一根：开高低收或成交量被改动')
}
if (narrowSpan > hammerRange * 1.8) {
  throw new Error(`窄区间不够窄：${narrowSpan.toFixed(2)} > 锤子振幅的 1.8 倍，锤子显不出「大」`)
}
if (wideSpan < narrowSpan * 3) {
  throw new Error(`宽区间不够宽：${wideSpan.toFixed(2)} < 窄区间的 3 倍，锤子压不扁`)
}
```

锤子样本本身也先过一道 `candleAnatomy` 的验货：下影占比不足 85% 不许出场。市场图上那枚「最长下影」标记同样来自计算——用第 3 章的 `candleAnatomy` 扫完全部 60 根，取下影占比最大的那根。简化之处照实声明：锤子是手工构造的教学样本，行情是固定种子的随机游走；识别锤子的正式判据要等下一章。全部差异登记在附录的差异清单。

## 验证：两道门槛与亲手开机

门槛在实验场目录里。`cd companion` 后先跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：32 项全绿，其中 13 项是本章新增——其中一项用与你手算 82 和 148 完全相同的输入（高度 300、关掉副图）断言同一条映射，只是期望坐标不写死常量、从输出自身的锚点推导，测试才不会跟着实现一起抄错。

再开机一次，亲眼看看图从哪来：

```bash
cd companion
npm run export-docs
```

终端打印三行摘要：市场图 60 根、最长下影在第几根；两张锤子图各自的纵轴区间。然后 `docs/assets/data/` 下出现三个 JSON 文件：`04-market.json`、`04-hammer-narrow.json`、`04-hammer-wide.json`。再跑一遍，文件一个字节都不变——脚本里没有时间戳，随机数全部来自固定种子。本章你看到的那四张图，就是这三个 JSON 文档站的 KLineChart 组件渲染出来的；那个组件与 `toSvg` 用同一套几何映射，实验场算什么，图上就是什么。

不进实验仓也有两处可验证：

1. 纸笔：合上书，用「演算」那节的数字重算 82、148、66，再算区间换成 1 到 21 时的 6.6。
2. 手机：打开任一行情软件，挑一根显眼的长下影 K 线，把显示区间从两周滚到两年，看它缩成小不点，再滚回来。你已经能精确说出：它缩小的倍数，等于区间扩大的倍数。

## 小结

- K 线的长相 = 开高低收 + 可见区间 + 坐标类型。数据只是三要素之一；肉眼判形态，被后两个要素牵着走。
- 换算公式一条：归一化到 0 到 1，再乘回像素高度。对数坐标把「每翻一倍」画成等长；量纲不同的成交量单独开副图、单独归一化。
- 实验场本章新增 `src/render/toSvg.ts`、`tests/candle-rendering.test.ts`（13 项断言）、`scripts/export-docs-data.ts`，并首次产出 `docs/assets/data/` 的三个 JSON 数据资产；全书 32 项测试全绿。

读完本章，你应该能回答：

1. 一根开 10、收 10.5 的阳线，在区间 9 到 11 里实体高 66 像素。区间换成 1 到 21，实体高多少？
2. 区间 10 到 20 元，对数轴的正中是哪个价格？线性轴的正中呢？
3. 成交量为什么不画进主图，而要单独开副图？
4. 同一根锤子线在两张图里长相不同：变的是哪两个东西，不变的又是什么？

去向一句话：第 5 章开始正式识别锤子线家族——识别器读的是 `candleAnatomy` 给出的数字，不是屏幕上的像素长相；正因为它不看长相，纵轴缩放骗不到它。
