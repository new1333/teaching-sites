import { describe, expect, it } from 'vitest'
import { evaluatePattern, shuffleControl } from '../src/stats/evaluate'
import { createRng, generateCandles } from '../src/data/generate'
import { classifyWicks } from '../src/patterns/wicks'
import { trendContext } from '../src/patterns/context'
import type { Candle } from '../src/types'

/**
 * 形态统计的行为断言：只喂 K 线序列与一个「在第 i 根是否命中形态」的判定函数，
 * 只看返回的统计读数（胜率、样本量、基准概率）与随机对照读数（对照组均值、被反超占比）。
 * 全章核心命题在这里受审：
 * 1. 读数可手算——固定命中位置与已知收盘序列，胜率/样本量/基准与纸面推演一致；
 * 2. 无优势的随机序列上，胜率贴着基准概率（形态没有偷偷捡到便宜）、随机对照组均值同样贴着基准；
 * 3. 人为注入优势的序列（锤子线命中后整段抬升 4%）被检出：胜率显著高于基准、
 *    随机对照组几乎无人反超（beatRatio≈0）；
 * 4. 长在窗口外的命中不计样本（没走完 horizon 根，输赢未定）；
 * 5. 固定种子下随机对照可复现；结构性非法输入抛中文错误。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-05-01',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 由一串收盘价手搓行情：开=昨收，高=两者较大者+0.02，低=较小者−0.02 */
const seriesFromCloses = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return c(open, Math.max(open, close) + 0.02, Math.min(open, close) - 0.02, close, `2026-05-${String(i + 1).padStart(2, '0')}`)
  })

/** 锤子线判定器：第 5 章的识别器原样接进来（前 5 根没有背景窗口，不算命中） */
const isHammer = (cs: readonly Candle[], i: number): boolean =>
  i >= 5 && classifyWicks(cs[i], trendContext(cs, i)).includes('hammer')

const round2 = (x: number): number => Math.round(x * 100) / 100

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

// 手算样本一：closes = [10, 11, 10, 12, 11, 13, 12, 14]，horizon=2，有效判定日 i=0..5
//   看涨的赢面（收盘[i+2] > 收盘[i]）：i=0 是 10 对 10（平手算输），i=1..5 全赢 → 基准 = 5/6
// 手算样本二：closes = [20, 19, 20, 18, 19, 17]，horizon=2，有效判定日 i=0..3
//   看跌的赢面（收盘[i+2] < 收盘[i]）：i=1 是 19 对 19（平手算输），i=0/2/3 赢 → 基准 = 3/4
const UPS = seriesFromCloses([10, 11, 10, 12, 11, 13, 12, 14])
const DOWNS = seriesFromCloses([20, 19, 20, 18, 19, 17])
const at = (...idx: number[]) => (_cs: readonly Candle[], i: number): boolean => idx.includes(i)

describe('evaluatePattern：读数可手算', () => {
  it('固定命中位置：胜率 1/2、样本量 2、基准 5/6，与纸面推演一致', () => {
    // 命中 i=0（平手，输）与 i=4（赢）；i=6 在窗口外（6+2=8 越界），不得计入样本
    const r = evaluatePattern(UPS, at(0, 4, 6), 2)
    expect(r.sampleSize).toBe(2)
    expect(r.winRate).toBeCloseTo(1 / 2, 10)
    expect(r.baseline).toBeCloseTo(5 / 6, 10)
  })

  it('同一序列换个方向参数：看跌视角下基准翻面', () => {
    // DOWNS 一路走低：没有任何一个两天窗口收涨 → 看涨基准 0；看跌窗口 4 个里赢 3 个 → 看跌基准 3/4
    expect(evaluatePattern(DOWNS, () => true, 2).baseline).toBe(0)
    expect(evaluatePattern(DOWNS, () => true, 2, 'bear').baseline).toBeCloseTo(3 / 4, 10)
    // 命中 i=0（平手，双向都算输）与 i=3（看跌赢）：看跌胜率 1/2
    const r = evaluatePattern(DOWNS, at(0, 3), 2, 'bear')
    expect(r.sampleSize).toBe(2)
    expect(r.winRate).toBeCloseTo(1 / 2, 10)
  })

  it('无命中的判定器：样本量 0、胜率记 0（读数先看样本量）', () => {
    const r = evaluatePattern(UPS, () => false, 2)
    expect(r.sampleSize).toBe(0)
    expect(r.winRate).toBe(0)
    expect(r.baseline).toBeCloseTo(5 / 6, 10)
  })
})

describe('无优势的随机序列：胜率贴着基准', () => {
  // 纯随机游走里「之后 horizon 根收涨」的条件概率与无条件概率相同——锤子线不该捡到便宜。
  // 锤子线是稀有形态（8000 个交易日约命中 59 次），样本要攒够长才轮得到统计说话
  const walk = generateCandles(createRng(2026), { days: 8000, startPrice: 10, volatility: 0.03 })

  it('锤子线的胜率与基准之差不超过 0.08，且样本量足以说话', () => {
    const r = evaluatePattern(walk, isHammer, 5)
    expect(r.sampleSize).toBeGreaterThanOrEqual(50)
    expect(Math.abs(r.winRate - r.baseline)).toBeLessThanOrEqual(0.08)
  })

  it('随机对照组的均值同样贴着基准：碰巧的样本组合捡不到系统性便宜', () => {
    const s = shuffleControl(walk, isHammer, 5, { trials: 200, seed: 7 })
    const r = evaluatePattern(walk, isHammer, 5)
    expect(s.sampleSize).toBe(r.sampleSize)
    expect(s.winRate).toBeCloseTo(r.winRate, 10)
    expect(Math.abs(s.meanWinRate - r.baseline)).toBeLessThanOrEqual(0.05)
    // 无优势的形态不该被对照组判成「显著」：200 组里被反超的远不止 1 组
    expect(s.beatRatio).toBeGreaterThanOrEqual(0.05)
  })
})

describe('人为注入优势的序列：被检出', () => {
  // 同一段随机游走，每次锤子线命中后把之后的行情整段抬升 5%——人为给锤子线装上「之后真会弹」的剧本
  const rigged = injectEdge(
    generateCandles(createRng(909), { days: 8000, startPrice: 10, volatility: 0.03 }),
    isHammer,
    5,
    1.05,
  )

  it('锤子线命中后行情整段抬升 5%：胜率显著高出基准', () => {
    const r = evaluatePattern(rigged, isHammer, 5)
    expect(r.sampleSize).toBeGreaterThanOrEqual(30)
    expect(r.winRate - r.baseline).toBeGreaterThan(0.15)
  })

  it('随机对照组几乎无人反超：beatRatio 趋近 0', () => {
    const s = shuffleControl(rigged, isHammer, 5, { trials: 200, seed: 7 })
    expect(s.beatRatio).toBeLessThanOrEqual(0.02)
  })
})

describe('shuffleControl：可复现与读数边界', () => {
  const walk = generateCandles(createRng(310), { days: 800, startPrice: 10 })

  it('同一种子跑两遍：读数逐项一致', () => {
    const a = shuffleControl(walk, isHammer, 5, { trials: 50, seed: 11 })
    const b = shuffleControl(walk, isHammer, 5, { trials: 50, seed: 11 })
    expect(a).toEqual(b)
  })

  it('trials 如实上报，每组对照都留下读数', () => {
    const s = shuffleControl(walk, isHammer, 5, { trials: 25, seed: 3 })
    expect(s.trials).toBe(25)
    expect(s.rates).toHaveLength(25)
    expect(s.rates.every((r) => r >= 0 && r <= 1)).toBe(true)
  })

  it('对照组的均值落在基准附近（抽样均值收敛于基准）', () => {
    const s = shuffleControl(walk, isHammer, 5, { trials: 200, seed: 5 })
    const base = evaluatePattern(walk, isHammer, 5).baseline
    expect(Math.abs(s.meanWinRate - base)).toBeLessThanOrEqual(0.05)
  })

  it('无命中时读数无意义但不炸：样本量 0、对照组均值记 0', () => {
    const s = shuffleControl(walk, () => false, 5, { trials: 10, seed: 2 })
    expect(s.sampleSize).toBe(0)
    expect(s.meanWinRate).toBe(0)
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = seriesFromCloses([10, 11, 12, 13, 14, 15])
  it.each([
    ['空数组', () => evaluatePattern([], at(0), 2)],
    ['非数组', () => evaluatePattern('不是数组' as unknown as Candle[], at(0), 2)],
    ['horizon 为 0', () => evaluatePattern(ok, at(0), 0)],
    ['horizon 为负', () => evaluatePattern(ok, at(0), -1)],
    ['horizon 非整数', () => evaluatePattern(ok, at(0), 1.5)],
    ['序列短于 horizon+1', () => evaluatePattern(ok, at(0), 6)],
    ['判定器不是函数', () => evaluatePattern(ok, '不是函数' as unknown as never, 2)],
    ['方向参数非法', () => evaluatePattern(ok, at(0), 2, '侧' as never)],
    ['收盘价 NaN', () => evaluatePattern([c(NaN, 11, 9, 10)], at(0), 1)],
    ['shuffle 的 trials 为 0', () => shuffleControl(ok, at(0), 2, { trials: 0 })],
    ['shuffle 的种子非整数', () => shuffleControl(ok, at(0), 2, { seed: 1.5 })],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
