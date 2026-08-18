import { describe, expect, it } from 'vitest'
import { chipDistribution } from '../src/chips/distribution'
import { createRng, generateCandles } from '../src/data/generate'
import type { Candle } from '../src/types'

/**
 * 筹码分布的行为断言：只喂 K 线序列与参数，只看每天的分布快照
 * （价位-持仓量、获利盘比例、平均成本、筹码峰），内部怎么分桶、怎么迭代一概不问。
 * 全章核心命题在这里受审：
 * 1. 换手衰减模型守恒：任何一天的持仓量总和都等于流通股本——筹码不会凭空生灭；
 * 2. 衰减与分摊的手算：构造的先跌后涨序列（三轮换手）逐日与纸面推演一致；
 * 3. 获利盘/套牢盘/平均成本/筹码峰都从分布读出：反弹日头顶的高位套牢峰被正确标出；
 * 4. 固定种子确定性：同一输入两次计算输出全等；
 * 5. 结构性非法输入抛中文错误。
 */

/** 一字平盘 K 线：开=高=低=收，全部成交量落进同一个价位桶，便于手工排布 */
const flatBar = (day: number, price: number, volume: number): Candle => ({
  date: `2026-09-${String(day).padStart(2, '0')}`,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
})

/** 区间 K 线：开=收=中间价、高=high、低=low——价格区间内的均匀分摊用它审 */
const rangeBar = (day: number, low: number, high: number, close: number, volume: number): Candle => ({
  date: `2026-09-${String(day).padStart(2, '0')}`,
  open: (low + high) / 2,
  high,
  low,
  close,
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

describe('总筹码守恒：换手衰减不生不灭', () => {
  it('先跌后涨序列：每一天的持仓量总和都等于流通股本', () => {
    const days = chipDistribution(FALL_AND_REBOUND, { floatShares: FLOAT, binWidth: 1 })
    expect(days).toHaveLength(4)
    for (const d of days) {
      const total = d.buckets.reduce((s, b) => s + b.quantity, 0)
      expect(total).toBeCloseTo(FLOAT, 6)
    }
  })

  it('合成随机行情（60 根、默认参数）：每日快照的持仓量总和守恒', () => {
    const cs = generateCandles(createRng(1414), { days: 60, startPrice: 10 })
    for (const d of chipDistribution(cs)) {
      const total = d.buckets.reduce((s, b) => s + b.quantity, 0)
      expect(total).toBeCloseTo(100_000_000, 0)
    }
  })

  it('零成交的日子：分布原样照抄，快照照常产出', () => {
    const cs = [...FALL_AND_REBOUND, flatBar(5, 10, 0)]
    const days = chipDistribution(cs, { floatShares: FLOAT, binWidth: 1 })
    const total = days[days.length - 1]!.buckets.reduce((s, b) => s + b.quantity, 0)
    expect(total).toBeCloseTo(FLOAT, 6)
    expect(days[days.length - 1]!.buckets).toEqual(days[3]!.buckets)
  })
})

describe('换手衰减与分摊：逐日与手算一致', () => {
  const days = chipDistribution(FALL_AND_REBOUND, { floatShares: FLOAT, binWidth: 1 })

  it('首日：全部流通盘落位首日价格区间，一字平盘落进一个桶', () => {
    expect(days[0]!.buckets).toEqual([{ price: 12, quantity: FLOAT }])
    expect(days[0]!.winnerRatio).toBeCloseTo(1, 6)
  })

  it('第一轮换手 30%：12 元剩 700、新 300 落 10 元，收盘 10 元获利盘 30%', () => {
    expect(days[1]!.buckets).toEqual([
      { price: 10, quantity: 300 },
      { price: 12, quantity: 700 },
    ].map((b) => ({ price: b.price, quantity: expect.closeTo(b.quantity, 6) })))
    expect(days[1]!.winnerRatio).toBeCloseTo(0.3, 6)
    expect(days[1]!.averageCost).toBeCloseTo(11.4, 6) //（700×12 + 300×10）÷ 1000
  })

  it('第二轮换手 20%：套牢 560/240、获利 200，平均成本 10.92 元', () => {
    const byPrice = new Map(days[2]!.buckets.map((b) => [b.price, b.quantity]))
    expect(byPrice.get(12)).toBeCloseTo(560, 6)
    expect(byPrice.get(10)).toBeCloseTo(240, 6)
    expect(byPrice.get(9)).toBeCloseTo(200, 6)
    expect(days[2]!.winnerRatio).toBeCloseTo(0.2, 6)
    expect(days[2]!.averageCost).toBeCloseTo(10.92, 6)
  })

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

  it('区间日：成交量按重叠长度均匀分摊到覆盖的桶', () => {
    const days = chipDistribution([rangeBar(1, 10, 12, 11, 1000)], { floatShares: FLOAT, binWidth: 1 })
    // [10,12] 均匀铺进中心 10/11/12 的三个桶：重叠 0.5/1.0/0.5 → 250/500/250
    const byPrice = new Map(days[0]!.buckets.map((b) => [b.price, b.quantity]))
    expect(byPrice.get(10)).toBeCloseTo(250, 6)
    expect(byPrice.get(11)).toBeCloseTo(500, 6)
    expect(byPrice.get(12)).toBeCloseTo(250, 6)
    expect(days[0]!.winnerRatio).toBeCloseTo(0.75, 6) // 收盘 11 元：10 与 11 两个桶获利
  })

  it('换手率超 100% 的合成日：封顶 100%，旧筹码清零出图、总量仍守恒', () => {
    const cs = [flatBar(1, 12, 1000), flatBar(2, 9, 2500)]
    const days = chipDistribution(cs, { floatShares: FLOAT, binWidth: 1 })
    const byPrice = new Map(days[1]!.buckets.map((b) => [b.price, b.quantity]))
    expect(byPrice.get(12)).toBeUndefined() // 清零的桶不再出现
    expect(byPrice.get(9)).toBeCloseTo(FLOAT, 6)
    expect(days[1]!.winnerRatio).toBeCloseTo(1, 6)
  })
})

describe('获利盘与套牢盘的行进：分布随行情移动', () => {
  it('下跌段获利盘一路走低、反弹日抬升：序列读数与末快照互相印证', () => {
    const days = chipDistribution(FALL_AND_REBOUND, { floatShares: FLOAT, binWidth: 1 })
    const winners = days.map((d) => d.winnerRatio)
    expect(winners[0]!).toBeCloseTo(1, 6)
    expect(winners[2]!).toBeLessThan(winners[1]!)
    expect(winners[3]!).toBeGreaterThan(winners[2]!)
  })

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
})

describe('固定种子确定性：同一输入两次计算全等', () => {
  it('同一颗种子的合成行情算两遍，输出逐字节一致', () => {
    const mk = () => generateCandles(createRng(1414), { days: 50, startPrice: 12, volatility: 0.03 })
    expect(chipDistribution(mk())).toEqual(chipDistribution(mk()))
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = FALL_AND_REBOUND
  it.each([
    ['空数组', () => chipDistribution([])],
    ['流通股本为 0', () => chipDistribution(ok, { floatShares: 0 })],
    ['流通股本为负', () => chipDistribution(ok, { floatShares: -100 })],
    ['桶宽为 0', () => chipDistribution(ok, { binWidth: 0 })],
    ['桶宽为负', () => chipDistribution(ok, { binWidth: -0.1 })],
    ['收盘价 NaN', () => chipDistribution([flatBar(1, NaN, 100)])],
    ['最低价非正数', () => chipDistribution([flatBar(1, 0, 100)])],
    ['成交量为负', () => chipDistribution([flatBar(1, 10, -5)])],
    ['高低倒挂', () => chipDistribution([{ ...flatBar(1, 10, 100), high: 9, low: 11 }])],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
