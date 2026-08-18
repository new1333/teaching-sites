import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRng, generateCandles, tradingDates } from '../src/data/generate'
import { candleAnatomy } from '../src/candles/anatomy'
import { aggregateTicks, tickDirections } from '../src/candles/aggregate'
import { callAuction, type AuctionOrder } from '../src/matching/auction'
import { classifyWicks, type WickPatternId } from '../src/patterns/wicks'
import { classifyDoji, dojiContext, type DojiKind } from '../src/patterns/doji'
import { detectTwoCandle, type TwoCandlePatternId } from '../src/patterns/two'
import { detectThreeCandle, type ThreeCandlePatternId } from '../src/patterns/three'
import { trendContext } from '../src/patterns/context'
import { evaluatePattern, shuffleControl, type PatternMatcher } from '../src/stats/evaluate'
import { sma, ema, crossovers } from '../src/indicators/ma'
import { macd, detectDivergence } from '../src/indicators/macd'
import { rsi, RSI_LEVELS } from '../src/indicators/rsi'
import { kdj } from '../src/indicators/kdj'
import { bollinger, squeezes, outsideStats, DEFAULT_BB_N } from '../src/indicators/bollinger'
import { stdev, normalDraws, leptokurticDraws } from '../src/stats/stdev'
import { volumeFeatures, turnoverRate, type VolumeLabelKind, type VolumeReport } from '../src/volume/features'
import { pivots, type Pivot } from '../src/levels/pivots'
import { levels } from '../src/levels/levels'
import { fibLevels } from '../src/levels/fib'
import { detectStructures } from '../src/levels/structures'
import { chipDistribution } from '../src/chips/distribution'
import { compoundCurve, expectancy, type EdgeStats } from '../src/risk/expectancy'
import { kellyFraction } from '../src/risk/kelly'
import { equityPaths, monteCarloRuin } from '../src/risk/ruin'
import { backtest, type Strategy } from '../src/backtest/engine'
import { drawdownSeries, maxDrawdown } from '../src/backtest/metrics'
import type { Candle } from '../src/types'

/**
 * docs 图表数据导出：npm run export-docs。
 * 固定种子、纯计算、零时间戳——两次运行的输出逐字节一致。
 * 正文里每一张 KLineChart 的数据都从这里来，不手写、不外采。
 */

type Marker = { index: number; label: string; kind: 'bull' | 'bear' | 'info' }
type ChartJson = {
  candles: Candle[]
  overlays: { name: string; values: (number | null)[] }[]
  markers: Marker[]
}
/** LineChart 数据形态：纯折线（胜率曲线、对照组分布等），与 KLineChart 的数据文件分家；area 为面积填充（筹码轮廓等）、color 为指定线色（参考刻度线用灰色等） */
type LineJson = { series: { name: string; values: (number | null)[]; area?: boolean; color?: string }[]; labels?: string[] }

const DATA_DIR = fileURLToPath(new URL('../../docs/assets/data/', import.meta.url))

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

const spanOf = (cs: readonly Candle[]): number =>
  Math.max(...cs.map((c) => c.high)) - Math.min(...cs.map((c) => c.low))

/** 配套可视化数据集的形态：与 ChartJson/LineJson 并列——正文交互图表的专用形状 */
type AuctionCurveJson = { labels: string[]; volumes: number[] }
type AnatomyDayJson = {
  candle: Candle
  trades: { time: string; price: number; size: number; direction: 'buy' | 'sell' }[]
}
type MatrixScenesJson = {
  scenes: { key: 'up-price-up-vol' | 'down-price-up-vol' | 'up-price-down-vol' | 'down-price-down-vol'; label: string; candles: Candle[] }[]
}
type ChipBinsJson = { bins: { price: number; volume: number; profitable: boolean }[]; currentPrice: number; avgCost: number }
type MarkersOnlyJson = { candles: Candle[]; markers: Marker[] }
type MacdIndJson = { candles: Candle[]; dif: (number | null)[]; dea: (number | null)[]; hist: (number | null)[]; markers: Marker[] }
type IndicatorsIndJson = {
  candles: Candle[]
  rsi: (number | null)[]
  k: (number | null)[]
  d: (number | null)[]
  j: (number | null)[]
  thresholds: { rsiOverbought: number; rsiOversold: number; rsiStrong: number; kdjOverbought: number; kdjOversold: number }
  markers: Marker[]
}
type BacktestDetailJson = {
  dates: string[]
  equity: number[]
  benchmark: number[]
  drawdown: number[]
  trades: { index: number; kind: 'buy' | 'sell'; note: string }[]
}
type DisposalCurvesJson = { labels: string[]; curves: { name: string; values: number[] }[] }

function writeJson(
  name: string,
  data: ChartJson | LineJson | AuctionCurveJson | AnatomyDayJson | MatrixScenesJson | ChipBinsJson | MarkersOnlyJson | MacdIndJson | IndicatorsIndJson | BacktestDetailJson | DisposalCurvesJson,
): void {
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2) + '\n', 'utf8')
}

// —— 数据自身的教学不变量：不成立就当场炸，不把坏图发给正文 ——

const hammer = candleAnatomy(HAMMER)
if (hammer.lowerWickRatio < 0.85) {
  throw new Error(`锤子样本形状不对：下影占比 ${hammer.lowerWickRatio.toFixed(3)} < 0.85`)
}

// —— 图一：常规合成行情（60 根日K + 成交量），标记全场下影占比最长的一根 ——

const market = generateCandles(createRng(44), { days: 60, startPrice: 20 })
let wickIdx = 0
for (let i = 1; i < market.length; i++) {
  if (candleAnatomy(market[i]).lowerWickRatio > candleAnatomy(market[wickIdx]).lowerWickRatio) wickIdx = i
}
writeJson('04-market.json', {
  candles: market,
  overlays: [],
  markers: [{ index: wickIdx, label: '最长下影', kind: 'info' }],
})

// —— 图二/图三：同一根锤子，两种纵轴价格区间 ——

// 窄区间：日内波动 0.6% 的温和行情；宽区间：波动 6% 的剧烈行情，且第 30 根前后正逢一段回落
const calmSeries = generateCandles(createRng(104), { days: 40, startPrice: 10, volatility: 0.006 })
const wildSeries = generateCandles(createRng(213), { days: 40, startPrice: 10, volatility: 0.06 })
const plantHammer = (cs: readonly Candle[]): Candle[] =>
  cs.map((c, i) => (i === HAMMER_AT ? { ...HAMMER, date: c.date } : c))

const narrow = plantHammer(calmSeries)
const wide = plantHammer(wildSeries)
const marker: Marker[] = [{ index: HAMMER_AT, label: '同一根锤子', kind: 'bull' }]

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

writeJson('04-hammer-narrow.json', { candles: narrow, overlays: [], markers: marker })
writeJson('04-hammer-wide.json', { candles: wide, overlays: [], markers: marker })

// —— 第 5 章图表：单根影线族形态。图上每一个标记都来自识别器对全序列的真实扫描，不手标 ——

const round2 = (x: number): number => Math.round(x * 100) / 100

const WICKS_LABEL: Record<WickPatternId, string> = {
  'big-yang': '大阳线',
  'big-yin': '大阴线',
  marubozu: '光头光脚',
  hammer: '锤子线',
  'hanging-man': '上吊线',
  'shooting-star': '射击之星',
  'inverted-hammer': '倒锤子',
}
const WICKS_KIND: Record<WickPatternId, Marker['kind']> = {
  'big-yang': 'bull',
  'big-yin': 'bear',
  marubozu: 'info',
  hammer: 'bull',
  'hanging-man': 'bear',
  'shooting-star': 'bear',
  'inverted-hammer': 'bull',
}

/** 识别器扫全序列：i 从 5 起（默认回看窗 5 根，更早的K线没有足够背景）。
 *  only 传形态白名单：强趋势里几乎每根都是「大实体」，趋势图只标影线族命中、避免淹没主角 */
const scanWicks = (cs: readonly Candle[], only?: readonly WickPatternId[]): Marker[] => {
  const out: Marker[] = []
  for (let i = 5; i < cs.length; i++) {
    const ids = classifyWicks(cs[i], trendContext(cs, i))
    const visible = only ? ids.filter((id) => only.includes(id)) : ids
    if (visible.length > 0) {
      out.push({ index: i, label: visible.map((id) => WICKS_LABEL[id]).join('·'), kind: WICKS_KIND[visible[0]] })
    }
  }
  return out
}

/** 带漂移的合成行情：drift 是每天的平均涨跌幅（趋势从这来），波动围绕它撒噪声 */
const driftSeries = (
  rng: () => number,
  opts: { days: number; startPrice: number; drift: number; vol: number },
): Candle[] => {
  const candles: Candle[] = []
  let prevClose = opts.startPrice
  for (const date of tradingDates('2026-03-02', opts.days)) {
    const open = round2(prevClose * (1 + (rng() * 2 - 1) * opts.vol * 0.4))
    const close = round2(open * (1 + opts.drift + (rng() * 2 - 1) * opts.vol))
    const high = round2(Math.max(open, close) * (1 + rng() * opts.vol * 0.5))
    const low = round2(Math.min(open, close) * (1 - rng() * opts.vol * 0.5))
    const volume = 100 * (1 + Math.floor(rng() * 1000))
    candles.push({ date, open, high, low, close, volume })
    prevClose = close
  }
  return candles
}

const plantAt = (cs: readonly Candle[], index: number, shape: Candle): Candle[] =>
  cs.map((c, i) => (i === index ? { ...shape, date: c.date } : c))

// 两个核心样本（判据余量都留足：四舍五入的 0.01 元抖动翻不了案）。
// 影线深度刻意控制在 ±10% 涨跌停边界之内：第 2 章教过的规则，构造样本不能带头违反
const CH5_HAMMER: Candle = { date: '2026-04-01', open: 10.0, high: 10.18, low: 9.6, close: 10.15, volume: 90000 }
const CH5_STAR: Candle = { date: '2026-04-01', open: 10.0, high: 10.68, low: 9.85, close: 9.85, volume: 90000 }
const CH5_BIGYANG: Candle = { date: '2026-04-01', open: 10, high: 10.75, low: 9.95, close: 10.7, volume: 80000 }
const CH5_BIGYIN: Candle = { date: '2026-04-01', open: 10.7, high: 10.75, low: 9.95, close: 10, volume: 80000 }
const CH5_BALD: Candle = { date: '2026-04-01', open: 10, high: 10.85, low: 10, close: 10.85, volume: 95000 }

const AT = 30 // 植入位置：第 31 根，前面有整段趋势做背景，后面留 3 根收尾

const WICK_FAMILY: readonly WickPatternId[] = ['hammer', 'hanging-man', 'shooting-star', 'inverted-hammer']

/** 守门：植入位置的趋势位置必须如预期、识别器必须在植入处认出预期形态，否则整段导出失败 */
const expectAt = (
  cs: readonly Candle[],
  index: number,
  position: 'falling' | 'rising',
  label: string,
): Marker[] => {
  const ctx = trendContext(cs, index)
  if (ctx.position !== position) {
    throw new Error(`第 ${index + 1} 根的背景判为 ${ctx.position}（窗口涨跌 ${(ctx.change * 100).toFixed(1)}%），期望 ${position}——换一颗种子再试`)
  }
  const all = scanWicks(cs)
  if (!all.some((h) => h.index === index && h.label === label)) {
    throw new Error(`第 ${index + 1} 根没有被识别为「${label}」，识别器命中：${JSON.stringify(all)}`)
  }
  return scanWicks(cs, WICK_FAMILY)
}

// 四张位置换算图：下跌/上涨各两段；锤子对与长上影对，在同一对图里植的是同一组数字。
// 低噪声高漂移：走势像样的趋势，且第 31 根的价位被 drift 钉在样本数字附近
const fallHammer = plantAt(driftSeries(createRng(506), { days: 34, startPrice: 18.4, drift: -0.02, vol: 0.009 }), AT, CH5_HAMMER)
const riseHang = plantAt(driftSeries(createRng(507), { days: 34, startPrice: 5.5, drift: 0.02, vol: 0.009 }), AT, CH5_HAMMER)
const fallInvert = plantAt(driftSeries(createRng(508), { days: 34, startPrice: 18.4, drift: -0.02, vol: 0.009 }), AT, CH5_STAR)
const riseStar = plantAt(driftSeries(createRng(511), { days: 34, startPrice: 5.5, drift: 0.02, vol: 0.009 }), AT, CH5_STAR)

if (!sameNumbers(fallHammer[AT], riseHang[AT])) throw new Error('锤子对两图不是同一组数字：位置换算的前提被破坏')
if (!sameNumbers(fallInvert[AT], riseStar[AT])) throw new Error('长上影对两图不是同一组数字：位置换算的前提被破坏')

writeJson('05-hammer.json', { candles: fallHammer, overlays: [], markers: expectAt(fallHammer, AT, 'falling', '锤子线') })
writeJson('05-hanging.json', { candles: riseHang, overlays: [], markers: expectAt(riseHang, AT, 'rising', '上吊线') })
writeJson('05-inverted.json', { candles: fallInvert, overlays: [], markers: expectAt(fallInvert, AT, 'falling', '倒锤子') })
writeJson('05-shooting.json', { candles: riseStar, overlays: [], markers: expectAt(riseStar, AT, 'rising', '射击之星') })

// 大实体与光头光脚：横盘震荡行情里植入三根样本，其余标记由识别器自己找出来
const bodiesRaw = driftSeries(createRng(505), { days: 30, startPrice: 10, drift: 0, vol: 0.03 })
const bodies = plantAt(plantAt(plantAt(bodiesRaw, 8, CH5_BIGYANG), 17, CH5_BIGYIN), 25, CH5_BALD)
const bodyHits = scanWicks(bodies)
const wanted: readonly [number, string][] = [
  [8, '大阳线'],
  [17, '大阴线'],
  [25, '大阳线·光头光脚'],
]
for (const [idx, label] of wanted) {
  if (!bodyHits.some((h) => h.index === idx && h.label === label)) {
    throw new Error(`第 ${idx + 1} 根没有被识别为「${label}」，识别器命中：${JSON.stringify(bodyHits)}`)
  }
}
writeJson('05-bodies.json', { candles: bodies, overlays: [], markers: bodyHits })

console.log(
  [
    `04-market.json：${market.length} 根，最长下影在第 ${wickIdx} 根`,
    `04-hammer-narrow.json：纵轴区间 ${narrowSpan.toFixed(2)} 元（锤子振幅 ${hammerRange.toFixed(2)} 元）`,
    `04-hammer-wide.json：纵轴区间 ${wideSpan.toFixed(2)} 元`,
  ].join('\n'),
)

console.log(
  [
    `05-hammer.json / 05-hanging.json：第 ${AT + 1} 根是同一组数字（开 ${CH5_HAMMER.open} 高 ${CH5_HAMMER.high} 低 ${CH5_HAMMER.low} 收 ${CH5_HAMMER.close}），分别判锤子线/上吊线`,
    `05-inverted.json / 05-shooting.json：第 ${AT + 1} 根是同一组长上影数字，分别判倒锤子/射击之星`,
    `四张趋势图全序列命中形态 ${[fallHammer, riseHang, fallInvert, riseStar].map((cs) => scanWicks(cs).length).join('/')} 处，图上只标影线族`,
    `05-bodies.json：识别器共命中 ${bodyHits.length} 处（含植入的大阳线、大阴线、光头光脚）`,
  ].join('\n'),
)

// —— 第 6 章图表：十字星家族。六种形态各一张图，外加一张「次日确认」——
// 样本的「长」与「缩」不是绝对数字，都相对植入处的参照振幅（dojiContext 的 avgRange）构造；
// 标记同样来自识别器对全序列的真实扫描，不手标。

const DOJI_LABEL: Record<DojiKind, string> = {
  doji: '十字星',
  'long-legged': '长腿十字',
  dragonfly: '蜻蜓线',
  gravestone: '墓碑线',
  'four-price': '一字线',
  'spinning-top': '纺锤线',
}

const scanDoji = (cs: readonly Candle[]): Marker[] => {
  const out: Marker[] = []
  for (let i = 5; i < cs.length; i++) {
    const r = classifyDoji(cs[i], dojiContext(cs, i))
    if (!r) continue
    const label =
      r.kind === 'four-price'
        ? r.limit === 'limit-up'
          ? '一字涨停'
          : r.limit === 'limit-down'
            ? '一字跌停'
            : '一字线'
        : DOJI_LABEL[r.kind]
    const kind: Marker['kind'] =
      r.kind === 'dragonfly'
        ? 'bull'
        : r.kind === 'gravestone'
          ? 'bear'
          : r.kind === 'four-price' && r.limit === 'limit-down'
            ? 'bear'
            : r.kind === 'four-price' && r.limit === 'limit-up'
              ? 'bull'
              : 'info'
    out.push({ index: i, label, kind })
  }
  return out
}

/** 守门：植入处必须被判成期望的形态，否则整段导出失败 */
const expectDojiAt = (cs: readonly Candle[], index: number, kind: DojiKind): void => {
  const r = classifyDoji(cs[index], dojiContext(cs, index))
  if (!r || r.kind !== kind) {
    throw new Error(`第 ${index + 1} 根被判为 ${r?.kind ?? '不属于十字族'}（期望 ${kind}）——换一颗种子或调整样本`)
  }
}

const D6 = 30 // 植入位置（第 31 根）：前面有整段行情做参照，确认图另用 29/30

/** 样本工厂：都以前一根收盘为锚、以植入处的参照振幅为尺，保证「长/缩」有判据余量 */
const refAt = (cs: readonly Candle[], index: number): number => dojiContext(cs, index).avgRange
const mkDoji = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const base = round2(cs[at - 1].close)
  return { date: cs[at].date, open: base, high: round2(base + 0.4 * ref), low: round2(base - 0.4 * ref), close: base, volume: 120000 }
}
const mkLongLegs = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const base = round2(cs[at - 1].close)
  return { date: cs[at].date, open: base, high: round2(base + 0.8 * ref), low: round2(base - 0.8 * ref), close: base, volume: 150000 }
}
const mkDragonfly = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const base = round2(cs[at - 1].close)
  return { date: cs[at].date, open: base, high: base, low: round2(base - 1.5 * ref), close: base, volume: 140000 }
}
const mkGravestone = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const base = round2(cs[at - 1].close)
  return { date: cs[at].date, open: base, high: round2(base + 1.5 * ref), low: base, close: base, volume: 140000 }
}
const mkSpinning = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const base = round2(cs[at - 1].close)
  return { date: cs[at].date, open: base, high: round2(base + 0.2 * ref), low: round2(base - 0.2 * ref), close: base, volume: 60000 }
}
/** 昨收 ×（1−10%）四舍五入到分 = 跌停价；一字封死在跌停价上，全天几乎无成交 */
const mkLimitDown = (cs: readonly Candle[], at: number): Candle => {
  const flat = round2(cs[at - 1].close * 0.9)
  return { date: cs[at].date, open: flat, high: flat, low: flat, close: flat, volume: 6000 }
}
const mkBigYang = (cs: readonly Candle[], at: number): Candle => {
  const ref = refAt(cs, at)
  const open = round2(cs[at - 1].close)
  const close = round2(open + 0.9 * ref)
  return { date: cs[at].date, open, high: round2(close + 0.05 * ref), low: round2(open - 0.05 * ref), close, volume: 160000 }
}

// 六种形态各一张：横盘段植普通十字与纺锤，下跌段植蜻蜓，上涨段植长腿与墓碑，另有一对连续一字跌停
const sidewaysA = driftSeries(createRng(601), { days: 34, startPrice: 10, drift: 0, vol: 0.02 })
const dojiSeries = plantAt(sidewaysA, D6, mkDoji(sidewaysA, D6))
const risingB = driftSeries(createRng(602), { days: 34, startPrice: 5.5, drift: 0.02, vol: 0.009 })
const longLegSeries = plantAt(risingB, D6, mkLongLegs(risingB, D6))
const fallingC = driftSeries(createRng(603), { days: 34, startPrice: 18.4, drift: -0.02, vol: 0.009 })
const dragonflySeries = plantAt(fallingC, D6, mkDragonfly(fallingC, D6))
const risingD = driftSeries(createRng(604), { days: 34, startPrice: 5.5, drift: 0.02, vol: 0.009 })
const gravestoneSeries = plantAt(risingD, D6, mkGravestone(risingD, D6))
const sidewaysE = driftSeries(createRng(605), { days: 34, startPrice: 10, drift: 0, vol: 0.02 })
const spinSeries = plantAt(sidewaysE, D6, mkSpinning(sidewaysE, D6))
const fallingF = driftSeries(createRng(606), { days: 32, startPrice: 18.4, drift: -0.02, vol: 0.009 })
const fpSeries = plantAt(plantAt(fallingF, 30, mkLimitDown(fallingF, 30)), 31, mkLimitDown(plantAt(fallingF, 30, mkLimitDown(fallingF, 30)), 31))

// 确认图：第 30 根普通十字，第 31 根收在十字最高价之上的大阳线——「次日确认」的最小样本
const confirmBase = driftSeries(createRng(607), { days: 34, startPrice: 10, drift: 0, vol: 0.02 })
const confirmWithDoji = plantAt(confirmBase, 29, mkDoji(confirmBase, 29))
const confirmSeries = plantAt(confirmWithDoji, 30, mkBigYang(confirmWithDoji, 30))

expectDojiAt(dojiSeries, D6, 'doji')
expectDojiAt(longLegSeries, D6, 'long-legged')
expectDojiAt(dragonflySeries, D6, 'dragonfly')
expectDojiAt(gravestoneSeries, D6, 'gravestone')
expectDojiAt(spinSeries, D6, 'spinning-top')
expectDojiAt(fpSeries, 30, 'four-price')
expectDojiAt(fpSeries, 31, 'four-price')
for (const i of [30, 31]) {
  const r = classifyDoji(fpSeries[i], dojiContext(fpSeries, i))
  if (r?.limit !== 'limit-down') {
    throw new Error(`第 ${i + 1} 根一字的涨跌停语境是 ${r?.limit}（期望 limit-down）——核对昨收与边界价`)
  }
}
expectDojiAt(confirmSeries, 29, 'doji')
if (!classifyWicks(confirmSeries[30], trendContext(confirmSeries, 30)).includes('big-yang')) {
  throw new Error('确认图第 31 根没有被识别为大阳线——「次日确认」的样本失效')
}
if (!(confirmSeries[30].close > confirmSeries[29].high)) {
  throw new Error('确认图大阳线收盘没有越过十字星最高价——确认语义不成立')
}

writeJson('06-doji.json', { candles: dojiSeries, overlays: [], markers: scanDoji(dojiSeries) })
writeJson('06-long-legged.json', { candles: longLegSeries, overlays: [], markers: scanDoji(longLegSeries) })
writeJson('06-dragonfly.json', { candles: dragonflySeries, overlays: [], markers: scanDoji(dragonflySeries) })
writeJson('06-gravestone.json', { candles: gravestoneSeries, overlays: [], markers: scanDoji(gravestoneSeries) })
writeJson('06-spinning.json', { candles: spinSeries, overlays: [], markers: scanDoji(spinSeries) })
writeJson('06-four-price.json', { candles: fpSeries, overlays: [], markers: scanDoji(fpSeries) })
writeJson('06-confirm.json', {
  candles: confirmSeries,
  overlays: [],
  markers: [...scanDoji(confirmSeries), ...scanWicks(confirmSeries)],
})

console.log(
  [
    `06-doji/long-legged/dragonfly/gravestone/spinning：第 ${D6 + 1} 根分别判 ${DOJI_LABEL.doji}/${DOJI_LABEL['long-legged']}/${DOJI_LABEL.dragonfly}/${DOJI_LABEL.gravestone}/${DOJI_LABEL['spinning-top']}，全序列十字族命中 ${[dojiSeries, longLegSeries, dragonflySeries, gravestoneSeries, spinSeries].map((cs) => scanDoji(cs).length).join('/')} 处`,
    `06-four-price：第 31、32 根连续一字跌停（跌停价 = 昨收 × 0.9 四舍五入到分），全序列命中 ${scanDoji(fpSeries).length} 处`,
    `06-confirm：第 30 根十字星、第 31 根大阳线收盘越过十字最高价——两个识别器同图各标各的`,
  ].join('\n'),
)

// —— 第 7 章图表：双根组合形态。九种形态各一张图，成对样本植入第 30/31 根 ——
// 两根 K 线一起换：昨天那根定锚（前一晚收盘）与尺（形态之前五根的平均振幅，与识别器同款窗口），
// 今天那根对同一组数字做回应；判据余量留足，四舍五入的 0.01 元抖动翻不了案。
// 标记同样来自识别器 detectTwoCandle 对全序列的真实扫描，不手标。

const TWO_LABEL: Record<TwoCandlePatternId, string> = {
  'bullish-engulfing': '看涨吞没',
  'bearish-engulfing': '看跌吞没',
  'dark-cloud-cover': '乌云盖顶',
  piercing: '刺透形态',
  'bullish-harami': '看涨孕线',
  'bearish-harami': '看跌孕线',
  'doji-harami': '十字孕线',
  'tweezer-top': '平顶',
  'tweezer-bottom': '平底',
}

const scanTwo = (cs: readonly Candle[]): Marker[] =>
  detectTwoCandle(cs).map((h) => ({
    index: h.index,
    label: TWO_LABEL[h.id],
    kind: h.direction === 'bull' ? 'bull' : 'bear',
  }))

/** 守门：植入的完成日必须如预期判出该形态、背景方向正确，否则整段导出失败 */
const expectTwoAt = (cs: readonly Candle[], index: number, id: TwoCandlePatternId, position: 'falling' | 'rising'): void => {
  const bg = trendContext(cs, index - 1)
  if (bg.position !== position) {
    throw new Error(`第 ${index + 1} 根的背景判为 ${bg.position}（窗口涨跌 ${(bg.change * 100).toFixed(1)}%），期望 ${position}——换一颗种子再试`)
  }
  if (!detectTwoCandle(cs).some((h) => h.index === index && h.id === id)) {
    throw new Error(`第 ${index + 1} 根没有被识别为「${TWO_LABEL[id]}」，识别器命中：${JSON.stringify(detectTwoCandle(cs))}`)
  }
}

const AT7 = 30 // 完成日（第 31 根）；形态第一根在第 30 根，参照尺取它之前五根

/** 参照振幅：形态之前五根的平均振幅——与 detectTwoCandle 内部同款窗口（不含形态两根） */
const refBeforePair = (cs: readonly Candle[], at: number): number => {
  let sum = 0
  for (let j = at - 6; j <= at - 2; j++) sum += cs[j].high - cs[j].low
  return sum / 5
}

/** 成对植入：工厂拿锚价 b 与参照振幅 r，一次性产出（昨天，今天）两根 */
const plantPair = (
  cs: readonly Candle[],
  at: number,
  mk: (b: number, r: number) => [Candle, Candle],
): Candle[] => {
  const b = round2(cs[at - 1].close)
  const r = refBeforePair(cs, at)
  const [prev, cur] = mk(b, r)
  return cs.map((c, i) => (i === at - 1 ? { ...prev, date: c.date } : i === at ? { ...cur, date: c.date } : c))
}

const ch7 = (seed: number, drift: number): Candle[] =>
  driftSeries(createRng(seed), { days: 34, startPrice: drift < 0 ? 18.4 : 5.5, drift, vol: 0.009 })

// 九组成对样本：每组的判据余量见行内注释，全部相对参照振幅 r 留出
const engulfBullSeries = plantPair(ch7(701, -0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.25 * r), close: round2(b - 1.2 * r), volume: 130000 }, // 大阴：实体 [b−1.2r, b]
  { date: '', open: round2(b - 1.3 * r), high: round2(b + 0.15 * r), low: round2(b - 1.5 * r), close: round2(b + 0.1 * r), volume: 200000 }, // 大阳：两头都严格越过
])
const engulfBearSeries = plantPair(ch7(702, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 130000 }, // 大阳：实体 [b, b+1.2r]
  { date: '', open: round2(b + 1.3 * r), high: round2(b + 1.5 * r), low: round2(b - 0.15 * r), close: round2(b - 0.1 * r), volume: 200000 }, // 大阴：两头都严格越过
])
const darkCloudSeries = plantPair(ch7(703, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 130000 }, // 阳线，实体中点在 b+0.6r
  { date: '', open: round2(b + 1.3 * r), high: round2(b + 1.45 * r), low: round2(b + 0.25 * r), close: round2(b + 0.3 * r), volume: 180000 }, // 高开、收阴、收进实体但过不了中点
])
const piercingSeries = plantPair(ch7(704, -0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.25 * r), close: round2(b - 1.2 * r), volume: 130000 }, // 阴线，实体中点在 b−0.6r
  { date: '', open: round2(b - 1.3 * r), high: round2(b - 0.25 * r), low: round2(b - 1.45 * r), close: round2(b - 0.3 * r), volume: 180000 }, // 低开、收阳、收过中点但收不进吞没的地盘
])
const haramiBullSeries = plantPair(ch7(705, -0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.25 * r), close: round2(b - 1.2 * r), volume: 130000 }, // 大阴：实体占振幅 0.92
  { date: '', open: round2(b - 0.85 * r), high: round2(b - 0.5 * r), low: round2(b - 0.9 * r), close: round2(b - 0.55 * r), volume: 80000 }, // 小阳：实体 0.3r 缩在内
])
const haramiBearSeries = plantPair(ch7(706, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 130000 }, // 大阳
  { date: '', open: round2(b + 0.55 * r), high: round2(b + 0.6 * r), low: round2(b + 0.2 * r), close: round2(b + 0.25 * r), volume: 80000 }, // 小阴：实体 0.3r 缩在内
])
const haramiDojiSeries = plantPair(ch7(707, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 130000 }, // 大阳
  { date: '', open: round2(b + 0.6 * r), high: round2(b + 0.85 * r), low: round2(b + 0.35 * r), close: round2(b + 0.6 * r), volume: 90000 }, // 十字：开=收，悬在实体正中
])
const tweezerTopSeries = plantPair(ch7(708, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.2 * r), low: round2(b - 0.05 * r), close: round2(b + 0.8 * r), volume: 130000 }, // 阳线，高点 b+1.2r
  { date: '', open: round2(b + 0.7 * r), high: round2(b + 1.2 * r), low: round2(b + 0.25 * r), close: round2(b + 0.3 * r), volume: 150000 }, // 阴线，高点分毫不差
])
const tweezerBottomSeries = plantPair(ch7(709, -0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.2 * r), close: round2(b - 0.8 * r), volume: 130000 }, // 阴线，低点 b−1.2r
  { date: '', open: round2(b - 0.7 * r), high: round2(b - 0.25 * r), low: round2(b - 1.2 * r), close: round2(b - 0.3 * r), volume: 150000 }, // 阳线，低点分毫不差
])

expectTwoAt(engulfBullSeries, AT7, 'bullish-engulfing', 'falling')
expectTwoAt(engulfBearSeries, AT7, 'bearish-engulfing', 'rising')
expectTwoAt(darkCloudSeries, AT7, 'dark-cloud-cover', 'rising')
expectTwoAt(piercingSeries, AT7, 'piercing', 'falling')
expectTwoAt(haramiBullSeries, AT7, 'bullish-harami', 'falling')
expectTwoAt(haramiBearSeries, AT7, 'bearish-harami', 'rising')
expectTwoAt(haramiDojiSeries, AT7, 'doji-harami', 'rising')
expectTwoAt(tweezerTopSeries, AT7, 'tweezer-top', 'rising')
expectTwoAt(tweezerBottomSeries, AT7, 'tweezer-bottom', 'falling')

writeJson('07-engulf-bull.json', { candles: engulfBullSeries, overlays: [], markers: scanTwo(engulfBullSeries) })
writeJson('07-engulf-bear.json', { candles: engulfBearSeries, overlays: [], markers: scanTwo(engulfBearSeries) })
writeJson('07-dark-cloud.json', { candles: darkCloudSeries, overlays: [], markers: scanTwo(darkCloudSeries) })
writeJson('07-piercing.json', { candles: piercingSeries, overlays: [], markers: scanTwo(piercingSeries) })
writeJson('07-harami-bull.json', { candles: haramiBullSeries, overlays: [], markers: scanTwo(haramiBullSeries) })
writeJson('07-harami-bear.json', { candles: haramiBearSeries, overlays: [], markers: scanTwo(haramiBearSeries) })
writeJson('07-harami-doji.json', { candles: haramiDojiSeries, overlays: [], markers: scanTwo(haramiDojiSeries) })
writeJson('07-tweezer-top.json', { candles: tweezerTopSeries, overlays: [], markers: scanTwo(tweezerTopSeries) })
writeJson('07-tweezer-bottom.json', { candles: tweezerBottomSeries, overlays: [], markers: scanTwo(tweezerBottomSeries) })

const CH7_HITS: [string, Candle[]][] = [
  ['07-engulf-bull', engulfBullSeries],
  ['07-engulf-bear', engulfBearSeries],
  ['07-dark-cloud', darkCloudSeries],
  ['07-piercing', piercingSeries],
  ['07-harami-bull', haramiBullSeries],
  ['07-harami-bear', haramiBearSeries],
  ['07-harami-doji', haramiDojiSeries],
  ['07-tweezer-top', tweezerTopSeries],
  ['07-tweezer-bottom', tweezerBottomSeries],
]
const ch7At = (cs: readonly Candle[]): string => scanTwo(cs).find((m) => m.index === AT7)?.label ?? '未命中'
console.log(
  [
    `07-*.json：第 ${AT7 + 1} 根分别判 ${CH7_HITS.map(([, cs]) => ch7At(cs)).join('/')}，全序列双根命中 ${CH7_HITS.map(([, cs]) => scanTwo(cs).length).join('/')} 处（标记皆由识别器扫出）`,
  ].join('\n'),
)

// —— 第 8 章图表：三根以上组合形态。七种形态各一张图，外加晨星「未确认」对照 ——
// 多根样本整段植入：第一根定锚（形态前一晚的收盘价）与尺（形态之前五根的平均振幅，与识别器同款窗口），
// 后续每根在同一组数字上按剧本推进；判据余量相对 r 留足，四舍五入的 0.01 元抖动翻不了案。
// 标记同样来自识别器 detectThreeCandle 对全序列的真实扫描，不手标。

const THREE_LABEL: Record<ThreeCandlePatternId, string> = {
  'morning-star': '早晨之星',
  'evening-star': '黄昏之星',
  'three-white-soldiers': '红三兵',
  'stalled-pattern': '红三兵受阻',
  'three-black-crows': '黑三鸦',
  'rising-three-methods': '上升三法',
  'falling-three-methods': '下降三法',
}

/** 识别器扫全序列。only 传形态白名单：稳定趋势里推进形态会连续成串报出（第 5 章同款考虑），
 *  趋势图只标主角形态族、避免淹没主角——全序列命中数由摘要行如实报告 */
const scanThree = (cs: readonly Candle[], only?: readonly ThreeCandlePatternId[]): Marker[] =>
  detectThreeCandle(cs)
    .filter((h) => !only || only.includes(h.id))
    .map((h) => ({
      index: h.index,
      label: h.id === 'morning-star' && h.confirmed === false ? '早晨之星·未确认' : THREE_LABEL[h.id],
      kind:
        h.id === 'morning-star' && h.confirmed === false
          ? 'info'
          : h.direction === 'bull'
            ? 'bull'
            : 'bear',
    }))

/** 守门：植入的完成日必须如预期判出该形态、背景方向与确认状态正确，否则整段导出失败 */
const expectThreeAt = (
  cs: readonly Candle[],
  index: number,
  id: ThreeCandlePatternId,
  position: 'falling' | 'rising' | 'flat',
  confirmed?: boolean,
): void => {
  const found = detectThreeCandle(cs).find((h) => h.index === index && h.id === id)
  if (!found) {
    throw new Error(`第 ${index + 1} 根没有被识别为「${THREE_LABEL[id]}」，识别器命中：${JSON.stringify(detectThreeCandle(cs))}`)
  }
  if (found.position !== position) {
    throw new Error(`第 ${index + 1} 根「${THREE_LABEL[id]}」的背景判为 ${found.position}，期望 ${position}——换一颗种子再试`)
  }
  if (confirmed !== undefined && found.confirmed !== confirmed) {
    throw new Error(`第 ${index + 1} 根「${THREE_LABEL[id]}」的确认状态是 ${found.confirmed}，期望 ${confirmed}`)
  }
}

const AT8 = 31 // 完成日（第 32 根）：三根形态在第 30-32 根，受阻四根在第 29-32 根，三法五根在第 28-32 根

/** 参照振幅：形态第一根之前五根的平均振幅——与 detectThreeCandle 内部同款窗口（不含形态各根） */
const refBeforeShape = (cs: readonly Candle[], start: number): number => {
  let sum = 0
  for (let j = start - 5; j < start; j++) sum += cs[j].high - cs[j].low
  return sum / 5
}

/** 整段植入：把 shapes 依次覆盖到 start 起的位置（日期沿用被覆盖那根的） */
const plantRange = (cs: readonly Candle[], start: number, shapes: Candle[]): Candle[] =>
  cs.map((c, i) => {
    const k = i - start
    return k >= 0 && k < shapes.length ? { ...shapes[k], date: c.date } : c
  })

/** 植入一段多根形态：锚取形态前一晚收盘，尺取形态之前五根平均振幅 */
const plantShape = (cs: readonly Candle[], start: number, mk: (b: number, r: number) => Candle[]): Candle[] =>
  plantRange(cs, start, mk(round2(cs[start - 1].close), refBeforeShape(cs, start)))

const ch8 = (seed: number, drift: number): Candle[] =>
  driftSeries(createRng(seed), { days: 34, startPrice: drift < 0 ? 18.4 : 5.5, drift, vol: 0.009 })

// 三幕剧：晨星（第一幕大阴、第二幕星线悬在其实体之下、第三幕收过中点的放量阳线）
const morningShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.25 * r), close: round2(b - 1.2 * r), volume: 130000 },
  { date: '', open: round2(b - 1.45 * r), high: round2(b - 1.35 * r), low: round2(b - 1.85 * r), close: round2(b - 1.5 * r), volume: 90000 },
  { date: '', open: round2(b - 1.55 * r), high: round2(b + 0.15 * r), low: round2(b - 1.6 * r), close: round2(b + 0.1 * r), volume: 200000 },
]
// 暮星：镜像的三幕剧（第一幕大阳、星线悬在其实体之上、第三幕失守中点的放量阴线）
const eveningShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 130000 },
  { date: '', open: round2(b + 1.5 * r), high: round2(b + 1.85 * r), low: round2(b + 1.35 * r), close: round2(b + 1.45 * r), volume: 90000 },
  { date: '', open: round2(b + 1.55 * r), high: round2(b + 1.6 * r), low: round2(b - 0.15 * r), close: round2(b - 0.1 * r), volume: 200000 },
]
// 三连推进：开盘逐根嵌在前根实体内的饱满阳线（受阻图共用，再接一根撞墙的第四根）
const soldiersShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 0.75 * r), low: round2(b - 0.05 * r), close: round2(b + 0.7 * r), volume: 100000 },
  { date: '', open: round2(b + 0.35 * r), high: round2(b + 1.45 * r), low: round2(b + 0.3 * r), close: round2(b + 1.4 * r), volume: 120000 },
  { date: '', open: round2(b + 1.05 * r), high: round2(b + 2.15 * r), low: round2(b + 1.0 * r), close: round2(b + 2.1 * r), volume: 140000 },
]
const stalledShapes = (b: number, r: number): Candle[] => [
  ...soldiersShapes(b, r),
  { date: '', open: round2(b + 2.15 * r), high: round2(b + 2.25 * r), low: round2(b + 1.95 * r), close: round2(b + 2.2 * r), volume: 80000 },
]
const crowsShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 0.75 * r), close: round2(b - 0.7 * r), volume: 100000 },
  { date: '', open: round2(b - 0.35 * r), high: round2(b - 0.3 * r), low: round2(b - 1.45 * r), close: round2(b - 1.4 * r), volume: 120000 },
  { date: '', open: round2(b - 1.05 * r), high: round2(b - 1.0 * r), low: round2(b - 2.15 * r), close: round2(b - 2.1 * r), volume: 140000 },
]
// 五幕剧：大阳立框、三根小实体缩在框内回撤、大阳收回新高（中间三根实体占比压在 0.5 之下，不冒充黑三鸦）
const riseThreeShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 1.25 * r), low: round2(b - 0.05 * r), close: round2(b + 1.2 * r), volume: 160000 },
  { date: '', open: round2(b + 1.0 * r), high: round2(b + 1.1 * r), low: round2(b + 0.45 * r), close: round2(b + 0.75 * r), volume: 50000 },
  { date: '', open: round2(b + 0.75 * r), high: round2(b + 0.85 * r), low: round2(b + 0.2 * r), close: round2(b + 0.5 * r), volume: 45000 },
  { date: '', open: round2(b + 0.5 * r), high: round2(b + 0.6 * r), low: round2(b + 0.05 * r), close: round2(b + 0.3 * r), volume: 40000 },
  { date: '', open: round2(b + 0.25 * r), high: round2(b + 1.45 * r), low: round2(b + 0.2 * r), close: round2(b + 1.4 * r), volume: 170000 },
]
const fallThreeShapes = (b: number, r: number): Candle[] => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.25 * r), close: round2(b - 1.2 * r), volume: 160000 },
  { date: '', open: round2(b - 0.95 * r), high: round2(b - 0.4 * r), low: round2(b - 1.05 * r), close: round2(b - 0.7 * r), volume: 50000 },
  { date: '', open: round2(b - 0.7 * r), high: round2(b - 0.15 * r), low: round2(b - 0.8 * r), close: round2(b - 0.45 * r), volume: 45000 },
  { date: '', open: round2(b - 0.45 * r), high: round2(b - 0.1 * r), low: round2(b - 0.55 * r), close: round2(b - 0.25 * r), volume: 40000 },
  { date: '', open: round2(b - 0.2 * r), high: round2(b - 0.15 * r), low: round2(b - 1.45 * r), close: round2(b - 1.4 * r), volume: 170000 },
]

// 晨星对照：两张图的三根价格逐字一致，只有第三根的量不同——收复照旧、量能掉链子
const morningBase = plantShape(ch8(801, -0.02), AT8 - 2, morningShapes)
const morningSeries = morningBase
const morningWeakSeries = morningBase.map((c, i) => (i === AT8 ? { ...c, volume: 100000 } : c))
const sameOhlc = (a: Candle, b: Candle): boolean =>
  ['open', 'high', 'low', 'close'].every((k) => a[k as keyof Candle] === b[k as keyof Candle])
for (const i of [AT8 - 2, AT8 - 1, AT8]) {
  if (!sameOhlc(morningSeries[i], morningWeakSeries[i])) {
    throw new Error(`第 ${i + 1} 根两张图价格不一致：晨星对照的前提被破坏`)
  }
}

const eveningSeries = plantShape(ch8(802, 0.02), AT8 - 2, eveningShapes)
const soldiersSeries = plantShape(ch8(803, 0.02), AT8 - 2, soldiersShapes)
const stalledSeries = plantShape(ch8(804, 0.02), AT8 - 3, stalledShapes)
const crowsSeries = plantShape(ch8(805, -0.02), AT8 - 2, crowsShapes)
const riseThreeSeries = plantShape(ch8(806, 0.02), AT8 - 4, riseThreeShapes)
const fallThreeSeries = plantShape(ch8(807, -0.02), AT8 - 4, fallThreeShapes)

expectThreeAt(morningSeries, AT8, 'morning-star', 'falling', true)
expectThreeAt(morningWeakSeries, AT8, 'morning-star', 'falling', false)
expectThreeAt(eveningSeries, AT8, 'evening-star', 'rising', true)
expectThreeAt(soldiersSeries, AT8, 'three-white-soldiers', 'rising')
expectThreeAt(stalledSeries, AT8, 'stalled-pattern', 'rising')
expectThreeAt(stalledSeries, AT8 - 1, 'three-white-soldiers', 'rising')
expectThreeAt(crowsSeries, AT8, 'three-black-crows', 'falling')
expectThreeAt(riseThreeSeries, AT8, 'rising-three-methods', 'rising')
expectThreeAt(fallThreeSeries, AT8, 'falling-three-methods', 'falling')

writeJson('08-morning-star.json', { candles: morningSeries, overlays: [], markers: scanThree(morningSeries, ['morning-star']) })
writeJson('08-morning-unconfirmed.json', {
  candles: morningWeakSeries,
  overlays: [],
  markers: scanThree(morningWeakSeries, ['morning-star']),
})
writeJson('08-evening-star.json', { candles: eveningSeries, overlays: [], markers: scanThree(eveningSeries, ['evening-star']) })
writeJson('08-three-soldiers.json', {
  candles: soldiersSeries,
  overlays: [],
  markers: scanThree(soldiersSeries, ['three-white-soldiers']),
})
writeJson('08-stalled.json', {
  candles: stalledSeries,
  overlays: [],
  markers: scanThree(stalledSeries, ['three-white-soldiers', 'stalled-pattern']),
})
writeJson('08-three-crows.json', { candles: crowsSeries, overlays: [], markers: scanThree(crowsSeries, ['three-black-crows']) })
writeJson('08-rising-three.json', {
  candles: riseThreeSeries,
  overlays: [],
  markers: scanThree(riseThreeSeries, ['rising-three-methods']),
})
writeJson('08-falling-three.json', {
  candles: fallThreeSeries,
  overlays: [],
  markers: scanThree(fallThreeSeries, ['falling-three-methods']),
})

const CH8_HITS: [string, Candle[]][] = [
  ['08-morning-star', morningSeries],
  ['08-morning-unconfirmed', morningWeakSeries],
  ['08-evening-star', eveningSeries],
  ['08-three-soldiers', soldiersSeries],
  ['08-stalled', stalledSeries],
  ['08-three-crows', crowsSeries],
  ['08-rising-three', riseThreeSeries],
  ['08-falling-three', fallThreeSeries],
]
console.log(
  [
    `08-morning-star / 08-morning-unconfirmed：第 ${AT8 + 1} 根是同一组价格，第三根量 20 万判「已确认」、10 万降级「早晨之星·未确认」（量能线：前两根较大者 13 万的 1.2 倍）`,
    `08-evening-star / 08-three-soldiers / 08-three-crows：第 ${AT8 + 1} 根分别判黄昏之星（已确认）/红三兵/黑三鸦`,
    `08-stalled：第 ${AT8}、${AT8 + 1} 根红三兵+红三兵受阻同图并存；08-rising-three / 08-falling-three：第 ${AT8 + 1} 根判五根组合的升降三法`,
    `08-*.json 全序列三根以上命中 ${CH8_HITS.map(([, cs]) => detectThreeCandle(cs).length).join('/')} 处（标记皆由识别器扫出，趋势图只标主角形态族）`,
  ].join('\n'),
)

// —— 第 9 章图表：形态统计验货。统计图的数据不是新行情，而是 evaluatePattern / shuffleControl
// 对同一段行情的真实读数——图上每一根线都是正文读者将亲手复现的代码算出来的 ——
// 锤子线是稀有形态：默认波动率下 1500 个交易日只命中 8 次，样本不够统计说话；
// 这里用 8000 个交易日、日波动 3% 的随机游走（种子 2026），与本章测试的无优势序列同一段。

const HORIZON = 5 // 前瞻窗口：命中后第 5 根收盘定输赢
const statWalk = generateCandles(createRng(2026), { days: 8000, startPrice: 10, volatility: 0.03 })
const last9 = statWalk.length - 1 - HORIZON

/** 单根影线族判定器：把第 5 章的识别器接进统计接口（前 5 根没有背景窗口，不算命中） */
const wickMatcher = (id: WickPatternId): PatternMatcher => (cs, i) =>
  i >= 5 && classifyWicks(cs[i], trendContext(cs, i)).includes(id)
const hammerMatcher = wickMatcher('hammer')

const hammerEval = evaluatePattern(statWalk, hammerMatcher, HORIZON)
if (hammerEval.sampleSize < 50) {
  throw new Error(`这段行情只命中 ${hammerEval.sampleSize} 个锤子线，攒不够「样本量」的教学线（≥50）——换种子或加长序列`)
}

// 图一：扫描段（前 200 根）。标记由识别器对这一段真实扫描，不手标；统计在全文 8000 根上算
const scanSlice = statWalk.slice(0, 200)
const scanHits: Marker[] = []
for (let i = 5; i < scanSlice.length; i++) {
  if (classifyWicks(scanSlice[i], trendContext(scanSlice, i)).includes('hammer')) {
    scanHits.push({ index: i, label: '锤子线', kind: 'bull' })
  }
}
if (scanHits.length < 3) {
  throw new Error(`扫描段只找到 ${scanHits.length} 个锤子线（期望 ≥3）——挪窗口或换种子`)
}
writeJson('09-hammer-scan.json', { candles: scanSlice, overlays: [], markers: scanHits })

// 图二：胜率累计曲线——每命中一个锤子线就记一笔，胜率随样本量长出来
let cumWins = 0
let cumHits = 0
const curve: number[] = []
for (let i = 5; i <= last9; i++) {
  if (!hammerMatcher(statWalk, i)) continue
  cumHits++
  if (statWalk[i + HORIZON].close > statWalk[i].close) cumWins++
  curve.push(cumWins / cumHits)
}
if (curve[curve.length - 1] !== hammerEval.winRate) {
  throw new Error('累计曲线的终点与 evaluatePattern 的胜率不一致——两条算路必须同源')
}
writeJson('09-hammer-learning.json', {
  series: [
    { name: '锤子线胜率（累计）', values: curve },
    { name: '基准概率', values: curve.map(() => hammerEval.baseline) },
  ],
  labels: curve.map((_, k) => `第${k + 1}个样本`),
})

// 图三：随机对照组的胜率分布（升序排列）与实测、基准同框
const ctrl = shuffleControl(statWalk, hammerMatcher, HORIZON, { trials: 200, seed: 7 })
const sortedRates = [...ctrl.rates].sort((a, b) => a - b)
const manualBeat = ctrl.rates.filter((r) => r >= ctrl.winRate).length / ctrl.trials
if (manualBeat !== ctrl.beatRatio) {
  throw new Error('beatRatio 与 rates 的手工复算不一致——读数必须能由分布推出')
}
writeJson('09-shuffle-control.json', {
  series: [
    { name: '随机对照组胜率（200 组·升序）', values: sortedRates },
    { name: '锤子线实测胜率', values: sortedRates.map(() => ctrl.winRate) },
    { name: '基准概率', values: sortedRates.map(() => hammerEval.baseline) },
  ],
})

// 图四：六种形态 + 一条注入剧本的「阳性对照」同场验货。
// 多根形态的判定器用「一次全扫 + 命中日集合」的方式接进来，避免每个判定日重扫全序列。
const setMatcher = (indices: readonly number[]): PatternMatcher => {
  const hit9 = new Set(indices)
  return (_cs, i) => hit9.has(i)
}
const dragonflyMatcher: PatternMatcher = (cs, i) =>
  i >= 5 && classifyDoji(cs[i], dojiContext(cs, i))?.kind === 'dragonfly'

type VerdictRow = { label: string; dir: 'bull' | 'bear'; n: number; win: number; base: number; ctrlMean: number; beat: number }

const verdictOn = (label: string, m: PatternMatcher, dir: 'bull' | 'bear', cs: readonly Candle[] = statWalk): VerdictRow => {
  const r = evaluatePattern(cs, m, HORIZON, dir)
  const s = shuffleControl(cs, m, HORIZON, { trials: 200, seed: 7, direction: dir })
  return { label, dir, n: r.sampleSize, win: r.winRate, base: r.baseline, ctrlMean: s.meanWinRate, beat: s.beatRatio }
}

const VERDICT: VerdictRow[] = [
  verdictOn('锤子线', hammerMatcher, 'bull'),
  verdictOn('上吊线', wickMatcher('hanging-man'), 'bear'),
  verdictOn('射击之星', wickMatcher('shooting-star'), 'bear'),
  verdictOn('倒锤子', wickMatcher('inverted-hammer'), 'bull'),
  verdictOn(
    '看涨吞没',
    setMatcher(detectTwoCandle(statWalk).filter((h) => h.id === 'bullish-engulfing').map((h) => h.index)),
    'bull',
  ),
  verdictOn('蜻蜓线', dragonflyMatcher, 'bull'),
]

// 阳性对照：同款随机游走换种子 909，每次锤子线命中后把之后的行情整段抬升 5%——
// 给「仪器」塞一份已知有优势的样本，检验统计这套流程真能检出优势（与本章测试的注入剧本同款）
const injectLift = (cs: readonly Candle[], lift: number): Candle[] => {
  const out = cs.map((k) => ({ ...k }))
  for (let i = 0; i + HORIZON < out.length; i++) {
    if (!hammerMatcher(out, i)) continue
    for (let j = i + 1; j < out.length; j++) {
      out[j] = {
        ...out[j],
        open: round2(out[j].open * lift),
        high: round2(out[j].high * lift),
        low: round2(out[j].low * lift),
        close: round2(out[j].close * lift),
      }
    }
  }
  return out
}
const riggedWalk = injectLift(generateCandles(createRng(909), { days: 8000, startPrice: 10, volatility: 0.03 }), 1.05)
const riggedRow = verdictOn('锤子线·注入剧本', hammerMatcher, 'bull', riggedWalk)

for (const row of VERDICT) {
  if (row.n < 20) throw new Error(`${row.label} 只命中 ${row.n} 次（期望 ≥20）——统计表的样本量线不成立`)
  if (row.beat < 0.05) throw new Error(`${row.label} 在无优势行情上 beat=${row.beat}——随机序列不该被验成显著，换种子`)
}
if (riggedRow.win - riggedRow.base <= 0.15 || riggedRow.beat > 0.02) {
  throw new Error(`注入剧本没被检出：diff=${(riggedRow.win - riggedRow.base).toFixed(3)}、beat=${riggedRow.beat}——仪器失灵`)
}

writeJson('09-verdict.json', {
  series: [
    { name: '形态胜率', values: [...VERDICT, riggedRow].map((r) => r.win) },
    { name: '基准概率', values: [...VERDICT, riggedRow].map((r) => r.base) },
  ],
  labels: [...VERDICT, riggedRow].map((r) => r.label),
})

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`
console.log(
  [
    `09-hammer-scan.json：${statWalk.length} 个交易日的行情里锤子线共命中 ${hammerEval.sampleSize} 个（胜率 ${pct(hammerEval.winRate)}、基准 ${pct(hammerEval.baseline)}）；图为前 200 根，识别器在这段找到 ${scanHits.length} 个（第 ${scanHits.map((h) => h.index + 1).join('/')} 根）`,
    `09-hammer-learning.json：累计曲线 ${curve.length} 个样本点；09-shuffle-control.json：200 组随机对照，均值 ${pct(ctrl.meanWinRate)}、beatRatio ${ctrl.beatRatio}`,
    `验货表（形态 | 方向 | 样本 | 胜率 | 基准 | 对照均值 | 被反超占比）：`,
    ...VERDICT.map(
      (r) => `  ${r.label} | ${r.dir === 'bull' ? '看涨' : '看跌'} | ${r.n} | ${pct(r.win)} | ${pct(r.base)} | ${pct(r.ctrlMean)} | ${r.beat}`,
    ),
    `  ${riggedRow.label} | 看涨 | ${riggedRow.n} | ${pct(riggedRow.win)} | ${pct(riggedRow.base)} | ${pct(riggedRow.ctrlMean)} | ${riggedRow.beat} ← 阳性对照`,
  ].join('\n'),
)

// —— 第 10 章图表：趋势的解剖。三张图：上行台阶、下行台阶、趋势线与通道 ——
// 行情出自本段的线性漂移合成器 trendWalk（固定种子）：日漂移是固定金额而非固定比例，
// 趋势走成直线而不是复利曲线——趋势线与通道的教学图需要行情围绕直线展开。
// 波峰波谷标签是本章导出段的教学标注：窗口 k=3 的局部极值 + 峰谷交替的草稿判据，
// 用来给图贴 HH/HL/LH/LL 标签。正式的枢轴识别器 pivots(candles, k) 要到第 13 章才建，
// 这里的标记不是识别器的输出——正文按「本章教学标注」如实说明。

/** 第 10 章专用：线性漂移合成行情——每日固定涨跌 drift 元，噪声与影线都是固定幅度 */
const trendWalk = (
  rng: () => number,
  opts: { days: number; startPrice: number; drift: number; noise: number; wick: number },
): Candle[] => {
  const candles: Candle[] = []
  let prevClose = opts.startPrice
  for (const date of tradingDates('2026-03-02', opts.days)) {
    const open = round2(prevClose + (rng() * 2 - 1) * opts.noise * 0.4)
    const close = round2(open + opts.drift + (rng() * 2 - 1) * opts.noise)
    const high = round2(Math.max(open, close) + rng() * opts.wick)
    const low = round2(Math.min(open, close) - rng() * opts.wick)
    const volume = 100 * (1 + Math.floor(rng() * 1000))
    candles.push({ date, open, high, low, close, volume })
    prevClose = close
  }
  return candles
}

/** 教学标注的枢轴：一个高点/低点在左右各 k 根内都是最高/最低，才算波峰/波谷；
 *  原始极值里同类相邻时只留更极端的一个，逼出峰谷交替的序列 */
type TeachPivot = { index: number; price: number; side: 'peak' | 'trough' }
const teachingPivots = (cs: readonly Candle[], k = 3): TeachPivot[] => {
  const raw: TeachPivot[] = []
  for (let i = k; i < cs.length - k; i++) {
    let isPeak = true
    let isTrough = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (cs[j].high >= cs[i].high) isPeak = false
      if (cs[j].low <= cs[i].low) isTrough = false
    }
    if (isPeak) raw.push({ index: i, price: cs[i].high, side: 'peak' })
    if (isTrough) raw.push({ index: i, price: cs[i].low, side: 'trough' })
  }
  const kept: TeachPivot[] = []
  for (const p of raw) {
    const last = kept[kept.length - 1]
    if (!last || last.side !== p.side) kept.push({ ...p })
    else if ((p.side === 'peak' && p.price > last.price) || (p.side === 'trough' && p.price < last.price))
      kept[kept.length - 1] = { ...p }
  }
  return kept
}

/** 峰对峰、谷对谷比高低：更高记 HH/HL，更低记 LH/LL；每侧第一个没有前驱，标「峰/谷」 */
const teachMarkers = (cs: readonly Candle[]): Marker[] => {
  const out: Marker[] = []
  let prevPeak: number | null = null
  let prevTrough: number | null = null
  for (const p of teachingPivots(cs)) {
    if (p.side === 'peak') {
      out.push({ index: p.index, label: prevPeak === null ? '峰' : p.price > prevPeak ? 'HH' : 'LH', kind: 'info' })
      prevPeak = p.price
    } else {
      out.push({ index: p.index, label: prevTrough === null ? '谷' : p.price > prevTrough ? 'HL' : 'LL', kind: 'bull' })
      prevTrough = p.price
    }
  }
  return out
}

/** 守门：整段行情必须是教科书台阶——上行全 HH/HL、下行全 LH/LL，且峰谷各 ≥4 个；
 *  出现一个反例就整段导出失败（换一颗种子再试） */
const expectStaircase = (cs: readonly Candle[], dir: 'up' | 'down'): Marker[] => {
  const ms = teachMarkers(cs)
  const want = dir === 'up' ? ['HH', 'HL'] : ['LH', 'LL']
  const bad = ms.filter((m) => m.label !== '峰' && m.label !== '谷' && !want.includes(m.label))
  if (bad.length > 0) {
    throw new Error(`第 10 章${dir === 'up' ? '上行' : '下行'}段混进反例：${bad.map((b) => `${b.label}@第${b.index + 1}根`).join('、')}——换一颗种子再试`)
  }
  const peaks = ms.filter((m) => m.label === '峰' || m.label === 'HH' || m.label === 'LH').length
  const troughs = ms.length - peaks
  if (peaks < 4 || troughs < 4) {
    throw new Error(`第 10 章台阶只有峰 ${peaks} 个、谷 ${troughs} 个（各需 ≥4）——换一颗种子再试`)
  }
  return ms
}

const up10 = trendWalk(createRng(3016), { days: 70, startPrice: 10, drift: 0.07, noise: 0.16, wick: 0.09 })
const down10 = trendWalk(createRng(4015), { days: 70, startPrice: 16, drift: -0.07, noise: 0.16, wick: 0.09 })
const upMarkers = expectStaircase(up10, 'up')
expectStaircase(down10, 'down')

writeJson('10-uptrend.json', { candles: up10, overlays: [], markers: upMarkers })
writeJson('10-downtrend.json', { candles: down10, overlays: [], markers: teachMarkers(down10) })

// 趋势线与通道（同一张上行图，加两条线）：取第 2、3 个谷连线（两枢轴起步），
// 第 4 个谷验「第三点回踩」；再把线平移过两谷之间的最高峰，得到通道上轨
const range10 = (cs: readonly Candle[]): number => {
  let s = 0
  for (const c of cs) s += c.high - c.low
  return s / cs.length
}
const r10 = range10(up10)
const troughs10 = teachingPivots(up10).filter((p) => p.side === 'trough')
const trendA = troughs10[1]
const trendB = troughs10[2]
const trendC = troughs10[3]
const slope10 = (trendB.price - trendA.price) / (trendB.index - trendA.index)
const lineAt10 = (i: number): number => trendA.price + slope10 * (i - trendA.index)
if (slope10 <= 0) throw new Error('趋势线的斜率不是正的——上行段选段失败')
for (const t of [trendB, trendC]) {
  if (up10[t.index].low !== t.price) throw new Error('锚点谷的价位与K线低点不一致——标注前提被破坏')
}
const touch10 = trendC.price - lineAt10(trendC.index)
if (touch10 < -0.25 * r10 || touch10 > 1.2 * r10) {
  throw new Error(`第三点离线 ${touch10.toFixed(2)} 元（容差 ±[0.25, 1.2]×平均振幅）——第三点验证不成立，换种子`)
}
if (!teachingPivots(up10).slice(4).every((p) => p.side !== 'trough' || p.price >= lineAt10(p.index) - 0.25 * r10)) {
  throw new Error('延长线被之后的谷跌穿——趋势线守门失败，换种子')
}
let gap10 = -Infinity
let iPeak10 = -1
for (let i = trendA.index + 1; i < trendB.index; i++) {
  const g = up10[i].high - lineAt10(i)
  if (g > gap10) {
    gap10 = g
    iPeak10 = i
  }
}
let pierce10 = -Infinity
for (let i = iPeak10; i < up10.length; i++) pierce10 = Math.max(pierce10, up10[i].high - (lineAt10(i) + gap10))
if (pierce10 > 1.5 * r10) {
  throw new Error(`最高峰冲出通道上轨 ${pierce10.toFixed(2)} 元（容差 1.5×平均振幅）——通道守门失败，换种子`)
}

writeJson('10-trendline.json', {
  candles: up10,
  overlays: [
    { name: '上行趋势线', values: up10.map((_, i) => (i < trendA.index ? null : round2(lineAt10(i)))) },
    { name: '通道上轨', values: up10.map((_, i) => (i < iPeak10 ? null : round2(lineAt10(i) + gap10))) },
  ],
  markers: [
    { index: trendA.index, label: '①', kind: 'bull' },
    { index: trendB.index, label: '②', kind: 'bull' },
    { index: trendC.index, label: '③', kind: 'bull' },
    { index: iPeak10, label: '峰', kind: 'info' },
  ],
})

console.log(
  [
    `10-uptrend.json：${up10.length} 根上行合成行情（线性漂移），教学标注峰谷 ${upMarkers.length} 个——首峰首谷无前驱标「峰/谷」，其余全部 HH/HL`,
    `10-downtrend.json：${down10.length} 根下行合成行情，标注全部 LH/LL`,
    `10-trendline.json：谷① 第 ${trendA.index + 1} 根（${up10[trendA.index].date}，${trendA.price}）与谷② 第 ${trendB.index + 1} 根（${up10[trendB.index].date}，${trendB.price}）连线，斜率 ${slope10.toFixed(4)} 元/根`,
    `  第三点谷③ 第 ${trendC.index + 1} 根（${up10[trendC.index].date}，低 ${trendC.price}）对线值 ${lineAt10(trendC.index).toFixed(2)}，差 ${touch10.toFixed(2)} 元 ≈ ${(Math.abs(touch10) / r10).toFixed(2)}×平均振幅`,
    `  通道：平移 ${gap10.toFixed(2)} 元过第 ${iPeak10 + 1} 根的峰（${up10[iPeak10].high}），其后最高冲出上轨 ${pierce10.toFixed(2)} 元（容差内，正文如实报数）`,
  ].join('\n'),
)

// —— 第 11 章图表：均线。三张图：MA5/MA20 叠加、金叉死叉标记、ema 与 sma 对跳价的响应 ——
// 图上每条均线都出自 src/indicators/ma.ts 的真实计算，标记来自 crossovers 的真实扫描，不手标。

const rnd = (v: number | null): number | null => (v == null ? null : round2(v))

// 图一：上行行情叠 MA5/MA20。driftSeries 固定漂移合成：日日有噪声，两条均线只留方向
const maUp = driftSeries(createRng(1101), { days: 70, startPrice: 10, drift: 0.008, vol: 0.014 })
const ma5Up = sma(maUp, 5)
const ma20Up = sma(maUp, 20)
if (maUp[maUp.length - 1].close <= maUp[0].close) {
  throw new Error('第 11 章上行段没涨起来——换一颗种子再试')
}
if ((ma5Up[ma5Up.length - 1] ?? 0) <= (ma20Up[ma20Up.length - 1] ?? 0)) {
  throw new Error('上行段末尾 MA5 没有站在 MA20 上方——快慢关系不成立，换种子')
}
writeJson('11-ma-overlay.json', {
  candles: maUp,
  overlays: [
    { name: 'MA5', values: ma5Up.map(rnd) },
    { name: 'MA20', values: ma20Up.map(rnd) },
  ],
  markers: [],
})

// 图二：平走→抬升→回落的完整回合。金叉死叉标记来自 crossovers(candles, 5, 20) 的真实扫描；
// 「山顶」标记取全程最高点的下标（argmax），也是计算结果——用来量死叉迟到了几根
const flat11 = driftSeries(createRng(1102), { days: 24, startPrice: 10, drift: 0, vol: 0.01 })
const rise11 = driftSeries(createRng(1103), { days: 28, startPrice: flat11[flat11.length - 1].close, drift: 0.012, vol: 0.012 })
const fall11 = driftSeries(createRng(1104), { days: 32, startPrice: rise11[rise11.length - 1].close, drift: -0.012, vol: 0.012 })
// 三段拼接：driftSeries 每段各自从 2026-03-02 起算日期，拼起来会重叠——统一按总根数重新排日期
const roundDates11 = tradingDates('2026-03-02', flat11.length + rise11.length + fall11.length)
const round11 = [...flat11, ...rise11, ...fall11].map((k, i) => ({ ...k, date: roundDates11[i] }))
const cross11 = crossovers(round11, 5, 20)
// 抬升段的金叉：横盘期快慢线贴着走，可能先出几个来回打脸的小交叉——主信号取抬升段（第 25 根起）的第一个金叉
const riseStart11 = flat11.length
const firstGolden = cross11.find((s) => s.kind === 'golden' && s.index >= riseStart11)
const firstDead = cross11.find((s) => s.kind === 'dead' && firstGolden && s.index > firstGolden.index)
if (!firstGolden || !firstDead) {
  throw new Error(`第 11 章回合没走出「抬升段金叉→回落段死叉」：${JSON.stringify(cross11)}——换一颗种子再试`)
}
let top11 = 0
for (let i = 1; i < round11.length; i++) {
  if (round11[i].high > round11[top11].high) top11 = i
}
const lag11 = firstDead.index - top11
const drop11 = (round11[top11].high - round11[firstDead.index].close) / round11[top11].high
if (lag11 < 5) {
  throw new Error(`死叉只比山顶迟到 ${lag11} 根（需 ≥5）——滞后性在图上显不出来，换一颗种子再试`)
}
if (drop11 < 0.05) {
  throw new Error(`死叉那天距山顶只跌了 ${(drop11 * 100).toFixed(1)}%（需 ≥5%）——「接盘」的故事不成立，换种子`)
}
writeJson('11-crossovers.json', {
  candles: round11,
  overlays: [
    { name: 'MA5', values: sma(round11, 5).map(rnd) },
    { name: 'MA20', values: sma(round11, 20).map(rnd) },
  ],
  markers: [
    ...cross11.map((s) => ({ index: s.index, label: s.kind === 'golden' ? '金叉' : '死叉', kind: s.kind === 'golden' ? 'bull' : 'bear' }) as Marker),
    { index: top11, label: '山顶', kind: 'info' },
  ],
})

// 图三：ema 与 sma 对新价格的响应速度（LineChart）。收盘价 10 元横走 30 根后一步跳到 13 元，
// 两条 n=20 的均线各自追——「追到一半」（≥11.5 元）各花几根，由真实读数回答
const STEP_AT = 30
const stepCloses = [...Array(STEP_AT).fill(10), ...Array(20).fill(13)]
const stepDates = tradingDates('2026-03-02', stepCloses.length)
const stepCandles: Candle[] = stepCloses.map((close, i) => ({
  date: stepDates[i],
  open: close,
  high: round2(close + 0.01),
  low: round2(close - 0.01),
  close,
  volume: 1000,
}))
const HALF_UP = 11.5 // 跳幅 3 元的一半：追到一半算「跟上了」
const stepSmaRaw = sma(stepCandles, 20)
const stepEmaRaw = ema(stepCandles, 20)
const barsToHalf = (ma: (number | null)[]): number => {
  const at = ma.findIndex((v) => v != null && v >= HALF_UP)
  if (at < 0) throw new Error('这条均线 50 根内没追到跳幅的一半——步子设计错了')
  return at - STEP_AT + 1
}
const smaReach11 = barsToHalf(stepSmaRaw)
const emaReach11 = barsToHalf(stepEmaRaw)
if (smaReach11 - emaReach11 < 2) {
  throw new Error(`ema 只比 sma 早 ${smaReach11 - emaReach11} 根追到一半（需 ≥2）——响应速度差不显`)
}
writeJson('11-ma-response.json', {
  series: [
    { name: '收盘价', values: stepCloses },
    { name: 'SMA20', values: stepSmaRaw.map(rnd) },
    { name: 'EMA20', values: stepEmaRaw.map(rnd) },
  ],
  labels: stepCandles.map((k) => k.date),
})

console.log(
  [
    `11-ma-overlay.json：${maUp.length} 根上行合成行情，MA5/MA20 叠加（首 ${20} 根 MA20 未成形记 null）`,
    `11-crossovers.json：金叉第 ${firstGolden.index + 1} 根、山顶第 ${top11 + 1} 根（${round11[top11].date}，高 ${round11[top11].high}）、死叉第 ${firstDead.index + 1} 根——死叉比山顶迟到 ${lag11} 根，其间收盘从山顶跌掉 ${(drop11 * 100).toFixed(1)}%`,
    `11-ma-response.json：收盘 10→13 跳变后，EMA20 第 ${emaReach11} 根追到跳幅一半、SMA20 第 ${smaReach11} 根——都还在半路上（EMA 末值 ${stepEmaRaw[stepEmaRaw.length - 1]?.toFixed(2)}、SMA 末值 ${stepSmaRaw[stepSmaRaw.length - 1]?.toFixed(2)}，新价 13.00）`,
  ].join('\n'),
)

// —— 第 12 章图表：量能特征。三张图：量能标签全景、量价背离、换手率序列 ——
// 量的路径是手工设计的阶梯（放量、缩量、天量、地量各就各位），价格出自 driftSeries 固定种子；
// 标签与背离点全部来自 volumeFeatures 对全序列的真实扫描，不手标。

const VOL_LABEL: Record<VolumeLabelKind, string> = { surge: '放量', shrink: '缩量', climax: '天量', drought: '地量' }
const VOL_KIND: Record<VolumeLabelKind, Marker['kind']> = { surge: 'bull', shrink: 'info', climax: 'bear', drought: 'info' }

/** 量能阶梯：按段铺 [根数, 每根成交量（股）] */
const volLadder = (segs: readonly [number, number][]): number[] => segs.flatMap(([n, v]) => Array<number>(n).fill(v))

/** 把设计好的量能路径盖到行情上（价格与日期沿用原序列） */
const withVolumes = (cs: readonly Candle[], vols: readonly number[]): Candle[] =>
  cs.map((c, i) => ({ ...c, volume: vols[i] }))

const FLOAT_SHARES = 400_000_000 // 流通股本 4 亿股——换手率的分母

/** 守门：第 index 根（0 起）必须挂着期望的量能标签，否则整段导出失败 */
const expectLabelAt = (report: VolumeReport, index: number, kind: VolumeLabelKind): void => {
  const got = report.labels.find((l) => l.index === index)?.kind
  if (got !== kind) {
    throw new Error(`第 ${index + 1} 根的量能标签是 ${got ?? '无'}（期望 ${kind}）——阶梯设计或种子不对`)
  }
}

// 图一：60 根横盘行情铺量能阶梯。四段主场：缩量下台阶（5-8）、放量回归（10-12）、
// 天量（25）与地量（30）夹一段回落、缩量而不破极值（45，窗口内有更低的 1.6M 压着）。
// 缩量那几根的收盘价被钉进前五根高低区间的正中（parkMidRange）：横盘里的量缩新高/新低
// 是噪声级背离，不配当主角——这个话题留给第二张图独占
const parkMidRange = (cs: readonly Candle[], at: readonly number[]): Candle[] => {
  const out = cs.map((c) => ({ ...c }))
  for (const i of at) {
    let max = -Infinity
    let min = Infinity
    for (let j = i - 5; j < i; j++) {
      if (out[j].close > max) max = out[j].close
      if (out[j].close < min) min = out[j].close
    }
    const open = out[i - 1].close
    const close = round2((max + min) / 2)
    if (!(close < max && close > min)) {
      throw new Error(`第 ${i + 1} 根的中位收盘 ${close} 没落进前五根区间 [${min}, ${max}]——钉桩失败，换一颗种子再试`)
    }
    out[i] = {
      ...out[i],
      open,
      close,
      high: round2(Math.max(open, close) + 0.03),
      low: round2(Math.min(open, close) - 0.03),
    }
  }
  return out
}
const volLabelsSeries = withVolumes(
  parkMidRange(driftSeries(createRng(1201), { days: 60, startPrice: 10, drift: 0, vol: 0.012 }), [5, 6, 7, 8, 30, 31, 32, 33, 45]),
  volLadder([
    [5, 4_000_000], [5, 1_500_000], [5, 4_500_000], [10, 4_400_000], [1, 12_000_000],
    [4, 4_400_000], [4, 1_600_000], [5, 4_400_000], [6, 4_000_000], [4, 2_700_000], [11, 3_200_000],
  ]),
)
const report1 = volumeFeatures(volLabelsSeries)
expectLabelAt(report1, 10, 'surge')
expectLabelAt(report1, 25, 'climax')
expectLabelAt(report1, 30, 'drought')
expectLabelAt(report1, 45, 'shrink')
if (report1.divergences.length > 0) {
  throw new Error(`标签全景图混进 ${report1.divergences.length} 处背离（期望 0，背离话题留给第二张图独占）——换一颗种子再试`)
}
writeJson('12-volume-labels.json', {
  candles: volLabelsSeries,
  overlays: [],
  markers: report1.labels.map((l) => ({ index: l.index, label: `${VOL_LABEL[l.kind]} ${l.ratio.toFixed(1)}×`, kind: VOL_KIND[l.kind] })),
})

// 图二：70 根单边上行，量能先同步（放量上涨，第 16 根 1.8 倍放量做对照）、后两段缩量下台阶。
// 价格一路创新高，量却缩到七成以下——背离点只能从两段缩量里长出来
const divergenceSeries = withVolumes(
  driftSeries(createRng(1251), { days: 70, startPrice: 10, drift: 0.007, vol: 0.006 }),
  volLadder([
    [15, 5_000_000], [1, 9_000_000], [34, 5_000_000], [4, 2_800_000], [9, 5_200_000], [4, 2_900_000], [3, 3_000_000],
  ]),
)
const report2 = volumeFeatures(divergenceSeries)
const zoneA = report2.divergences.filter((d) => d.index >= 50 && d.index <= 53)
const zoneB = report2.divergences.filter((d) => d.index >= 63 && d.index <= 66)
if (report2.divergences.some((d) => d.index < 50)) {
  throw new Error('量价同步段冒出背离——放量上涨被误报，仪器失灵')
}
if (zoneA.length === 0 || zoneB.length === 0) {
  throw new Error(`两个缩量段扫出的背离是 ${zoneA.length}/${zoneB.length}（各需 ≥1）——换一颗种子再试`)
}
if (!report2.labels.some((l) => l.index === 15 && l.kind === 'surge')) {
  throw new Error('第 16 根的 1.8 倍放量没被记上——「放量上涨不误报」的对照样本丢了')
}
writeJson('12-divergence.json', {
  candles: divergenceSeries,
  overlays: [],
  markers: [
    { index: 15, label: `放量 1.8×`, kind: 'bull' },
    ...report2.divergences.map((d): Marker => ({ index: d.index, label: '顶背离', kind: 'bear' })),
  ],
})

// 图三：图一的量能阶梯除以流通股本 4 亿股——换手率序列（LineChart，百分轴）
const turnover12 = turnoverRate(volLabelsSeries, FLOAT_SHARES)
if (Math.abs(turnover12[25] - 12_000_000 / FLOAT_SHARES) > 1e-12) {
  throw new Error('天量日的换手率不是 3%——演算的锚丢了')
}
writeJson('12-turnover.json', {
  series: [{ name: '换手率', values: turnover12.map((v) => Math.round(v * 1e6) / 1e6) }],
  labels: volLabelsSeries.map((c) => c.date),
})

console.log(
  [
    `12-volume-labels.json：${volLabelsSeries.length} 根横盘行情铺量能阶梯，volumeFeatures 记标签 ${report1.labels.length} 枚（surge ${report1.labels.filter((l) => l.kind === 'surge').length}/shrink ${report1.labels.filter((l) => l.kind === 'shrink').length}/climax ${report1.labels.filter((l) => l.kind === 'climax').length}/drought ${report1.labels.filter((l) => l.kind === 'drought').length}），零背离`,
    `12-divergence.json：${divergenceSeries.length} 根单边上行，两段缩量各扫出顶背离 ${zoneA.length}/${zoneB.length} 处（第 ${report2.divergences.map((d) => d.index + 1).join('/')} 根），第 16 根 1.8 倍放量无背离；全序列另有标签 ${report2.labels.length} 枚`,
    `12-turnover.json：同一阶梯 ÷ 流通 4 亿股——常量 400 万股日 1.0%、天量 1200 万股 3.0%、地量段 0.4%`,
  ].join('\n'),
)

// —— 第 13 章图表：支撑、阻力与斐波那契。三张图：枢轴标注、位的聚类、回调刻度 ——
// 行情出自本段的路径合成器 pathSeries（固定种子）：按「目标价位 + 根数」逐段生成，
// 段内每根朝目标匀速走、身上撒 ±jit 小抖动——峰与谷的落点被目标价位钉住，触碰次数才有保证。
// 图一标记全部来自正式识别器 pivots 对全序列的真实扫描（第 10 章的教学标注此刻功成身退）；
// 图二的位由 levels 聚类算出、横线用「等值序列」画在 overlays 上；
// 图三的刻度由 fibLevels 对「枢轴行程」计算——图上没有一条线是手画的。

/** 第 13 章专用：路径行情——按「目标价位 + 根数」逐段生成，段内每根朝目标匀速走、身上撒小抖动。
 *  开盘嵌进当日步长的两成（而非贴住昨收）：贴住昨收会让反向那根的开盘价恰好压在拐角的极值上，
 *  严格极值判据就要靠影线抖动掷硬币——峰谷的确定性不能交给硬币 */
const pathSeries = (
  rng: () => number,
  start: number,
  legs: readonly { target: number; bars: number }[],
  jit = 0.015,
): Candle[] => {
  const raw: Candle[] = []
  let prevClose = start
  for (const leg of legs) {
    const step = (leg.target - prevClose) / leg.bars
    for (let b = 0; b < leg.bars; b++) {
      const open = round2(prevClose + step * 0.2)
      const close = round2(prevClose + step + (rng() * 2 - 1) * jit)
      const high = round2(Math.max(open, close) + rng() * jit)
      const low = round2(Math.min(open, close) - rng() * jit)
      raw.push({ date: '', open, high, low, close, volume: 100 * (1 + Math.floor(rng() * 1000)) })
      prevClose = close
    }
  }
  const dates = tradingDates('2026-03-02', raw.length)
  return raw.map((k, i) => ({ ...k, date: dates[i] }))
}

/** 守门（口径衔接）：正式识别器 pivots 与第 10 章教学标注 teachingPivots 在同一段行情上必须同输出——
 *  本章承诺「判据一字不改地转正」，这条守门就是承诺的机械证明 */
const samePivotSet = (a: readonly Pivot[], b: readonly Pivot[]): boolean =>
  a.length === b.length && a.every((p, i) => p.index === b[i].index && p.side === b[i].side && p.price === b[i].price)
const teachAs13 = teachingPivots(up10).map((p) => ({ index: p.index, side: p.side === 'peak' ? ('high' as const) : ('low' as const), price: p.price }))
if (!samePivotSet(pivots(up10), teachAs13)) {
  throw new Error('pivots 与第 10 章教学标注在第 10 章行情上输出不一致——口径衔接承诺被破坏')
}

/** HH/HL/LH/LL 标签：同类枢轴峰对峰、谷对谷比高低，每侧第一个没有前驱，标「峰/谷」 */
const pivotMarkers = (cs: readonly Candle[]): Marker[] => {
  const out: Marker[] = []
  let prevHigh: number | null = null
  let prevLow: number | null = null
  for (const p of pivots(cs)) {
    if (p.side === 'high') {
      out.push({ index: p.index, label: prevHigh === null ? '峰' : p.price > prevHigh ? 'HH' : 'LH', kind: 'info' })
      prevHigh = p.price
    } else {
      out.push({ index: p.index, label: prevLow === null ? '谷' : p.price > prevLow ? 'HL' : 'LL', kind: 'bull' })
      prevLow = p.price
    }
  }
  return out
}

// 图一/图二共用行情：三上三下的震荡段（顶约 11.0、底约 9.6，第三次上冲略低），末段向上突破
const range13 = pathSeries(createRng(1301), 10.0, [
  { target: 11.0, bars: 8 },
  { target: 9.6, bars: 8 },
  { target: 11.0, bars: 8 },
  { target: 9.6, bars: 8 },
  { target: 10.95, bars: 6 },
  { target: 9.65, bars: 6 },
  { target: 11.55, bars: 8 },
])

const pv13 = pivots(range13)
const ALT_OK = pv13.every((p, i) => i === 0 || p.side !== pv13[i - 1].side)
if (pv13.length < 6 || !ALT_OK) {
  throw new Error(`第 13 章震荡段枢轴 ${pv13.length} 个（需 ≥6）或峰谷不交替——换一颗种子再试`)
}
const priceAt13 = new Map(pv13.map((p) => [p.index, p.price]))
for (const m of pivotMarkers(range13)) {
  if ((m.label === '峰' || m.label === 'HH' || m.label === 'LH') && range13[m.index].high !== priceAt13.get(m.index)) {
    throw new Error('峰标记的价位与K线高点不一致——标注前提被破坏')
  }
}
writeJson('13-pivots.json', { candles: range13, overlays: [], markers: pivotMarkers(range13) })

// 图二：同一行情聚类成位。容差显式取 0.2 元（约一段台阶振幅），图上只画被证明过的位（触≥2）
const LV_TOL = 0.2
const lv13 = levels(range13, { tol: LV_TOL })
const sideOf13 = new Map(pv13.map((p) => [p.index, p.side]))
const top13 = lv13.find((l) => l.touches === 3 && l.indices.every((i) => sideOf13.get(i) === 'high'))
const bottom13 = lv13.find((l) => l.touches === 3 && l.indices.every((i) => sideOf13.get(i) === 'low'))
if (!top13 || top13.touches !== 3) {
  throw new Error(`顶部没有聚成「触 3」的位：${JSON.stringify(lv13.map((l) => ({ p: l.price, t: l.touches })))}——换种子或调容差`)
}
if (!bottom13 || bottom13.touches !== 3) {
  throw new Error(`底部没有聚成「触 3」的位：${JSON.stringify(lv13.map((l) => ({ p: l.price, t: l.touches })))}——换种子或调容差`)
}
const lastClose13 = range13[range13.length - 1].close
if (lastClose13 <= top13.price || top13.kind !== 'support') {
  throw new Error(`末根收盘 ${lastClose13} 没有涨过顶位 ${top13.price.toFixed(2)}——「破位换角色」的故事不成立，换种子`)
}
if (bottom13.price >= top13.price) throw new Error('底位不低于顶位——聚类结果不对')
// 破位根：收盘第一次站上顶位的那一根，也是故事的主角
let break13 = -1
for (let i = top13.indices[top13.indices.length - 1] + 1; i < range13.length; i++) {
  if (range13[i].close > top13.price) {
    break13 = i
    break
  }
}
if (break13 < 0) throw new Error('找不到收盘站上顶位的破位根——守门失败')

const levelOverlayName = (l: (typeof lv13)[number]): string => {
  const role = l.kind === 'resistance' ? '阻力' : '支撑'
  const allHighSide = l.indices.every((i) => sideOf13.get(i) === 'high')
  const flipped = allHighSide && l.kind === 'support' // 位由峰聚成、如今却在价下——阻力破位换的角色
  return `${role} ${round2(l.price)}（触${l.touches}${flipped ? '·原阻力' : ''}）`
}
writeJson('13-levels.json', {
  candles: range13,
  overlays: [top13, bottom13].map((l) => ({ name: levelOverlayName(l), values: range13.map(() => round2(l.price)) })),
  markers: [
    ...[top13, bottom13].flatMap((l) =>
      l.indices.map((i, n) => ({
        index: i,
        label: sideOf13.get(i) === 'high' ? `试顶${n + 1}` : `试底${n + 1}`,
        kind: (sideOf13.get(i) === 'high' ? 'bear' : 'bull') as Marker['kind'],
      })),
    ),
    { index: break13, label: '破位', kind: 'info' },
  ],
})

// 图三：涨一段、回一段——行程两端取自枢轴（起点谷与终点峰），刻度交给 fibLevels
const trend13 = pathSeries(createRng(1302), 10.5, [
  { target: 10.2, bars: 4 },
  { target: 13.0, bars: 20 },
  { target: 11.5, bars: 9 },
  { target: 11.8, bars: 5 },
])
const pvT13 = pivots(trend13)
const fibFrom = pvT13.filter((p) => p.side === 'low').reduce((a, b) => (b.price < a.price ? b : a))
const fibTo = pvT13.filter((p) => p.side === 'high').reduce((a, b) => (b.price > a.price ? b : a))
if (fibTo.price - fibFrom.price < 2) {
  throw new Error(`枢轴行程只有 ${round2(fibTo.price - fibFrom.price)} 元（需 ≥2）——行程太短，刻度挤成一团，换种子`)
}
const fib13 = fibLevels(fibFrom.price, fibTo.price)
const at13 = (ratio: number): number => fib13.find((f) => f.ratio === ratio)!.price
// 回踩谷：终点峰之后最低的低枢轴——它踩没踩进刻度带，是本图的故事
const pull13 = pvT13.filter((p) => p.side === 'low' && p.index > fibTo.index).reduce((a, b) => (b.price < a.price ? b : a))
const retraceRatio = (fibTo.price - pull13.price) / (fibTo.price - fibFrom.price)
if (retraceRatio < 0.35 || retraceRatio > 0.65) {
  throw new Error(`回踩只回撤了 ${(retraceRatio * 100).toFixed(1)}%（期望 35%–65%，踩进 0.5 附近的刻度带）——换种子`)
}
if (pull13.price > at13(0.382) || pull13.price < at13(0.618)) {
  throw new Error('回踩谷不在 0.382–0.618 刻度带内——守门失败')
}
if (trend13[trend13.length - 1].close <= pull13.price) {
  throw new Error('结尾没有收在回踩谷之上——「踩住回升」的故事不成立，换种子')
}
writeJson('13-fib.json', {
  candles: trend13,
  overlays: ([0.382, 0.5, 0.618] as const).map((ratio) => ({
    name: `${ratio} · ${round2(at13(ratio))}`,
    values: trend13.map(() => round2(at13(ratio))),
  })),
  markers: [
    { index: fibFrom.index, label: '① 起点', kind: 'bull' },
    { index: fibTo.index, label: '② 终点', kind: 'info' },
    { index: pull13.index, label: '③ 回踩', kind: 'bull' },
  ],
})

console.log(
  [
    `13-pivots.json：${range13.length} 根震荡+突破行情，正式识别器 pivots 扫出枢轴 ${pv13.length} 个（峰谷交替）——标签 ${pivotMarkers(range13).map((m) => m.label).join('/')}；口径衔接守门：与第 10 章教学标注在 10-uptrend 上逐个一致`,
    `13-levels.json：tol=${LV_TOL} 元聚类——顶位 ${round2(top13.price)} 元触 ${top13.touches} 次（第 ${top13.indices.map((i) => i + 1).join('/')} 根）、底位 ${round2(bottom13.price)} 元触 ${bottom13.touches} 次；第 ${break13 + 1} 根收盘 ${range13[break13].close} 元首次涨破顶位（末根收 ${lastClose13} 元），原阻力换角色为支撑`,
    `13-fib.json：枢轴行程 ①${round2(fibFrom.price)}（第 ${fibFrom.index + 1} 根）→ ②${round2(fibTo.price)}（第 ${fibTo.index + 1} 根），刻度 0.382=${round2(at13(0.382))}/0.5=${round2(at13(0.5))}/0.618=${round2(at13(0.618))}；回踩谷③ ${round2(pull13.price)}（第 ${pull13.index + 1} 根）回撤 ${(retraceRatio * 100).toFixed(1)}%`,
  ].join('\n'),
)

// —— 第 14 章图表：筹码分布。三张图：分布轮廓（底部日 vs 反弹末日）、获利盘/套牢盘比例曲线、
// 反弹路径上的套牢峰标注 ——
// 行情由 pathSeries 生成（第 13 章同款路径合成器，固定种子）：高位盘整 → 下跌 → 底部盘整 → 反弹，
// 止步在套牢峰之下。全部读数出自 src/chips/distribution.ts 的 chipDistribution 真实计算：
// 轮廓是逐日快照的价位-持仓量、曲线是逐日 winnerRatio/trappedRatio、平均成本线是逐日 averageCost；
// 套牢峰标记由「末日 peak 在收盘价上方」的真实读数定位，反弹段标记取真实扫描的极值，不手标。

const FLOAT14 = 2_000_000 // 流通股本 200 万股：与 pathSeries 的量级配套（日均量约 5 万股 ≈ 换手 2.5%）
const rebound14 = pathSeries(createRng(1401), 12.2, [
  { target: 12.3, bars: 6 }, // 高位盘整：未来的套牢峰在这里长出来
  { target: 9.0, bars: 14 }, // 下跌：山顶的居民原地留守
  { target: 9.2, bars: 6 }, // 底部盘整：新居民在低位搬进新房
  { target: 10.8, bars: 12 }, // 反弹：涨回半山腰就滞涨
])
const chips14 = chipDistribution(rebound14, { floatShares: FLOAT14 })
const final14 = chips14[chips14.length - 1]!

// 行程的三个锚点：左侧最高（高位密集区）、左侧最低（反弹起点）、反弹段最高（滞涨日）
let top14 = 0
for (let i = 1; i <= 11; i++) if (rebound14[i].high > rebound14[top14].high) top14 = i
let trough14 = 12
for (let i = 12; i <= 25; i++) if (rebound14[i].low < rebound14[trough14].low) trough14 = i
let stall14 = 26
for (let i = 27; i < rebound14.length; i++) if (rebound14[i].high > rebound14[stall14].high) stall14 = i

// 守门：套牢峰的故事线必须成立——峰仍在头顶、反弹没碰到峰、底部获利盘足够低、反弹抬升足够多
if (final14.peak.price <= final14.close) {
  throw new Error(`末日筹码峰 ${round2(final14.peak.price)} 不在收盘 ${final14.close} 上方——套牢峰故事不成立，换一颗种子再试`)
}
if (rebound14[stall14].high >= final14.peak.price - 0.5) {
  throw new Error(`反弹段最高 ${rebound14[stall14].high} 离峰 ${round2(final14.peak.price)} 不足 0.5 元——「滞涨在峰下」不成立，换一颗种子再试`)
}
if (rebound14[trough14].low > 9.5) {
  throw new Error(`底部只跌到 ${rebound14[trough14].low}——下跌段不够深，换一颗种子再试`)
}
if (chips14[trough14].winnerRatio > 0.3) {
  throw new Error(`底部日获利盘 ${chips14[trough14].winnerRatio.toFixed(2)}（期望 ≤0.3）——下跌不够狠，换一颗种子再试`)
}
if (final14.winnerRatio - chips14[trough14].winnerRatio < 0.2) {
  throw new Error(`反弹只把获利盘从 ${chips14[trough14].winnerRatio.toFixed(2)} 抬到 ${final14.winnerRatio.toFixed(2)}——抬升不够，换一颗种子再试`)
}

// 图一：分布轮廓。筹码分布本该是「价位→持仓量」的水平直方图，折线组件画不了水平条——
// 这里用 LineChart 画分布轮廓线近似（x=价位桶中心、y=持仓量占流通盘比例，面积填充），
// 峰与谷的形状与水平直方图一一对应。两张轮廓同框：底部日 vs 反弹末日，看低位山包长高
const bottomDay14 = chips14[trough14]
const endDay14 = final14
const r4 = (x: number): number => Math.round(x * 1e4) / 1e4
const priceLabels14 = [...new Set([...bottomDay14.buckets, ...endDay14.buckets].map((b) => round2(b.price)))]
  .sort((a, b) => a - b)
const profileAt14 = (d: (typeof chips14)[number]): (number | null)[] =>
  priceLabels14.map((p) => {
    const b = d.buckets.find((k) => round2(k.price) === p)
    return b ? r4(b.quantity / FLOAT14) : null
  })
writeJson('14-chips-profile.json', {
  series: [
    { name: `底部日 ${bottomDay14.date}`, values: profileAt14(bottomDay14), area: true },
    { name: `反弹末日 ${endDay14.date}`, values: profileAt14(endDay14), area: true },
  ],
  labels: priceLabels14.map((p) => p.toFixed(1)),
})

// 图二：获利盘与套牢盘比例的行进（LineChart，百分轴）——下跌段获利盘被打光，反弹段底部筹码变获利
writeJson('14-winner-ratio.json', {
  series: [
    { name: '获利盘比例', values: chips14.map((d) => r4(d.winnerRatio)) },
    { name: '套牢盘比例', values: chips14.map((d) => r4(d.trappedRatio)) },
  ],
  labels: rebound14.map((c) => c.date),
})

// 图三：反弹路径上的套牢峰（KLineChart）。平均成本线逐日叠加；三枚标记分别是
// 高位密集区（峰的成因地）、反弹起点（左侧最低）、反弹滞涨（反弹段最高的那根——头顶就是峰）
writeJson('14-rebound.json', {
  candles: rebound14,
  overlays: [{ name: '平均成本', values: chips14.map((d) => round2(d.averageCost)) }],
  markers: [
    { index: top14, label: '高位密集区', kind: 'info' },
    { index: trough14, label: '反弹起点', kind: 'bull' },
    { index: stall14, label: '反弹滞涨', kind: 'bear' },
  ],
})

console.log(
  [
    `14-chips-profile.json：${rebound14.length} 根先跌后涨行情（流通 ${FLOAT14 / 1e4} 万股、桶宽 0.1 元），底部日 ${bottomDay14.date} vs 反弹末日 ${endDay14.date} 两条分布轮廓同框——末日峰 ${round2(final14.peak.price)} 元压着 ${(final14.peak.quantity / FLOAT14 * 100).toFixed(1)}% 筹码（收盘 ${final14.close} 元）`,
    `14-winner-ratio.json：获利盘从顶部 ~${(chips14[top14].winnerRatio * 100).toFixed(0)}% 跌到底部 ${bottomDay14.date} 的 ${(bottomDay14.winnerRatio * 100).toFixed(1)}%，反弹末日回到 ${(final14.winnerRatio * 100).toFixed(1)}%——头顶仍有 ${(final14.trappedRatio * 100).toFixed(1)}% 套牢盘`,
    `14-rebound.json：高位密集区第 ${top14 + 1} 根（高 ${rebound14[top14].high}）、反弹起点第 ${trough14 + 1} 根（低 ${rebound14[trough14].low}）、滞涨第 ${stall14 + 1} 根（高 ${rebound14[stall14].high}，距峰 ${round2(final14.peak.price)} 还有 ${(final14.peak.price - rebound14[stall14].high).toFixed(2)} 元）；平均成本从 ${round2(chips14[0].averageCost)} 挪到 ${round2(final14.averageCost)}`,
  ].join('\n'),
)

// —— 第 15 章图表：反转结构。两张结构图（头肩顶、双顶）+ 一张缺口图 ——
// 结构图行情由 pathSeries 生成（第 13 章同款路径合成器，固定种子）：峰与谷的落点被目标价位钉住。
// 结构、颈线、破位日、量度目标全部出自 src/levels/structures.ts 的 detectStructures 真实计算；
// 颈线与目标线用「等值序列」铺在叠加层上（只铺结构存活的那一段），标记不手标。
// 缺口图的行情是手工设计的剧本（价格真空必须整段手工排布，路径合成器画不出缺口），
// 三处缺口由本段的小扫描器逐对核对「今日低点高于昨日高点」后定位——缺口识别不进 src（非本章 milestone）。

const TOL15 = 0.25 // 显式同水平容差（与第 13 章图上 LV_TOL 同理：合成行情振幅小，默认容差偏紧）

/** 水平段叠加层：from 到 to 铺同一价位，其余为 null */
const flatLine15 = (len: number, from: number, to: number, price: number): (number | null)[] =>
  Array.from({ length: len }, (_, i) => (i >= from && i <= to ? round2(price) : null))

// 图一：头肩顶。六段路径：上到左肩、回撤左谷、冲头、跌右谷、弱反右肩、破线下行收在量度目标附近
const hsWalk = pathSeries(createRng(1501), 9.4, [
  { target: 10.6, bars: 8 }, // 左肩：涨势里一次正常的新高
  { target: 9.8, bars: 7 }, // 左谷：回撤到前一段的支撑带
  { target: 11.4, bars: 9 }, // 头：最后的冲锋，量度目标的高度从它量起
  { target: 9.85, bars: 8 }, // 右谷：第二次回撤，颈线的第二个锚
  { target: 10.75, bars: 6 }, // 右肩：弱反，肩低于头
  { target: 8.3, bars: 9 }, // 破线下行，收在量度目标附近
])
const hsFound = detectStructures(hsWalk, { tol: TOL15 })
const hs15 = hsFound.find((s) => s.id === 'head-and-shoulders')
if (hsFound.length !== 1 || !hs15) {
  throw new Error(`第 15 章头肩段检出 ${JSON.stringify(hsFound)}——期望恰好一个头肩顶，换一颗种子再试`)
}
const [ls15, a15, head15, b15, rs15] = hs15.indices
if (hsWalk[hs15.breakIndex].close >= hs15.neckline) {
  throw new Error('头肩破位根收盘不低于颈线——破位读数自相矛盾')
}
if (head15 >= rs15 || head15 <= ls15) {
  throw new Error('头的下标不在两肩之间——骨架顺序不对')
}
const hsHeight = hsWalk[head15].high - hs15.neckline
if (hsHeight < 1.2) {
  throw new Error(`头肩结构高度只有 ${round2(hsHeight)} 元（需 ≥1.2）——头不够高，换一颗种子再试`)
}
if (Math.abs(hsWalk[hsWalk.length - 1].close - hs15.target) > 0.5) {
  throw new Error(`末根收盘 ${hsWalk[hsWalk.length - 1].close} 离量度目标 ${round2(hs15.target)} 超过 0.5 元——行程设计不对`)
}
writeJson('15-head-shoulders.json', {
  candles: hsWalk,
  overlays: [
    { name: `颈线 ${round2(hs15.neckline)}`, values: flatLine15(hsWalk.length, a15, hsWalk.length - 1, hs15.neckline) },
    { name: `量度目标 ${round2(hs15.target)}`, values: flatLine15(hsWalk.length, hs15.breakIndex, hsWalk.length - 1, hs15.target) },
  ],
  markers: [
    { index: ls15, label: '左肩', kind: 'info' },
    { index: head15, label: '头', kind: 'info' },
    { index: rs15, label: '右肩', kind: 'info' },
    { index: hs15.breakIndex, label: '收盘跌破颈线', kind: 'bear' },
  ],
})

// 图二：双顶。四段路径：上到第一顶、回落中间谷、二攻同一价位失败、破线下行
const dtWalk = pathSeries(createRng(1502), 9.6, [
  { target: 10.6, bars: 8 }, // 第一顶
  { target: 9.3, bars: 7 }, // 中间谷：未来的颈线
  { target: 10.6, bars: 8 }, // 第二顶：同一价位第二次证明有人守
  { target: 8.0, bars: 9 }, // 破线下行到量度目标附近
])
const dtFound = detectStructures(dtWalk, { tol: TOL15 })
const dt15 = dtFound.find((s) => s.id === 'double-top')
if (dtFound.length !== 1 || !dt15) {
  throw new Error(`第 15 章双顶段检出 ${JSON.stringify(dtFound)}——期望恰好一个双顶，换一颗种子再试`)
}
const [p115, mid15, p215] = dt15.indices
if (Math.abs(dtWalk[p115].high - dtWalk[p215].high) > TOL15) {
  throw new Error(`两峰高点 ${dtWalk[p115].high}/${dtWalk[p215].high} 差超过容差 ${TOL15}——「同水平」前提被破坏`)
}
if (dtWalk[dt15.breakIndex].close >= dt15.neckline) {
  throw new Error('双顶破位根收盘不低于颈线——破位读数自相矛盾')
}
if (Math.abs(dtWalk[dtWalk.length - 1].close - dt15.target) > 0.5) {
  throw new Error(`末根收盘 ${dtWalk[dtWalk.length - 1].close} 离量度目标 ${round2(dt15.target)} 超过 0.5 元——行程设计不对`)
}
writeJson('15-double-top.json', {
  candles: dtWalk,
  overlays: [
    { name: `颈线 ${round2(dt15.neckline)}`, values: flatLine15(dtWalk.length, mid15, dtWalk.length - 1, dt15.neckline) },
    { name: `量度目标 ${round2(dt15.target)}`, values: flatLine15(dtWalk.length, dt15.breakIndex, dtWalk.length - 1, dt15.target) },
  ],
  markers: [
    { index: p115, label: '峰1', kind: 'info' },
    { index: mid15, label: '颈线谷', kind: 'bull' },
    { index: p215, label: '峰2', kind: 'info' },
    { index: dt15.breakIndex, label: '收盘跌破颈线', kind: 'bear' },
  ],
})

// 图三：缺口三性格。手工剧本：横盘区的普通缺口（很快回补）、放量突破缺口（全程不回补）、
// 急涨末端的衰竭缺口（回补反转）——三处真空段按「今日 low > 昨日 high」逐对核对后才允许落标记
const G = (o: number, h: number, l: number, c: number, v: number): Candle => ({
  date: '',
  open: o,
  high: h,
  low: l,
  close: c,
  volume: v,
})
const gapBars15: Candle[] = [
  G(10.0, 10.15, 9.9, 10.05, 90000),
  G(10.05, 10.2, 9.95, 10.1, 85000),
  G(10.1, 10.25, 10.0, 10.15, 95000),
  G(10.15, 10.2, 10.0, 10.05, 80000),
  G(10.05, 10.2, 9.95, 10.1, 90000),
  G(10.1, 10.25, 10.05, 10.2, 88000),
  G(10.2, 10.25, 10.05, 10.1, 84000),
  G(10.1, 10.15, 9.95, 10.0, 90000),
  G(10.0, 10.15, 9.9, 10.05, 92000),
  G(10.05, 10.25, 10.0, 10.2, 90000),
  G(10.45, 10.55, 10.35, 10.5, 105000), // 第 11 根：普通缺口（真空区 10.25–10.35）
  G(10.5, 10.55, 10.38, 10.42, 95000),
  G(10.42, 10.5, 10.3, 10.35, 90000),
  G(10.35, 10.38, 10.05, 10.1, 88000), // 回补：low 10.05 走完真空区
  G(10.1, 10.3, 10.0, 10.25, 90000),
  G(10.25, 10.4, 10.15, 10.3, 92000),
  G(10.3, 10.45, 10.2, 10.35, 94000),
  G(10.35, 10.45, 10.25, 10.3, 90000),
  G(10.3, 10.4, 10.2, 10.28, 88000),
  G(10.28, 10.42, 10.22, 10.38, 96000),
  G(10.75, 11.05, 10.7, 11.0, 300000), // 第 21 根：突破缺口（真空区 10.42–10.70），量 3 倍
  G(11.0, 11.25, 10.95, 11.2, 220000),
  G(11.2, 11.4, 11.1, 11.35, 180000),
  G(11.35, 11.55, 11.25, 11.5, 160000),
  G(11.5, 11.6, 11.35, 11.4, 140000),
  G(11.4, 11.65, 11.35, 11.6, 150000),
  G(11.6, 11.85, 11.55, 11.8, 160000),
  G(11.8, 11.95, 11.65, 11.7, 140000),
  G(11.7, 12.0, 11.65, 11.95, 170000),
  G(11.95, 12.15, 11.9, 12.1, 150000),
  G(12.1, 12.25, 12.0, 12.05, 130000),
  G(12.05, 12.4, 12.0, 12.3, 140000),
  G(12.75, 12.88, 12.65, 12.7, 240000), // 第 33 根：衰竭缺口（真空区 12.40–12.65）
  G(12.7, 12.75, 12.45, 12.5, 150000),
  G(12.5, 12.55, 12.2, 12.25, 180000), // 回补：low 12.20 走完真空区
  G(12.25, 12.3, 11.9, 11.95, 200000),
  G(11.95, 12.0, 11.6, 11.65, 170000),
  G(11.65, 11.7, 11.35, 11.4, 160000),
]
const gapDates15 = tradingDates('2026-03-02', gapBars15.length)
const gapWalk = gapBars15.map((c, i) => ({ ...c, date: gapDates15[i] }))

/** 缺口扫描（导出段教学件，不进 src）：今日 low 严格高于昨日 high 记向上缺口，镜像为向下 */
type Gap = { index: number; dir: 'up' | 'down'; top: number; bottom: number }
const gapsOf = (cs: readonly Candle[]): Gap[] => {
  const out: Gap[] = []
  for (let i = 1; i < cs.length; i++) {
    if (cs[i].low > cs[i - 1].high) out.push({ index: i, dir: 'up', top: cs[i].low, bottom: cs[i - 1].high })
    else if (cs[i].high < cs[i - 1].low) out.push({ index: i, dir: 'down', top: cs[i - 1].low, bottom: cs[i].high })
  }
  return out
}
/** 回补扫描：缺口之后第一根 low 触到缺口下沿（把真空区走完）的 K 线 */
const filledAt = (cs: readonly Candle[], gap: Gap): number => {
  for (let i = gap.index + 1; i < cs.length; i++) {
    if (cs[i].low <= gap.bottom) return i
  }
  return -1
}

const gaps15 = gapsOf(gapWalk)
if (gaps15.length !== 3 || gaps15.some((g) => g.dir !== 'up') || gaps15.map((g) => g.index).join(',') !== '10,20,32') {
  throw new Error(`第 15 章缺口段扫出 ${JSON.stringify(gaps15)}——期望恰好三处向上缺口（第 11/21/33 根），检查剧本`)
}
const [commonGap15, breakGap15, exhaustGap15] = gaps15
const commonFill15 = filledAt(gapWalk, commonGap15)
const exhaustFill15 = filledAt(gapWalk, exhaustGap15)
if (commonFill15 < 0 || commonFill15 > 14) {
  throw new Error(`普通缺口在第 ${commonFill15 + 1} 根才回补——「震荡区内几天就补」的故事线不成立`)
}
if (filledAt(gapWalk, breakGap15) !== -1) {
  throw new Error('突破缺口被回补——「不回补」的故事线被破坏')
}
if (exhaustFill15 < 33 || exhaustFill15 > 36) {
  throw new Error(`衰竭缺口在第 ${exhaustFill15 + 1} 根回补——「很快回补并反转」的故事线不成立`)
}
if (gapWalk[gapWalk.length - 1].close >= exhaustGap15.bottom) {
  throw new Error('结尾收盘没有离开衰竭缺口下方——反转故事线不成立')
}
const volBefore15 = (i: number): number => {
  let sum = 0
  for (let j = i - 5; j < i; j++) sum += gapWalk[j].volume
  return sum / 5
}
if (gapWalk[breakGap15.index].volume < 2.5 * volBefore15(breakGap15.index)) {
  throw new Error('突破缺口量能不足前五日均量 2.5 倍——「放量突破」的教学点不成立')
}
writeJson('15-gaps.json', {
  candles: gapWalk,
  overlays: [],
  markers: [
    { index: commonGap15.index, label: '普通缺口', kind: 'info' },
    { index: commonFill15, label: '三日后回补', kind: 'info' },
    { index: breakGap15.index, label: `突破缺口·${(gapWalk[breakGap15.index].volume / volBefore15(breakGap15.index)).toFixed(1)}×量`, kind: 'bull' },
    { index: exhaustGap15.index, label: '衰竭缺口', kind: 'bear' },
    { index: exhaustFill15, label: '回补反转', kind: 'bear' },
  ],
})

console.log(
  [
    `15-head-shoulders.json：${hsWalk.length} 根路径合成行情，detectStructures 检出头肩顶——左肩第 ${ls15 + 1} 根（高 ${hsWalk[ls15].high}）、头第 ${head15 + 1} 根（高 ${hsWalk[head15].high}）、右肩第 ${rs15 + 1} 根（高 ${hsWalk[rs15].high}）`,
    `  颈线 =（左谷 ${hsWalk[a15].low} + 右谷 ${hsWalk[b15].low}）÷2 = ${hs15.neckline}，第 ${hs15.breakIndex + 1} 根收盘 ${hsWalk[hs15.breakIndex].close} 首次跌破；量度目标 = 2×${hs15.neckline} − ${hsWalk[head15].high} = ${round2(hs15.target)}（结构高度 ${Math.round(hsHeight * 1000) / 1000}），末根收 ${hsWalk[hsWalk.length - 1].close}`,
    `15-double-top.json：${dtWalk.length} 根行情检出双顶——峰1 第 ${p115 + 1} 根（高 ${dtWalk[p115].high}）、峰2 第 ${p215 + 1} 根（高 ${dtWalk[p215].high}，同水平差 ${Math.abs(dtWalk[p115].high - dtWalk[p215].high).toFixed(2)} ≤ ${TOL15}）；颈线（中间谷低点）${round2(dt15.neckline)}，第 ${dt15.breakIndex + 1} 根收盘 ${dtWalk[dt15.breakIndex].close} 跌破，目标 ${round2(dt15.target)}，末根收 ${dtWalk[dtWalk.length - 1].close}`,
    `15-gaps.json：${gapWalk.length} 根手工剧本，扫描器扫出三处向上缺口（第 11/21/33 根）——普通缺口 ${round2(commonGap15.bottom)}–${round2(commonGap15.top)} 第 ${commonFill15 + 1} 根回补；突破缺口 ${round2(breakGap15.bottom)}–${round2(breakGap15.top)} 量 ${(gapWalk[breakGap15.index].volume / volBefore15(breakGap15.index)).toFixed(1)}×、全程不回补；衰竭缺口 ${round2(exhaustGap15.bottom)}–${round2(exhaustGap15.top)} 第 ${exhaustFill15 + 1} 根回补反转`,
  ].join('\n'),
)

// —— 第 16 章图表：MACD 与背离。四张图：动量回合（K线+金叉死叉标记）、MACD 副图
// （LineChart：DIF/DEA 双线加柱）、顶背离构造的行情图、同一段行情的 DIF 图 ——
// 行情由 pathSeries 生成（第 13 章同款路径合成器，固定种子）；暖机段手工排平（jit=0）：
// EMA26/DEA9 成形之前既不冒噪声枢轴、也不冒噪声交叉。全部读数出自 src/indicators/macd.ts
// 的真实计算；背离标记来自 detectDivergence 的真实扫描。金叉死叉标记是导出段教学扫描
// （hist 的正负就是 DIF 与 DEA 的高低，判据与第 11 章 crossovers 同款：前一根不高于/不低于、
// 当根严格穿越）——不进 src，非本章 milestone。

/** MACD 线的取整：null 透传（r4 只吃 number） */
const r4n = (v: number | null): number | null => (v == null ? null : r4(v))

/** MACD 金叉死叉教学扫描：柱翻正=金叉（DIF 上穿 DEA）、翻负=死叉（下穿），零线上穿下穿同判 */
const macdCrosses16 = (hist: readonly (number | null)[]): Marker[] => {
  const out: Marker[] = []
  for (let i = 1; i < hist.length; i++) {
    const prev = hist[i - 1]
    const cur = hist[i]
    if (prev == null || cur == null) continue
    if (cur > 0 && prev <= 0) out.push({ index: i, label: '金叉', kind: 'bull' })
    else if (cur < 0 && prev >= 0) out.push({ index: i, label: '死叉', kind: 'bear' })
  }
  return out
}

// 图一/图二：动量的一整个回合。暖机 36 根排平后：陡升 6 根（动量冲顶）→ 缓升 10 根
// （价格还在爬、推力已卸——柱峰先于价峰）→ 回落 14 根（DIF 掉头、柱翻绿、死叉迟到）→ 缓住收尾
const warm16 = pathSeries(createRng(1601), 10.0, [{ target: 10.0, bars: 36 }], 0)
const move16 = pathSeries(createRng(1602), 10.0, [
  { target: 11.4, bars: 6 },
  { target: 12.0, bars: 10 },
  { target: 10.2, bars: 14 },
  { target: 10.3, bars: 6 },
])
const roundDates16 = tradingDates('2026-03-02', warm16.length + move16.length)
const round16 = [...warm16, ...move16].map((k, i) => ({ ...k, date: roundDates16[i] }))
const macd16 = macd(round16)
const crosses16 = macdCrosses16(macd16.hist)
if (crosses16.length !== 2) {
  throw new Error(`第 16 章回合段扫出 ${JSON.stringify(crosses16)}——期望恰好金叉、死叉各一次，换一颗种子再试`)
}
const golden16 = crosses16.find((m) => m.kind === 'bull')!
const dead16 = crosses16.find((m) => m.kind === 'bear')!
let histPeak16 = -1
for (let i = 0; i < macd16.hist.length; i++) {
  if (macd16.hist[i] != null && (histPeak16 < 0 || (macd16.hist[i] ?? 0) > (macd16.hist[histPeak16] ?? 0))) histPeak16 = i
}
let top16 = 0
for (let i = 1; i < round16.length; i++) {
  if (round16[i].high > round16[top16].high) top16 = i
}
if (!(histPeak16 < top16 && top16 < dead16.index)) {
  throw new Error(`柱峰第 ${histPeak16 + 1} 根、山顶第 ${top16 + 1} 根、死叉第 ${dead16.index + 1} 根——「柱峰先于价峰、死叉迟于山顶」的故事线不成立，换一颗种子再试`)
}
if (macd16.dif[macd16.dif.length - 1]! >= 0) {
  throw new Error('回合段结尾 DIF 没有跌回零轴之下——死叉后的图面不完整')
}
writeJson('16-macd-round.json', {
  candles: round16,
  overlays: [],
  markers: [golden16, { index: histPeak16, label: '柱峰', kind: 'info' }, { index: top16, label: '山顶', kind: 'info' }, dead16],
})
writeJson('16-macd-panel.json', {
  series: [
    { name: 'DIF', values: macd16.dif.map(r4n) },
    { name: 'DEA', values: macd16.dea.map(r4n) },
    { name: '柱（DIF−DEA）', values: macd16.hist.map(r4n) },
  ],
  labels: round16.map((k) => k.date),
})

// 图三/图四：顶背离构造。急涨 10 根见峰1（每天约 +0.3 元，DIF 冲上高位）→ 深回撤 →
// 慢爬 22 根见峰2（每天约 +0.1 元，价格新高、DIF 只到半山腰）→ 掉头收尾。
// 背离标记来自 detectDivergence 的真实扫描；峰1 标记取背离事件自带的 prevIndex，不手标
const divWarm16 = pathSeries(createRng(1611), 10.0, [{ target: 10.0, bars: 36 }], 0)
const divMove16 = pathSeries(createRng(1612), 10.0, [
  { target: 13.0, bars: 10 },
  { target: 11.4, bars: 7 },
  { target: 13.5, bars: 22 },
  { target: 12.9, bars: 6 },
])
const divDates16 = tradingDates('2026-03-02', divWarm16.length + divMove16.length)
const div16 = [...divWarm16, ...divMove16].map((k, i) => ({ ...k, date: divDates16[i] }))
const divMacd16 = macd(div16)
const divEvents16 = detectDivergence(div16, divMacd16)
if (divEvents16.length !== 1 || divEvents16[0]!.kind !== 'top') {
  throw new Error(`第 16 章背离段扫出 ${JSON.stringify(divEvents16)}——期望恰好一处顶背离，换一颗种子再试`)
}
const divTop16 = divEvents16[0]!
if (divTop16.price <= divTop16.prevPrice || divTop16.dif >= divTop16.prevDif) {
  throw new Error('背离读数自相矛盾：价格未新高或 DIF 未回落')
}
if (divTop16.dif > 0.75 * divTop16.prevDif) {
  throw new Error(`DIF 第二峰只矮到第一峰的 ${(divTop16.dif / divTop16.prevDif * 100).toFixed(0)}%（期望 ≤75%）——「半山腰」的图面不显，换一颗种子再试`)
}
const trough16 = pivots(div16).find((p) => p.side === 'low' && p.index > divTop16.prevIndex && p.index < divTop16.index)
if (!trough16) throw new Error('两峰之间没有谷枢轴——构造段不成立')
writeJson('16-divergence.json', {
  candles: div16,
  overlays: [],
  markers: [
    { index: divTop16.prevIndex, label: '峰1', kind: 'info' },
    { index: trough16.index, label: '回撤谷', kind: 'bull' },
    { index: divTop16.index, label: '峰2·顶背离', kind: 'bear' },
  ],
})
writeJson('16-divergence-dif.json', {
  series: [
    { name: 'DIF', values: divMacd16.dif.map(r4n) },
    { name: 'DEA', values: divMacd16.dea.map(r4n) },
  ],
  labels: div16.map((k) => k.date),
})

console.log(
  [
    `16-macd-round.json：${round16.length} 根（前 ${warm16.length} 根暖机排平）——金叉第 ${golden16.index + 1} 根、柱峰第 ${histPeak16 + 1} 根（${r4(macd16.hist[histPeak16]!)}）、山顶第 ${top16 + 1} 根（高 ${round16[top16].high}）、死叉第 ${dead16.index + 1} 根；柱峰领先山顶 ${top16 - histPeak16} 根，死叉比山顶迟到 ${dead16.index - top16} 根`,
    `16-macd-panel.json：同一段行情的副图——DIF 自第 ${macd16.dif.findIndex((v) => v != null) + 1} 根、DEA 与柱自第 ${macd16.dea.findIndex((v) => v != null) + 1} 根成形；DIF 峰 ${r4(Math.max(...macd16.dif.filter((v): v is number => v != null)))}、结尾 DIF ${r4(macd16.dif[macd16.dif.length - 1]!)}`,
    `16-divergence.json / 16-divergence-dif.json：峰1 第 ${divTop16.prevIndex + 1} 根高 ${round2(divTop16.prevPrice)}（DIF ${r4(divTop16.prevDif)}）、峰2 第 ${divTop16.index + 1} 根高 ${round2(divTop16.price)}（DIF ${r4(divTop16.dif)}）——价格高 ${round2(divTop16.price - divTop16.prevPrice)} 元（+${((divTop16.price / divTop16.prevPrice - 1) * 100).toFixed(1)}%），DIF 只剩第一峰的 ${(divTop16.dif / divTop16.prevDif * 100).toFixed(0)}%；标记由 detectDivergence 扫出（全序列恰好这一处背离）`,
  ].join('\n'),
)

// —— 第 17 章图表：RSI 与 KDJ。五张图：强势股全程主图（RSI 80 清仓点对山顶）、
// RSI 副图（70/30 刻度线）、KDJ 副图（K/D/J 三线 + 80/20 刻度线）、钝化窗口的
// 行情与指标对照（切片视图，指标仍按全序列计算后切片——读数带全历史，不是重算）。
// 行情由 pathSeries 生成（第 13 章同款路径合成器，固定种子）：20 根排平暖机
// （RSI 与 KDJ 都从不偏不倚的 50 起步）→ 28 根强势拉升 → 14 根回落。
// 全部读数出自 src/indicators/rsi.ts 与 src/indicators/kdj.ts 的真实计算；
// K/D 金叉死叉标记与钝化区间是导出段教学扫描（判据与第 11 章 crossovers 同款：
// 前一根不高于/不低于、当根严格穿越）——不进 src，非本章 milestone。

/** RSI 取两位小数：null 透传 */
const r2n = (v: number | null): number | null => (v == null ? null : round2(v))

/** KDJ 金叉死叉教学扫描：K 上穿/下穿 D——判据与第 11 章 crossovers 同款 */
const kdCrosses17 = (k: readonly (number | null)[], d: readonly (number | null)[]): { index: number; kind: 'golden' | 'dead' }[] => {
  const out: { index: number; kind: 'golden' | 'dead' }[] = []
  for (let i = 1; i < k.length; i++) {
    const kP = k[i - 1]
    const dP = d[i - 1]
    const kN = k[i]
    const dN = d[i]
    if (kP == null || dP == null || kN == null || dN == null) continue
    if (kN > dN && kP <= dP) out.push({ index: i, kind: 'golden' })
    else if (kN < dN && kP >= dP) out.push({ index: i, kind: 'dead' })
  }
  return out
}

const warm17 = pathSeries(createRng(1701), 10.0, [{ target: 10.0, bars: 20 }], 0.02)
const move17 = pathSeries(createRng(1702), 10.0, [
  { target: 13.6, bars: 28 },
  { target: 11.4, bars: 14 },
], 0.045)
const dates17 = tradingDates('2026-03-02', warm17.length + move17.length)
const rally17 = [...warm17, ...move17].map((k, i) => ({ ...k, date: dates17[i] }))
const rsi17 = rsi(rally17) // 默认窗口 14
const kdj17 = kdj(rally17) // 默认窗口 9

// 守门：痛点故事线必须机械成立，否则换一颗种子重试
const firstOb17 = rsi17.findIndex((v) => v != null && v >= RSI_LEVELS.strong) // RSI 首次 ≥ 80
let top17 = 0
for (let i = 1; i < rally17.length; i++) if (rally17[i].high > rally17[top17].high) top17 = i
let stallEnd17 = firstOb17
while (stallEnd17 + 1 < rally17.length && (rsi17[stallEnd17 + 1] ?? 0) >= RSI_LEVELS.strong) stallEnd17++
const obGains17: number[] = []
for (let i = firstOb17 + 1; i <= stallEnd17; i++) {
  if (i < rally17.length) obGains17.push(rally17[i].high - rally17[i - 1].high)
}
const crosses17 = kdCrosses17(kdj17.k, kdj17.d)
const obDead17 = crosses17.filter((c) => c.kind === 'dead' && c.index > firstOb17 && c.index <= top17)
const missPct17 = (rally17[top17].high / rally17[firstOb17].close - 1) * 100
const kMinOb17 = Math.min(...kdj17.k.slice(firstOb17, stallEnd17 + 1).filter((v): v is number => v != null))
const jMaxRally17 = Math.max(...kdj17.j.slice(warm17.length, top17 + 1).filter((v): v is number => v != null))
const jMinCrack17 = Math.min(...kdj17.j.slice(top17).filter((v): v is number => v != null))
let below50_17 = -1
for (let i = top17; i < rally17.length; i++) if ((rsi17[i] ?? 100) < 50) { below50_17 = i; break }
if (firstOb17 < 0 || firstOb17 <= warm17.length) {
  throw new Error(`第 17 章：RSI 首次 ≥80 落在第 ${firstOb17 + 1} 根（应在拉升段内），换一颗种子再试`)
}
if (missPct17 < 10) {
  throw new Error(`第 17 章：清仓点之后只涨了 ${missPct17.toFixed(1)}%——「强势股涨到 95」的踏空故事不显，换一颗种子再试`)
}
if (stallEnd17 - firstOb17 + 1 < 15) {
  throw new Error(`第 17 章：RSI 连续 ≥80 只有 ${stallEnd17 - firstOb17 + 1} 根——钝化区间不够长，换一颗种子再试`)
}
if (kMinOb17 < 70) {
  throw new Error(`第 17 章：钝化区间内 K 最低到 ${round2(kMinOb17)}——KDJ 高位粘滞不成立，换一颗种子再试`)
}
if (obDead17.length < 1) {
  throw new Error('第 17 章：超买区内一次 K/D 死叉都没有——「金叉买完就死叉」无图面，换一颗种子再试')
}
if ((rsi17[rsi17.length - 1] ?? 100) >= 45) {
  throw new Error('第 17 章：回落段结尾 RSI 没有跌回 45 之下——「钝化只在单边」的对照组不完整')
}
if (!(jMaxRally17 > 100 && jMinCrack17 < 0)) {
  throw new Error(`第 17 章：J 最大 ${round2(jMaxRally17)}、最小 ${round2(jMinCrack17)}——「J 冲出 0~100」两侧都要有图面，换一颗种子再试`)
}
if (below50_17 < 0) throw new Error('第 17 章：回落段没有 RSI 跌破 50 的刻度点')

// 图一：强势股全程。标记：80 清仓点（bear）、超买区死叉（bear）、山顶（info）、RSI 跌破 50（info）
writeJson('17-strong-rally.json', {
  candles: rally17,
  overlays: [],
  markers: [
    { index: firstOb17, label: 'RSI 首上 80·清仓点', kind: 'bear' },
    { index: obDead17[0]!.index, label: '超买区死叉', kind: 'bear' },
    { index: top17, label: `山顶 ${round2(rally17[top17].high)}`, kind: 'info' },
    { index: below50_17, label: 'RSI 跌破 50', kind: 'info' },
  ],
})
// 图二：RSI 副图。70/30 刻度线只在 RSI 成形段画（等值序列，与指标同 null 段）
writeJson('17-rsi-panel.json', {
  series: [
    { name: 'RSI(14)', values: rsi17.map(r2n) },
    { name: '超买 70', values: rsi17.map((v) => (v == null ? null : 70)), color: '#adb5bd' },
    { name: '超卖 30', values: rsi17.map((v) => (v == null ? null : 30)), color: '#adb5bd' },
  ],
  labels: rally17.map((k) => k.date),
})
// 图三：KDJ 副图。K/D/J 三线 + 80/20 刻度线（J 冲出上界的那一下是重点）
writeJson('17-kdj-panel.json', {
  series: [
    { name: 'K', values: kdj17.k.map(r2n) },
    { name: 'D', values: kdj17.d.map(r2n) },
    { name: 'J', values: kdj17.j.map(r2n) },
    { name: '超买 80', values: kdj17.k.map((v) => (v == null ? null : 80)), color: '#adb5bd' },
    { name: '超卖 20', values: kdj17.k.map((v) => (v == null ? null : 20)), color: '#adb5bd' },
  ],
  labels: rally17.map((k) => k.date),
})

// 图四/图五：钝化对照（切片窗口：首上 80 前三根 → 结尾）。指标按全序列算好后切片，
// 每个读数都带着完整历史——切片只是把镜头推近，不是从头重算
const s0_17 = firstOb17 - 3
const win17 = rally17.slice(s0_17)
const rsiWin17 = rsi17.slice(s0_17)
const kWin17 = kdj17.k.slice(s0_17)
const dWin17 = kdj17.d.slice(s0_17)
writeJson('17-stall-kline.json', {
  candles: win17,
  overlays: [],
  markers: [
    { index: firstOb17 - s0_17, label: '首上 80', kind: 'bear' },
    { index: top17 - s0_17, label: `山顶 ${round2(rally17[top17].high)}`, kind: 'info' },
    { index: below50_17 - s0_17, label: 'RSI 跌破 50', kind: 'info' },
  ],
})
writeJson('17-stall-indicators.json', {
  series: [
    { name: 'RSI(14)', values: rsiWin17.map(r2n) },
    { name: 'K', values: kWin17.map(r2n) },
    { name: 'D', values: dWin17.map(r2n) },
    { name: '80 刻度', values: rsiWin17.map((v) => (v == null ? null : 80)), color: '#adb5bd' },
  ],
  labels: win17.map((k) => k.date),
})

// 响应速度刻度：回落段里单日跌幅最大的那根，三把尺各自的位移（正文同源差异演算的素材）
let worst17 = top17 + 1
for (let i = top17 + 1; i < rally17.length; i++) {
  if (rally17[i].close - rally17[i - 1].close < rally17[worst17].close - rally17[worst17 - 1].close) worst17 = i
}
const dRsi17 = rsi17[worst17]! - rsi17[worst17 - 1]!
const dK17 = kdj17.k[worst17]! - kdj17.k[worst17 - 1]!
const dJ17 = kdj17.j[worst17]! - kdj17.j[worst17 - 1]!

console.log(
  [
    `17-strong-rally.json：${rally17.length} 根（前 ${warm17.length} 根排平暖机）——RSI 首上 80 第 ${firstOb17 + 1} 根（收 ${round2(rally17[firstOb17].close)}），山顶第 ${top17 + 1} 根高 ${round2(rally17[top17].high)}，清仓后再涨 ${missPct17.toFixed(1)}%；RSI 连续 ≥80 共 ${stallEnd17 - firstOb17 + 1} 根（第 ${firstOb17 + 1}~${stallEnd17 + 1} 根），区间内 K 最低 ${round2(kMinOb17)}；结尾 RSI ${round2(rsi17[rsi17.length - 1]!)}`,
    `17-rsi-panel.json / 17-kdj-panel.json：同一段行情的两张副图——K/D 金叉死叉共 ${crosses17.length} 次，其中超买区（首上 80 到山顶）死叉 ${obDead17.length} 次（第 ${obDead17.map((c) => c.index + 1).join('/')} 根）；J 在拉升段最高 ${round2(jMaxRally17)}、回落段最低 ${round2(jMinCrack17)}`,
    `17-stall-kline.json / 17-stall-indicators.json：切片窗口 ${win17.length} 根（第 ${s0_17 + 1} 根起）——行情与 RSI/K/D 同轴对照，第 ${below50_17 + 1} 根 RSI 跌破 50（钝化被回落打破）`,
    `响应速度：回落段最狠一根是第 ${worst17 + 1} 根（跌 ${round2(rally17[worst17 - 1].close - rally17[worst17].close)} 元），当日 RSI 移动 ${round2(dRsi17)}、K 移动 ${round2(dK17)}、J 移动 ${round2(dJ17)}`,
  ].join('\n'),
)

// —— 第 18 章图表：布林带与波动率。三张图：K线+三线叠加（收口 → 下跌开口 → 反抽中轨）、
// 带宽序列（收口-开口的另一种读法，LineChart）、肥尾实验（正态 vs 尖峰肥尾的累计带外占比）。
// 行情由 pathSeries 生成（第 13 章同款路径合成器，固定种子）；三条带、带宽、收口点、带外占比
// 全部出自 src/indicators/bollinger.ts 与 src/stats/stdev.ts 的真实计算——图上没有一条线是手画的。

// 图一/图二共用行情：50 根横盘收口 → 两段下台阶（第二段更陡，带宽开口）→ 企稳 → 反弹回中轨
const bandWalk18 = pathSeries(createRng(1804), 10.0, [
  { target: 10.0, bars: 50 }, // 横盘：带宽一路收窄——风暴前的安静
  { target: 8.9, bars: 10 }, // 第一段下台阶：缓跌
  { target: 7.3, bars: 8 }, // 第二段更陡：颠簸变大，带子开口，收盘跌出下轨
  { target: 7.4, bars: 10 }, // 企稳：价格回到带内
  { target: 8.2, bars: 14 }, // 反弹：反抽中轨——「下轨不是地板」的对照
], 0.02)
const bb18 = bollinger(bandWalk18)
const sq18 = squeezes(bandWalk18) // 默认 20/2、回看 20 根

// 守门：痛点故事线必须机械成立，否则换一颗种子重试
// 图一的主角收口点取「风暴前最后一个收口点」（下标 < 50）；企稳反弹后带宽还会再收口一轮，
// 那批点（下标 ≥ 70）是图二「再收口」的图面，不当图一主角
const preSq18 = sq18.filter((s) => s.index < 50)
const lastSq18 = preSq18.length > 0 ? preSq18[preSq18.length - 1]! : null
if (!lastSq18 || lastSq18.index < 38) {
  throw new Error(`第 18 章：横盘段没有收口点（最后一个在第 ${lastSq18 ? lastSq18.index + 1 : '无'} 根，期望 39~50）——换一颗种子再试`)
}
const postSq18 = sq18.filter((s) => s.index >= 70)
if (postSq18.length === 0) {
  throw new Error('第 18 章：企稳后没有再收口——「收口→开口→再收口」的完整回合不成立，换一颗种子再试')
}
let breakBelow18 = -1
for (let i = 50; i < bandWalk18.length; i++) {
  if (bandWalk18[i].close < bb18.lower[i]!) { breakBelow18 = i; break }
}
if (breakBelow18 < 0 || breakBelow18 > 68) {
  throw new Error(`第 18 章：下跌段没有收盘跌出下轨（首破在第 ${breakBelow18 + 1} 根，期望 51~69）——换一颗种子再试`)
}
let belowCount18 = 0
for (let i = 50; i < bandWalk18.length; i++) {
  if (bandWalk18[i].close < bb18.lower[i]!) belowCount18++
}
if (belowCount18 < 2) throw new Error(`第 18 章：跌出下轨只有 ${belowCount18} 根——「下轨一路下沉」的图面不成立，换一颗种子再试`)
let bwPeak18 = 19
for (let i = 20; i < bandWalk18.length; i++) {
  if ((bb18.bandwidth[i] ?? 0) > (bb18.bandwidth[bwPeak18] ?? 0)) bwPeak18 = i
}
if (bwPeak18 <= breakBelow18 || bwPeak18 >= 78) {
  throw new Error(`第 18 章：带宽峰值在第 ${bwPeak18 + 1} 根（期望下跌段内、破轨之后）——换一颗种子再试`)
}
if (bb18.bandwidth[bwPeak18]! < 3 * lastSq18.bandwidth) {
  throw new Error(`第 18 章：开口极值 ${round2(bb18.bandwidth[bwPeak18]!)}% 不足收口 ${round2(lastSq18.bandwidth)}% 的 3 倍——收口-开口对比不显，换一颗种子再试`)
}
let low18 = breakBelow18
for (let i = breakBelow18; i < bandWalk18.length; i++) {
  if (bandWalk18[i].close < bandWalk18[low18].close) low18 = i
}
let retest18 = -1
for (let i = low18; i < bandWalk18.length; i++) {
  if (bandWalk18[i].close >= bb18.mid[i]!) { retest18 = i; break }
}
if (retest18 < 0) throw new Error('第 18 章：反弹段没有收盘反抽回中轨——「速度表不是地板」的对照组不完整，换一颗种子再试')
if (bb18.bandwidth[bandWalk18.length - 1]! > bb18.bandwidth[bwPeak18]! / 2) {
  throw new Error('第 18 章：结尾带宽没有收回峰值一半以下——「再收口」的图面不成立，换一颗种子再试')
}

// 图一：K线 + 中轨/上轨/下轨三线叠加。标记：收口点（ squeezes 扫出）、首根收盘破下轨、
// 开口极值（带宽 argmax）、反抽中轨——破轨点与收口点都是计算结果，不手标
writeJson('18-bands.json', {
  candles: bandWalk18,
  overlays: [
    { name: '中轨 MA20', values: bb18.mid.map(rnd) },
    { name: '上轨 +2σ', values: bb18.upper.map(rnd) },
    { name: '下轨 −2σ', values: bb18.lower.map(rnd) },
  ],
  markers: [
    { index: lastSq18.index, label: `收口 ${round2(lastSq18.bandwidth)}%`, kind: 'info' },
    { index: breakBelow18, label: '收盘破下轨', kind: 'bear' },
    { index: bwPeak18, label: `开口极值 ${round2(bb18.bandwidth[bwPeak18]!)}%`, kind: 'info' },
    { index: retest18, label: '反抽中轨', kind: 'bull' },
  ],
})

// 图二：同一行情的带宽序列——上图的三条带子，这里压成一条线；灰线是收口当天的水位
writeJson('18-bandwidth.json', {
  series: [
    { name: '带宽（(上轨−下轨)÷中轨）', values: bb18.bandwidth.map((v) => (v == null ? null : round2(v))) },
    { name: '收口水位', values: bb18.bandwidth.map((v) => (v == null ? null : round2(lastSq18.bandwidth))), color: '#adb5bd' },
  ],
  labels: bandWalk18.map((k) => k.date),
})

// 图三：肥尾实验。两列各 1500 个读数绕 10 元震荡（把「分布形状」从「趋势」里剥出来）：
// 正态列 normalDraws、尖峰肥尾列 leptokurticDraws（88% 的日子小波动 + 12% 的日子大跳，
// 总 σ 被解到与正态列一致）——累计带外占比曲线由 bollinger 逐格算出，每根读数带着全历史
const EXP_N18 = 1500
const EXP_SIGMA18 = 0.15
const drawsN18 = normalDraws(createRng(1822), EXP_N18, EXP_SIGMA18)
const drawsF18 = leptokurticDraws(createRng(1822), EXP_N18, EXP_SIGMA18)
/** 一列读数包成绕 base 震荡的 K 线：开盘嵌昨收、影线各让一分——布林带只看收盘 */
const statBars18 = (draws: readonly number[], base = 10): Candle[] =>
  draws.map((d, i) => {
    const close = base + d
    const open = i === 0 ? base : base + draws[i - 1]!
    return { date: '', open, high: round2(Math.max(open, close) + 0.01), low: round2(Math.min(open, close) - 0.01), close, volume: 1000 }
  })
const normalSeries18 = statBars18(drawsN18)
const fatSeries18 = statBars18(drawsF18)
/** 累计带外占比：自第一条带成形起逐格记账，曲线终点必须与 outsideStats 同源 */
const cumOutside18 = (cs: readonly Candle[]): number[] => {
  const { upper, lower } = bollinger(cs)
  let formed = 0
  let outside = 0
  const out: number[] = []
  for (let i = DEFAULT_BB_N - 1; i < cs.length; i++) {
    formed++
    if (cs[i].close > upper[i]! || cs[i].close < lower[i]!) outside++
    out.push(outside / formed)
  }
  return out
}
const curveN18 = cumOutside18(normalSeries18)
const curveF18 = cumOutside18(fatSeries18)
const statN18 = outsideStats(normalSeries18)
const statF18 = outsideStats(fatSeries18)
const sdN18 = stdev(drawsN18)
const sdF18 = stdev(drawsF18)
if (curveN18[curveN18.length - 1] !== statN18.ratio || curveF18[curveF18.length - 1] !== statF18.ratio) {
  throw new Error('第 18 章：累计曲线终点与 outsideStats 的占比不一致——两条算路必须同源')
}
if (Math.abs(sdF18 - sdN18) > 0.1 * sdN18) {
  throw new Error(`第 18 章：两列总标准差 ${round2(sdN18)} 对 ${round2(sdF18)}——公平对照前提被破坏，换一颗种子再试`)
}
if (statN18.ratio < 0.03 || statN18.ratio > 0.065) {
  throw new Error(`第 18 章：正态列带外占比 ${round2(statN18.ratio * 100)}%（期望约 4%~5%）——换一颗种子再试`)
}
if (statF18.ratio < statN18.ratio + 0.02 || statF18.ratio < 1.6 * statN18.ratio) {
  throw new Error(`第 18 章：肥尾列 ${round2(statF18.ratio * 100)}% 对正态列 ${round2(statN18.ratio * 100)}%——差距不够显著，换一颗种子再试`)
}
const maxAbs18 = (xs: readonly number[]): number => xs.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)
writeJson('18-fat-tails.json', {
  series: [
    { name: '正态序列累计带外占比', values: curveN18.map((v) => Math.round(v * 1e4) / 1e4) },
    { name: '尖峰肥尾序列累计带外占比', values: curveF18.map((v) => Math.round(v * 1e4) / 1e4) },
    { name: '5% 参考线', values: curveN18.map(() => 0.05), color: '#adb5bd' },
  ],
  labels: curveN18.map((_, k) => `第${k + DEFAULT_BB_N}根`),
})

console.log(
  [
    `18-bands.json：${bandWalk18.length} 根（前 50 根横盘收口）——收口点第 ${lastSq18.index + 1} 根（带宽 ${round2(lastSq18.bandwidth)}%）、首根收盘破下轨第 ${breakBelow18 + 1} 根（收 ${round2(bandWalk18[breakBelow18].close)}，下轨 ${round2(bb18.lower[breakBelow18]!)}）、全程收盘在下轨之下 ${belowCount18} 根、开口极值第 ${bwPeak18 + 1} 根（${round2(bb18.bandwidth[bwPeak18]!)}%，收口水位的 ${round2(bb18.bandwidth[bwPeak18]! / lastSq18.bandwidth)} 倍）、价格最低第 ${low18 + 1} 根（${round2(bandWalk18[low18].close)}）、反抽中轨第 ${retest18 + 1} 根`,
    `18-bandwidth.json：同一行情的带宽序列——收口 ${round2(lastSq18.bandwidth)}% → 开口 ${round2(bb18.bandwidth[bwPeak18]!)}% → 企稳后再收口（新收口点第 ${postSq18.map((s) => s.index + 1).join('/')} 根，最深 ${round2(postSq18[postSq18.length - 1]!.bandwidth)}%）→ 结尾 ${round2(bb18.bandwidth[bandWalk18.length - 1]!)}%（峰值的一半以下）`,
    `18-fat-tails.json：两列各 ${EXP_N18} 个读数、总 σ 同为 ${round2(sdN18)}（肥尾列 ${round2(sdF18)}）——正态列带外 ${statN18.outside}/${statN18.formed} = ${round2(statN18.ratio * 100)}%（上 ${statN18.above}/下 ${statN18.below}），肥尾列 ${statF18.outside}/${statF18.formed} = ${round2(statF18.ratio * 100)}%，为正态列的 ${round2(statF18.ratio / statN18.ratio)} 倍；最大单日读数：正态列 ${round2(maxAbs18(drawsN18))}（${round2(Math.abs(maxAbs18(drawsN18)) / EXP_SIGMA18)}σ）、肥尾列 ${round2(maxAbs18(drawsF18))}（${round2(Math.abs(maxAbs18(drawsF18)) / EXP_SIGMA18)}σ）`,
  ].join('\n'),
)

// —— 第 19 章图表：同一元利润、不同增速下的回本年数（LineChart）。数据不是行情，是本章
// 演算的确定性公式输出：每股盈利恒为 1 元（今年就赚 1 元，此后每年按增速复利），买入价
// 15 元（PE 15）与 30 元（PE 30）两条线，利润增速从 −20% 到 +40% 每 5% 一档——每档解
// 「累计利润首次追上买入价」的年数；追不上（未来全部利润加起来都不够买入价）记 null，
// 线在那一段断开。正文按「演算示意」如实交代：图上没有一根线来自行情，每档可纸笔复算。

/** 每股盈利从 1 元起步、此后每年按 g 复利：n 年累计利润（元）。首年就是当下的 1 元，
 *  所以零增速时累计 = n——PE 的字面义「按现在利润几年回本」由此成立 */
const cumProfit19 = (g: number, n: number): number => {
  let sum = 0
  let e = 1
  for (let k = 1; k <= n; k++) {
    sum += e
    e *= 1 + g
  }
  return sum
}

/** 回本年数：累计利润首次 ≥ 买入价的最小年数；100 年内追不上记 null（永不回本） */
const payback19 = (price: number, g: number): number | null => {
  for (let n = 1; n <= 100; n++) {
    if (cumProfit19(g, n) >= price) return n
  }
  return null
}

// 守门：正文引用的读数逐个钉死，错一处整段导出失败
if (payback19(30, 0) !== 30 || payback19(15, 0) !== 15) {
  throw new Error('第 19 章：零增速的回本年数不等于 PE 的倍数——「PE=按现在利润几年回本」的字面义被破坏')
}
if (payback19(30, 0.15) !== 13 || payback19(30, 0.3) !== 9) {
  throw new Error('第 19 章：PE 30 在 +15%/+30% 增速下的回本年数不是 13/9——正文演算的锚丢了')
}
if (payback19(15, 0.15) !== 9 || payback19(15, 0.3) !== 7) {
  throw new Error('第 19 章：PE 15 在 +15%/+30% 增速下的回本年数不是 9/7——正文演算的锚丢了')
}
if (payback19(30, -0.2) !== null || payback19(15, -0.2) !== null) {
  throw new Error('第 19 章：−20% 增速下不该有回本年数——排雷样本的算术前提被破坏')
}
if (payback19(30, -0.05) !== null) {
  throw new Error('第 19 章：PE 30 在 −5% 增速下未来总利润只有 20 元，不该有回本年数')
}
if (payback19(15, -0.05) !== 28) {
  throw new Error(`第 19 章：PE 15 在 −5% 增速下的回本年数是 ${payback19(15, -0.05)}（期望 28）——换一条算路核对`)
}

const GROWTHS19 = [-0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4]
const fmtG19 = (g: number): string => (g === 0 ? '0%' : g > 0 ? `+${Math.round(g * 100)}%` : `−${Math.round(-g * 100)}%`)
const paybackLine19 = (price: number): (number | null)[] => GROWTHS19.map((g) => payback19(price, g))
const line30 = paybackLine19(30)
const line15 = paybackLine19(15)
// 单调性守门：增速越高回本越快，年数只能持平或下降；null 段只许出现在负增速端
for (const line of [line30, line15]) {
  for (let i = 1; i < line.length; i++) {
    if (line[i - 1] != null && line[i] != null && line[i]! > line[i - 1]!) {
      throw new Error(`第 19 章：回本年数随增速回升（${fmtG19(GROWTHS19[i - 1]!)}→${fmtG19(GROWTHS19[i]!)}）——曲线必须单调不增`)
    }
  }
}
writeJson('19-payback.json', {
  series: [
    { name: 'PE 30（30 元买入）', values: line30 },
    { name: 'PE 15（15 元买入）', values: line15 },
  ],
  labels: GROWTHS19.map(fmtG19),
})

// 闭式核对：累计利润的等比级数公式解与逐笔累加必须一致（两条算路同源，读者纸笔可复算）
for (const g of GROWTHS19) {
  const closed = g === 0 ? 30 : ((1 + g) ** 30 - 1) / g
  if (Math.abs(closed - cumProfit19(g, 30)) > 1e-6 * Math.max(1, Math.abs(closed))) {
    throw new Error(`第 19 章：增速 ${fmtG19(g)} 的闭式解与逐笔累加不一致——演算前提被破坏`)
  }
}

console.log(
  [
    `19-payback.json：每股盈利 1 元、增速 ${GROWTHS19.map(fmtG19).join('/')} 共 ${GROWTHS19.length} 档——PE 30 的回本年数 ${line30.map((v) => v ?? '永不').join('/')}，PE 15 为 ${line15.map((v) => v ?? '永不').join('/')}；增速 −20% 时未来全部利润加总只有 ${cumProfit19(-0.2, 100).toFixed(2)} 元（极限 5 元），两条线在各自的负增速段断开（PE 30 断在 −5% 起、PE 15 断在 −10% 起）`,
  ].join('\n'),
)

// —— 第 20 章图表：期望值、凯利与破产概率（LineChart）。数据不是行情，是风险算术的
// 蒙特卡洛输出：两套参数化策略——痛点策略（胜率 0.6、平均赢 4%、平均亏 12%，期望值
// −2.4%/注）与趋势画像（胜率 0.35、盈亏比 2，期望值 +0.25%/注）。图一：同一正期望
// 策略在全仓 / 凯利仓位 / 半凯利三种仓位下的累计破产概率曲线（各 4000 条平行宇宙、
// 各自固定种子）；图二：痛点策略全仓下注的 8 条资金路径（扇形）。凯利仓位不由手写，
// 由 kellyFraction 现场算出再换算：仓位 = 凯利风险 ÷ 平均亏损。

const PAIN20: EdgeStats = { winRate: 0.6, avgWin: 0.04, avgLoss: 0.12 }
const TREND20: EdgeStats = { winRate: 0.35, avgWin: 0.1, avgLoss: 0.05 }

// 守门：正文引用的算术锚逐个钉死，错一处整段导出失败
if (Math.abs(expectancy(PAIN20) - -0.024) > 1e-12) {
  throw new Error(`第 20 章：痛点策略期望值不是 −0.024（实测 ${expectancy(PAIN20)}）——正文演算的锚丢了`)
}
if (Math.abs(expectancy(TREND20) - 0.0025) > 1e-12) {
  throw new Error(`第 20 章：趋势画像期望值不是 +0.0025（实测 ${expectancy(TREND20)}）——正文演算的锚丢了`)
}
if (Math.abs(kellyFraction(TREND20) - 0.025) > 1e-12) {
  throw new Error(`第 20 章：趋势画像凯利风险不是 2.5%（实测 ${kellyFraction(TREND20)}）——正文演算的锚丢了`)
}
if (kellyFraction(PAIN20) > -0.5) {
  throw new Error(`第 20 章：痛点策略凯利分数应为负数（实测 ${kellyFraction(PAIN20)}）——「别坐上桌」的读数丢了`)
}

const kellyPos20 = kellyFraction(TREND20) / TREND20.avgLoss // 0.025 ÷ 0.05 = 0.5：凯利风险换算成仓位
if (Math.abs(kellyPos20 - 0.5) > 1e-9) {
  throw new Error(`第 20 章：凯利仓位不是半仓（实测 ${kellyPos20}）——「仓位 = 风险 ÷ 止损距离」的桥断了`)
}

// 图一：破产概率 vs 交易次数。仓位是唯一变量——参数、注数（200）、轮数（4000）全同
const BETS20 = 200
const TRIALS20 = 4000
const full20 = monteCarloRuin(TREND20, BETS20, TRIALS20, 1.0, { seed: 2001 })
const kelly20 = monteCarloRuin(TREND20, BETS20, TRIALS20, kellyPos20, { seed: 2002 })
const half20 = monteCarloRuin(TREND20, BETS20, TRIALS20, kellyPos20 / 2, { seed: 2003 })

const pct20 = (v: number): number => Math.round(v * 1000) / 1000
for (const r of [full20, kelly20, half20]) {
  for (let k = 1; k < r.ruinCurve.length; k++) {
    if (r.ruinCurve[k]! < r.ruinCurve[k - 1]!) {
      throw new Error('第 20 章：破产概率曲线出现下降——吸收口径下曲线必须单调不降')
    }
  }
}
if (full20.ruinProbability < 0.3) {
  throw new Error(`第 20 章：正期望策略全仓 200 注破产概率只有 ${pct20(full20.ruinProbability)}——「正期望救不了全仓」的图面不成立`)
}
if (kelly20.ruinProbability > full20.ruinProbability - 0.05 || half20.ruinProbability > kelly20.ruinProbability - 0.05) {
  throw new Error(
    `第 20 章：破产概率排序不成立（全仓 ${pct20(full20.ruinProbability)} / 凯利 ${pct20(kelly20.ruinProbability)} / 半凯利 ${pct20(half20.ruinProbability)}）——差距不足 5 个百分点，换种子再试`,
  )
}
if (half20.ruinProbability > 0.05) {
  throw new Error(`第 20 章：半凯利破产概率 ${pct20(half20.ruinProbability)} 高于 5%——「取分数压回撤」的图面不成立`)
}

writeJson('20-ruin-compare.json', {
  series: [
    { name: `全仓（仓位 100%）`, values: full20.ruinCurve },
    { name: `凯利仓位（${Math.round(kellyPos20 * 100)}%）`, values: kelly20.ruinCurve },
    { name: `半凯利（${Math.round((kellyPos20 / 2) * 100)}%）`, values: half20.ruinCurve },
  ],
  labels: Array.from({ length: BETS20 }, (_, k) => `第${k + 1}注`),
})

// 图二：痛点策略（胜率六成、期望值 −2.4%）全仓下注的 8 条资金路径（与 LineChart 图例容量匹配），
// 纵轴为初始资金的百分比
const FAN_BETS20 = 120
const paths20 = equityPaths(PAIN20, FAN_BETS20, 8, 1.0, { seed: 2022 })
for (const p of paths20) {
  if (p[0] !== 1) throw new Error('第 20 章：资金路径起点不是 1——归一化前提被破坏')
  if (p[p.length - 1]! > 0.5) {
    throw new Error(`第 20 章：有路径 120 注后仍高于初始一半（终点 ${pct20(p[p.length - 1]!)}）——「胜率六成全仓照样缩水」的图面不成立，换一颗种子再试`)
  }
}
const dead20 = paths20.filter((p) => p[p.length - 1]! <= 0.5).length
if (dead20 < 6) {
  throw new Error(`第 20 章：跌破一半的路径只有 ${dead20}/8——图面差距不够显著，换一颗种子再试`)
}
const fanMax20 = Math.max(...paths20.map((p) => p[p.length - 1]!))
writeJson('20-equity-fan.json', {
  series: paths20.map((p, i) => ({ name: `宇宙 ${i + 1}`, values: p.map((v) => Math.round(v * 10000) / 100) })),
  labels: Array.from({ length: FAN_BETS20 + 1 }, (_, k) => `第${k}注`),
})

// 附带读数：痛点策略的破产概率曲线（正文表格引用，不单独成图）
const neg20 = monteCarloRuin(PAIN20, 200, 3000, 1.0, { seed: 20 })

console.log(
  [
    `20-ruin-compare.json：趋势画像（胜率 0.35、盈亏比 2、期望值 +${(expectancy(TREND20) * 100).toFixed(2)}%/注、凯利风险 ${(kellyFraction(TREND20) * 100).toFixed(1)}% → 仓位 ${Math.round(kellyPos20 * 100)}%）——200 注破产概率：全仓 ${pct20(full20.ruinProbability)}、凯利仓位 ${pct20(kelly20.ruinProbability)}、半凯利 ${pct20(half20.ruinProbability)}（${TRIALS20} 条中 ${Math.round(half20.ruinProbability * TRIALS20)} 条）；第 50 注时三者 ${pct20(full20.ruinCurve[49]!)}/${pct20(kelly20.ruinCurve[49]!)}/${pct20(half20.ruinCurve[49]!)}，第 100 注 ${pct20(full20.ruinCurve[99]!)}/${pct20(kelly20.ruinCurve[99]!)}/${pct20(half20.ruinCurve[99]!)}`,
    `20-equity-fan.json：痛点策略（胜率 0.6、赢 4% 亏 12%、期望值 ${(expectancy(PAIN20) * 100).toFixed(1)}%/注）全仓 8 条路径各 ${FAN_BETS20} 注——终点最高一条只剩初始的 ${Math.round(fanMax20 * 1000) / 10}%（最低 ${(Math.round(Math.min(...paths20.map((p) => p[p.length - 1]!)) * 1000) / 10).toFixed(1)}%）`,
    `第 20 章附带读数：痛点策略全仓破产概率 第 10 注 ${pct20(neg20.ruinCurve[9]!)} → 第 25 注 ${pct20(neg20.ruinCurve[24]!)} → 第 50 注 ${pct20(neg20.ruinCurve[49]!)} → 第 100 注 ${pct20(neg20.ruinCurve[99]!)} → 第 200 注 ${pct20(neg20.ruinCurve[199]!)}，破产路径平均活到第 ${Math.round(neg20.meanRuinBet ?? 0)} 注`,
  ].join('\n'),
)

// —— 第 21 章图表：回测资金曲线与未来函数对比（LineChart）。同一行情（种子 2102、300 根、
// 日波动 3%）跑三遍 backtest：守规的均线交叉策略（MA5/20 金叉买、死叉卖，来自第 11 章
// crossovers 的真实扫描）、引擎内置的买入持有基准、以及偷看写法（在整段行情的最低收盘日
// 喊买、最高收盘日喊卖——信号日拿全序列事后挑出来，教科书级未来函数）。费用走默认档
// （佣金万3 双向、最低 5 元、印花税 0.05% 卖出、滑点 0.1%），纵轴换算成初始资金的百分比。

/** 均线交叉策略（守规写法）：金叉喊买、死叉喊卖。交叉表按行情缓存只算一次，逐格读取 */
const maCrossStrategy = (fast: number, slow: number): Strategy => {
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

/** 偷看写法（未来函数）：整段行情的最低收盘日喊买、最高收盘日喊卖——事后诸葛亮选信号日 */
const peekStrategy = (): Strategy => {
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

const market21 = generateCandles(createRng(2102), { days: 300, startPrice: 10, volatility: 0.03 })
const honest21 = backtest(market21, maCrossStrategy(5, 20))
const cheater21 = backtest(market21, peekStrategy())
const pctRound21 = (v: number): number => Math.round((v / honest21.initialCash) * 100 * 1000) / 1000

// 守门：正文引用的读数逐个钉死，错一处整段导出失败
if (honest21.trades.length < 5) {
  throw new Error(`第 21 章：守规策略只做了 ${honest21.trades.length} 笔（需 ≥5）——图面信息量不足，换一颗种子再试`)
}
if (cheater21.trades.length !== 1) {
  throw new Error(`第 21 章：偷看写法不是整段一笔（实测 ${cheater21.trades.length} 笔）——最低点排到了最高点后面，换一颗种子`)
}
if (cheater21.totalReturn - honest21.totalReturn < 0.25) {
  throw new Error(
    `第 21 章：偷写与守规只差 ${((cheater21.totalReturn - honest21.totalReturn) * 100).toFixed(1)} 个百分点（需 ≥25）——「成绩显著不同」的图面不成立`,
  )
}
if (honest21.buyHoldReturn <= honest21.totalReturn) {
  throw new Error('第 21 章：守规策略跑赢了买入持有——「跑不赢傻拿」的对照故事不成立，换一颗种子再试')
}
if (cheater21.maxDrawdown >= honest21.maxDrawdown) {
  throw new Error('第 21 章：偷看版的回撤没有显著更浅——「偷看连回撤都漂亮」的读数丢了，换一颗种子再试')
}

// 图一：守规策略的资金曲线（area）叠买入持有基准——策略忙活一场 vs 什么都不做
writeJson('21-equity.json', {
  series: [
    { name: '均线交叉策略', values: honest21.equity.map(pctRound21), area: true },
    { name: '买入持有基准', values: honest21.buyHoldEquity.map(pctRound21), color: '#adb5bd' },
  ],
  labels: market21.map((c) => c.date),
})

// 图二：同一行情、同一引擎——偷看写法 vs 守规写法的资金曲线
writeJson('21-lookahead.json', {
  series: [
    { name: '偷看写法（含未来函数）', values: cheater21.equity.map(pctRound21), area: true },
    { name: '守规写法', values: honest21.equity.map(pctRound21) },
  ],
  labels: market21.map((c) => c.date),
})

console.log(
  [
    `21-equity.json：${market21.length} 根合成行情（种子 2102）——守规的 MA5/20 交叉策略 ${honest21.trades.length} 笔、总收益 ${(honest21.totalReturn * 100).toFixed(1)}%、最大回撤 ${(honest21.maxDrawdown * 100).toFixed(1)}%、胜率 ${(honest21.winRate * 100).toFixed(0)}%、盈亏比 ${honest21.payoffRatio?.toFixed(2)}；买入持有基准 ${(honest21.buyHoldReturn * 100).toFixed(1)}%、回撤 ${(maxDrawdown(honest21.buyHoldEquity) * 100).toFixed(1)}%`,
    `21-lookahead.json：偷看写法整段一笔（${cheater21.trades[0]!.entryDate} 开盘买 → ${cheater21.trades[0]!.exitDate} 开盘卖）——总收益 ${(cheater21.totalReturn * 100).toFixed(1)}%、最大回撤 ${(cheater21.maxDrawdown * 100).toFixed(1)}%，对守规写法 ${(honest21.totalReturn * 100).toFixed(1)}%/${(honest21.maxDrawdown * 100).toFixed(1)}%：同一引擎、同一行情，只差「信号有没有偷看」`,
  ].join('\n'),
)

// —— 配套可视化数据集（第 2/3/12/14/15/21/22 章 + 16/17 指标交互派生件）——
// 为正文的交互图表补数据。凡正文表格已给出数字的（02 申报表、03 五笔成交、21 回测参数、
// 22 处置效应两组参数），数据必须由这些数字算出，不另编；合成场景（12 量价矩阵、15 双底）
// 沿用本文件既有的固定种子合成器与守门惯例。以下各段变量如无声明，均只在本段使用。

// —— 02-auction-curve.json：集合竞价撮合曲线 ——
// 申报表是第 2 章正文原文；五个候选价的可成交量由 src/matching/auction.ts 的 callAuction
// 按撮合规则算出（两侧取小），峰值价位即正文结论的开盘价 10.65 元
const AUCTION_BUYS_02: AuctionOrder[] = [
  { price: 10.7, shares: 3000 },
  { price: 10.65, shares: 4000 },
  { price: 10.6, shares: 2000 },
  { price: 10.58, shares: 1000 },
  { price: 10.5, shares: 2000 },
]
const AUCTION_SELLS_02: AuctionOrder[] = [
  { price: 10.5, shares: 1500 },
  { price: 10.6, shares: 2500 },
  { price: 10.65, shares: 4500 },
  { price: 10.7, shares: 4000 },
]
const auction02 = callAuction(AUCTION_BUYS_02, AUCTION_SELLS_02)
// [候选价, 愿买, 愿卖, 可成交量]——第 2 章正文表格逐行，错一处整段导出失败
const AUCTION_TABLE_02: readonly (readonly [number, number, number, number])[] = [
  [10.7, 3000, 12500, 3000],
  [10.65, 7000, 8500, 7000],
  [10.6, 9000, 4000, 4000],
  [10.58, 10000, 1500, 1500],
  [10.5, 12000, 1500, 1500],
]
for (const [p, b, s, v] of AUCTION_TABLE_02) {
  const row = auction02.levels.find((l) => l.price === p)
  if (!row || row.buyShares !== b || row.sellShares !== s || row.volume !== v) {
    throw new Error(`第 2 章候选价 ${p} 的撮合读数 ${JSON.stringify(row)} 与正文表格（愿买 ${b}/愿卖 ${s}/可成交 ${v}）不一致——算式与正文口径分叉`)
  }
}
if (auction02.openingPrice !== 10.65 || auction02.openingVolume !== 7000) {
  throw new Error(`第 2 章开盘价投出 ${auction02.openingPrice}×${auction02.openingVolume}，与正文结论 10.65×7000 不一致`)
}
writeJson('02-auction-curve.json', {
  labels: auction02.levels.map((l) => l.price.toFixed(2)),
  volumes: auction02.levels.map((l) => l.volume),
})

// —— 03-anatomy-candle.json：一根蜡烛的诞生 ——
// 五笔成交是第 3 章正文表格原文；蜡烛由 aggregateTicks 聚出
// （开=第一笔、收=最后一笔、高=最大那笔、低=最小那笔、量=求和）；
// 每笔的方向箭头由 tick 规则标注（tickDirections：较前笔上行记主动买、下行记主动卖、首笔约定买）
const TRADES_03 = [
  { time: '09:30', price: 10.0, size: 200 },
  { time: '10:15', price: 10.4, size: 100 },
  { time: '11:05', price: 9.8, size: 300 },
  { time: '14:00', price: 10.1, size: 100 },
  { time: '14:57', price: 10.25, size: 400 },
] as const
const at03 = (hhmm: string): number => Date.UTC(2026, 2, 2, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)))
const ticks03 = TRADES_03.map((t) => ({ time: at03(t.time), price: t.price, size: t.size }))
const candle03 = aggregateTicks(ticks03, { open: '09:30', close: '15:00' })[0]!
if (
  candle03.date !== '2026-03-02' ||
  candle03.open !== 10.0 ||
  candle03.high !== 10.4 ||
  candle03.low !== 9.8 ||
  candle03.close !== 10.25 ||
  candle03.volume !== 1100
) {
  throw new Error(`第 3 章五笔成交聚出的蜡烛 ${JSON.stringify(candle03)} 与正文手算（开10.00 高10.40 低9.80 收10.25 量1100）不一致`)
}
const dirs03 = tickDirections(ticks03)
writeJson('03-anatomy-candle.json', {
  candle: candle03,
  trades: TRADES_03.map((t, i) => ({ time: t.time, price: t.price, size: t.size, direction: dirs03[i] })),
})

// —— 12-matrix-candles.json：量价关系矩阵四格 ——
// 每格 8 根合成 K 线：价格出自本文件既有的 driftSeries（固定种子），量能是手工设计的
// 单调阶梯（放量格逐根抬高、缩量格逐根回落，首尾差 3.5 倍）——趋势与量能形态一眼可辨；
// 量纲沿用第 12 章数据集（百万股级成交量、10 元档价格）
type MatrixScene = {
  key: 'up-price-up-vol' | 'down-price-up-vol' | 'up-price-down-vol' | 'down-price-down-vol'
  label: string
  candles: Candle[]
}
const MATRIX_VOL_UP = [2_000_000, 2_600_000, 3_200_000, 3_800_000, 4_500_000, 5_200_000, 6_000_000, 7_000_000]
const matrixScene = (key: MatrixScene['key'], label: string, seed: number, drift: number, vols: readonly number[]): MatrixScene => ({
  key,
  label,
  candles: withVolumes(driftSeries(createRng(seed), { days: 8, startPrice: 10, drift, vol: 0.008 }), [...vols]),
})
const scenes12: MatrixScene[] = [
  matrixScene('up-price-up-vol', '价涨量增：推进有燃料', 1261, 0.012, MATRIX_VOL_UP),
  matrixScene('down-price-up-vol', '价跌量增：恐慌或派发', 1262, -0.012, MATRIX_VOL_UP),
  matrixScene('up-price-down-vol', '价涨量缩：无人反对的推进', 1263, 0.012, [...MATRIX_VOL_UP].reverse()),
  matrixScene('down-price-down-vol', '价跌量缩：卖压枯竭', 1264, -0.012, [...MATRIX_VOL_UP].reverse()),
]
for (const s of scenes12) {
  const cs = s.candles
  const disp = cs[cs.length - 1]!.close / cs[0]!.open - 1
  const priceUp = s.key.startsWith('up-')
  const volUp = s.key.endsWith('up-vol')
  if (priceUp ? disp < 0.05 : disp > -0.05) {
    throw new Error(`第 12 章矩阵 ${s.key} 的价格位移只有 ${(disp * 100).toFixed(1)}%——趋势方向不够醒目，换一颗种子再试`)
  }
  const mono = volUp
    ? cs.every((c, i) => i === 0 || c.volume >= cs[i - 1]!.volume)
    : cs.every((c, i) => i === 0 || c.volume <= cs[i - 1]!.volume)
  const span3x = volUp ? cs[cs.length - 1]!.volume >= 3 * cs[0]!.volume : cs[0]!.volume >= 3 * cs[cs.length - 1]!.volume
  if (!mono || !span3x) {
    throw new Error(`第 12 章矩阵 ${s.key} 的量能阶梯不单调或首尾差距不足 3 倍——量能形态不够醒目`)
  }
}
writeJson('12-matrix-candles.json', { scenes: scenes12 })

// —— 14-chip-bins.json：筹码分布的价位直方图 ——
// 与 14-rebound.json 同一段行情（种子 1401）、同一台 chipDistribution——桶宽放宽到 0.2 元，
// 反弹末日的分布摊成约 17 档（规格 15–25 档）：套牢峰（全图最大桶）仍在现价上方，
// 获利/套牢的分界就是现价——与本章「峰压在头顶」的叙事同源
const chipsBins14 = chipDistribution(rebound14, { floatShares: FLOAT14, binWidth: 0.2 })
const finalBins14 = chipsBins14[chipsBins14.length - 1]!
const bins14 = finalBins14.buckets.map((b) => ({
  price: round2(b.price),
  volume: Math.round(b.quantity),
  profitable: round2(b.price) <= finalBins14.close,
}))
if (bins14.length < 15 || bins14.length > 25) {
  throw new Error(`第 14 章直方图摊成 ${bins14.length} 档（规格 15–25）——桶宽 0.2 元的选段不对`)
}
if (Math.abs(bins14.reduce((s, b) => s + b.volume, 0) - FLOAT14) > bins14.length) {
  throw new Error(`第 14 章直方图持仓合计偏离流通股本 ${FLOAT14} 超过逐桶取整误差——守恒被破坏`)
}
const peakBin14 = bins14.reduce((a, b) => (b.volume > a.volume ? b : a))
if (peakBin14.profitable || bins14.every((b) => b.profitable === bins14[0]!.profitable)) {
  throw new Error(`第 14 章直方图最大桶 ${peakBin14.price} 元（${peakBin14.volume} 股）不在现价上方——「套牢峰压顶」的叙事不成立`)
}
writeJson('14-chip-bins.json', {
  bins: bins14,
  currentPrice: finalBins14.close,
  avgCost: round2(finalBins14.averageCost),
})

// —— 15-double-bottom.json：双底与颈线突破 ——
// 双顶图（15-double-top.json）的镜像剧本：跌到第一底、反弹出中间峰（未来的颈线）、
// 二次探底同一价位、收盘突破颈线上行到量度目标附近。结构、颈线、破位日、量度目标
// 全部出自 src/levels/structures.ts 的 detectStructures 真实计算，标记不手标；
// kinds 只用 bull/info——底部结构与突破都在看涨侧
const dbWalk = pathSeries(createRng(1503), 10.4, [
  { target: 9.4, bars: 8 }, // 第一底
  { target: 10.7, bars: 7 }, // 中间峰：未来的颈线
  { target: 9.4, bars: 8 }, // 第二底：同一价位第二次证明有人守
  { target: 12.0, bars: 9 }, // 突破颈线上行，收在量度目标附近
])
const dbFound = detectStructures(dbWalk, { tol: TOL15 })
const db15 = dbFound.find((s) => s.id === 'double-bottom')
if (dbFound.length !== 1 || !db15) {
  throw new Error(`第 15 章双底段检出 ${JSON.stringify(dbFound)}——期望恰好一个双底，换一颗种子再试`)
}
const [b115, midDb15, b215] = db15.indices
if (Math.abs(dbWalk[b115].low - dbWalk[b215].low) > TOL15) {
  throw new Error(`两底低点 ${dbWalk[b115].low}/${dbWalk[b215].low} 差超过容差 ${TOL15}——「同水平」前提被破坏`)
}
if (dbWalk[db15.breakIndex].close <= db15.neckline) {
  throw new Error('双底破位根收盘没有越过颈线——破位读数自相矛盾')
}
const dbHeight = db15.neckline - Math.min(dbWalk[b115].low, dbWalk[b215].low)
if (dbHeight < 1.2) {
  throw new Error(`双底结构高度只有 ${round2(dbHeight)} 元（需 ≥1.2）——底不够深，换一颗种子再试`)
}
if (Math.abs(dbWalk[dbWalk.length - 1].close - db15.target) > 0.5) {
  throw new Error(`末根收盘 ${dbWalk[dbWalk.length - 1].close} 离量度目标 ${round2(db15.target)} 超过 0.5 元——行程设计不对`)
}
writeJson('15-double-bottom.json', {
  candles: dbWalk,
  markers: [
    { index: b115, label: '谷1', kind: 'info' },
    { index: midDb15, label: '颈线峰', kind: 'info' },
    { index: b215, label: '谷2', kind: 'info' },
    { index: db15.breakIndex, label: '收盘突破颈线', kind: 'bull' },
  ],
})

// —— 16-macd-ind.json：MACD 指标交互派生件 ——
// 16-macd-round.json（主图 K 线）与 16-macd-panel.json（DIF/DEA/柱）是同一段行情拆成的
// 两张静态图；交互版主副图联动需要一份合并文件——candles 与 dif/dea/hist 逐格对齐
// （指标未成形的暖机段记 null，与副图同款），标记沿用主图的四处计算读数
if (!(round16.length === macd16.dif.length && round16.length === macd16.dea.length && round16.length === macd16.hist.length)) {
  throw new Error('第 16 章交互件的对齐前提被破坏：candles 与 dif/dea/hist 不等长')
}
writeJson('16-macd-ind.json', {
  candles: round16,
  dif: macd16.dif.map(r4n),
  dea: macd16.dea.map(r4n),
  hist: macd16.hist.map(r4n),
  markers: [golden16, { index: histPeak16, label: '柱峰', kind: 'info' }, { index: top16, label: '山顶', kind: 'info' }, dead16],
})

// —— 17-indicators-ind.json：RSI+KDJ 指标交互派生件 ——
// 17-strong-rally.json（主图）、17-rsi-panel.json、17-kdj-panel.json 三张静态图同一段行情；
// 交互版把主图 K 线与 RSI/K/D/J 序列合并成一份逐格对齐的文件，阈值依据随文件走——
// RSI 的 70/30 超买超卖与 80 强势线来自 src/indicators/rsi.ts 的 RSI_LEVELS，
// KDJ 的 80/20 与副图刻度同款；标记沿用 17-strong-rally 的四处计算读数
if (![rsi17, kdj17.k, kdj17.d, kdj17.j].every((s) => s.length === rally17.length)) {
  throw new Error('第 17 章交互件的对齐前提被破坏：candles 与 rsi/k/d/j 不等长')
}
writeJson('17-indicators-ind.json', {
  candles: rally17,
  rsi: rsi17.map(r2n),
  k: kdj17.k.map(r2n),
  d: kdj17.d.map(r2n),
  j: kdj17.j.map(r2n),
  thresholds: {
    rsiOverbought: RSI_LEVELS.overbought,
    rsiOversold: RSI_LEVELS.oversold,
    rsiStrong: RSI_LEVELS.strong,
    kdjOverbought: 80,
    kdjOversold: 20,
  },
  markers: [
    { index: firstOb17, label: 'RSI 首上 80·清仓点', kind: 'bear' },
    { index: obDead17[0]!.index, label: '超买区死叉', kind: 'bear' },
    { index: top17, label: `山顶 ${round2(rally17[top17].high)}`, kind: 'info' },
    { index: below50_17, label: 'RSI 跌破 50', kind: 'info' },
  ],
})

// —— 21-backtest-detail.json：回测明细（资金曲线 + 逐格回撤 + 交易点位） ——
// 与 21-equity.json 同一行情（种子 2102）、同一引擎、同一 MA5/20 均线交叉策略与默认
// 费用档——honest21 一个字没重算，只是在资金曲线之外补齐交互图要的三样：买入持有基准、
// 相对历史峰值的逐格回撤（drawdown[0] 恒为 0、最深一格 = −最大回撤，drawdownSeries）、
// 逐笔交易的下标与成交价（含滑点的成交价，与交易列表同源）。
// equity/benchmark 沿用 21-equity.json 的百分轴（初始资金 = 100），drawdown 记负百分数
const dd21raw = drawdownSeries(honest21.equity)
if (dd21raw[0] !== 0) {
  throw new Error('第 21 章明细图的 drawdown[0] 不是 0——回撤序列口径被破坏')
}
if (Math.abs(Math.min(...dd21raw) + honest21.maxDrawdown) > 1e-12) {
  throw new Error('第 21 章明细图的最深回撤与 maxDrawdown 不一致——两条算路必须同源')
}
const tradesDetail21: { index: number; kind: 'buy' | 'sell'; note: string }[] = []
for (const t of honest21.trades) {
  tradesDetail21.push({ index: t.entryIndex, kind: 'buy', note: `买入 @${round2(t.entryPrice)}` })
  tradesDetail21.push({ index: t.exitIndex, kind: 'sell', note: `卖出 @${round2(t.exitPrice)}` })
}
if (honest21.openPosition) {
  tradesDetail21.push({
    index: honest21.openPosition.entryIndex,
    kind: 'buy',
    note: `买入 @${round2(honest21.openPosition.entryPrice)}（期末仍持有）`,
  })
}
if (tradesDetail21.length !== honest21.trades.length * 2 + (honest21.openPosition ? 1 : 0)) {
  throw new Error('第 21 章明细图的交易点位数与回测交易列表对不上——记账分叉')
}
writeJson('21-backtest-detail.json', {
  dates: market21.map((c) => c.date),
  equity: honest21.equity.map(pctRound21),
  benchmark: honest21.buyHoldEquity.map(pctRound21),
  drawdown: dd21raw.map((v) => Math.round(v * 100 * 1000) / 1000),
  trades: tradesDetail21,
})

// —— 22-disposal-curves.json：处置效应的两组复利资金曲线 ——
// 参数是第 22 章正文演算的两组构造参数（同一套胜率 60%）：处置画像 赢 2% 亏 20%
// （期望值每笔 −6.8%）、修正版 赢 12% 亏 8%（每笔 +4.0%）；曲线由 src/risk/expectancy.ts
// 的 compoundCurve 按期望值逐笔复利——初始 1.0，十笔后 0.932 的 10 次方 ≈ 0.495
// 对 1.04 的 10 次方 ≈ 1.480，方向与正文结论一致
const DISPOSAL_22: EdgeStats = { winRate: 0.6, avgWin: 0.02, avgLoss: 0.2 }
const REVISED_22: EdgeStats = { winRate: 0.6, avgWin: 0.12, avgLoss: 0.08 }
if (Math.abs(expectancy(DISPOSAL_22) - -0.068) > 1e-9) {
  throw new Error(`第 22 章处置画像期望值不是 −6.8%（实测 ${expectancy(DISPOSAL_22)}）——正文演算的锚丢了`)
}
if (Math.abs(expectancy(REVISED_22) - 0.04) > 1e-9) {
  throw new Error(`第 22 章修正版期望值不是 +4.0%（实测 ${expectancy(REVISED_22)}）——正文演算的锚丢了`)
}
const curveDisposal22 = compoundCurve(DISPOSAL_22, 10)
const curveRevised22 = compoundCurve(REVISED_22, 10)
if (curveDisposal22[9]! >= 1 || Math.abs(curveDisposal22[9]! - 0.494492) > 5e-4) {
  throw new Error(`处置画像十笔后剩 ${curveDisposal22[9]!.toFixed(6)}——与正文 0.932 的 10 次方 ≈ 0.495 不一致`)
}
if (curveRevised22[9]! <= 1 || Math.abs(curveRevised22[9]! - 1.480244) > 5e-4) {
  throw new Error(`修正版十笔后到 ${curveRevised22[9]!.toFixed(6)}——与正文 1.04 的 10 次方 ≈ +48% 不一致`)
}
writeJson('22-disposal-curves.json', {
  labels: Array.from({ length: 10 }, (_, k) => `第${k + 1}笔`),
  curves: [
    {
      name: '处置效应画像（赢2% 亏20%·每笔 −6.8%）',
      values: curveDisposal22.map((v) => Math.round(v * 1e4) / 1e4),
    },
    {
      name: '修正版（赢12% 亏8%·每笔 +4.0%）',
      values: curveRevised22.map((v) => Math.round(v * 1e4) / 1e4),
    },
  ],
})

const dispOf12 = (s: MatrixScene): string =>
  `${(((s.candles[s.candles.length - 1]!.close / s.candles[0]!.open) - 1) * 100).toFixed(1)}%`

console.log(
  [
    `02-auction-curve.json：五个候选价可成交量 ${auction02.levels.map((l) => l.volume.toLocaleString('en-US')).join('/')} 股——峰值 ${auction02.openingPrice.toFixed(2)} 元（${auction02.openingVolume.toLocaleString('en-US')} 股）即开盘价，逐行对上正文申报表`,
    `03-anatomy-candle.json：五笔成交聚成一根蜡烛（开 ${candle03.open} 高 ${candle03.high} 低 ${candle03.low} 收 ${candle03.close} 量 ${candle03.volume}），tick 方向标注 ${dirs03.join('/')}`,
    `12-matrix-candles.json：量价矩阵四格各 8 根——${scenes12.map((s) => `${s.label}（位移 ${dispOf12(s)}）`).join('；')}`,
    `14-chip-bins.json：反弹末日筹码直方图 ${bins14.length} 档（桶宽 0.2 元）——最大桶 ${peakBin14.price} 元（${peakBin14.volume.toLocaleString('en-US')} 股）压在现价 ${finalBins14.close} 上方，平均成本 ${round2(finalBins14.averageCost)}`,
    `15-double-bottom.json：${dbWalk.length} 根双底段——谷1 第 ${b115 + 1} 根（低 ${dbWalk[b115].low}）、颈线峰第 ${midDb15 + 1} 根（高 ${dbWalk[midDb15].high}）、谷2 第 ${b215 + 1} 根（低 ${dbWalk[b215].low}），颈线 ${round2(db15.neckline)}，第 ${db15.breakIndex + 1} 根收盘 ${dbWalk[db15.breakIndex].close} 突破，末根收 ${dbWalk[dbWalk.length - 1].close}（量度目标 ${round2(db15.target)}）`,
    `16-macd-ind.json / 17-indicators-ind.json：主图与指标序列逐格对齐的交互派生件（各 ${round16.length} / ${rally17.length} 根，含阈值与标记）`,
    `21-backtest-detail.json：守规策略 ${honest21.trades.length} 笔交易摊成 ${tradesDetail21.length} 个点位，逐格回撤最深 ${(Math.min(...dd21raw) * 100).toFixed(1)}%（drawdown[0]=0）`,
    `22-disposal-curves.json：两条十笔复利曲线——处置画像终值 ${curveDisposal22[9]!.toFixed(4)}（跌破本金一半附近）、修正版终值 ${curveRevised22[9]!.toFixed(4)}`,
  ].join('\n'),
)
