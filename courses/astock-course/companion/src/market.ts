// companion/src/market.ts · 合成日线生成器（第 4 章 K线、第 5 章趋势行情的唯一数据来源）
// 教学示意·固定种子合成数据：以几何随机游走为底（mulberry32 + gaussian，SEED=42），
// 按剧情段设定每日漂移 / 波动 / 量能，并在少数事件日施加形态指令
//（长上影 / 长下影 / 放量大阳 / 缩量大阳 / 缩量小阴 / 高开回落），
// 让「可教特征」稳定存在——特征是否真的成立，由 tests/market.test.ts 的断言锁定。
// 日期一律用相对序号 D1…Dn，不冒充任何真实交易日；全部价格满足主板 ±10% 涨跌幅约束。
// 第 5 章在此之上追加：均线 ma()、金叉/死叉检测、交叉策略回测（费用直接调第 3 章成本函数）。

import { SEED, gaussian, mulberry32 } from './rng'
import { buyTotalPaid, commission, sellNetReceived, stampTax, transferFee } from './costs'
import { round2 } from './round'

export const CANDLE_COUNT = 60
export const VISIBLE_COUNT = 40 // 「先猜后揭晓」：默认展示前 40 根
export const HIDDEN_COUNT = 20 // 揭晓后展开的后 20 根
export const START_PRICE = 10 // 起始价（元）
export const BASE_VOLUME_LOTS = 80_000 // 基线成交量（手，1 手 = 100 股）
export const DAILY_LIMIT = 0.1 // 主板涨跌幅约束（幅度 10%）

export interface Candle {
  day: string // 'D1'…'D60'
  open: number
  close: number
  high: number
  low: number
  volume: number // 手
}

type Shape = 'plain' | 'long-upper' | 'long-lower' | 'big-yang-heavy' | 'big-yang-light' | 'small-yin-light' | 'gap-fade'

interface DayScript {
  drift: number // 当日对数收益中心
  vol: number // 当日对数收益标准差
  act: number // 量能相对基线倍数
  dir?: 'up' | 'down' // 连续段：强制当日收阳 / 收阴（且收于昨收之上 / 之下）
  shape?: Shape
}

/** 剧情段速记：连续 n 天同一组参数 */
function seg(days: number, drift: number, vol: number, act: number, extra: Partial<DayScript> = {}): DayScript[] {
  return Array.from({ length: days }, () => ({ drift, vol, act, ...extra }))
}

// 剧情脚本（60 根，day = 下标 + 1）：
// 基期横盘 → 连阳上攻 → 长上影见压 → 连阴回调 → 长下影探底 → 缩量蓄势
// → 放量大阳（D36）→ 缩量大阳（D37）→ 高位犹豫 → 缩量小阴（D40，可见部分到此为止）
// → 揭晓段：滞涨 → 回落 → 放量长下影二次探底 → 低位横盘收官
const SCRIPT: DayScript[] = [
  ...seg(12, 0.0005, 0.007, 1.0), // D1–D12 基期横盘
  ...seg(6, 0.013, 0.008, 1.35, { dir: 'up' }), // D13–D18 连续阳线
  { drift: 0.002, vol: 0.006, act: 1.9, shape: 'long-upper' }, // D19 冲高回落·长上影
  { drift: -0.008, vol: 0.009, act: 1.1, dir: 'down' }, // D20 过渡小阴
  ...seg(6, -0.014, 0.01, 1.25, { dir: 'down' }), // D21–D26 连续阴线
  ...seg(3, -0.006, 0.009, 1.0), // D27–D29 阴跌尾段
  { drift: -0.004, vol: 0.008, act: 1.7, shape: 'long-lower' }, // D30 探底回升·长下影
  { drift: 0, vol: 0.006, act: 0.5, shape: 'gap-fade' }, // D31 高开回落·小阴（收盘仍高于昨收）
  ...seg(3, 0.001, 0.006, 0.55), // D32–D34 缩量横盘
  { drift: 0.004, vol: 0.007, act: 0.6, dir: 'up' }, // D35 微阳蓄势
  { drift: 0, vol: 0.006, act: 2.8, shape: 'big-yang-heavy' }, // D36 放量大阳
  { drift: 0, vol: 0.006, act: 0.35, shape: 'big-yang-light' }, // D37 缩量大阳（钩子的另一半）
  ...seg(2, 0.003, 0.007, 0.5, { dir: 'up' }), // D38–D39 高位犹豫小阳
  { drift: 0, vol: 0.005, act: 0.35, shape: 'small-yin-light' }, // D40 缩量小阴（可见区收尾）
  ...seg(4, 0, 0.008, 0.5), // D41–D44 高位滞涨
  ...seg(6, -0.011, 0.011, 0.9), // D45–D50 回落
  ...seg(2, -0.009, 0.012, 1.1), // D51–D52 加速探底
  { drift: -0.005, vol: 0.009, act: 1.8, shape: 'long-lower' }, // D53 放量长下影·二次探底回升
  ...seg(7, 0.0008, 0.006, 0.7), // D54–D60 低位横盘收官
]

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

export function generateDailyCandles(): Candle[] {
  const rng = mulberry32(SEED)
  const candles: Candle[] = []
  let prevClose = START_PRICE

  for (const [i, s] of SCRIPT.entries()) {
    let open: number
    let close: number
    let high: number
    let low: number

    switch (s.shape) {
      case 'long-upper': {
        // 冲高回落：小幅高开 → 盘中冲到高处 → 收在开盘附近（小阳，上影远长于实体）
        open = prevClose * (1 + 0.004 + 0.002 * gaussian(rng))
        close = open * (1 + 0.004 + 0.002 * gaussian(rng))
        high = open * (1 + 0.045 + 0.008 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.004 * Math.abs(gaussian(rng)))
        break
      }
      case 'long-lower': {
        // 探底回升：盘中深跌 → 尾盘拉回开盘上方（小阳，下影远长于实体）
        open = prevClose * (1 - 0.003 + 0.002 * gaussian(rng))
        close = open * (1 + 0.003 + 0.0015 * gaussian(rng))
        low = open * (1 - 0.05 - 0.008 * Math.abs(gaussian(rng)))
        high = Math.max(open, close) * (1 + 0.003 * Math.abs(gaussian(rng)))
        break
      }
      case 'big-yang-heavy':
      case 'big-yang-light': {
        // 大阳线：实体约 4%~5%；两者的差别只在量能（act），形态刻意同款
        open = prevClose * (1 + 0.004 + 0.002 * gaussian(rng))
        close = open * (1 + 0.042 + 0.004 * gaussian(rng))
        high = Math.max(open, close) * (1 + 0.003 * Math.abs(gaussian(rng)))
        low = open * (1 - 0.003 * Math.abs(gaussian(rng)))
        break
      }
      case 'small-yin-light': {
        // 缩量小阴：实体不足半个百分点，影线极短
        open = prevClose * (1 + 0.001 + 0.0015 * gaussian(rng))
        close = open * (1 - 0.004 - 0.001 * gaussian(rng))
        high = Math.max(open, close) * (1 + 0.002 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.002 * Math.abs(gaussian(rng)))
        break
      }
      case 'gap-fade': {
        // 高开回落：跳空高开 2% → 收盘低于开盘（阴线）但高于昨收——
        // 「收>昨收」与「收>开」两条判定在这根蜡烛上答案相反，供定向破坏用
        open = prevClose * (1 + 0.02 + 0.003 * gaussian(rng))
        close = open * (1 - 0.006 - 0.002 * gaussian(rng))
        high = open * (1 + 0.002 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.003 * Math.abs(gaussian(rng)))
        break
      }
      default: {
        const gap = clamp(0.002 * gaussian(rng), -0.015, 0.015)
        let logRet = s.drift + s.vol * gaussian(rng)
        if (s.dir === 'up') {
          open = prevClose * (1 + Math.min(Math.abs(gap), 0.012))
          logRet = Math.abs(logRet) + 0.002
          close = open * Math.exp(Math.min(logRet, 0.094))
        } else if (s.dir === 'down') {
          open = prevClose * (1 - Math.min(Math.abs(gap), 0.012))
          logRet = -(Math.abs(logRet) + 0.002)
          close = open * Math.exp(Math.max(logRet, -0.094))
        } else {
          open = prevClose * (1 + gap)
          logRet = clamp(logRet, -0.094, 0.094)
          close = prevClose * Math.exp(logRet)
        }
        const wickUp = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
        const wickDown = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
        high = Math.max(open, close) * (1 + wickUp)
        low = Math.min(open, close) * (1 - wickDown)
      }
    }

    // 价格统一到分，并保证 OHLC 大小关系在舍入后仍成立
    const o = round2(open)
    const c = round2(close)
    const h = round2(Math.max(high, open, close))
    const l = round2(Math.min(low, open, close))
    candles.push({
      day: `D${i + 1}`,
      open: o,
      close: c,
      high: h,
      low: l,
      volume: Math.round(BASE_VOLUME_LOTS * s.act * Math.exp(0.22 * gaussian(rng))),
    })
    prevClose = c
  }

  return candles
}

// ---- 读图辅助（数据集与测试共用同一实现，禁止平行手抄） ----

export const isYang = (c: Candle): boolean => c.close > c.open
export const bodyOf = (c: Candle): number => round2(c.close - c.open)
export const upperShadowOf = (c: Candle): number => round2(c.high - Math.max(c.open, c.close))
export const lowerShadowOf = (c: Candle): number => round2(Math.min(c.open, c.close) - c.low)

/** 成交量中位数（手）——量能倍数的分母 */
export function medianVolume(candles: Candle[]): number {
  const vs = candles.map((c) => c.volume).sort((a, b) => a - b)
  const mid = Math.floor(vs.length / 2)
  return vs.length % 2 === 1 ? (vs[mid] as number) : Math.round(((vs[mid - 1] as number) + (vs[mid] as number)) / 2)
}

export interface Streak {
  from: number // 起始序号（与 D{n} 一致，1-based）
  to: number
  length: number
}

/** 最长连续阳线（yang=true）或连续阴线（yang=false）段 */
export function longestStreak(candles: Candle[], yang: boolean): Streak {
  let best: Streak = { from: 0, to: 0, length: 0 }
  let start = 0
  for (let i = 0; i <= candles.length; i += 1) {
    const hit = i < candles.length && (yang ? isYang(candles[i] as Candle) : !isYang(candles[i] as Candle))
    if (!hit) {
      const length = i - start
      if (length > best.length) best = { from: start + 1, to: i, length }
      start = i + 1
    }
  }
  return best
}

/** 全天量能最大的交易日序号（1-based） */
export function maxVolumeDay(candles: Candle[]): number {
  let best = 0
  for (let i = 1; i < candles.length; i += 1) {
    if ((candles[i] as Candle).volume > (candles[best] as Candle).volume) best = i
  }
  return best + 1
}

// ---- 第 5 章：250 日趋势教学行情（D1–D250，与第 4 章 60 根是两段独立剧情） ----
// 剧情目标：一轮完整的「下跌 → 上涨 → 震荡 → 主升 → 深回调 → 修复 → 顶部折腾 → 再攻 → 末段下跌」，
// 让 MA5/MA20 的金叉死叉既有吃到趋势的真信号，也有震荡里的假信号与末段的滞后卖低——
// 回测结局「交叉策略（含费）跑输持有不动」由 tests/ma-cross.test.ts 断言锁定。

export const TREND_COUNT = 250

export interface TrendDayScript {
  drift: number // 当日对数收益中心
  vol: number // 当日对数收益标准差
  act: number // 量能相对基线倍数
}

/** 第 5 章剧情段速记 */
function tseg(days: number, drift: number, vol: number, act: number): TrendDayScript[] {
  return Array.from({ length: days }, () => ({ drift, vol, act }))
}

// 剧情脚本（250 根，day = 下标 + 1）：涨一段、磨一段、再涨一段的行情——
// D1–D28 阴跌探底（年内低点）→ D29–D68 第一波趋势上涨（首个金叉吃到趋势）
// → D69–D80 急跌（死叉卖出）→ D81–D100 急涨（金叉确认时车已开走：卖飞）
// → D101–D180 长期宽幅震荡（假信号绞肉机：反复卖低买高）
// → D181–D250 末段主升收官（欠下的账再也追不回来）
// 回测结局「交叉策略（含费）跑输持有不动」由 tests/ma-cross.test.ts 断言锁定。
const TREND_SCRIPT: TrendDayScript[] = [
  ...tseg(28, -0.002, 0.009, 1.0),
  ...tseg(40, 0.005, 0.009, 1.1),
  ...tseg(12, -0.008, 0.009, 1.25),
  ...tseg(20, 0.013, 0.01, 1.2),
  ...tseg(80, 0, 0.013, 1.0),
  ...tseg(70, 0.006, 0.008, 1.1),
]

/** 第 5 章趋势行情：与第 4 章生成器各自持有独立随机流，互不串剧情 */
export function generateTrendCandles(): Candle[] {
  const rng = mulberry32(SEED)
  const candles: Candle[] = []
  let prevClose = START_PRICE

  for (const [i, s] of TREND_SCRIPT.entries()) {
    const gap = clamp(0.002 * gaussian(rng), -0.015, 0.015)
    const open = prevClose * (1 + gap)
    const logRet = clamp(s.drift + s.vol * gaussian(rng), -0.094, 0.094)
    const close = prevClose * Math.exp(logRet)
    const wickUp = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
    const wickDown = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
    const o = round2(open)
    const c = round2(close)
    const upLimit = round2(prevClose * (1 + DAILY_LIMIT))
    const downLimit = round2(prevClose * (1 - DAILY_LIMIT))
    const h = Math.min(round2(Math.max(open, close) * (1 + wickUp)), upLimit)
    const l = Math.max(round2(Math.min(open, close) * (1 - wickDown)), downLimit)
    candles.push({
      day: `D${i + 1}`,
      open: o,
      close: c,
      high: Math.max(h, o, c),
      low: Math.min(l, o, c),
      volume: Math.round(BASE_VOLUME_LOTS * s.act * Math.exp(0.22 * gaussian(rng))),
    })
    prevClose = c
  }

  return candles
}

/** 简单移动平均线：最近 n 个收盘价的算术平均；窗口不满的头部记 null。值按分舍入。 */
export function ma(prices: number[], n: number): Array<number | null> {
  const out: Array<number | null> = []
  let sum = 0
  for (let i = 0; i < prices.length; i += 1) {
    sum += prices[i] as number
    if (i >= n) sum -= prices[i - n] as number
    out.push(i >= n - 1 ? round2(sum / n) : null)
  }
  return out
}

export type CrossType = 'golden' | 'death'

export interface MaCross {
  index: number // 信号确认日下标（0-based，day = D{index+1}）
  day: string // 信号确认日
  type: CrossType
  ma5: number
  ma20: number
}

/** 金叉 = MA5 自下而上穿越 MA20；死叉 = 自上而下穿越。两线就绪前与贴线相等都不出信号。 */
export function detectCrosses(ma5: Array<number | null>, ma20: Array<number | null>): MaCross[] {
  const out: MaCross[] = []
  for (let i = 1; i < ma5.length; i += 1) {
    const p5 = ma5[i - 1]
    const p20 = ma20[i - 1]
    const c5 = ma5[i]
    const c20 = ma20[i]
    if (p5 == null || p20 == null || c5 == null || c20 == null) continue
    if (p5 <= p20 && c5 > c20) out.push({ index: i, day: `D${i + 1}`, type: 'golden', ma5: c5, ma20: c20 })
    else if (p5 >= p20 && c5 < c20) out.push({ index: i, day: `D${i + 1}`, type: 'death', ma5: c5, ma20: c20 })
  }
  return out
}

export interface BacktestTrade {
  action: 'buy' | 'sell'
  signal_day: string
  signal_index: number // 信号确认日下标（0-based）
  exec_day: string // 成交日 = 信号确认日的次一交易日
  exec_index: number
  price: number // 成交价 = 次日开盘价
  shares: number // 整手（100 股的整数倍）
  amount: number // 股票成交金额
  fees: number // 本笔费用合计（买入：佣金+过户费；卖出：佣金+过户费+印花税）
  cash_after: number
}

export interface MaCrossInfo extends MaCross {
  exec_day: string | null // null = 信号确认在最后一天，没有次日开盘可成交
  exec_price: number | null
  acted: boolean // 该信号是否真实改变了持仓（被持仓状态过滤掉的信号为 false）
  lag_days: number | null // 距上一个信号之间价格极值的天数（滞后量）
  lag_pct: number | null // 信号确认日收盘相对该极值已走出的幅度（%，金叉为已涨、死叉为已跌）
}

export interface BacktestResult {
  initial_capital: number
  crosses: MaCrossInfo[]
  strategy_trades: BacktestTrade[]
  hold_trades: BacktestTrade[]
  strategy_equity: number[]
  hold_equity: number[]
  strategy_final: number // 期末净值：现金 + 持仓按 D250 收盘估值（含费路径）
  strategy_final_no_fee: number // 同一信号序列、零费率的期末净值（拆出「费」的单独贡献）
  hold_final: number
  total_fees: number
  round_trips: number // 完整回合数（一次买入对应一次卖出）
  whipsaw_round_trips: number // 卖低买高回合数：卖出价低于其后一次买回价（震荡里的假信号代价）
}

export interface BacktestOptions {
  shortN?: number
  longN?: number
  capital?: number
}

const LOT = 100

/** 按整手算出现金能买到的最大股数（含费路径下要求买入总付出不超过现金） */
function maxAffordableShares(price: number, cash: number, useFees: boolean): number {
  let lots = Math.floor(cash / (price * LOT))
  while (lots > 0) {
    const amount = round2(lots * LOT * price)
    const paid = useFees ? buyTotalPaid(amount) : amount
    if (paid <= cash) break
    lots -= 1
  }
  return lots * LOT
}

/**
 * 交叉策略回测（第 5 章唯一实现）：
 * - 信号：detectCrosses 的金叉/死叉；成交：信号确认日的次一交易日开盘价（信号收盘才确认，天然满足 T+1）。
 * - 金叉且空仓 → 次日开盘按整手全仓买入；死叉且持仓 → 次日开盘全部卖出；
 *   持仓中的金叉与空仓中的死叉不动作（acted=false）。
 * - 费用直接调用第 3 章成本函数：佣金（万 2.5、单笔最低 5 元）+ 过户费（万 0.1）双边，
 *   卖出另加印花税（万 5）；免费对照组仅把费率置零、交易序列不变。
 * - 期末净值 = 现金 + 持仓股数 × 最后收盘价（两条曲线同口径，比较才公平）。
 */
export function backtestMaCross(candles: Candle[], opts: BacktestOptions = {}): BacktestResult {
  const shortN = opts.shortN ?? 5
  const longN = opts.longN ?? 20
  const capital = opts.capital ?? 10_000

  const closes = candles.map((c) => c.close)
  const signals = detectCrosses(ma(closes, shortN), ma(closes, longN))

  // 滞后标注：金叉回看上一信号以来 lowest close，死叉回看 highest close
  const crosses: MaCrossInfo[] = []
  let prevSignalIdx = 0
  for (const s of signals) {
    let extremeIdx = prevSignalIdx
    for (let i = prevSignalIdx; i <= s.index; i += 1) {
      const better =
        s.type === 'golden' ? (closes[i] as number) < (closes[extremeIdx] as number) : (closes[i] as number) > (closes[extremeIdx] as number)
      if (better) extremeIdx = i
    }
    const base = closes[extremeIdx] as number
    crosses.push({
      ...s,
      exec_day: null,
      exec_price: null,
      acted: false,
      lag_days: s.index - extremeIdx,
      lag_pct: round2((((closes[s.index] as number) - base) / base) * 100),
    })
    prevSignalIdx = s.index
  }

  // 逐日推进：先执行当日到期的信号，再记录当日净值
  function simulate(useFees: boolean): { trades: BacktestTrade[]; equity: number[]; fees: number } {
    let cash = capital
    let shares = 0
    let fees = 0
    const trades: BacktestTrade[] = []
    const equity: number[] = []
    const byExec = new Map<number, MaCrossInfo>()
    for (const c of crosses) {
      if (c.index + 1 < candles.length) byExec.set(c.index + 1, c)
    }

    for (let i = 0; i < candles.length; i += 1) {
      const sig = byExec.get(i)
      if (sig) {
        const price = (candles[i] as Candle).open
        if (sig.type === 'golden' && shares === 0) {
          const n = maxAffordableShares(price, cash, useFees)
          if (n > 0) {
            const amount = round2(n * price)
            const fee = useFees ? round2(commission(amount) + transferFee(amount)) : 0
            cash = round2(cash - amount - fee)
            fees = round2(fees + fee)
            shares = n
            sig.acted = true
            sig.exec_day = (candles[i] as Candle).day
            sig.exec_price = price
            trades.push({
              action: 'buy',
              signal_day: sig.day,
              signal_index: sig.index,
              exec_day: sig.exec_day,
              exec_index: i,
              price,
              shares: n,
              amount,
              fees: fee,
              cash_after: cash,
            })
          }
        } else if (sig.type === 'death' && shares > 0) {
          const amount = round2(shares * price)
          const fee = useFees ? round2(commission(amount) + transferFee(amount) + stampTax(amount)) : 0
          cash = round2(cash + amount - fee)
          fees = round2(fees + fee)
          sig.acted = true
          sig.exec_day = (candles[i] as Candle).day
          sig.exec_price = price
          trades.push({
            action: 'sell',
            signal_day: sig.day,
            signal_index: sig.index,
            exec_day: sig.exec_day,
            exec_index: i,
            price,
            shares,
            amount,
            fees: fee,
            cash_after: cash,
          })
          shares = 0
        }
      }
      equity.push(round2(cash + shares * ((candles[i] as Candle).close)))
    }
    return { trades, equity, fees }
  }

  const withFee = simulate(true)
  const noFee = simulate(false)

  // 持有不动对照：D1 开盘整手买入后一股不卖
  const open0 = (candles[0] as Candle).open
  const holdShares = maxAffordableShares(open0, capital, true)
  const holdAmount = round2(holdShares * open0)
  const holdCash = round2(capital - buyTotalPaid(holdAmount))
  const holdEquity = candles.map((c) => round2(holdCash + holdShares * c.close))
  const holdTrades: BacktestTrade[] = [
    {
      action: 'buy',
      signal_day: 'D1',
      signal_index: 0,
      exec_day: 'D1',
      exec_index: 0,
      price: open0,
      shares: holdShares,
      amount: holdAmount,
      fees: round2(commission(holdAmount) + transferFee(holdAmount)),
      cash_after: holdCash,
    },
  ]

  // 回合盘点：一次买入与其后的卖出构成一个回合；卖出价低于其后一次买回价记为卖低买高回合
  let roundTrips = 0
  let whipsawRoundTrips = 0
  let lastSellPrice = 0
  for (const t of withFee.trades) {
    if (t.action === 'buy') {
      if (roundTrips > 0 && t.price > lastSellPrice) whipsawRoundTrips += 1
    } else {
      roundTrips += 1
      lastSellPrice = t.price
    }
  }

  return {
    initial_capital: capital,
    crosses,
    strategy_trades: withFee.trades,
    hold_trades: holdTrades,
    strategy_equity: withFee.equity,
    hold_equity: holdEquity,
    strategy_final: withFee.equity[withFee.equity.length - 1] as number,
    strategy_final_no_fee: noFee.equity[noFee.equity.length - 1] as number,
    hold_final: holdEquity[holdEquity.length - 1] as number,
    total_fees: withFee.fees,
    round_trips: roundTrips,
    whipsaw_round_trips: whipsawRoundTrips,
  }
}
