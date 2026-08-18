---
title: 一根 K 线的诞生：从逐笔成交到开高低收
---

# 一根 K 线的诞生：从逐笔成交到开高低收

<script setup>
// 本章解剖图的数据：五笔成交与聚出的那根蜡烛，与正文演算表同源，出自实验场 export-docs 脚本。
import anatomy from './assets/data/03-anatomy-candle.json'
</script>

先讲一次让你心里发虚的对照。周三盘中你一直盯着分时图（把当天每分钟成交价连成一条线的图）：上午 10 点半，价格直线冲上 11.20 元，一刻钟内又摁回 10.80 元，尾盘企稳收在 10.98 元。收盘后你切到日线图，屏幕上立着一根红色蜡烛。朋友凑过来问：「今天冲高回落，蜡烛头顶那根细线怎么看？」你张了张嘴，只答得出一句话：「红的，涨了。」

更尴尬的是第二天。你在网上看到有人讨论美股，那边绿是涨、红是跌，跟你的软件正好相反，你瞬间不敢确定自己记的颜色对不对。分时图和 K 线图对不上、看蜡烛只会认红绿，病根是同一个：那根蜡烛身上的四个数字——开盘价、最高价、最低价、收盘价——各自从哪笔成交里来，你说不清。四个数合称开高低收（OHLC，四个英文单词的首字母缩写）。

这一章把这层压缩拆开：四个数怎么来，怎么用代码把一天的逐笔成交亲手聚成一根蜡烛，日线又怎么并成周线。从本章起，全书有了一个伴生实验场（companion）：一个几百行的 TypeScript 最小技术分析引擎，每章演进一点。课程的每条原理，都能在里面跑给你看。

## 一天几千笔成交，怎么记成四个数

### 成因：战报只要四个坐标

一只活跃股票一个交易日有几千上万笔成交，人眼读不动，笔记记不下。三百年前就有人解决过这个问题：相传 18 世纪的日本大阪堂岛大米市场，米商本间宗久用蜡烛记米价——身子记一天的开与收，细芯记高与低。这套记法沿用到今天，就是蜡烛图。

为什么偏偏挑这四个数？因为一场多空拉锯战读完战报，只需要四个坐标：开局谁占先手、终局谁拿下、全天最多推进到哪里、最少退到哪里。开局与终局各来自一场集合竞价——第 2 章看过，开盘价是 9:25 全场按最大成交量投出来的，收盘价由 14:57–15:00 的收盘集合竞价定格。最高价与最低价来自连续竞价里走得最远的主动吃单：买方把卖方的队吃到最深处的那一笔，打下当日最高；卖方反攻到最低的那一笔，同理。

压缩必然丢信息。几千笔的先后次序、每笔的数量细节，全都不在了；换来的是一天一格、一眼扫几个月的尺度。**K 线是一天的压缩战报，不是行情本身**——分时图里藏着它丢掉的一切。

### 载体：一根蜡烛的结构

把 2026 年 3 月 2 日这一天画出来（数字沿用下面的演算）：

```text
10.40 ─┐        ┃  ← 上影线 0.15：最高价到实体顶
        │        ┃
10.25 ─┤     ┏━┻━┓  ← 收盘价（阳线身子顶端）
        │     ┃    ┃
        │     ┃实体┃  0.25
10.00 ─┤     ┃    ┃  ← 开盘价（身子底端）
        │     ┗━┳━┛
 9.80 ─┘        ┃  ← 下影线 0.20：实体底到最低价
```

| 部位 | 由哪两个价构成 | 记录了什么 |
|---|---|---|
| 实体（body，粗段） | 开盘价到收盘价 | 一天拉锯的净结果 |
| 上影线（细线） | 最高价到实体顶 | 冲高被摁回的攻防 |
| 下影线（细线） | 实体底到最低价 | 砸低被托回的攻防 |

实体——开盘价与收盘价之间的粗段；影线——实体上下伸出的细线，上影线顶到最高价，下影线底到最低价。收盘价高于开盘价，这根叫阳线（A股软件默认画红色）；低于开盘价叫阴线（默认画绿色）；开收同价，身子缩成一条横线，留给后面的形态章节细讲。**红绿只是颜色约定，方向永远由收与开的大小决定**——把屏幕调成黑白，蜡烛照样能读。

### 演算：五笔成交，纸笔聚一根蜡烛

真实一天几千笔，原理用五笔就够。设 2026-03-02 当天只成交了五笔（数字为教学示意）：

| 时刻 | 成交价（元） | 数量（股） |
|---|---|---|
| 09:30 | 10.00 | 200 |
| 10:15 | 10.40 | 100 |
| 11:05 | 9.80 | 300 |
| 14:00 | 10.10 | 100 |
| 14:57 | 10.25 | 400 |

一步步聚。开盘价 = 第一笔 = 10.00 元；收盘价 = 最后一笔 = 10.25 元；最高价 = 五笔中最大 = 10.40 元；最低价 = 最小 = 9.80 元；成交量 = 200 + 100 + 300 + 100 + 400 = 1,100 股。

再量这根蜡烛。实体 = |10.25 − 10.00| = 0.25 元；上影线 = 10.40 − 10.25 = 0.15 元；下影线 = 10.00 − 9.80 = 0.20 元；全天振幅 = 10.40 − 9.80 = 0.60 元。三个占比：实体 0.25 ÷ 0.60 ≈ 41.7%，上影 25%，下影 33.3%，加起来正好 100%。收高于开，是阳线。**开=第一笔，收=最后一笔，高=最大那笔，低=最小那笔**——聚合的全部秘密就这一行。

把算出来的四个数画回一根真蜡烛：开 10.00、收 10.25、最高 10.40、最低 9.80——收高于开，阳线，红柱。看图认三段就够：粗的实体从开盘价顶到收盘价，头顶的上影线顶到最高价，脚下的下影线探到最低价，三段的长度比就是刚算的 41.7%、25%、33.3%。

<KLineChart :candles="[anatomy.candle]" :show-volume="false" :height="380" title="2026-03-02 的日 K 单根放大" />

红色实体说的是「收盘高于开盘」：这一天多头净胜 0.25 元。上影线顶端就是 10:15 那笔 10.40 元的最高成交，下影线底端是 11:05 那笔 9.80 元的最低成交。对照上方五笔表逐笔对位：09:30 的第一笔 10.00 落在实体底端（开盘），14:57 的最后一笔 10.25 落在实体顶端（收盘），14:00 的 10.10 落在实体中段——五笔各有各的位置，唯独先后次序被压缩丢掉了。

锚点：把四个数想成小卖部一天的经营记录——开门第一单的价、全天最贵一单、最便宜一单、关门最后一单。开高低收对你就不再是黑话。

最后把分时图接回来。分时图是这一天的显微镜视图：每分钟一个点，连线成曲线，先后细节都在。日线蜡烛是它的压缩快照。两者对不上，不是数据错了，是你手里只有快照、却不懂压缩规则。本章剩下的任务，就是把压缩规则写成代码。

## 渐进实验：亲手把逐笔聚成蜡烛

实验场的约定只有几条：`src/` 放引擎，`tests/` 放每章的断言；一切蜡烛数组按时间从旧到新排列（下标 0 最旧），这是全书的总线约定；两道硬门槛把门——`npm run typecheck` 与 `npm test`，两道全绿，正文才动笔。

### 第零步：先说清数据长什么样

逐笔成交与蜡烛，各用一个类型装下：

```ts
// src/types.ts
/** 逐笔成交：time 为 UTC 毫秒时间戳，price 为成交价（元），size 为成交股数 */
export type Tick = { time: number; price: number; size: number }

/** 一根K线：date 为 'YYYY-MM-DD' 日期标签（按 UTC 解释），volume 为股数 */
export type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 交易时段：open 与 close 为 'HH:mm' 格式的时刻（按 UTC 解释），如 { open: '09:30', close: '15:00' } */
export type Session = { open: string; close: string }
```

时间戳统一按 UTC（协调世界时）解释，是为了让同一段代码在任何机器上算出同样的日期桶——本地时区会让结果跟着机器变，实验就不可复现了。

### 第一步：固定种子，让实验可复现

实验场不联网、不读真实行情，数据全部现场合成。随机数每次不同，测试就没了断言的对象，所以先造一个确定性的随机源：同一种子，永远吐出同一串数。

```ts
// src/data/generate.ts · createRng
/** mulberry32：确定性伪随机数生成器——同一种子永远吐出同一串数，全书合成数据的唯一随机源 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

这是 mulberry32 算法，十几行位运算。你不需要看懂每一行，需要看懂的是它的承诺：种子 42 永远等价于种子 42。

### 第二步：先写断言，再写实现

本章的测试文件先写、先跑，看到失败（红），再实现代码让它转绿。断言的是行为：给定上面那五笔，聚合结果必须逐字段等于手算。

```ts
// tests/candle-anatomy.test.ts · 手算一致
    const ticks = [
      tick('2026-03-02', '09:30', 10.0, 200),
      tick('2026-03-02', '10:15', 10.4, 100),
      tick('2026-03-02', '11:05', 9.8, 300),
      tick('2026-03-02', '14:00', 10.1, 100),
      tick('2026-03-02', '14:57', 10.25, 400),
    ]
    expect(aggregateTicks(ticks, SESSION)).toEqual([
      { date: '2026-03-02', open: 10.0, high: 10.4, low: 9.8, close: 10.25, volume: 1100 },
    ])
```

同一份测试还断言了别的行为：固定种子两次生成结果逐项相等；时段外的逐笔不进蜡烛；五根日线并成一根周线后开高低收各就各位；阴线阳线的解剖读数与手算一致。共 19 项。

### 第三步：聚合器 aggregateTicks

```ts
// src/candles/aggregate.ts · aggregateTicks
export function aggregateTicks(ticks: readonly Tick[], session: Session): Candle[] {
  if (ticks.length === 0) throw new Error('aggregateTicks：ticks 不能为空')
  const openMin = minutesOfDay(session.open)
  const closeMin = minutesOfDay(session.close)
  if (closeMin <= openMin) throw new Error('aggregateTicks：session.close 必须晚于 session.open')

  const byDay = new Map<string, Tick[]>()
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]
    if (i > 0 && t.time < ticks[i - 1].time) {
      throw new Error('aggregateTicks：ticks 必须按时间从旧到新排列')
    }
    if (!Number.isFinite(t.price) || t.price <= 0) {
      throw new Error(`aggregateTicks：第 ${i + 1} 笔的价格必须是正数`)
    }
    if (!Number.isFinite(t.size) || t.size <= 0) {
      throw new Error(`aggregateTicks：第 ${i + 1} 笔的数量必须是正数`)
    }
    const m = minuteOfDay(t.time)
    if (m < openMin || m > closeMin) continue // 早盘前、收盘后的逐笔不计入当天的蜡烛
    const key = dayKey(t.time)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(t)
    else byDay.set(key, [t])
  }

  const candles: Candle[] = []
  for (const [date, bucket] of byDay) {
    candles.push({
      date,
      open: bucket[0].price,
      high: Math.max(...bucket.map((t) => t.price)),
      low: Math.min(...bucket.map((t) => t.price)),
      close: bucket[bucket.length - 1].price,
      volume: bucket.reduce((sum, t) => sum + t.size, 0),
    })
  }
  return candles
}
```

函数分三段。第一段守门：空数组、乱序、非正的价格或数量，当场抛错，错误信息用中文说清期望——宁可立刻炸，不留脏数据往下走。第二段分桶：每笔按日期标签归入当天的桶，落在时段外的逐笔直接跳过；注意「几点开盘几点收盘」由参数 session 传入，不写死在函数里——会变的规则常量不该焊进代码，第 2 章已经领教过。第三段装蜡烛：每桶首笔价做开、末笔价做收、最大最小做高低、数量求和；Map 按插入顺序遍历，输入旧到新，输出自然旧到新。

### 第四步：量出部位 candleAnatomy

聚合器产出整根蜡烛，candleAnatomy 量出身上的部位：

```ts
// src/candles/anatomy.ts · candleAnatomy
export function candleAnatomy(c: Candle): CandleAnatomy {
  const { open, high, low, close } = c
  for (const v of [open, high, low, close]) {
    if (!Number.isFinite(v)) throw new Error(`candleAnatomy：开高低收必须是有限数字，收到的是 ${v}`)
  }
  if (high < low) throw new Error('candleAnatomy：最高价不能低于最低价')
  if (high < open || high < close || low > open || low > close) {
    throw new Error('candleAnatomy：最高/最低价必须包住开盘价与收盘价')
  }
  const body = Math.abs(close - open)
  const upperWick = high - Math.max(open, close)
  const lowerWick = Math.min(open, close) - low
  const range = high - low
  return {
    direction: close > open ? 'yang' : close < open ? 'yin' : 'doji',
    body,
    upperWick,
    lowerWick,
    range,
    bodyRatio: range > 0 ? body / range : 0,
    upperWickRatio: range > 0 ? upperWick / range : 0,
    lowerWickRatio: range > 0 ? lowerWick / range : 0,
  }
}
```

读法与手算完全一致：实体取收与开的距离，与谁高谁低无关；两条影线从实体两端向外量到最高最低；三个占比都以振幅为分母。振幅为 0——四价合一，比如一字涨停——时占比记 0，不让除零发生。direction 三值：yang 是阳线，yin 是阴线，开收同价记 doji（多空打平）。这套读数是后续所有形态识别的地基。

### 第五步：日线并周线

周期聚合——把小周期蜡烛按固定根数并成大周期的操作。规则是同一套：开=组内第一根的开，收=最后一根的收，高=最高的高，低=最低的低，量=求和。

```ts
// src/candles/aggregate.ts · resample
/** n 根日K并成 1 根大周期K线（n=5 即周K）：开=首根开、收=末根收、高=最高、低=最低、量=求和；不足 n 根的尾组照样并成一根 */
export function resample(daily: readonly Candle[], n: number): Candle[] {
  if (daily.length === 0) throw new Error('resample：daily 不能为空')
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`resample：n 必须是不小于 2 的整数（1 根并 1 根没有意义），收到的是 ${n}`)
  }
  for (let i = 1; i < daily.length; i++) {
    if (daily[i].date <= daily[i - 1].date) {
      throw new Error('resample：daily 必须按日期从旧到新排列')
    }
  }
  const merged: Candle[] = []
  for (let i = 0; i < daily.length; i += n) {
    const group = daily.slice(i, i + n)
    merged.push({
      date: group[0].date,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return merged
}
```

两个细节值得盯。尾组不足 n 根时照样并成一根：进行中的这一周只有三天，就先用三天并——行情软件里「本周」的周线每天都在重写，就是它。新蜡烛的 date 记组内第一个交易日，方便对回日历。还有一个反方向的常识：**压缩不可逆，周线拆不回日线**——周三冲到多高，周线不知道。所以想找回丢掉的分辨率，只有一个方向：回到更低级别的图上去看——日线看不清的当天攻防，去分时图里看。

### 数据从哪来

合成逐笔的心脏只有九行：价格做随机游走——每走一步随机涨跌一点、再从新价格继续走；数量取 100 到 1,000 股的整手（1 手 = 100 股，第 2 章的规矩）。

守门与时段默认值略去，只看主循环：

```ts
// src/data/generate.ts · generateTicks（逐笔生成的心脏）
  const ticks: Tick[] = []
  let price = opts.startPrice
  for (const date of tradingDates(opts.startDate ?? '2026-01-05', opts.days)) {
    const base = dayStart(date)
    for (let i = 0; i < opts.ticksPerDay; i++) {
      const minute = openMin + Math.floor(((closeMin - openMin) * i) / opts.ticksPerDay)
      price = Math.max(0.01, round2(price * (1 + (rng() * 2 - 1) * volatility)))
      const size = 100 * (1 + Math.floor(rng() * 10))
      ticks.push({ time: base + minute * 60_000, price, size })
    }
  }
  return ticks
```

每笔价格 = 上一笔乘以（1 加减一个不超过 volatility 的随机比例），四舍五入到分。同文件里还有 `generateCandles`：跳过逐笔细节直接合成日线，给后面只关心日线的指标章节当地基。简化之处照实声明：合成行情是随机游走，不模拟任何真实走势；一天简化为 09:30–15:00 的连续时段（真实市场有午休，开盘价也来自 9:25 的集合竞价撮合）；交易日跳过周六周日。全部差异登记在附录的差异清单。

## 验证：两道门槛与三处对照

第一道门槛是编译期。在实验场目录里 `cd companion`，再跑 `npm run typecheck`：tsc 对 `src` 与 `tests` 做严格类型检查，无输出即通过。第二道是运行期：`npm test`，你会在终端看到 `tests/candle-anatomy.test.ts` 19 项测试全绿，其中就有你手算过的那组数字。想亲手摸一摸门槛？改一个词就够：把 `open: bucket[0].price` 改成 `bucket[bucket.length - 1].price`，再跑 `npm test`。手算那条测试立刻变红——聚合器在守你的数字。改回来，重新全绿。

不进实验仓也有三处可验证：

1. 纸笔：合上书，用演算那张五笔表重算开高低收与三根尺子，再翻回来对答案。
2. 手机：明天收盘后挑一只活跃股票，先看分时图读出全天最高与最低，再切日线图核对当天的最高价与最低价。两个数应当一致——它们来自同一堆逐笔成交。
3. 手机：切到周线图读本周最高价，再回日线图找这五天里最高的那个最高。又一致。三处对照做完，「对不上」的病就好了。

## 小结

- K 线是一天的压缩战报：开=时段内第一笔成交，收=最后一笔，高=最高的那笔，低=最低的那笔；先后细节被压缩丢掉，分时图是找回细节的显微镜。
- 实体记净结果（开到收），影线记被顶回的攻防；红绿只是颜色约定，方向永远看收与开。
- 周期聚合是同一套规则在大尺度上重复：周线的开高低收完全由组内日线决定，且压缩不可逆。
- 实验场本章新增五个模块与首个测试文件：`src/types.ts`、`src/time.ts`、`src/data/generate.ts`、`src/candles/aggregate.ts`、`src/candles/anatomy.ts`。19 项断言全绿。

读完本章，你应该能回答：

1. 10:15 那笔 10.40 元的成交，进了蜡烛的哪个部位？如果同样的成交发生在 15:10，还进吗？
2. 开 10.00、收 9.70、高 10.20、低 9.50：这是阳线还是阴线？实体与上下影线各多少？
3. 五根日线并成一根周线后，还能从这根周线还原出周三的最高价吗？为什么？
4. createRng(42) 两次喂给生成器，得到的序列一样吗？这对「断言行为」为什么是前提？

去向一句话：第 4 章把这些数字画成图——同一根蜡烛在不同纵轴区间里长相会变，到那时你会庆幸自己已经学会看数字，而不是看长相。
