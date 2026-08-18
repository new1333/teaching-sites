---
title: 形态到底灵不灵：用统计给三十种形态验货
---

# 形态到底灵不灵：用统计给三十种形态验货

<script setup>
// 本章四张图的数据，全部来自实验场 export-docs 脚本对 src/stats/evaluate.ts 的真实计算。
import scan from './assets/data/09-hammer-scan.json'
// 8000 个交易日的行情里，识别器找到的全部锤子线。图为前 200 根。
import curve from './assets/data/09-hammer-learning.json'
// 锤子线胜率的累计曲线：读数随样本量长出来。
import ctrl from './assets/data/09-shuffle-control.json'
// 200 组随机对照组的胜率分布，与实测、基准同框。
import verdict from './assets/data/09-verdict.json'
// 七行验货：六种形态加一行注入剧本的阳性对照。
</script>

三月底那只票你记得很清楚：下跌末端的锤子线，你按第 5 章的判据核过——长下影、小实体、背景跌足 5%，买入，五天后赚 6% 离场。从那天起「锤子线灵」成了你的信条。上周群里有人贴图：同样标准的锤子线，买进去继续跌 8%。你回了句「我上次就赚了」，他回了句「我上次就亏了」。吵到半夜，谁也没说服谁——因为你们手里的都是个案，而个案当不了证据。你那次赚了，可能是形态的本事，也可能只是赶巧。到底是哪种，感觉说了不算。

问题不在嗓门，在仪器。前四章你攒下了三十余种形态的数值判据，但判据只回答「是不是锤子线」，从不回答「锤子线之后到底涨不涨」。这一章给实验场装上验货机，读数只有三样，先在这里各给一句人话：**胜率——赢的次数占全部形态命中的比例；基准概率——不看形态、随便挑一天也会赢的比例；随机对照——让随机挑的日子亲自跑一遍，看能不能碰出同样的成绩。** 样本量——命中的累计次数——是这三样的地基，先于一切读数。读完本章，你谈论任何形态的方式会从「上次赚了」变成三行数字。

## 胜率：把个案折成一个分数

为什么需要胜率（win rate——盈利次数占全部交易次数的比例）？因为个案之间没有公约。你的一次成功对别人的一次失败，谁也压不倒谁；把同类事件全部收进来折成「赢几次 ÷ 总几次」，两个形态、两个人、两段时间才能放上同一张桌子比。教科书把锤子线叫「反转信号」，信号灵不灵，也要先把每一根的历史结局都数出来。

载体是三条定义，一条都不能含糊：

- 赢面判定：形态命中后，往后再数第 horizon 根（前瞻窗口，horizon 就是往后看的 K 线根数，本章取 5），收盘严格高于命中日收盘算赢；平手算输。
- 胜率 = 赢的命中数 ÷ 有效命中数。
- 有效命中：既命中形态、又走完了前瞻窗口的判定日——窗口没走完的，输赢未定，不计入。

跟着算一遍。手搓一段收盘价序列：10、11、10、12、11、13、12、14，共 8 根，前瞻窗口取 2。可判定日是第 0 到第 5 根（再往后凑不满两根）。逐格判：

```text
判定日 i=0：两根后收 10，对命中日收 10 —— 平手，输
判定日 i=1：两根后收 12，对 11 —— 赢
判定日 i=2：两根后收 11，对 10 —— 赢
判定日 i=3：两根后收 13，对 12 —— 赢
判定日 i=4：两根后收 12，对 11 —— 赢
判定日 i=5：两根后收 14，对 13 —— 赢
```

六格里赢五格。现在让一个只在第 0、4、6 根命中的判定器进场：第 6 根在第 5 根之后、凑不满窗口，剔除；有效命中剩两个——第 0 根（平手，输）与第 4 根（赢）。胜率 = 1 ÷ 2 = 50%。锚点：篮球的投篮命中率——一个球员准不准，看整季几千次出手折出来的比例，没人拿某一次绝杀当论据。

## 样本量：胜率是个会抖的读数

胜率是除法，分母就是样本量（sample size——同类事件被统计到的累计次数）。为什么看读数之前要先看它？因为胜率是从历史里抽样算出来的读数，样本越少，读数抖得越凶。10 个样本里赢 7 个是 70%，再连输 3 个就掉到 54%——三五个个案就能把结论掀翻一次。

抖动宽度有个粗略的量级：大约 1 ÷ (2√n)，n 是样本量。10 个样本上下 16 个百分点，60 个上下 6 个，600 个上下 2 个（这个式子的来历，第 18 章标准差正式登场时回头细算）。下面这张图就是抖动的现场：8000 个交易日的合成行情里，锤子线共命中 59 次，每命中一次，曲线就记一笔累计胜率。

<LineChart :series="curve.series" :labels="curve.labels" percent-y title="锤子线胜率的累计曲线（59 个样本）" />

开局极其唬人。前 8 个样本几乎全胜，累计胜率一度冲到 0.88——如果有人在第 8 个样本时写下「锤子线胜率九成」，图表证词看起来无懈可击。第 9 个样本输了，读数跌回 0.78；此后一路晃到 59 个样本，收在 0.49。**样本量不足时读出来的胜率，不是形态的性质，是开局的运气。**锚点：尝一勺汤判断咸淡——勺越小，咸淡越说不准；样本量就是那把勺子。

## 基准概率：胜率的另一半

有了胜率和样本量还不够。行情本身有涨有跌：不看任何形态、随便挑一天，之后 5 根收涨的可能性本来就有四成多。锤子线胜率 49.2% 算好算坏？单看这个数，无法回答——你必须知道「什么都不看的话本来是多少」。这就是基准概率（baseline——同一口径、同一窗口下，全部可判定日里朝约定方向走的比例，也就是不看形态的成绩单）。

基准必须同口径：同样的前瞻窗口、同样的赢面判定，只是把「形态命中」这道门拆掉，全体日子都进考场。刚才那段手搓序列里它就是 5 ÷ 6 ≈ 83.3%——六格赢五格。于是那段行情的完整判词是：命中样本胜率 50%，基准 83.3%，低了 33 个百分点。两个方向的判据同构：胜率高出本方向的基准才算真有优势——看跌形态的胜率与基准都以「之后收跌」为赢的口径，先换向、再比高低。**胜率单独报数没有意义，必须对着基准读。**锚点：你考了 72 分，先问全班平均分多少——分数是给平均分衬托出来的。

还有个容易踩的坑：基准不是想当然的 50%。这段 8000 日行情的看涨基准是 45.0%，看跌基准也只有 46.5%——两个方向都不到一半。差额主要是被「平手算输」吃掉的。合成行情的价格精确到分：价格越走越低，一分钱的刻度相对越粗，收盘恰好与前一日持平的日子越来越多，全段平手占 8.5%。这部分在涨、跌两个方向的口径里都记作输，剩下的零点几个百分点才是乘法随机游走的对数漂移。谁要是拿「胜率 49%、还不到一半」当没有优势，或拿「51%、过半了」当有优势，账从第一行就错了——真基准是 45.0%。

## 随机对照：让运气亲自来一遍

还剩最后一个漏洞。胜率高出基准几个百分点，仍可能只是「挑日子挑得巧」——59 个样本不算多，随机抓 59 天，胜率本身也会抖。抖多宽？与其背公式，不如让随机亲自跑：随机对照（shuffle control——从全部可判定日里随机抽出与形态命中数同样多的日子，算一遍胜率，重复很多组）就是干这个的。实验场的 shuffleControl 抽 59 天算一组，共跑 200 组；判官是一个数：beatRatio——200 组随机对照组里，胜率达到实测的组数占比。

下图是 200 组的胜率分布（升序排列），锤子线实测 0.492 与基准 0.450 同框。

<LineChart :series="ctrl.series" percent-y title="随机对照组的胜率分布 vs 锤子线实测" />

读法分三步。随机组散布在 0.288 到 0.627 之间——这就是 59 个样本的天然抖幅，比多数人直觉的宽。实测 0.492 落在分布中段偏上。达到或超过实测的随机组有 52 组，beatRatio = 52 ÷ 200 = 0.26：**随机挑日子，有四分之一的概率不输给锤子线。**这样的差距，用「碰巧」完全解释得通。锚点：新药上市前要跟对照组比——吃空白药片的那组如果也能「好转」，药的效果就要打问号。beatRatio 越接近 0，实测优势越不像碰巧；工程上常见的经验线是 5% 以下才值得当真。

三个读数凑齐，锤子线在这段行情上的验货结论：胜率 49.2%、基准 45.0%、差距 +4.2 个百分点、随机对照里 26% 的组做得到同样成绩。判词——验不出优势。

## 验货实验：六种代表排排坐

现在把整套流程跑给一个形态看，再铺开到六个。其余二十余种是同一对函数的事——matcher 换个形态 id 就能验，本章挑六种代表：四种影线族、一种双根、一种十字族。实验材料：8000 个交易日的合成行情，日波动 3%，固定种子 2026，与本章测试共用同一段。它纯随机，任何形态都「不该」有优势——正好当空白考卷。先看识别器扫出来的锤子线长什么样、落在哪里。

<KLineChart :candles="scan.candles" :markers="scan.markers" title="随机行情里的锤子线（前 200 根，全文共命中 59 个）" />

图中三个红三角。识别器在第 42、97、162 根各找到一个锤子线，都落在局部下坡之后——判据自动挑的位置，不是手标。全文 8000 根共命中 59 个。

验货账目表如下。方向栏是赢面口径：看跌形态（上吊线、射击之星）按「之后收跌」算赢，基准也随之换向。

| 形态 | 方向 | 样本量 | 胜率 | 基准概率 | 随机对照均值 | 被反超占比 |
| --- | --- | --- | --- | --- | --- | --- |
| 锤子线 | 看涨 | 59 | 49.2% | 45.0% | 44.9% | 26% |
| 上吊线 | 看跌 | 64 | 51.6% | 46.5% | 46.2% | 25% |
| 射击之星 | 看跌 | 69 | 55.1% | 46.5% | 45.8% | 8% |
| 倒锤子 | 看涨 | 51 | 54.9% | 45.0% | 45.4% | 13% |
| 看涨吞没 | 看涨 | 29 | 37.9% | 45.0% | 43.9% | 80% |
| 蜻蜓线 | 看涨 | 346 | 48.3% | 45.0% | 45.1% | 13% |
| 锤子线·注入剧本 | 看涨 | 51 | 82.4% | 50.8% | 50.2% | 0% |

逐行念一遍。锤子线、上吊线、蜻蜓线：胜率小幅高于基准，但随机对照里两成上下的组做得到同样成绩——验不出优势。最扎眼的是射击之星：55.1% 对 46.5%，差 8.6 个百分点，beatRatio 只剩 8%。按 5% 的经验线它还是过不了，但值得多攒样本再判一次——这是疑点，不是证据。看涨吞没 37.9% 低于基准且 80% 的随机组超过它——既没有优势，也凑不成反向证据，样本只有 29 个。多根形态缺席有理：早晨之星在这段行情里一次都没凑齐判据，样本为零，连胜率都无从谈起——这也是读数。

最后一行是仪器的体检报告。同一台验货机，换一段行情：种子 909，每次锤子线命中后把之后的行情整段抬升 5%——人为写进「锤子线之后真的会弹」的剧本。读数立刻翻脸：胜率 82.4%、基准 50.8%、200 组随机对照无一反超。**空白考卷上验不出优势、注入剧本一抓一个准，两场合在一起，这台仪器才算可信。**

<LineChart :series="verdict.series" :labels="verdict.labels" percent-y title="七行验货：形态胜率 vs 基准概率" />

图上两条线的距离，就是优势的形状。前六行两线贴近，最后一行远远岔开。

## 渐进实验：先让两道命题见红

老规矩，先写测试看红。本章测试审四件事：读数可手算；无优势的随机序列上胜率贴着基准；人为注入优势的序列被检出；窗口外的命中与非法输入都挡在门外。第一件用刚才那段手搓序列，固定命中位置、逐格可复算。

```ts
// tests/pattern-stats.test.ts · 固定命中位置的手算读数
  it('固定命中位置：胜率 1/2、样本量 2、基准 5/6，与纸面推演一致', () => {
    // 命中 i=0（平手，输）与 i=4（赢）；i=6 在窗口外（6+2=8 越界），不得计入样本
    const r = evaluatePattern(UPS, at(0, 4, 6), 2)
    expect(r.sampleSize).toBe(2)
    expect(r.winRate).toBeCloseTo(1 / 2, 10)
    expect(r.baseline).toBeCloseTo(5 / 6, 10)
  })
```

两道核心命题一条是「无优势不误报」，一条是「有优势不漏报」。

```ts
// tests/pattern-stats.test.ts · 无优势序列贴着基准
  it('锤子线的胜率与基准之差不超过 0.08，且样本量足以说话', () => {
    const r = evaluatePattern(walk, isHammer, 5)
    expect(r.sampleSize).toBeGreaterThanOrEqual(50)
    expect(Math.abs(r.winRate - r.baseline)).toBeLessThanOrEqual(0.08)
  })
```

```ts
// tests/pattern-stats.test.ts · 注入剧本被随机对照抓个正着
  it('随机对照组几乎无人反超：beatRatio 趋近 0', () => {
    const s = shuffleControl(rigged, isHammer, 5, { trials: 200, seed: 7 })
    expect(s.beatRatio).toBeLessThanOrEqual(0.02)
  })
```

rigged 序列的剧本在测试里写得明明白白——每根 K 线四个价格同乘一个系数，形状与背景比例原封不动，只有「命中之后」整段被抬高。

```ts
// tests/pattern-stats.test.ts · 注入优势的剧本
/** 注入优势：每次命中后，把之后整段行情统一抬升 lift 倍（每根K线四个价格同乘，形状与背景比例不变）。
 *  命中日的后 horizon 根收盘相对命中日凭空多得 lift−1 的涨幅——「锤子线之后真的会弹」的人为剧本 */
const scaleUp = (k: Candle, lift: number): Candle => ({
  date: k.date,
  volume: k.volume,
  open: round2(k.open * lift),
  high: round2(k.high * lift),
  low: round2(k.low * lift),
  close: round2(k.close * lift),
})
const injectEdge = (
  cs: readonly Candle[],
  matcher: (cs2: readonly Candle[], i: number) => boolean,
  horizon: number,
  lift = 1.04,
): Candle[] => {
  const out = cs.map((k) => ({ ...k }))
  for (let i = 0; i + horizon < out.length; i++) {
    if (!matcher(out, i)) continue
    for (let j = i + 1; j < out.length; j++) out[j] = scaleUp(out[j], lift)
  }
  return out
}
```

见红后实现。新模块 `src/stats/evaluate.ts`，三个读数先立字据。

```ts
// src/stats/evaluate.ts · 三个读数的类型
export type PatternStats = {
  /** 胜率：命中的判定日里，horizon 根后收盘朝约定方向走的比例；无命中记 0 */
  winRate: number
  /** 样本量：既命中、又走完了 horizon 根的判定日个数——窗口外的命中不算数 */
  sampleSize: number
  /** 基准概率：全部走完 horizon 根的K线里，收盘朝同方向走的比例——不看形态的成绩单 */
  baseline: number
}

export type ShuffleStats = {
  /** 对照组组数 */
  trials: number
  /** 每组抽样的判定日个数（等于形态的有效命中数） */
  sampleSize: number
  /** 实测胜率（与 evaluatePattern 的 winRate 同源） */
  winRate: number
  /** 各随机对照组胜率的平均：没有优势时应贴着基准概率 */
  meanWinRate: number
  /** 对照组胜率达到实测的组数占比——越接近 0，实测优势越不像碰巧；无命中记 1（读数无意义） */
  beatRatio: number
  /** 各对照组的胜率（按生成顺序，长度 = trials）：分布本身就是读数——抖多宽、挤在哪，一眼可见 */
  rates: number[]
}

export type ShuffleOpts = {
  /** 对照组组数，默认 200 */
  trials?: number
  /** 固定种子（createRng 的入参），默认 42：同一种子跑两遍，读数逐项一致 */
  seed?: number
  /** 输赢方向，与 evaluatePattern 同款，默认看涨 */
  direction?: TradeDirection
}
```

赢面判定是全章的地基，一行不等号都不能含糊——严格大于，平手算输：

```ts
// src/stats/evaluate.ts · 赢面判定
/** 赢面判定：horizon 根后的收盘对命中日收盘，严格朝约定方向才算赢（平手算输） */
function isWin(candles: readonly Candle[], index: number, horizon: number, direction: TradeDirection): boolean {
  const now = candles[index].close
  const then = candles[index + horizon].close
  return direction === 'bull' ? then > now : then < now
}
```

主函数 evaluatePattern 全貌。一个循环里两本账并排记：命中样本一本、全体日子一本——两本账同一口径，胜率与基准才可比。

```ts
// src/stats/evaluate.ts · evaluatePattern 全貌
/** 给形态验货：命中日的胜率、样本量，与「不看形态」的基准概率同场对比。
 *  看涨形态要 winRate 高出 baseline 才算真有优势；看跌形态反过来，要低出才算。 */
export function evaluatePattern(
  candles: readonly Candle[],
  matcher: PatternMatcher,
  horizon: number,
  direction: TradeDirection = 'bull',
): PatternStats {
  if (typeof matcher !== 'function') {
    throw new Error(`evaluatePattern：matcher 必须是函数，收到的是 ${typeof matcher}`)
  }
  if (direction !== 'bull' && direction !== 'bear') {
    throw new Error(`evaluatePattern：direction 必须是 bull/bear 之一，收到的是 ${direction}`)
  }
  const last = assertSeries(candles, horizon, 'evaluatePattern')

  let wins = 0
  let hits = 0
  let baseWins = 0
  for (let i = 0; i <= last; i++) {
    if (isWin(candles, i, horizon, direction)) baseWins++
    if (matcher(candles, i)) {
      hits++
      if (isWin(candles, i, horizon, direction)) wins++
    }
  }
  return {
    winRate: hits === 0 ? 0 : wins / hits,
    sampleSize: hits,
    baseline: baseWins / (last + 1), // assertSeries 保证 last ≥ 0
  }
}
```

matcher 的类型是 `(candles, index) => boolean`——第 5 章的 classifyWicks、第 7 章的 detectTwoCandle 都能包进来，统计机不关心形态是几根 K 线。shuffleControl 全貌。抽样用 partial Fisher–Yates 洗牌，不重复；种子来自第 3 章的 createRng，跑两遍读数逐项一致。

```ts
// src/stats/evaluate.ts · shuffleControl 全貌
/** 随机对照：从全部可判定日里随机抽出与形态命中数同样多的日子，算一遍胜率——重复 trials 组。
 *  回答的是样本量问题：胜率 0.6 看着神，若随机凑的日子十组里有八组也能到 0.6，那就不是形态的本事。
 *  beatRatio = 对照组里胜率达到实测的占比：200 组里 0 组反超（beatRatio=0）是有优势的硬证据；
 *  beatRatio 越大，实测胜率越可能只是这个样本量下的正常抖动。 */
export function shuffleControl(
  candles: readonly Candle[],
  matcher: PatternMatcher,
  horizon: number,
  opts: ShuffleOpts = {},
): ShuffleStats {
  const trials = opts.trials ?? 200
  const seed = opts.seed ?? 42
  const direction = opts.direction ?? 'bull'
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`shuffleControl：trials 必须是正整数，收到的是 ${trials}`)
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`shuffleControl：seed 必须是整数，收到的是 ${seed}`)
  }
  const actual = evaluatePattern(candles, matcher, horizon, direction)
  const last = candles.length - 1 - horizon
  const pool = Array.from({ length: last + 1 }, (_, i) => i) // 全部走得完前瞻窗口的判定日

  if (actual.sampleSize === 0) {
    return { trials, sampleSize: 0, winRate: 0, meanWinRate: 0, beatRatio: 1, rates: [] }
  }

  const rng = createRng(seed)
  let sum = 0
  let beat = 0
  const rates: number[] = []
  for (let t = 0; t < trials; t++) {
    // 每组都从完整的池子重抽：partial Fisher–Yates 洗牌取前 sampleSize 个（不重复抽样）
    const bag = [...pool]
    for (let k = 0; k < actual.sampleSize; k++) {
      const j = k + Math.floor(rng() * (bag.length - k))
      ;[bag[k], bag[j]] = [bag[j], bag[k]]
    }
    let wins = 0
    for (let k = 0; k < actual.sampleSize; k++) {
      if (isWin(candles, bag[k], horizon, direction)) wins++
    }
    const rate = wins / actual.sampleSize
    rates.push(rate)
    sum += rate
    if (rate >= actual.winRate) beat++
  }
  return {
    trials,
    sampleSize: actual.sampleSize,
    winRate: actual.winRate,
    meanWinRate: sum / trials,
    beatRatio: beat / trials,
    rates,
  }
}
```

图表数据照旧出自 export-docs 脚本。验货表一行一个形态，读数由同一对函数现场算出：

```ts
// companion/scripts/export-docs-data.ts · 验货表的一行
const verdictOn = (label: string, m: PatternMatcher, dir: 'bull' | 'bear', cs: readonly Candle[] = statWalk): VerdictRow => {
  const r = evaluatePattern(cs, m, HORIZON, dir)
  const s = shuffleControl(cs, m, HORIZON, { trials: 200, seed: 7, direction: dir })
  return { label, dir, n: r.sampleSize, win: r.winRate, base: r.baseline, ctrlMean: s.meanWinRate, beat: s.beatRatio }
}
```

简化之处照实声明。输赢按收盘对收盘计，不含佣金印花税，不检查涨跌停能否成交——费用与 T+1 的完整账要等回测引擎（持有 5 天天然满足 T+1，这里不歪楼）。前瞻窗口固定 5 根、对照 200 组、种子固定，都是教学约定。考卷是合成行情而非真实历史，真实行情还多一层幸存者偏差（退了市、爆了雷的股票不在你眼前的图里，只数活着的，结论偏乐观）。这些全部登记在附录差异清单。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：135 项全绿，其中 22 项是本章新增。覆盖面：手搓序列的胜率、样本量、基准与纸面一致；平手算输、窗口外命中不计、方向参数换向基准翻面；随机游走上锤子线胜率贴基准、对照组均值同样贴基准；注入剧本胜率高出基准 15 个百分点以上、beatRatio 压到 0.02 以下；同种子两遍读数逐项一致；空数组、非函数判定器、NaN 价格等非法输入抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加验货表：8000 个交易日锤子线命中 59 个，胜率 49.2%、基准 45.0%；200 组随机对照均值 44.9%、被反超占比 0.26；六行形态读数与一行注入剧本（82.4% 对 50.8%、0 组反超）。`docs/assets/data/` 下多出四个 `09-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体：打开行情软件，在前复权数据里随便挑一只票。前复权，就是把分红除权造成的价格跳空修补回连续序列的开关，不开它，除权日的假跳空会污染涨跌记录。人肉数 20 个锤子线，每个记「之后第 5 根收盘对命中日收盘」的涨跌，算出胜率。再随机点 20 个任意日子，同样记 5 根后的涨跌，算出基准。两数一比，你就在自己手里复现了本章的仪器。数到 20 个你会累——这本身就是样本量的一课。

## 小结

- 胜率是赢的次数 ÷ 有效命中数，赢面按「严格朝约定方向」判，平手算输，窗口外的命中不计。
- 样本量先于胜率：抖动宽度约 1 ÷ (2√n)，10 个样本 ±16 个百分点。开局连赢撑起来的胜率是运气，不是性质。
- 基准概率是拆掉形态之门后的全体成绩单；胜率必须对着基准读，且基准不是想当然的 50%。
- 随机对照回答「这么点样本碰不碰得出同样成绩」：beatRatio 越小优势越硬，经验线 5%。
- 空白考卷验不出优势、注入剧本一抓一个准——仪器可信，「验不出」才作数。这段合成行情上，六种形态全部没有可检出的优势。

读完本章，你应该能回答：

1. 一段序列的看涨基准是 5/6，某形态命中两个样本赢一个——胜率多少？这能证明形态好吗？还缺什么读数？
2. 前 8 个样本累计胜率 0.88、59 个样本收在 0.49——为什么开局读数会那么高？
3. 胜率 55.1% 对基准 46.5%、beatRatio 8%——这是证据吗？下一步该做什么？
4. 命中日的后 5 根收盘与命中日持平——这个样本算赢、算输，还是不计入？为什么平手不能算赢？

去向一句话：验不出优势不等于形态无用——从下一部分起，趋势、成交量、支撑阻力会作为上下文逐个装回来；而胜率只是账的一半，第 20 章把盈亏比并进来算期望值，第 21 章回测引擎再把费用、滑点与 T+1 一并入账。
