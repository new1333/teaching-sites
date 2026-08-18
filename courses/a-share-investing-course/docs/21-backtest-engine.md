---
title: 最小回测引擎：拿历史数据彩排你的策略
---

# 最小回测引擎：拿历史数据彩排你的策略

<script setup>
// 图一：守规的均线交叉策略资金曲线（area）叠买入持有基准（LineChart）。
import eq from './assets/data/21-equity.json'
// 图二：同一行情、同一引擎，偷看写法与守规写法的资金曲线对比（LineChart）。
import look from './assets/data/21-lookahead.json'
</script>

你在行情软件里调出了一个「回测年化 50%」的金叉策略。回测曲线一路向右上，三年翻五倍；充钱实盘三个月，账户亏成狗，曲线一路向右下。你怀疑软件坏了，其实是回测这门手艺里藏着三个坑，坑坑都能把彩排成绩吹上天：信号偷看了答案、参数把历史答案背了下来、样本里只装了活下来的股票。三个坑在行内各有名字——未来函数、过拟合、幸存者偏差，本章会把它们一一亲手造出来、亲眼看它吹出多大的牛皮，再学防。

先交代本章要造的东西：一个三百余行（含注释）的最小回测引擎。造完之后，你在第 9 章验过的形态、第 11 章的均线、第 16 到 18 章的指标，都能整段接进同一台机器，跑出含费用、守规则的成绩单。

## 回测是什么：把规则放进历史里彩排

回测（backtest）——拿历史行情当考卷、把一套买卖规则逐根跑一遍、数出成绩的模拟。它存在的理由在第 20 章末尾就埋下了：期望值要三个参数（胜率、平均盈利、平均亏损），凯利要拿参数算仓位，可参数从哪来？口头报的不算数。回测就是出参数的那台仪器：规则跑过历史，交易列表摆在那里，胜率与盈亏比现场数出来。

彩排这个比喻只用到一句：戏上台之前先在剧场里走一遍，彩排顺不等于首演顺——历史走得通，只证明规则没有违反历史，不承诺未来。这句提醒贯穿全章。

引擎的工作方式一句话能说完：逐根推进。走到第 i 根 K 线，收盘之后问一次策略「现在怎么说」，然后按答案记账。但有三条纪律必须写死在引擎里，一条都不能靠自觉。

**纪律一：信号只用当时可见的信息**。策略在第 i 根收盘后被调用，守规的写法只该看第 i 根及之前的数据。引擎把整个数组都交给策略——用不用未来的数据，引擎管不了，这是本章后半段「未来函数」要亲手演示的事故现场。

**纪律二：T+1，当天信号次日开盘成交**。第 2 章教过：A 股当天买入的股票最快次日才能卖。信号在收盘后产生，你最早的下单时点是第二天，成交价锚在次日开盘价上。第 9 章验形态时我们欠了一笔账：收盘对收盘、不含费用、不查可成交性——那章明说费用、滑点与 T+1 留给第 21 章回测引擎一并入账，现在还账。

**纪律三：费用三件套逐笔入账**。佣金：买卖双向，按成交金额收，常见万 1 到万 3、单笔最低 5 元。印花税：只在卖出时收，成交金额的 0.05%。滑点（slippage）——你想成交时实际拿到的价格比屏幕上看到的价格更差的那一小截：下市价单要吃掉盘口价差，排队时价格又在动，于是买贵一点、卖贱一点。引擎按开盘价上下各偏一个固定比例（默认 0.1%）入账。跟着算一遍：开盘 10 元，买入成交价 10 × 1.001 = 10.01 元；开盘 10.5 元卖出，成交价 10.5 × 0.999 = 10.4895 元。一来一回，单看价格就比屏幕读数少了约 0.2 个百分点。

绩效报告四件套，全是旧相识升级：总收益看两头；最大回撤（max drawdown）——资金曲线从已到过的山顶到其后最深谷底的那次下坡，第 20 章的破产线管「死没死」，回撤管「路上最深摔过多少」，两个都是风险的语言；胜率与盈亏比从交易列表里现场数出来——第 9 章、第 20 章口头报的参数，在这里变成读数。报告里还压着一条买入持有基准：第一天开盘全仓买入、拿到期末不动（同款费用）。策略忙活一场，连「什么都不做」都跑不赢的话，这套规则在这段行情上就不合格。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审八组：T+1 成交时点、零费用手账、费用三件套逐项、未来函数、过拟合与样本内外、幸存者偏差、metrics 独立手算、非法输入。挑四段出来看断言的样子。

先审 T+1——七根 K 线的手工样本，信号剧本写死：

```ts
// tests/backtest-engine.test.ts · T+1：信号日与成交日隔一根
  it('第 1 根收盘喊买，成交在第 2 根开盘：entryIndex=1、成交价=第 2 根开盘价', () => {
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.entryIndex).toBe(1)
    expect(r.trades[0]!.entryIndex).not.toBe(0)
    expect(r.trades[0]!.entryPrice).toBeCloseTo(HAND[1]!.open, 10)
    expect(r.trades[0]!.entryDate).toBe('2026-03-03')
  })
```

再审费用——佣金只开一项时，账要能逐笔对上：

```ts
// tests/backtest-engine.test.ts · 只开佣金：双向逐笔记账
  it('只开佣金（万3）：买卖双向都收——整手预算后 9900 股，买腿 99000×0.0003=29.7、卖腿 103950×0.0003=31.185', () => {
    const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), { ...FREE, commissionRate: 0.0003 })
    expect(r.trades[0]!.shares).toBe(9900) // 100000 元要给佣金留预算：买 9900 而不是 10000 股
    expect(r.trades[0]!.entryCost).toBeCloseTo(29.7, 6)
    expect(r.trades[0]!.exitCost).toBeCloseTo(31.185, 6)
    expect(r.trades[0]!.costs).toBeCloseTo(60.885, 6)
  })
```

三件套全开后，同一策略、同一行情，收益必须下降：

```ts
// tests/backtest-engine.test.ts · 三件套全开后的收益下降断言
  it('三件套全开（默认档）后：同一策略、同一行情，总收益低于零费用档', () => {
    const free = backtest(HAND, scripted(HAND_PLAN), FREE)
    const full = backtest(HAND, scripted(HAND_PLAN))
    expect(full.totalReturn).toBeLessThan(free.totalReturn)
    for (const t of full.trades) expect(t.costs).toBeGreaterThan(0)
  })
```

最后是未来函数的指纹——同一根 K 线上的信号，竟会被之后的行情改写：

```ts
// tests/backtest-engine.test.ts · 未来函数的指纹
    const sameHead = [10, 9.5, 9, 8.5, 8]
    const turnsUp = mk([...sameHead, 8.5, 9, 9.5, 10, 10.5, 10.2]) // 全程最低在第 5 根
    const keepsFalling = mk([...sameHead, 7.5, 7, 6.5, 6, 5.5, 5.2]) // 最低在最后一根
    const p = peek()
    expect(p(turnsUp, 4)).toBe('buy') // 前五行情完全相同——
    expect(p(keepsFalling, 4)).toBe('hold') // 只因之后走的不同，第 5 根的信号就变了
```

见红后实现。新模块 `src/backtest/`，两个文件，只增不改。先是契约——策略长什么样、费用怎么配：

```ts
// src/backtest/engine.ts · 策略与费用的契约
/** 一根K线收盘后的三值指令：买入 / 卖出 / 不动 */
export type BacktestSignal = 'buy' | 'sell' | 'hold'

/** 策略函数：在第 index 根收盘后被调用，只该用 candles[0..index] 的信息做决定。
 *  签名与第 9 章的 PatternMatcher 同构——形态判定器、指标交叉表都能直接接进来 */
export type Strategy = (candles: readonly Candle[], index: number) => BacktestSignal

/** 费用与资金参数：不传走默认档（第 2 章教过的常见口径） */
export type CostOpts = {
  /** 初始资金（元），默认 100000 */
  initialCash?: number
  /** 佣金率：买卖双向按成交金额收，默认 0.0003（万 3） */
  commissionRate?: number
  /** 单笔最低佣金（元），默认 5 */
  minCommission?: number
  /** 印花税率：只在卖出时按成交金额收，默认 0.0005（0.05%） */
  stampTaxRate?: number
  /** 滑点率：成交价对开盘价的偏移比例（买贵卖贱），默认 0.001（0.1%） */
  slippageRate?: number
  /** 暖机根数：前 warmup 根不问策略（识别器要背景窗），默认 0 */
  warmup?: number
}
```

主体一台循环。全貌如下，三段注释就是三步舞步：

```ts
// src/backtest/engine.ts · backtest 全貌
export function backtest(candles: readonly Candle[], strategy: Strategy, opts: CostOpts = {}): BacktestReport {
  const o = { ...DEFAULTS, ...opts }
  assertBacktestArgs(candles, strategy, o)

  const commission = (amount: number): number => Math.max(amount * o.commissionRate, o.minCommission)
  const buyFill = (open: number): number => open * (1 + o.slippageRate) // 滑点：买贵一点
  const sellFill = (open: number): number => open * (1 - o.slippageRate) // 卖贱一点

  /** 现金能买几股（整手），且金额 + 佣金不许超出现金 */
  const sharesFor = (cash: number, price: number): number => {
    let shares = Math.floor(cash / price / 100) * 100
    while (shares > 0 && shares * price + commission(shares * price) > cash) shares -= 100
    return shares
  }

  // 买入持有基准：第 1 根开盘全仓买入（同款滑点与佣金），拿到期末按收盘估值、不收卖出费用
  const bhPrice = buyFill(candles[0].open)
  const bhShares = sharesFor(o.initialCash, bhPrice)
  const bhCash = o.initialCash - bhShares * bhPrice - commission(bhShares * bhPrice)
  const buyHoldEquity = candles.map((c) => bhCash + bhShares * c.close)

  // 主循环：单一持仓，现金账逐笔结清
  let cash = o.initialCash
  let shares = 0
  let pending: 'buy' | 'sell' | null = null
  let entry: { index: number; price: number; cost: number; invested: number } | null = null
  const trades: BacktestTrade[] = []
  const equity: number[] = []

  for (let i = 0; i < candles.length; i++) {
    // 一、昨日收盘的信号在今日开盘成交（T+1）
    if (pending === 'buy') {
      const price = buyFill(candles[i].open)
      const n = sharesFor(cash, price)
      if (n > 0) {
        const amount = n * price
        const cost = commission(amount)
        cash -= amount + cost
        shares = n
        entry = { index: i, price, cost, invested: amount + cost }
      } // 一手都买不起：这单作废，继续空仓等下一个信号
    } else if (pending === 'sell') {
      const e = entry
      if (shares > 0 && e) {
        const price = sellFill(candles[i].open)
        const amount = shares * price
        const cost = commission(amount) + amount * o.stampTaxRate // 印花税只收卖出腿
        cash += amount - cost
        trades.push({
          entryIndex: e.index,
          entryDate: candles[e.index].date,
          entryPrice: e.price,
          entryCost: e.cost,
          exitIndex: i,
          exitDate: candles[i].date,
          exitPrice: price,
          exitCost: cost,
          shares,
          costs: e.cost + cost,
          pnl: amount - cost - e.invested,
          returnRate: (amount - cost - e.invested) / e.invested,
        })
        shares = 0
        entry = null
      }
    }
    pending = null

    // 二、收盘估值：现金 + 持仓 × 当根收盘价
    equity[i] = cash + shares * candles[i].close

    // 三、问策略：这根收盘后怎么说（最后一根问了也没法成交，不问）
    if (i >= o.warmup && i < candles.length - 1) {
      const signal = strategy(candles, i)
      if (signal === 'buy' && shares === 0) pending = 'buy'
      else if (signal === 'sell' && shares > 0) pending = 'sell'
    }
  }

  const stats = tradeStats(trades.map((t) => t.pnl))
  return {
    trades,
    equity,
    openPosition:
      entry && shares > 0
        ? {
            entryIndex: entry.index,
            entryDate: candles[entry.index].date,
            entryPrice: entry.price,
            entryCost: entry.cost,
            shares,
          }
        : null,
    totalReturn: totalReturn(equity),
    maxDrawdown: maxDrawdown(equity),
    winRate: stats.winRate,
    payoffRatio: stats.payoffRatio,
    buyHoldEquity,
    buyHoldReturn: (buyHoldEquity[buyHoldEquity.length - 1] - o.initialCash) / o.initialCash,
    initialCash: o.initialCash,
  }
}
```

读两个承重点。其一，`pending` 是 T+1 的全部实现：信号只把一个「明天开盘做这件事」的字条放进变量，成交发生在下一圈循环的开头——想「今天收盘出信号、今天收盘价成交」，在这台引擎里拼不出来；最后一根不问策略，因为没有下一根开盘可供成交。其二，`sharesFor` 的整手预算：A 股按 100 股一手买卖，买入金额加佣金不许超出现金——10 万元本金在 10.01 元的成交价上买 9900 股而不是 10000 股，差的预算就是留给佣金的。期末仍持仓的照实报进 `openPosition`，不进胜率（没平仓就没有输赢），只按收盘价进资金曲线。

绩效四件套在 `src/backtest/metrics.ts`，脱离引擎也能单独用：

```ts
// src/backtest/metrics.ts · maxDrawdown 全貌
export function maxDrawdown(equity: readonly number[]): number {
  assertCurve(equity, 'maxDrawdown')
  let peak = equity[0]
  let worst = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = 1 - v / peak // 相对「到此为止最高点」的下坡幅度
      if (dd > worst) worst = dd
    }
  }
  return worst
}
```

```ts
// src/backtest/metrics.ts · tradeStats 全貌
export function tradeStats(pnls: readonly number[]): TradeStats {
  if (!Array.isArray(pnls)) {
    throw new Error(`tradeStats：pnls 必须是数组，收到的是 ${typeof pnls}`)
  }
  for (let i = 0; i < pnls.length; i++) {
    if (!Number.isFinite(pnls[i])) {
      throw new Error(`tradeStats：第 ${i} 笔盈亏必须是有限数字，收到的是 ${pnls[i]}`)
    }
  }
  let wins = 0
  let winSum = 0
  let lossSum = 0
  for (const p of pnls) {
    if (p > 0) {
      wins++
      winSum += p
    } else {
      lossSum += -p // 平手（0）落进亏损侧：没赚就是输，口径与第 9 章一致
    }
  }
  const losses = pnls.length - wins
  return {
    count: pnls.length,
    wins,
    winRate: pnls.length === 0 ? 0 : wins / pnls.length,
    avgWin: wins === 0 ? 0 : winSum / wins,
    avgLoss: losses === 0 ? 0 : lossSum / losses,
    payoffRatio: losses === 0 ? null : winSum / wins / (lossSum / losses),
  }
}
```

`maxDrawdown` 一遍扫过：手里记着「到此为止的最高点」，每个新值算一次下坡幅度，留最深的一个。`totalReturn` 一行：期末除以期初减一。参数校验门 `assertBacktestArgs`（空行情、非函数策略、非正资金、费率越界、warmup 非整数，共十三案）与两函数同文件，测试逐项验过抛错。

## 一份成绩单怎么读

引擎有了，先跑一份守规的样本成绩单。策略用第 11 章的 MA5/MA20 交叉：金叉喊买、死叉喊卖。两种写法都出自实验场的真实代码，一字未改：

```ts
// tests/backtest-engine.test.ts · maCross 与 peek 两种写法
/** 均线交叉策略（守规写法）：金叉喊买、死叉喊卖。交叉表按行情缓存只算一次，
 *  逐格读取——第 i 格的交叉只用第 i 根之前的数据，因果干净 */
const maCross = (fast: number, slow: number): Strategy => {
  let table: Map<number, 'golden' | 'dead'>
  let src: readonly Candle[] | null = null
  return (candles, i) => {
    if (src !== candles) {
      src = candles
      table = new Map(crossovers(candles, fast, slow).map((c) => [c.index, c.kind]))
    }
    const kind = table.get(i)
    return kind === 'golden' ? 'buy' : kind === 'dead' ? 'sell' : 'hold'
  }
}

/** 偷看写法（未来函数）：在整段行情的最低收盘日喊买、最高收盘日喊卖——
 *  信号日是拿全序列（含未来）事后挑出来的（同样按行情缓存） */
const peek = (): Strategy => {
  let minI = -1
  let maxI = -1
  let src: readonly Candle[] | null = null
  return (candles, i) => {
    if (src !== candles) {
      src = candles
      minI = 0
      maxI = 0
      for (let k = 1; k < candles.length; k++) {
        if (candles[k].close < candles[minI].close) minI = k
        if (candles[k].close > candles[maxI].close) maxI = k
      }
    }
    return i === minI ? 'buy' : i === maxI ? 'sell' : 'hold'
  }
}
```

`maCross` 里的交叉表虽然一次算完，但读第 i 格只动第 i 格。交叉判据本身只用当根及之前的数据，因果干净；缓存按行情数组记账，换一段行情就重算。300 根合成行情（种子 2102、日波动 3%），费用走默认档，资金 10 万元。

<LineChart :series="eq.series" :labels="eq.labels" title="守规策略 vs 买入持有：同一行情的两份资金曲线" />

八笔忙活，输给一条灰线。

读数：策略做了 8 笔，总收益 −1.3%，最大回撤 41.2%，胜率 38%（3/8，约 38%），盈亏比 1.85；买入持有基准 +40.3%，回撤 27.4%。两个教训当场立住。第一，均线交叉在这种震荡行情上反复挨打（第 11 章讲滞后时就预告过），既没跑赢基准、回撤还更深——**连「什么都不做」都跑不赢的策略，回测成绩单上就该打回重造**。第二，胜率 38% 配盈亏比 1.85 是第 20 章教过的画像：输多赢少但赢的大，期望值未必是负的——四件套要合起来读，单看任何一个都会误诊。

这张图由 companion 的 `src/backtest/engine.ts` 的 `backtest` 现场算出（`npm run export-docs`，种子 2102），数据文件 `21-equity.json`。

## 亲手踩坑一：未来函数，偷看答案的信号

未来函数（lookahead bias）——信号在做决定那天用了那天之后才能知道的信息，也就是偷看答案。上图的行情原样不动、引擎原样不动，只把策略换成 `peek` 那个「整段最低收盘日买、最高收盘日卖」的写法。

<LineChart :series="look.series" :labels="look.labels" title="同一行情、同一引擎：偷看写法 vs 守规写法" />

一条笔直的起飞线。

读数：偷看写法整段只做一笔（2026-09-17 开盘买、2027-02-08 开盘卖），总收益 +89.9%，最大回撤 6.8%——回撤比守规版浅六倍。注意这台引擎并没有放水：成交照样 T+1 次日开盘、照样扣三件套费用，偷看发生在信号层面——「最低点」「最高点」是拿全序列事后挑出来的，实盘那天你根本不知道哪里是最低。开章那句「回测年化 50%」，最常见的就是这台造币机印出来的。ZIGZAG 这类会「重绘」的指标（新K线出来后回头改写旧信号）、软件默认的「当天收盘出信号、按当天收盘价成交」口径（信号成立的那一刻价格已经过去了），都是它的变体。

防它的手段就两条。其一，结构防：本引擎把成交钉死在次日开盘，收盘价成交这类偷价拼不出来；用别人平台回测时，先查成交口径。其二，指纹查：本章测试里那段「前五根行情完全相同、只改之后的走法，第 5 根上的信号就从 buy 变 hold」就是定义性检验。把未来几根 K 线改一改，守规策略的既有信号纹丝不动，未来函数的信号当场改口。

## 亲手踩坑二：过拟合，把历史答案背下来

过拟合（overfitting）——参数调到对这段历史完美，等于把答案背下来当成规律；市场换一段考卷，立刻现形。亲手跑一遍：还是均线交叉策略族，换七组窗口参数，同一段 400 根行情，前 280 根当样本内调参、后 120 根当样本外验证（零费用档，读数更纯粹）。这是测试里逐行断言过的真实扫描：

| 窗口 | 样本内（前 280 根） | 样本外（后 120 根） |
|---|---|---|
| MA2/20 | +15.6% | −16.8% |
| MA3/10 | −6.5% | −16.9% |
| MA5/10 | −7.5% | −13.8% |
| MA5/20 | −8.7% | −3.7% |
| MA10/20 | −10.1% | −11.5% |
| MA10/30 | −7.3% | −15.6% |
| MA20/60 | −8.8% | −2.4% |

三个读数摆在一起看。参数敏感性：同一策略族只换窗口，样本内成绩从 +15.6% 拉到 −10.1%，差距 25.7 个百分点——参数可挖的空间有多大，过拟合的温床就有多大。冠军陨落：样本内状元 MA2/20 的 +15.6% 一到样本外变成 −16.8%，七组里倒数第二。样本外另有状元：真正样本外最好的是 MA20/60，也只有 −2.4%——这段行情本身就不适合这个策略族，样本内那个「完美」纯粹是背了答案。

样本内外切分（in-sample / out-of-sample，前段调参、后段只验证不回改）就是过拟合的体检流程。规矩只有一条：样本外的成绩出来之后，不许再回去改参数重挑——改了再验，样本外就成了第二块样本内。日常防它还有两招：参数要少而钝，能动的旋钮越多，可背的答案越多；成绩对参数要平滑，相邻参数的成绩不该出现悬崖，MA2/20 独占 +15.6% 而邻居最好的也只有 −6.5%，这个孤峰本身就是警报。

## 亲手踩坑三：幸存者偏差，池子里没有死者

幸存者偏差（survivorship bias）——只统计了没死掉的样本，读数整体虚高。这次引擎连策略都不用换：12 只合成股票（种子 300 到 311，各 200 根），每 3 只让 1 只在末段崩掉 65%——模拟退市、暴雷出局。每只都跑买入持有：

全样本 12 只的平均收益 −25.5%；把崩掉的那 4 只从池子里剔除，剩 8 只「幸存者」的平均收益 −7.6%。高了 17.9 个百分点，而这 8 只股票自己一分钱没变——被剔走的死者（平均 −61.3%）才是真账的一部分。A 股实况更实在：退市的、戴帽摘不掉的、被吸收合并的股票，如果回测池子只装「今天还活着」的名单，你回测的是幸存者的传记，不是市场的历史。专业做法叫 point-in-time（用时点成分）：回测 2020 年就用 2020 年当时的成分股名单，含后来死掉的。个人拿不到这种数据时，退而求其次的诚实做法：把「只含幸存者」的回测读数整体打个折扣看，且不据此上仓位。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：404 项全绿，其中 47 项是本章新增。覆盖面：T+1 六案（信号日与成交日隔一根、最后一根的信号永不成交、买进次日喊卖也要再等一天、期末持仓不进胜率、重复买入不重复建仓）；零费用手账五案（两笔交易的股数、盈亏、七格资金曲线逐格比对，总收益 +0.8%、回撤 9.32%、胜率 1/2、盈亏比 5000/4200 与纸面账一致）；费用六案（滑点 10→10.01 与 10.5→10.4895、佣金双向 29.7/31.185、最低佣金 5 元压过万 3）；另有印花税只收卖腿 52.5、三件套全开后收益下降、快线策略 200 根 10 笔被费用咬掉 2.8 个百分点三案；未来函数三案（偷看比守规多赚 25 个百分点以上、信号被未来改写的指纹）；过拟合三案（样本内拉开 15 个百分点以上、冠军出样本外掉队、样本外另有状元）；幸存者两案（幸存者平均虚高 10 个百分点以上、崩盘股平均亏 35% 以上）；metrics 独立手算五案；非法输入十七案全部抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 21 章一段：守规的 MA5/20 交叉策略 8 笔、总收益 −1.3%、最大回撤 41.2%、胜率 38%、盈亏比 1.85；买入持有基准 40.3%、回撤 27.4%；偷看写法整段一笔、总收益 89.9%、最大回撤 6.8%。`docs/assets/data/` 下多出两个 `21-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体——一笔来回的真实成本，纸笔就能复算：

```ts
// 用法示例：一笔来回的真实成本（node 直接可跑）
const open = 10                          // 信号次日开盘价（元）
const shares = 10000                     // 成交股数
const slip = 0.001, fee = 0.0003, minFee = 5, tax = 0.0005
const buy = open * (1 + slip)            // 滑点：买贵 0.1%
const sell = 10.5 * (1 - slip)           // 假设次日开盘 10.5 卖出：卖贱 0.1%
const pay = (amount: number) => Math.max(amount * fee, minFee)
const cost = pay(buy * shares) + pay(sell * shares) + sell * shares * tax
console.log(cost.toFixed(2), ((sell - buy) * shares - cost).toFixed(2)) // 113.95 4681.05
```

屏幕上看是 10 元买、10.5 元卖、毛利 5000 元；账本上是 10.01 买、10.4895 卖，三件套咬掉 113.95 元，净利 4681.05 元。把你自己常用的参数代进去算一遍，这就是每次出手前该看的底账。

## 用法收三条，全部条件句

其一，若一套规则在含费用与 T+1 的回测里跑赢买入持有、最大回撤在你的承受线内、且样本外复验不翻车，常见的应对是把它放进候选清单、以小仓位实盘验证；失效条件：实盘成交价与回测的滑点假设持续背离，或样本外成绩转负——停用重审。其二，若回测成绩主要来自某个精确参数或少数几笔交易，常见的应对是按过拟合嫌疑处理：参数钝化（取相邻参数成绩都平稳的一片，不用孤峰）、扩样本再验；失效条件：任何「再调一档参数就能更好」的诱惑——那是在背答案。其三，若回测样本只含当前还在交易的股票，常见的应对是把读数整体打折、只做方向性参考；失效条件：拿打折后的读数直接算仓位——幸存者的传记不配当仓位依据。

简化之处照实声明。策略全仓进出、不分批不加仓（第 20 章的仓位算法不进引擎，是实验的下一层）；期末持仓按收盘估值、不强制平仓；滑点取固定比例口径，不建模盘口深度，也不检查涨跌停可成交性——一字板上的买不进卖不掉（第 6 章见过）在引擎里照样「成交」；买入持有基准含买入费用、不含卖出费用；样本内外切分处指标在样本外重新暖机；行情全部为固定种子合成数据，非真实历史。这些全部登记在附录差异清单。

## 小结

- 回测是拿历史数据彩排：逐根推进、信号只用当时可见的信息、T+1 次日开盘成交、费用三件套逐笔入账——三条纪律写死在引擎结构里，不靠自觉。
- 绩效四件套（总收益、最大回撤、胜率、盈亏比）加上买入持有基准，合起来才算成绩单；胜率 38% 配盈亏比 1.85 的画像要用第 20 章的眼睛读。
- 三大坑都亲手跑出了读数：未来函数让 −1.3% 变 +89.9%（信号被未来改写是它的指纹）；过拟合让样本内状元 +15.6% 出样本外变 −16.8%（样本内外切分是体检）；幸存者偏差把 −25.5% 的池子读成 −7.6%（用时点成分才算数）。
- 实验场新增 `src/backtest/`：`backtest` / `maxDrawdown` / `totalReturn` / `tradeStats`，只增不改。

读完本章，你应该能回答：

1. 一套策略第 3 根收盘喊买，引擎在第几根、按什么价格成交？费用三件套各扣在哪条腿上？
2. 同一行情、同一引擎，偷看写法凭什么做到回撤只有守规版的六分之一？用「信号被未来改写」说一遍检验办法。
3. 样本内冠军一到样本外就掉队，说明什么？为什么样本外成绩出来后不许回去改参数？
4. 剔除 4 只崩盘股后平均读数高了 17.9 个百分点，这 17.9 个点是从哪里凭空出现的？

去向一句话：引擎已经能给出含费用、守规则的成绩单，第 22 章把全书积木——形态、指标、期望值、仓位、回测——组装成一套完整的交易系统，并配一份防骗清单。
