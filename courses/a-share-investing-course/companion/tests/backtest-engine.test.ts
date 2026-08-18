import { describe, expect, it } from 'vitest'
import { backtest, type Strategy } from '../src/backtest/engine'
import { drawdownSeries, maxDrawdown, totalReturn, tradeStats } from '../src/backtest/metrics'
import { createRng, generateCandles } from '../src/data/generate'
import { crossovers } from '../src/indicators/ma'
import type { Candle } from '../src/types'

/**
 * 回测引擎的行为断言：喂行情与策略函数，只看返回读数（交易列表、资金曲线、绩效四件套）。
 * 全章核心命题在这里受审：
 * 1. T+1——信号在收盘产生、次日开盘成交；最后一根上的信号永远执行不了；同一根内买不进又卖出；
 * 2. 费用三件套逐项计入——佣金双向（含最低 5 元）、印花税只收卖出、滑点把两头成交价都变差，
 *    全部计入后同一策略收益下降；
 * 3. 绩效读数可手算——总收益、最大回撤、胜率、盈亏比与七根K线的小样本手账一致；
 * 4. 同一行情、同一引擎，含未来函数的写法与守规写法成绩显著不同；
 * 5. 参数敏感（过拟合的原料）与样本内外切分、剔除「退市」样本的幸存者偏差，都能亲手跑出读数；
 * 6. 结构性非法输入抛中文错误。
 */

/** 剧本策略：按下标表发信号——测试里想让哪天喊买就哪天喊买 */
const scripted = (plan: Record<number, 'buy' | 'sell'>): Strategy => (_cs, i) => plan[i] ?? 'hold'

/** 零费用档：比例与最低佣金全为 0——手算对照组 */
const FREE = { commissionRate: 0, minCommission: 0, stampTaxRate: 0, slippageRate: 0, initialCash: 100_000 }

/** 手账样本：七根K线，开收盘按下表手工排定，信号剧本 {0:买, 2:卖, 3:买, 4:卖} */
const HAND: Candle[] = [
  { date: '2026-03-02', open: 10, high: 11.2, low: 9.9, close: 10.4, volume: 100000 },
  { date: '2026-03-03', open: 10, high: 11.2, low: 9.95, close: 11, volume: 100000 },
  { date: '2026-03-04', open: 10.8, high: 10.9, low: 9.9, close: 10, volume: 100000 },
  { date: '2026-03-05', open: 10.5, high: 10.6, low: 10.1, close: 10.2, volume: 100000 },
  { date: '2026-03-06', open: 10, high: 10.3, low: 9.4, close: 9.5, volume: 100000 },
  { date: '2026-03-09', open: 9.6, high: 9.7, low: 9.3, close: 9.4, volume: 100000 },
  { date: '2026-03-10', open: 9.5, high: 9.6, low: 9.3, close: 9.45, volume: 100000 },
]
const HAND_PLAN: Record<number, 'buy' | 'sell'> = { 0: 'buy', 2: 'sell', 3: 'buy', 4: 'sell' }

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

describe('T+1：当天收盘的信号，次日开盘才成交', () => {
  const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), FREE)

  it('第 1 根收盘喊买，成交在第 2 根开盘：entryIndex=1、成交价=第 2 根开盘价', () => {
    expect(r.trades).toHaveLength(1)
    expect(r.trades[0]!.entryIndex).toBe(1)
    expect(r.trades[0]!.entryIndex).not.toBe(0)
    expect(r.trades[0]!.entryPrice).toBeCloseTo(HAND[1]!.open, 10)
    expect(r.trades[0]!.entryDate).toBe('2026-03-03')
  })

  it('第 3 根收盘喊卖，成交在第 4 根开盘：exitIndex=entryIndex+1，买进当天绝无卖出', () => {
    expect(r.trades[0]!.exitIndex).toBe(3)
    expect(r.trades[0]!.exitPrice).toBeCloseTo(HAND[3]!.open, 10)
    for (const t of r.trades) expect(t.exitIndex).toBeGreaterThanOrEqual(t.entryIndex + 1)
  })

  it('紧跟着喊卖（买进次日收盘）也要再等一天：成交隔一根，T+1 由结构保证', () => {
    const s = backtest(HAND, scripted({ 0: 'buy', 1: 'sell' }), FREE)
    expect(s.trades).toHaveLength(1)
    expect(s.trades[0]!.entryIndex).toBe(1)
    expect(s.trades[0]!.exitIndex).toBe(2)
  })

  it('最后一根上的信号永远执行不了：无平仓交易、无持仓', () => {
    const last = backtest(HAND, scripted({ 6: 'buy' }), FREE)
    expect(last.trades).toHaveLength(0)
    expect(last.openPosition).toBeNull()
    expect(last.totalReturn).toBe(0)
  })

  it('倒数第二根喊买、期末仍持仓：openPosition 如实报出，不进胜率', () => {
    const open = backtest(HAND, scripted({ 5: 'buy' }), FREE)
    expect(open.trades).toHaveLength(0)
    expect(open.openPosition).not.toBeNull()
    expect(open.openPosition!.entryIndex).toBe(6)
    expect(open.winRate).toBe(0)
  })

  it('重复的买入信号不重复建仓：引擎单一持仓，第二次喊买被忽略', () => {
    const twice = backtest(HAND, scripted({ 0: 'buy', 1: 'buy', 2: 'buy' }), FREE)
    expect(twice.trades).toHaveLength(0)
    expect(twice.openPosition!.shares).toBe(10000)
  })
})

describe('零费用手账：绩效四件套与七根K线的纸面账一致', () => {
  const r = backtest(HAND, scripted(HAND_PLAN), FREE)

  it('两笔交易：第一笔 10 买 10.5 卖赚 5000（+5%）；第二笔全仓 105000 买 10500 股、9.6 卖亏 4200（−4%）', () => {
    expect(r.trades).toHaveLength(2)
    expect(r.trades[0]!.shares).toBe(10000)
    expect(r.trades[0]!.pnl).toBeCloseTo(5000, 6)
    expect(r.trades[0]!.returnRate).toBeCloseTo(0.05, 10)
    expect(r.trades[1]!.shares).toBe(10500) // 卖出后现金 105000 全押：整手取整买 10500 股
    expect(r.trades[1]!.pnl).toBeCloseTo(-4200, 6)
    expect(r.trades[1]!.returnRate).toBeCloseTo(-0.04, 10)
  })

  it('资金曲线与K线等长：[100000,110000,100000,105000,99750,100800,100800]', () => {
    expect(r.equity).toHaveLength(HAND.length)
    const want = [100000, 110000, 100000, 105000, 99750, 100800, 100800]
    for (let i = 0; i < want.length; i++) expect(r.equity[i]).toBeCloseTo(want[i]!, 6)
  })

  it('总收益 +0.8%；最大回撤 = 1 − 99750/110000 ≈ 9.32%（山顶 110000、谷底 99750）', () => {
    expect(r.totalReturn).toBeCloseTo(0.008, 10)
    expect(r.maxDrawdown).toBeCloseTo(1 - 99750 / 110000, 10)
  })

  it('胜率 1/2；盈亏比 = 5000/4200 = 25/21 ≈ 1.19', () => {
    expect(r.winRate).toBeCloseTo(0.5, 10)
    expect(r.payoffRatio).toBeCloseTo(25 / 21, 10)
  })

  it('买入持有基准同口径算出：期末 94500，收益 −5.5%——策略这回跑赢了基准', () => {
    expect(r.buyHoldEquity).toHaveLength(HAND.length)
    expect(r.buyHoldEquity[6]).toBeCloseTo(94500, 6)
    expect(r.buyHoldReturn).toBeCloseTo(-0.055, 10)
    expect(r.totalReturn).toBeGreaterThan(r.buyHoldReturn)
  })
})

describe('费用三件套：逐项计入，收益应声下降', () => {
  it('只开滑点（0.1%）：买价抬高 10→10.01、卖价压低 10.5→10.4895，其余费用为 0', () => {
    const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), { ...FREE, slippageRate: 0.001 })
    expect(r.trades[0]!.entryPrice).toBeCloseTo(10.01, 10)
    expect(r.trades[0]!.exitPrice).toBeCloseTo(10.4895, 10)
    expect(r.trades[0]!.entryCost).toBe(0)
    expect(r.trades[0]!.exitCost).toBe(0)
  })

  it('只开佣金（万3）：买卖双向都收——整手预算后 9900 股，买腿 99000×0.0003=29.7、卖腿 103950×0.0003=31.185', () => {
    const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), { ...FREE, commissionRate: 0.0003 })
    expect(r.trades[0]!.shares).toBe(9900) // 100000 元要给佣金留预算：买 9900 而不是 10000 股
    expect(r.trades[0]!.entryCost).toBeCloseTo(29.7, 6)
    expect(r.trades[0]!.exitCost).toBeCloseTo(31.185, 6)
    expect(r.trades[0]!.costs).toBeCloseTo(60.885, 6)
  })

  it('最低佣金 5 元：1500 元资金买一手（1000 元成交额），佣金按 5 元收而不是 0.3 元', () => {
    const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), {
      ...FREE,
      initialCash: 1500,
      commissionRate: 0.0003,
      minCommission: 5,
    })
    expect(r.trades[0]!.shares).toBe(100)
    expect(r.trades[0]!.entryCost).toBe(5)
  })

  it('只开印花税（0.05%）：买腿不收、卖腿 105000×0.0005=52.5', () => {
    const r = backtest(HAND, scripted({ 0: 'buy', 2: 'sell' }), { ...FREE, stampTaxRate: 0.0005 })
    expect(r.trades[0]!.entryCost).toBe(0)
    expect(r.trades[0]!.exitCost).toBeCloseTo(52.5, 6)
  })

  it('三件套全开（默认档）后：同一策略、同一行情，总收益低于零费用档', () => {
    const free = backtest(HAND, scripted(HAND_PLAN), FREE)
    const full = backtest(HAND, scripted(HAND_PLAN))
    expect(full.totalReturn).toBeLessThan(free.totalReturn)
    for (const t of full.trades) expect(t.costs).toBeGreaterThan(0)
  })

  it('高换手放大费用：快线交叉策略 200 根内做 10 笔，费用咬掉 2 个百分点以上', () => {
    const market = generateCandles(createRng(2101), { days: 200, startPrice: 20, volatility: 0.03 })
    const free = backtest(market, maCross(3, 10), FREE)
    const full = backtest(market, maCross(3, 10))
    expect(full.trades.length).toBeGreaterThanOrEqual(10)
    expect(free.totalReturn - full.totalReturn).toBeGreaterThanOrEqual(0.02)
  })
})

describe('未来函数：同一行情、同一引擎，偷看写法成绩显著不同', () => {
  const market = generateCandles(createRng(2102), { days: 300, startPrice: 10, volatility: 0.03 })
  const honest = backtest(market, maCross(5, 20), FREE)
  const cheater = backtest(market, peek(), FREE)

  it('守规写法有像样的交易量（≥3 笔），不是空转', () => {
    expect(honest.trades.length).toBeGreaterThanOrEqual(3)
  })

  it('偷看写法（最低收盘日买、最高收盘日卖）比守规写法多赚 25 个百分点以上', () => {
    expect(cheater.trades.length).toBeGreaterThanOrEqual(1)
    expect(cheater.totalReturn - honest.totalReturn).toBeGreaterThanOrEqual(0.25)
  })

  it('未来函数的指纹：同一根K线上的信号，会被之后的行情改写', () => {
    const mk = (closes: number[]): Candle[] =>
      closes.map((c, i) => ({
        date: `2026-03-${String(i + 2).padStart(2, '0')}`,
        open: c,
        high: c + 0.1,
        low: c - 0.1,
        close: c,
        volume: 100000,
      }))
    const sameHead = [10, 9.5, 9, 8.5, 8]
    const turnsUp = mk([...sameHead, 8.5, 9, 9.5, 10, 10.5, 10.2]) // 全程最低在第 5 根
    const keepsFalling = mk([...sameHead, 7.5, 7, 6.5, 6, 5.5, 5.2]) // 最低在最后一根
    const p = peek()
    expect(p(turnsUp, 4)).toBe('buy') // 前五行情完全相同——
    expect(p(keepsFalling, 4)).toBe('hold') // 只因之后走的不同，第 5 根的信号就变了
  })
})

describe('过拟合：参数敏感与样本内外切分', () => {
  const GRID: [number, number][] = [
    [2, 20],
    [3, 10],
    [5, 10],
    [5, 20],
    [10, 20],
    [10, 30],
    [20, 60],
  ]
  const series = generateCandles(createRng(2121), { days: 400, startPrice: 20, volatility: 0.025 })
  const SPLIT = 280 // 前 280 根调参（样本内），后 120 根验证（样本外）
  const inSample = series.slice(0, SPLIT)
  const outSample = series.slice(SPLIT)
  const isRet = GRID.map(([f, s]) => backtest(inSample, maCross(f, s), FREE).totalReturn)
  const osRet = GRID.map(([f, s]) => backtest(outSample, maCross(f, s), FREE).totalReturn)
  const bestIn = isRet.indexOf(Math.max(...isRet))

  it('参数敏感性：同一策略族换窗口，样本内成绩拉开 15 个百分点以上', () => {
    expect(Math.max(...isRet) - Math.min(...isRet)).toBeGreaterThanOrEqual(0.15)
  })

  it('样本内冠军一到样本外就掉队：出样本收益低于自己样本内的成绩', () => {
    expect(osRet[bestIn]).toBeLessThan(isRet[bestIn])
  })

  it('样本内选出的冠军参数，不是样本外最好的参数——样本外另有状元', () => {
    const bestOut = osRet.indexOf(Math.max(...osRet))
    expect(bestOut).not.toBe(bestIn)
  })
})

describe('幸存者偏差：剔除「退市」样本后，读数整体虚高', () => {
  /** 12 只合成股票；每 3 只里第 1 只的末段崩掉 65%（模拟退市/暴雷出局） */
  const crashedTail = (cs: readonly Candle[]): Candle[] =>
    cs.map((c, i) =>
      i < cs.length - 3
        ? c
        : {
            ...c,
            open: Math.round(c.open * 35) / 100,
            high: Math.round(c.high * 35) / 100,
            low: Math.round(c.low * 35) / 100,
            close: Math.round(c.close * 35) / 100,
          },
    )
  const stocks = Array.from({ length: 12 }, (_, k) => {
    const cs = generateCandles(createRng(300 + k), { days: 200, startPrice: 10, volatility: 0.02 })
    return k % 3 === 0 ? crashedTail(cs) : cs
  })
  const hold: Strategy = () => 'hold' // 不交易，只读引擎内置的买入持有基准
  const returns = stocks.map((cs) => backtest(cs, hold, FREE).buyHoldReturn)
  const fullAvg = returns.reduce((a, b) => a + b, 0) / returns.length
  const survivorAvg =
    returns.filter((_, k) => k % 3 !== 0).reduce((a, b) => a + b, 0) / (returns.length - 4)

  it('全样本平均收益被崩盘股拉低：幸存者样本的平均读数高出 10 个百分点以上', () => {
    expect(survivorAvg - fullAvg).toBeGreaterThanOrEqual(0.1)
  })

  it('崩盘的四只平均亏 35% 以上；同一只股票的成绩不因在不在样本里而改变——虚高的全是平均数', () => {
    const crashedAvg = returns.filter((_, k) => k % 3 === 0).reduce((a, b) => a + b, 0) / 4
    expect(crashedAvg).toBeLessThanOrEqual(-0.35)
    for (const r of returns) expect(r).toBeGreaterThan(-1)
  })
})

describe('metrics：脱离引擎也能独立手算', () => {
  it('最大回撤：[1,1.2,0.9,1.1,0.8] 的最深下坡是 1−0.8/1.2 ≈ 33.33%（山顶 1.2 到谷底 0.8）', () => {
    expect(maxDrawdown([1, 1.2, 0.9, 1.1, 0.8])).toBeCloseTo(1 - 0.8 / 1.2, 12)
  })

  it('只涨不跌与只跌不涨：回撤分别为 0 与 1−2/3', () => {
    expect(maxDrawdown([2, 2, 2])).toBe(0)
    expect(maxDrawdown([3, 2])).toBeCloseTo(1 / 3, 12)
  })

  it('总收益 = 期末÷期初−1：[100,110]→+10%，[100,90]→−10%', () => {
    expect(totalReturn([100, 110])).toBeCloseTo(0.1, 12)
    expect(totalReturn([100, 90])).toBeCloseTo(-0.1, 12)
  })

  it('tradeStats：[+5000,−4000,+1000,0] 胜率 1/2（平手算输）、盈亏比 3000/2000=1.5', () => {
    const s = tradeStats([5000, -4000, 1000, 0])
    expect(s.count).toBe(4)
    expect(s.wins).toBe(2)
    expect(s.winRate).toBeCloseTo(0.5, 12)
    expect(s.avgWin).toBeCloseTo(3000, 10)
    expect(s.avgLoss).toBeCloseTo(2000, 10)
    expect(s.payoffRatio).toBeCloseTo(1.5, 12)
  })

  it('无交易记 0 胜率、盈亏比 null；只赢不亏时盈亏比也记 null（除数不存在）', () => {
    const empty = tradeStats([])
    expect(empty.winRate).toBe(0)
    expect(empty.payoffRatio).toBeNull()
    expect(tradeStats([100, 50]).payoffRatio).toBeNull()
  })
})

describe('结构性非法输入：抛中文错误', () => {
  it.each([
    ['空行情', () => backtest([], scripted({ 0: 'buy' }))],
    ['策略不是函数', () => backtest(HAND, 'buy' as unknown as Strategy)],
    ['初始资金为 0', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, initialCash: 0 })],
    ['初始资金为负', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, initialCash: -1 })],
    ['初始资金 NaN', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, initialCash: NaN })],
    ['佣金率为负', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, commissionRate: -0.001 })],
    ['最低佣金为负', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, minCommission: -1 })],
    ['印花税 NaN', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, stampTaxRate: NaN })],
    ['滑点 ≥ 1', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, slippageRate: 1 })],
    ['滑点为负', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, slippageRate: -0.1 })],
    ['warmup 为负', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, warmup: -1 })],
    ['warmup 非整数', () => backtest(HAND, scripted({ 0: 'buy' }), { ...FREE, warmup: 1.5 })],
    ['K线含 NaN 开盘价', () => backtest([{ ...HAND[0]!, open: NaN }, ...HAND.slice(1)], scripted({ 0: 'buy' }))],
    ['空资金曲线求回撤', () => maxDrawdown([])],
    ['资金曲线含 NaN', () => maxDrawdown([1, NaN, 2])],
    ['期初为 0 求总收益', () => totalReturn([0, 1])],
    ['盈亏列表含非数值', () => tradeStats([100, NaN])],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})

describe('drawdownSeries：逐格回撤序列（第 21 章回测明细图）', () => {
  it('相对历史峰值：[100,120,60,90] → [0,0,−0.5,−0.25]，首格恒为 0', () => {
    expect(drawdownSeries([100, 120, 60, 90])).toEqual([0, 0, -0.5, -0.25])
  })

  it('最深一格与 maxDrawdown 同源（差一个符号），创新高时回撤归零', () => {
    const curve = [100, 80, 130, 117, 140]
    const dd = drawdownSeries(curve)
    expect(dd[1]).toBeCloseTo(-0.2, 12)
    expect(dd[3]).toBeCloseTo(-0.1, 12)
    expect(dd[4]).toBe(0)
    expect(Math.min(...dd)).toBeCloseTo(-maxDrawdown(curve), 12)
  })

  it('守规回测的资金曲线（种子 2102·MA5/20 交叉）：drawdown[0] === 0，最深一格 = −最大回撤', () => {
    const market = generateCandles(createRng(2102), { days: 300, startPrice: 10, volatility: 0.03 })
    const strategy: Strategy = (candles, i) => {
      const kind = crossovers(candles, 5, 20).find((c) => c.index === i)
      return kind?.kind === 'golden' ? 'buy' : kind?.kind === 'dead' ? 'sell' : 'hold'
    }
    const r = backtest(market, strategy)
    const dd = drawdownSeries(r.equity)
    expect(dd).toHaveLength(market.length)
    expect(dd[0]).toBe(0)
    expect(Math.min(...dd)).toBeCloseTo(-r.maxDrawdown, 12)
    expect(r.maxDrawdown).toBeCloseTo(0.412, 2) // 正文读数：最大回撤 41.2%
  })

  it.each([
    ['空资金曲线求逐格回撤', () => drawdownSeries([])],
    ['资金曲线含 NaN', () => drawdownSeries([1, NaN, 2])],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
