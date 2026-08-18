---
title: 筹码分布：谁的持仓成本压在哪个价位
---

# 筹码分布：谁的持仓成本压在哪个价位

<script setup>
// 本章四张图的数据，全部来自实验场 export-docs 脚本第 14 章导出段对 src/chips/distribution.ts 的真实计算。
import profile from './assets/data/14-chips-profile.json'
// 38 根先跌后涨行情的两条分布轮廓同框：x 轴是价位桶中心，y 轴是持仓量占比。
import winner from './assets/data/14-winner-ratio.json'
// 获利盘与套牢盘比例的逐日快照，直接连成两条互补的曲线。
import rebound from './assets/data/14-rebound.json'
// 同一段行情的 K 线与三枚标记，平均成本线逐日叠加在主图上。
import chipBins from './assets/data/14-chip-bins.json'
// 反弹末日的筹码直方图正身：同一段行情、桶宽放宽到 0.2 元摊成 18 档，交给交互组件 ChipDistChart。
</script>

四月你在一只股票上抢了反弹。买入理由挑不出错：跌了三成、第 11 章的均线在低位金叉、第 12 章的量能刻度显示回踩缩量。价格从 9 元反弹到 10.8 元附近，然后就不走了。连着几天冲高回落，每天收盘都差一点。你翻遍 K 线图找不到坏信号：形态没坏，量也没异常。切到筹码图的那一秒你看懂了——头顶 12 元附近压着一整片密密麻麻的持仓，全是等着解套就跑的人。价格每涨一分，都在替他们解套。这次滞涨不是谁砸盘砸出来的，是反弹撞上了一堵 K 线图上看不见的墙；墙上写着每个价位的名字，叫筹码分布。

筹码分布（chip distribution，行情软件里常叫 CYQ 或筹码峰）是一张地图。它把流通盘里的股票按买入成本堆到对应价位上：某个价位堆得越高，说明还有越多的持仓把成本记在那里。第 13 章讲了「价格到哪里会堵」，本章回答另一半问题：路口为什么这么堵——堵车的不是价格，是压在价位上的人心。按陌生概念的老规矩四步走：成因、载体、演算、锚点，最后把它写成函数。

## 成因：没有换手，筹码就不搬家

这张图为什么存在？因为持仓成本只在一件事发生时改变：换手。第 12 章算过换手率——成交量除以流通股本，即今天有多少百分比的股东换了人。每一笔成交同时做两件事：卖方交出自己当年在某价位买到的筹码，买方按今天的成交价重新记一笔成本。**筹码换的是主人，不是数量**：换手率 30% 的那一天，每个价位上的旧持仓都划走 30% 给新买家，新买家的成本落在当天的价格区间里。

没有成交的价位什么也不会发生。去年在 12 元买入的人，只要不卖，成本永远记在 12 元——跌到 9 元、反弹到 10.8 元，都动不了这笔账。于是地图上长出两种地形：成交密集的历史成本区堆成山峰，长期无人换手的价位区间是山谷。山峰是拥挤的历史成本，山谷是换干净的真空——这句话就是整张图的读法。第 13 章说位是人多的路口，筹码图把「人多」具体到了人数。

## 载体：一张价位直方图

图的骨架是「价位 → 持仓量」的直方图，价位一根档、持仓量一堆条。拿本章后面会用到的真实数字画个样子（现价 10.79 元那天的简版）：

```text
价位（元）  持仓量（占流通盘）   ← 现价 10.79 元
12.2   ██████████████ 41.0%   筹码峰：全图最大的桶，成本全在现价上方
11.4   ▏ 0.7%                下跌时路过留下的薄谷
10.8   ▏ 1.3%                现价脚下的获利堆积
 9.1   ██ 6.0%               底部盘整养出来的新山包
       全图 34 个桶合计恒等于 100%，这里只画四行
```

四个术语一次说清。获利盘（成本不高于现价、现在卖出不亏钱的持仓）占流通盘的比例，等于现价及下方所有桶的合计；套牢盘（成本高于现价、卖出就要认亏的持仓）是现价上方的合计，两者相加恒为 100%。平均成本是全部持仓按量加权的平均价，市场的「公摊账本」。筹码峰是持仓量最大的那个桶——开章故事里那堵墙正是它。分界口径先说定：成本恰好等于现价的算获利，图上没有第三种人。

## 演算：三轮换手，纸上跑一遍

模型全貌只有两条规则：历史筹码按当日换手率等比衰减；当日成交量均匀分摊到当日价格区间。拿一段先跌后涨的四天行情手算。流通盘 1000 股、桶宽 1 元。四天都是一字平盘，即开=高=低=收，全部成交量落进同一个桶。

```text
第 1 天  12 元收盘，首日落位 {12: 1000}，获利盘 100%
第 2 天  10 元、量 300 → t=30%：全体 ×0.7 得 {12: 700}，新 300 落 10 元
         分布 {12: 700, 10: 300}，收盘 10 元 → 获利盘 300/1000 = 30%
第 3 天   9 元、量 200 → t=20%：全体 ×0.8 得 {12: 560, 10: 240}，新 200 落 9 元
         分布 {12: 560, 10: 240, 9: 200}，收盘 9 元 → 获利盘 20%，平均成本 10.92 元
第 4 天  10 元反弹、量 100 → t=10%：全体 ×0.9 得 {12: 504, 10: 216, 9: 180}，新 100 落 10 元
         分布 {12: 504, 10: 316, 9: 180}，收盘 10 元 → 获利盘 496/1000 = 49.6%
         筹码峰 = 最大桶 = 12 元的 504 股：反弹了一天，峰还压在头顶
```

四天里价格从 12 元跌到 9 元再弹回 10 元。山顶的老居民只搬走了一半，剩下的仍把成本记在 12 元——他们的解套价远在现价上方。锚点用一句话收住：换手衰减就是老居民搬新房，搬家比例看换手率，没人搬走的继续住在老价位，山峰与山谷不过是人口密度。

## 渐进实验：先把命题写进测试

上面这段四天行情直接做成测试夹具（fixture——测试里预置的固定输入数据），手算与代码从此对同一组数字负责：

```ts
// tests/chip-distribution.test.ts · 一字平盘工厂与先跌后涨四连（拼版：两段相邻定义，中间略去本章未引用的 rangeBar 区间工厂）
/** 一字平盘 K 线：开=高=低=收，全部成交量落进同一个价位桶，便于手工排布 */
const flatBar = (day: number, price: number, volume: number): Candle => ({
  date: `2026-09-${String(day).padStart(2, '0')}`,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
})

// 先跌后涨四连：首日在 12 元整段落位，此后三根的换手率分别是 30%、20%、10%
const FLOAT = 1000 // 流通股本 1000 股，纸面可整除
const FALL_AND_REBOUND: Candle[] = [
  flatBar(1, 12, 1000), // 首日：流通盘全部落位 12 元
  flatBar(2, 10, 300), // t=30%：12 元剩 700，新 300 落 10 元
  flatBar(3, 9, 200), // t=20%：{12:560, 10:240}，新 200 落 9 元
  flatBar(4, 10, 100), // t=10% 反弹：{12:504, 10:316, 9:180}，收盘 10 元
]
```

本章测试审四件事：任何一天的持仓量总和等于流通股本；四天序列逐日与手算一致；反弹日头顶的套牢峰仍是最大桶；固定种子的合成行情算两遍输出全等。挑三条贴出来。第一条，守恒——换手只能搬椅子，不能造椅子：

```ts
// tests/chip-distribution.test.ts · 总筹码守恒
  it('先跌后涨序列：每一天的持仓量总和都等于流通股本', () => {
    const days = chipDistribution(FALL_AND_REBOUND, { floatShares: FLOAT, binWidth: 1 })
    expect(days).toHaveLength(4)
    for (const d of days) {
      const total = d.buckets.reduce((s, b) => s + b.quantity, 0)
      expect(total).toBeCloseTo(FLOAT, 6)
    }
  })
```

第二条，反弹日的手算核对，高位套牢峰在快照里等着验收：

```ts
// tests/chip-distribution.test.ts · 反弹日的套牢峰
  it('第三轮换手 10% 的反弹日：获利盘 49.6%，头顶 12 元的套牢峰仍是最大桶', () => {
    const byPrice = new Map(days[3]!.buckets.map((b) => [b.price, b.quantity]))
    expect(byPrice.get(12)).toBeCloseTo(504, 6)
    expect(byPrice.get(10)).toBeCloseTo(316, 6)
    expect(byPrice.get(9)).toBeCloseTo(180, 6)
    expect(days[3]!.winnerRatio).toBeCloseTo(0.496, 6)
    expect(days[3]!.trappedRatio).toBeCloseTo(0.504, 6)
    expect(days[3]!.peak).toEqual({ price: 12, quantity: expect.closeTo(504, 6) })
    expect(days[3]!.peak.price).toBeGreaterThan(days[3]!.close) // 峰在收盘价上方：套牢峰
  })
```

第三条，峰的去处——它不会自己消失，只能让低位换手一点点吃掉：

```ts
// tests/chip-distribution.test.ts · 高换手消化套牢峰
  it('高换手消化套牢峰：低位持续放量后，峰从 12 元搬到低位', () => {
    // 9 元连续高换手（t=60%）：三轮之后 9 元成为最大桶，12 元的旧峰衰减到个位数百分比
    const cs = [...FALL_AND_REBOUND, flatBar(5, 9, 600), flatBar(6, 9, 600), flatBar(7, 9, 600)]
    const days = chipDistribution(cs, { floatShares: FLOAT, binWidth: 1 })
    const last = days[days.length - 1]!
    expect(last.peak.price).toBe(9)
    const trapped = new Map(last.buckets.map((b) => [b.price, b.quantity])).get(12)!
    expect(trapped).toBeCloseTo(504 * 0.4 * 0.4 * 0.4, 6) // 32.256 股：每轮乘 0.4
    expect(last.winnerRatio).toBeCloseTo(0.94752, 6) // 947.52 ÷ 1000——残余套牢 5.248%
  })
```

见红后实现。新模块 `src/chips/distribution.ts`，先是类型——一天的快照把全部读数装在一起：

```ts
// src/chips/distribution.ts · 分布快照与参数的类型
/** 一个价位桶：price 是桶中心价（binWidth 的整数倍），quantity 是压在这里的持仓量（股） */
export type ChipBucket = {
  price: number
  quantity: number
}

/** 一天的筹码快照：分布轮廓加上由它读出的全部读数 */
export type ChipDay = {
  /** 日期标签（与当根 K 线一致） */
  date: string
  /** 当日收盘价——获利/套牢的分界线 */
  close: number
  /** 价位-持仓量分布，按价位升序，只含非零桶 */
  buckets: ChipBucket[]
  /** 获利盘比例：成本不高于收盘价的持仓占比（恰好等于现价的算获利） */
  winnerRatio: number
  /** 套牢盘比例：成本高于收盘价的持仓占比，与获利盘互补 */
  trappedRatio: number
  /** 平均成本：全部分布的持仓量加权平均价 */
  averageCost: number
  /** 筹码峰：持仓量最大的桶——拥挤的历史成本区；并列时取更低价位 */
  peak: ChipBucket
}

export type ChipDistributionOpts = {
  /** 流通股本（股），分布总量的分母与首日落位的基数，默认 1 亿股 */
  floatShares?: number
  /** 价位桶宽（元），默认 0.1——分布图的横向分辨率 */
  binWidth?: number
}
```

分摊是模型的一条腿，先看它——一字价整桶落入，区间价按重叠长度均匀切：

```ts
// src/chips/distribution.ts · spreadInto 全貌
/** 把 amount 股均匀铺进 [low, high] 覆盖的各价位桶，按重叠长度分摊；一字价全部落进一个桶 */
function spreadInto(chips: Map<number, number>, low: number, high: number, amount: number, binWidth: number): void {
  if (amount <= 0) return
  if (high === low) {
    const price = Math.round(low / binWidth) * binWidth
    chips.set(price, (chips.get(price) ?? 0) + amount)
    return
  }
  const span = high - low
  const half = binWidth / 2
  const kLo = Math.round(low / binWidth)
  const kHi = Math.round(high / binWidth)
  for (let k = kLo; k <= kHi; k++) {
    const price = k * binWidth
    const overlap = Math.min(price + half, high) - Math.max(price - half, low)
    if (overlap > 0) chips.set(price, (chips.get(price) ?? 0) + (amount * overlap) / span)
  }
}
```

主函数的全貌，衰减那条腿也在这里：

```ts
// src/chips/distribution.ts · chipDistribution 全貌
/** 筹码分布：逐根 K 线推进换手衰减模型，返回每天的分布快照（时间旧→新）。
 *  - 首日是初始化假设：全部流通盘均匀落位首日价格区间（更早的历史无从得知，只能从第一天开始记账）；
 *  - 此后每天：换手率 t = 成交量 ÷ 流通股本（封顶 100%——T+1 之下单日不会有更多筹码换手，
 *    封顶只防合成数据越界），旧分布全体乘 (1−t)，当日成交量按 t 对应的股数均匀铺进当日区间；
 *  - 任何一天持仓量总和恒等于流通股本：筹码换的是主人，不是数量；
 *  - 获利盘/套牢盘以收盘价分界（恰等于现价算获利），平均成本与筹码峰由分布直接读出。 */
export function chipDistribution(candles: readonly Candle[], opts: ChipDistributionOpts = {}): ChipDay[] {
  const floatShares = opts.floatShares ?? DEFAULT_OPTS.floatShares
  const binWidth = opts.binWidth ?? DEFAULT_OPTS.binWidth
  assertChipArgs(candles, floatShares, binWidth)
  const chips = new Map<number, number>()
  const eps = binWidth * 1e-9 // 浮点噪声容差：桶中心 12.000000000000002 与收盘 12 视为同价
  const days: ChipDay[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (i === 0) {
      spreadInto(chips, c.low, c.high, floatShares, binWidth)
    } else {
      const t = Math.min(c.volume / floatShares, 1)
      if (t > 0) {
        for (const [price, q] of chips) chips.set(price, q * (1 - t))
        spreadInto(chips, c.low, c.high, t * floatShares, binWidth)
      }
    }
    // 当日快照：从分布读出全部读数
    const buckets = [...chips.entries()]
      .map(([price, quantity]) => ({ price, quantity }))
      .filter((b) => b.quantity > 1e-9)
      .sort((a, b) => a.price - b.price)
    const total = buckets.reduce((s, b) => s + b.quantity, 0)
    if (total <= 0) {
      // 首日零成交且无历史：没有筹码就没有读数，获利盘记 0、平均成本无定义
      days.push({ date: c.date, close: c.close, buckets, winnerRatio: 0, trappedRatio: 0, averageCost: NaN, peak: { price: Math.round(c.close / binWidth) * binWidth, quantity: 0 } })
      continue
    }
    let winner = 0
    let costSum = 0
    let peak = buckets[0]!
    for (const b of buckets) {
      if (b.price <= c.close + eps) winner += b.quantity
      costSum += b.price * b.quantity
      if (b.quantity > peak.quantity) peak = b
    }
    days.push({
      date: c.date,
      close: c.close,
      buckets,
      winnerRatio: winner / total,
      trappedRatio: 1 - winner / total,
      averageCost: costSum / total,
      peak: { price: peak.price, quantity: peak.quantity },
    })
  }
  return days
}
```

两处诚实条款单独念一遍。其一，首日初始化假设：更早的持仓成本无从得知，只能从序列第一天开始记账，第一天全部流通盘落位首日区间。这决定了筹码图对起始日期敏感——看真实软件的筹码图，先看它算了多久。其二，换手率封顶 100%：第 2 章的 T+1 规定当天买入的次日才能卖，同一股筹码一天最多换一次手，所以封顶在真实行情里几乎不会触发，它只是给合成数据的防御。

## 四张图：把墙画出来

数据出自 export-docs 脚本第 14 章导出段：38 根先跌后涨的路径合成行情（固定种子），流通盘 200 万股、桶宽 0.1 元，日均换手约 2.5%。画法两条腿。先用 LineChart 画分布轮廓打底——x 轴是价位桶中心，y 轴是持仓量占流通盘的比例，轮廓的起伏与水平条的高低一一对应；随后上正身：课程的交互组件 ChipDistChart 画的就是水平条形直方图——一根横条一个价格档，红条=获利盘、绿条=套牢盘，两条虚线分别标着现价与平均成本，鼠标停在任意价格档就读出该档的筹码量与占比。先看轮廓。

<LineChart :series="profile.series" :labels="profile.labels" :percent-y="true" title="分布轮廓" />

两个瞬间的对照。底部日（03-27）整图只有一座山：12.2 元的峰压着 65.5% 的筹码，低位 9.0 到 9.4 元只住着 4.9% 的居民——下跌一路换手，新区还没养成气候。反弹末日（04-22）峰矮到 41.0%，低位山包长到 15.5%。18 个交易日、日均 2.5% 的换手，只够消化这么点：峰的消退速度由换手率单方面决定，急不来。

轮廓看完，请正身——同一段行情的反弹末日，桶宽放宽到 0.2 元、摊成 18 个档，画成行情软件里筹码图的长相。怎么看：y 轴自下而上是价格、低价在下，每根横条是压在该价位的持仓量；橙红虚线是现价 10.79 元、蓝虚线是平均成本 10.96 元，现价就是红绿分界——下方红条全是获利盘，上方绿条全是套牢盘；鼠标停到任意价格档，读数报出该档的筹码量与占比。

<ChipDistChart :bins="chipBins.bins" :current-price="chipBins.currentPrice" :avg-cost="chipBins.avgCost" title="反弹末日的筹码直方图：现价 10.79 元头上压着一座套牢峰" />

三句话读正身。其一，12.2 元那根最长的绿条是全图最大桶：一个桶就压着约 86.7 万股、占两百万流通盘的 43%（轮廓图里的 41.0% 是桶宽 0.1 元的读数——这里桶宽放宽一倍、桶装得更多，同一座峰量出的高度略有出入）。开章那堵「看不见的墙」，在直方图上是摸得着的高度。其二，蓝虚线（平均成本 10.96 元）还压在橙红虚线（现价）上方：公摊账本整体仍套着，墙上住的多数是等解套的老居民。其三，对照上面的轮廓图：轮廓把峰画成一条起伏的线，直方图把「现价上方到底压着多少套牢盘」直接铺成看得见的绿条，红绿两块的悬殊一眼即见——读筹码图，看的就是这堵墙的厚度。

再看获利盘的行进。

<LineChart :series="winner.series" :labels="winner.labels" :percent-y="true" title="获利盘与套牢盘" />

两条曲线互补。下跌段获利盘从接近 100% 一路清零，底部日只剩 1%——满盘皆套。反弹段一路修复到 48.9%，反弹末段涨速明显放缓：再往上，每买一股，对手盘越来越多是成本 11 到 12 元的套牢者，他们等解套等了整整一段下跌。第四张图把这条曲线放回 K 线上：

<KLineChart :candles="rebound.candles" :overlays="rebound.overlays" :markers="rebound.markers" title="反弹路径上的套牢峰" />

三枚标记各就各位。高位密集区在第 6 根（高点 12.33 元），峰在那里长成；反弹起点在第 20 根（低点 9.01 元）；滞涨主角在第 38 根，反弹的最高点 10.79 元，距头顶的峰还有 1.41 元。细线叠加的平均成本从 12.20 元一路下移到 10.96 元——新居民的低价成本在拉低公摊账本，但拉不过峰的残骸。**反弹的每一步，都要从套牢者手里把筹码买回来**；量不够，墙就推不动。

导出段内置守门，故事线不成立就整段失败：

```ts
// companion/scripts/export-docs-data.ts · 第 14 章守门：套牢峰的故事线必须成立
if (final14.peak.price <= final14.close) {
  throw new Error(`末日筹码峰 ${round2(final14.peak.price)} 不在收盘 ${final14.close} 上方——套牢峰故事不成立，换一颗种子再试`)
}
if (rebound14[stall14].high >= final14.peak.price - 0.5) {
  throw new Error(`反弹段最高 ${rebound14[stall14].high} 离峰 ${round2(final14.peak.price)} 不足 0.5 元——「滞涨在峰下」不成立，换一颗种子再试`)
}
```

守门之外还有两条：底部日获利盘必须不高于 30%，反弹必须把获利盘至少抬升 20 个百分点。五条全过（还有一条：底部要跌得够深，低点须在 9.5 元以下），这套图才配发正文。

写成条件句。其一：若你参与超跌反弹，且价格已临近头顶套牢峰（距峰不足一成）、量能开始萎缩，常见的应对是先减掉一部分仓位，等放量收盘穿过峰体再说；失效条件是连续两日放量收盘站上峰体上方——套牢盘整体换手，墙变成新地板，按突破处理。其二：若获利盘占比极高（九成以上）而价格滞涨，常见的原因是获利了结的压力在堆积，应对是收紧止损而不是追加买入；失效条件是缩量横盘后放量再创新高，说明获利盘没砸出来，趋势仍在。

## 简化之处，照实声明

本章模型有三处显式简化，已登记进附录差异清单。其一，当日成交量均匀分摊到当日价格区间——真实日内成交有疏密（开盘收盘密集、午间稀疏），行情软件常用三角形分布加权，这里是均匀版。其二，历史筹码按换手率等比衰减——真实市场里卖方并非均匀来自各价位：被套的人倾向死扛、赚钱的人倾向先卖（处置效应，交易系统一章会正式拆解），等比衰减是不偏向任何一侧的中间假设。其三，首日初始化假设——更早的历史不入账。另：行情为固定种子路径合成，非真实行情；真实软件的筹码图还涉及复权与流通股本变动的处理，本课程不展开。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：239 项全绿，其中 21 项是本章新增。覆盖面：守恒三案——四天手算序列逐日守恒、60 根合成行情逐日守恒、零成交日照抄分布；手算六案——首日落位、两轮衰减逐桶核对、反弹日峰在头顶、区间分摊 250/500/250、换手率封顶、获利盘行进方向；峰的去向一案；固定种子确定性一案；非法输入九案全部抛中文错误。

再开机一次：

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 14 章一段：末日峰 12.2 元压着 41.0% 筹码（收盘 10.79 元）；获利盘从顶部约 100% 跌到底部的 1.0%，反弹末日回到 48.9%；滞涨第 38 根高点 10.79 元、距峰 1.41 元；平均成本从 12.20 元挪到 10.96 元；直方图 18 档（桶宽 0.2 元），最大桶 12.2 元（866,574 股）压在现价上方。`docs/assets/data/` 下多出四个 `14-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体。打开行情 App 的筹码分布指标，找一只从高位跌下来又反弹过的股票，先看反弹高点的头顶有没有峰。再笔算一笔：若它近 20 日平均换手 2%，旧筹码只剩 0.98 的 20 次方 ≈ 66.8%——头顶的峰理论上最多消化三分之一，你在图上看到的峰高，应当与这笔账互相印证。算不拢，先怀疑软件的起始日期，再怀疑自己的眼睛。

## 小结

- 筹码分布的成因是换手：只有成交能改写持仓成本，山峰是密集换手的历史成本区，山谷是无人换手的真空。
- 模型两条规则：历史筹码按当日换手率等比衰减、当日成交量均匀分摊到当日价格区间；任何一天持仓总量恒等于流通股本。
- 四个读数从同一张直方图来：获利盘与套牢盘以现价二分（恰等算获利）、平均成本是加权公摊账本、筹码峰是最大桶。
- 反弹滞涨的机制：临近套牢峰时，每个卖盘背后都是等解套的老居民，量不够就推不动墙；峰只能靠换手慢慢消化，消化速度由换手率单方面决定。
- 条件句两套：近峰缩量先减仓、放量穿峰再回；高获利滞涨收紧止损。失效条件都已写明。

读完本章，你应该能回答：

1. 流通盘 1000 股、现价 10 元，分布为 {12 元: 400 股, 10 元: 350 股, 9 元: 250 股}——获利盘、套牢盘各占多少？平均成本是多少？
2. 日换手率 5%，大约几天之后山顶的旧筹码只剩一半？
3. 首日初始化假设意味着图的哪一段最不可信？看真实软件的筹码图要先确认什么？
4. 反弹到峰下沿且量能萎缩，按本章条件句该怎么应对？什么情况下这条应对作废？

去向一句话：峰与谷是反转结构的燃料——第 15 章的双顶与头肩，颈线之下正是套牢峰最厚的地方；那时你会看到，形态的每一步都踩在筹码的地图上。
