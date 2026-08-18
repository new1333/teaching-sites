import type { Candle } from '../types'
import { maxDrawdown, totalReturn, tradeStats } from './metrics'

/**
 * 最小回测引擎：把一套买卖规则放进历史行情里彩排一遍。
 * 回测（backtest）——拿历史数据当考卷、把策略规则跑一遍、数出成绩的模拟；
 * 它能回答的只有「这套规则在过去这段数据上表现如何」，一字不多。
 *
 * 引擎只有一条铁律：信号在收盘后产生，成交在下一根开盘——第 2 章的 T+1 写进结构里，
 * 「今天收盘出信号、今天收盘价成交」这种偷价在引擎里拼不出来。
 * 费用三件套（佣金双向、印花税卖出、滑点）逐笔扣进现金账。
 * 引擎管不了策略有没有偷看未来——它把整个数组交给策略，只用哪根的信息是策略的自觉
 * （本章正文用「偷看写法」亲手演示偷看能偷出什么成绩）。
 */

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

/** 一笔已平仓的交易：两腿成交价、两腿费用、净盈亏 */
export type BacktestTrade = {
  /** 买入成交的下标与日期（信号日的下一根） */
  entryIndex: number
  entryDate: string
  /** 买入成交价：次日开盘价 ×(1+滑点) */
  entryPrice: number
  /** 买入腿费用：佣金 */
  entryCost: number
  /** 卖出成交的下标与日期 */
  exitIndex: number
  exitDate: string
  /** 卖出成交价：次日开盘价 ×(1−滑点) */
  exitPrice: number
  /** 卖出腿费用：佣金 + 印花税 */
  exitCost: number
  /** 成交股数（整手） */
  shares: number
  /** 两腿费用合计（元） */
  costs: number
  /** 净盈亏（元）：卖出净入账 − 买入总投入 */
  pnl: number
  /** 这笔的收益率：pnl ÷ 买入总投入 */
  returnRate: number
}

/** 期末仍持仓的照实报出：不进胜率（没平仓就没有输赢），只按收盘价进资金曲线 */
export type OpenPosition = {
  entryIndex: number
  entryDate: string
  entryPrice: number
  entryCost: number
  shares: number
}

export type BacktestReport = {
  /** 已平仓交易列表（时间旧→新） */
  trades: BacktestTrade[]
  /** 资金曲线：每根K线收盘时的账户总值（现金 + 持仓按收盘价估值），与入参K线等长 */
  equity: number[]
  /** 期末持仓；空仓记 null */
  openPosition: OpenPosition | null
  /** 总收益：期末资金 ÷ 初始资金 − 1 */
  totalReturn: number
  /** 最大回撤：资金曲线上最深的一次下坡（正数比例） */
  maxDrawdown: number
  /** 胜率：已平仓交易里净盈利的比例（平手算输）；无平仓交易记 0 */
  winRate: number
  /** 盈亏比：平均盈利 ÷ 平均亏损；没有亏损交易记 null */
  payoffRatio: number | null
  /** 买入持有基准的资金曲线：第 1 根开盘全仓买入（同款滑点与佣金）、拿到期末按收盘估值。
   *  策略曲线赢没赢过「什么都不做」，得有对照才算数 */
  buyHoldEquity: number[]
  /** 买入持有的总收益 */
  buyHoldReturn: number
  /** 初始资金（元），报告里如实上报 */
  initialCash: number
}

const DEFAULTS = {
  initialCash: 100_000,
  commissionRate: 0.0003,
  minCommission: 5,
  stampTaxRate: 0.0005,
  slippageRate: 0.001,
  warmup: 0,
}

function assertBacktestArgs(candles: readonly Candle[], strategy: Strategy, opts: Required<CostOpts>): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('backtest：candles 不能为空')
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Number.isFinite(c.open) || !(c.open > 0)) {
      throw new Error(`backtest：第 ${i} 根的开盘价必须是正的有限数字（成交价以它为锚），收到的是 ${c.open}`)
    }
    if (!Number.isFinite(c.close)) {
      throw new Error(`backtest：第 ${i} 根的收盘价必须是有限数字（估值以它为锚），收到的是 ${c.close}`)
    }
  }
  if (typeof strategy !== 'function') {
    throw new Error(`backtest：strategy 必须是函数，收到的是 ${typeof strategy}`)
  }
  if (!Number.isFinite(opts.initialCash) || opts.initialCash <= 0) {
    throw new Error(`backtest：initialCash 必须是正数，收到的是 ${opts.initialCash}`)
  }
  for (const [name, v] of [
    ['commissionRate', opts.commissionRate],
    ['stampTaxRate', opts.stampTaxRate],
    ['slippageRate', opts.slippageRate],
  ] as const) {
    if (!Number.isFinite(v) || v < 0 || v >= 1) {
      throw new Error(`backtest：${name} 必须在 [0,1) 内，收到的是 ${v}`)
    }
  }
  if (!Number.isFinite(opts.minCommission) || opts.minCommission < 0) {
    throw new Error(`backtest：minCommission 必须是非负数（元），收到的是 ${opts.minCommission}`)
  }
  if (!Number.isInteger(opts.warmup) || opts.warmup < 0) {
    throw new Error(`backtest：warmup 必须是非负整数，收到的是 ${opts.warmup}`)
  }
}

/** 回测：逐根推进——每根先执行昨日信号（开盘成交）、再按收盘估值记资金、最后问一次策略。
 *  最后一根只估值不问策（没有「下一根开盘」可成交）；买单按整手（100 股）取整，
 *  预算给费用留好余量，一手都买不起就放弃这单。 */
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
