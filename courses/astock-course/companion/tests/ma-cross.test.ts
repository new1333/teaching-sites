// companion/tests/ma-cross.test.ts · 第 5 章 均线与交叉回测：已知值、交叉检测、策略-持有对比与数据集互锁
// 金标值（趋势行情的关键交易日、回测期末值、交易笔数）来自固定种子生成器与回测器的实际输出，
// 任何参数改动若破坏可教结局或金标，对应测试即红。

import { describe, expect, it } from 'vitest'
import { buildCh05 } from '../src/datasets/ch05-trend-ma'
import { commission, stampTax, transferFee } from '../src/costs'
import {
  TREND_COUNT,
  backtestMaCross,
  detectCrosses,
  generateDailyCandles,
  generateTrendCandles,
  ma,
  type Candle,
} from '../src/market'
import { round2 } from '../src/round'

describe('均线 ma()：手工已知值', () => {
  it('ma2：窗口不满为 null，其后为最近 2 日收盘的均值', () => {
    expect(ma([10, 11, 12, 13, 14], 2)).toEqual([null, 10.5, 11.5, 12.5, 13.5])
  })

  it('ma5：前 4 日窗口不满，第 5 日 = (10+11+12+13+14)/5 = 12', () => {
    expect(ma([10, 11, 12, 13, 14], 5)).toEqual([null, null, null, null, 12])
  })

  it('均值按分舍入：10.01、10.02、10.06 的 3 日均值 = 10.03', () => {
    expect(ma([10.01, 10.02, 10.06], 3)).toEqual([null, null, 10.03])
  })
})

describe('交叉检测：手工样本', () => {
  it('ma5 上穿 ma20 为金叉、下穿为死叉，位置与方向逐条对上', () => {
    const maLong = [5, 5, 5, 5, 5, 5]
    const maShort = [4, 4.5, 5.5, 5.2, 4.8, 5.3]
    expect(detectCrosses(maShort, maLong)).toEqual([
      { index: 2, day: 'D3', type: 'golden', ma5: 5.5, ma20: 5 },
      { index: 4, day: 'D5', type: 'death', ma5: 4.8, ma20: 5 },
      { index: 5, day: 'D6', type: 'golden', ma5: 5.3, ma20: 5 },
    ])
  })

  it('任一均线尚未就绪（null）时不出信号', () => {
    const maShort = [null, null, 6, 6, 6]
    const maLong = [null, null, null, 5, 5]
    expect(detectCrosses(maShort, maLong)).toEqual([])
  })

  it('贴线相等不算交叉，直到明确穿越', () => {
    const maLong = [5, 5, 5, 5]
    const maShort = [5, 5, 5.1, 5.1]
    expect(detectCrosses(maShort, maLong)).toEqual([
      { index: 2, day: 'D3', type: 'golden', ma5: 5.1, ma20: 5 },
    ])
  })
})

const candles = generateTrendCandles()
const closes = candles.map((c) => c.close)
const at = (n: number): Candle => candles[n - 1] as Candle
const ma5 = ma(closes, 5)
const ma20 = ma(closes, 20)
const crosses = detectCrosses(ma5, ma20)
const bt = backtestMaCross(candles)

describe('趋势行情生成器：确定性、长度与两段剧情隔离', () => {
  it('同种子两次生成逐根一致；共 250 根，标签 D1…D250', () => {
    expect(generateTrendCandles()).toEqual(candles)
    expect(candles).toHaveLength(TREND_COUNT)
    expect(candles[0]?.day).toBe('D1')
    expect(candles[TREND_COUNT - 1]?.day).toBe(`D${TREND_COUNT}`)
  })

  it('每根蜡烛 OHLC 大小关系成立，且全天不出主板 ±10% 涨跌幅约束', () => {
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i] as Candle
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.volume).toBeGreaterThan(0)
      if (i > 0) {
        const prev = candles[i - 1] as Candle
        expect(c.high).toBeLessThanOrEqual(Math.round(prev.close * 1.1 * 100) / 100)
        expect(c.low).toBeGreaterThanOrEqual(Math.round(prev.close * 0.9 * 100) / 100)
      }
    }
  })

  it('与第 4 章的 60 根剧情是两段独立行情（首根四价与量都不同）', () => {
    const kline = generateDailyCandles()
    expect(candles[0]).not.toEqual(kline[0])
    expect(closes[TREND_COUNT - 1]).not.toBe(kline[kline.length - 1]?.close)
  })
})

describe('交叉检测：趋势行情上的信号形态', () => {
  it('MA5 与 MA20 的前段为 null：MA5 从 D5、MA20 从 D20 起有值', () => {
    expect(ma5.slice(0, 4)).toEqual([null, null, null, null])
    expect(ma5[4]).not.toBeNull()
    expect(ma20.slice(0, 19)).toEqual(Array.from({ length: 19 }, () => null))
    expect(ma20[19]).not.toBeNull()
  })

  it('全程有信号、两型都出现；实际执行的信号金叉死叉交替', () => {
    expect(crosses.length).toBeGreaterThanOrEqual(6)
    const types = crosses.map((c) => c.type)
    expect(types).toContain('golden')
    expect(types).toContain('death')
    const actedTypes = bt.crosses.filter((c) => c.acted).map((c) => c.type)
    expect(actedTypes.length).toBeGreaterThanOrEqual(6)
    for (let i = 1; i < actedTypes.length; i += 1) {
      expect(actedTypes[i]).not.toBe(actedTypes[i - 1])
    }
    expect(actedTypes[0]).toBe('golden')
  })
})

describe('回测器：机制不变量与可教结局', () => {
  it('期初 1 万元；两条净值曲线各 250 点、期末值与逐日口径一致', () => {
    expect(bt.initial_capital).toBe(10_000)
    expect(bt.strategy_equity).toHaveLength(TREND_COUNT)
    expect(bt.hold_equity).toHaveLength(TREND_COUNT)
    expect(bt.strategy_final).toBe(bt.strategy_equity[TREND_COUNT - 1])
    expect(bt.hold_final).toBe(bt.hold_equity[TREND_COUNT - 1])
  })

  it('持有不动：首日开盘整手买入一次，此后不再交易', () => {
    expect(bt.hold_trades).toHaveLength(1)
    const t = bt.hold_trades[0] as { exec_day: string; action: string }
    expect(t.exec_day).toBe('D1')
    expect(t.action).toBe('buy')
  })

  it('每一笔买卖都按整手成交、现金不为负；卖出都在其买入之后', () => {
    let cash = bt.initial_capital
    let boughtAt = -1
    for (const t of bt.strategy_trades) {
      expect(t.shares % 100).toBe(0)
      expect(t.shares).toBeGreaterThan(0)
      cash = round2(t.action === 'buy' ? cash - t.amount - t.fees : cash + t.amount - t.fees)
      expect(cash).toBeGreaterThanOrEqual(0)
      expect(round2(cash)).toBe(t.cash_after)
      if (t.action === 'buy') boughtAt = t.exec_index
      else expect(t.exec_index).toBeGreaterThan(boughtAt)
    }
  })

  it('费用逐笔可复算：全部来自第 3 章成本函数（佣金+过户费双边、卖出加印花税）', () => {
    let fees = 0
    for (const t of bt.strategy_trades) {
      if (t.action === 'buy') fees += commission(t.amount) + transferFee(t.amount)
      else fees += commission(t.amount) + transferFee(t.amount) + stampTax(t.amount)
    }
    expect(round2(fees)).toBe(bt.total_fees)
    expect(bt.total_fees).toBeGreaterThan(0)
  })

  it('信号次一交易日开盘成交：每笔交易的 exec_index = 信号 index + 1', () => {
    const acted = new Map(bt.crosses.filter((c) => c.exec_day !== null).map((c) => [c.index, c]))
    for (const t of bt.strategy_trades) {
      const c = acted.get(t.signal_index)
      expect(c).toBeDefined()
      expect(t.exec_index).toBe((c as { index: number }).index + 1)
    }
  })

  it('手续费只会更糟：含费期末 < 免费期末', () => {
    expect(bt.strategy_final).toBeLessThan(bt.strategy_final_no_fee)
  })

  it('可教结局：交叉策略（含费）跑输持有不动；滞后与假信号在免费情形下同样跑输', () => {
    expect(bt.strategy_final).toBeLessThan(bt.hold_final)
    expect(bt.strategy_final_no_fee).toBeLessThan(bt.hold_final)
  })

  it('交易足够活跃：成交笔数 ≥ 6，完整回合 ≥ 3，其中卖低买高的回合可指认', () => {
    expect(bt.strategy_trades.length).toBeGreaterThanOrEqual(6)
    expect(bt.round_trips).toBeGreaterThanOrEqual(3)
    expect(bt.whipsaw_round_trips).toBeGreaterThanOrEqual(2)
  })

  it('卖飞锚点：第一趟完整回合把股票卖低买高（卖出价低于其后一次买回价）', () => {
    const [buy1, sell1, buy2] = bt.strategy_trades
    expect(buy1?.action).toBe('buy')
    expect(sell1?.action).toBe('sell')
    expect(buy2?.action).toBe('buy')
    expect(sell1?.price).toBeLessThan(buy2?.price ?? 0)
  })
})

describe('已知值：固定种子下的金标（防参数漂移）', () => {
  it('年内最低收盘 D19 = 9.53；全程最高收盘在 D250 = 18.79', () => {
    const min = Math.min(...closes)
    expect(closes.indexOf(min)).toBe(18)
    expect(at(19).close).toBe(9.53)
    expect(at(TREND_COUNT).close).toBe(18.79)
  })

  it('首个信号 D30 金叉，次日 D31 开盘 9.69 买入（比持有对照的 D1 开盘 9.98 还便宜）', () => {
    expect(crosses[0]).toMatchObject({ day: 'D30', type: 'golden', ma5: 9.7, ma20: 9.69 })
    const firstBuy = bt.strategy_trades[0] as { exec_day: string; price: number; shares: number }
    expect(firstBuy).toMatchObject({ exec_day: 'D31', price: 9.69, shares: 1000 })
    expect(bt.hold_trades[0]?.price).toBe(9.98)
  })

  it('卖飞回合：D74 死叉开盘 10.68 卖出，D86 金叉追高 11.17 买回（且只能买回 900 股）', () => {
    const sell = bt.strategy_trades[1] as { exec_day: string; price: number; shares: number }
    const rebuy = bt.strategy_trades[2] as { exec_day: string; price: number; shares: number }
    expect(sell).toMatchObject({ exec_day: 'D74', price: 10.68, shares: 1000 })
    expect(rebuy).toMatchObject({ exec_day: 'D86', price: 11.17, shares: 900 })
  })

  it('回测期末金标：策略 18091.59 / 免费 18145 / 持有 18804.9，费用合计 53.41', () => {
    expect(bt.strategy_final).toBe(18_091.59)
    expect(bt.strategy_final_no_fee).toBe(18_145)
    expect(bt.hold_final).toBe(18_804.9)
    expect(bt.total_fees).toBe(53.41)
    expect(bt.strategy_trades.length).toBe(7)
    expect(bt.round_trips).toBe(3)
    expect(bt.whipsaw_round_trips).toBe(2)
  })

  it('支撑压力金标：压力 D132 收 14.45，支撑 D166 收 12.69，突破 D199 收 14.54', () => {
    expect(at(132).close).toBe(14.45)
    expect(at(166).close).toBe(12.69)
    expect(at(199).close).toBe(14.54)
  })

  it('纸笔演算锚点：D246–D250 收盘手算 MA5 = 18.69，与实现一致', () => {
    const last5 = closes.slice(245) as number[]
    expect(last5).toEqual([18.68, 18.76, 18.54, 18.67, 18.79])
    expect(ma(last5, 5)).toEqual([null, null, null, null, 18.69])
    expect(ma5[249]).toBe(18.69)
  })
})

describe('数据集 ma-cross.json：与实现互锁', () => {
  const { file, data } = buildCh05()
  interface MaData {
    labeling: string
    meta: {
      seed: number
      total: number
      short_ma: number
      long_ma: number
      initial_capital: number
      generator: string
      fee_note: string
    }
    candles: Candle[]
    ma5: Array<number | null>
    ma20: Array<number | null>
    crosses: Array<{ day: string; type: string; exec_day: string | null; exec_price: number | null }>
    backtest: {
      strategy_final: number
      hold_final: number
      strategy_final_no_fee: number
      total_fees: number
      trade_count: number
      round_trips: number
      whipsaw_round_trips: number
      strategy_equity: number[]
      hold_equity: number[]
    }
  }
  const parsed = data as unknown as MaData

  it('文件名、教学声明与元数据', () => {
    expect(file).toBe('ma-cross.json')
    expect(parsed.labeling).toContain('教学示意')
    expect(parsed.meta).toMatchObject({
      seed: 42,
      total: TREND_COUNT,
      short_ma: 5,
      long_ma: 20,
      initial_capital: 10_000,
    })
    expect(parsed.meta.generator).toContain('market.ts')
    expect(parsed.meta.fee_note).toContain('印花税')
  })

  it('candles、ma5、ma20 与生成器/均线实现逐根一致', () => {
    expect(parsed.candles).toEqual(candles)
    expect(parsed.ma5).toEqual(ma5)
    expect(parsed.ma20).toEqual(ma20)
  })

  it('crosses 与回测器输出一致，每条含方向、信号日与成交信息', () => {
    expect(parsed.crosses).toEqual(bt.crosses)
    for (const c of parsed.crosses) {
      expect(['golden', 'death']).toContain(c.type)
      expect(c.day).toMatch(/^D\d+$/)
    }
  })

  it('backtest 承重数字与回测器一致，可教结局在数据文件里同样成立', () => {
    const bt2 = backtestMaCross(candles)
    expect(parsed.backtest.strategy_final).toBe(bt2.strategy_final)
    expect(parsed.backtest.hold_final).toBe(bt2.hold_final)
    expect(parsed.backtest.strategy_final_no_fee).toBe(bt2.strategy_final_no_fee)
    expect(parsed.backtest.total_fees).toBe(bt2.total_fees)
    expect(parsed.backtest.trade_count).toBe(bt2.strategy_trades.length)
    expect(parsed.backtest.round_trips).toBe(bt2.round_trips)
    expect(parsed.backtest.whipsaw_round_trips).toBe(bt2.whipsaw_round_trips)
    expect(parsed.backtest.strategy_final).toBeLessThan(parsed.backtest.hold_final)
    expect(parsed.backtest.strategy_equity).toHaveLength(TREND_COUNT)
    expect(parsed.backtest.hold_equity).toHaveLength(TREND_COUNT)
  })
})
