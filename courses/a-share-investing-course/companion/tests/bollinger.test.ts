import { describe, expect, it } from 'vitest'
import { bollinger, squeezes, outsideStats, DEFAULT_BB_N, DEFAULT_BB_K } from '../src/indicators/bollinger'
import { sma } from '../src/indicators/ma'
import { stdev, normalDraws, leptokurticDraws } from '../src/stats/stdev'
import { createRng } from '../src/data/generate'
import type { Candle } from '../src/types'

/**
 * 布林带与波动率的行为断言：只喂 K 线序列与参数，只看三条带、带宽、收口点、带外占比，
 * 内部怎么滑窗一概不问。全章核心命题在这里受审：
 * 1. 标准差手算四步可复算——
 *    closes=[9,11,10,12,8]：平均 = 50/5 = 10；离差 = −1/+1/0/+2/−2；
 *    平方和 = 1+1+0+4+4 = 10；方差 = 10/5 = 2；σ = √2 ≈ 1.4142（总体口径 ÷n）；
 *    带宽 =（上轨−下轨）÷中轨×100 = 4σ/10×100 = 40√2 ≈ 56.57%；
 * 2. 布林带 = 中轨（就是第 11 章 sma）± k·σ：k 放大几倍带宽就放大几倍；
 *    窗口含当根的枷锁——n=5 时单根离群收盘最多把自己的 z 顶到 √(n−1) = 2，恰好压线而非越出；
 * 3. 带宽序列与收口检测：振幅一路收窄的段里，带宽逐格创 lookback 新低；
 *    风暴段（振幅骤增）带宽数倍于收口段，且不再有新低；
 * 4. ±2σ 带外占比：同总标准差的构造正态序列接近约 5%（实测约 4%），
 *    尖峰肥尾序列（小波动打底 + 偶发大跳、总 σ 不变）显著更高（1.6 倍以上）；
 * 5. 结构性非法输入抛中文错误。
 */

const bar = (i: number, open: number, high: number, low: number, close: number): Candle => ({
  date: `2026-08-${String(i + 1).padStart(2, '0')}`,
  open,
  high,
  low,
  close,
  volume: 10000,
})

/** 一列收盘价包成 K 线：开盘嵌昨收、影线各让一分——布林带只看收盘，形状只要自洽 */
const closesToBars = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1]!
    return bar(i, open, Math.max(open, close) + 0.01, Math.min(open, close) - 0.01, close)
  })

describe('stdev：总体标准差，手算四步可复算', () => {
  it('小样本 [9,11,10,12,8]：平均 10 → 离差 −1/+1/0/+2/−2 → 平方和 10 → 方差 2 → σ=√2', () => {
    expect(stdev([9, 11, 10, 12, 8])).toBeCloseTo(Math.sqrt(2), 10)
  })

  it('全等数列 σ=0；整体平移只改平均不改 σ（颠簸是相对平均量的）', () => {
    expect(stdev([5, 5, 5, 5])).toBe(0)
    expect(stdev([109, 111, 110, 112, 108])).toBeCloseTo(Math.sqrt(2), 10)
  })

  it('空数组与非有限值抛错', () => {
    expect(() => stdev([])).toThrow()
    expect(() => stdev([1, NaN])).toThrow()
  })
})

describe('bollinger：小样本与手算一致（中轨=均线，上下轨=均线±k·σ）', () => {
  // closes=[9,11,10,12,8,13]、n=5、k=2：
  //   第 5 根窗口 [9,11,10,12,8]：mid=10、σ=√2、upper=10+2√2、lower=10−2√2、带宽 40√2%；
  //   第 6 根窗口 [11,10,12,8,13]：mid=54/5=10.8、平方和=0.04+0.64+1.44+7.84+4.84=14.8、
  //   σ=√2.96、upper=10.8+2√2.96（≈14.24）——收盘 13 还在带内
  const cs = closesToBars([9, 11, 10, 12, 8, 13])
  const b = bollinger(cs, 5, 2)

  it('头部不足一个窗口记 null；第 5、6 根逐格与手算一致', () => {
    expect(b.mid.slice(0, 4)).toEqual([null, null, null, null])
    expect(b.upper.slice(0, 4)).toEqual([null, null, null, null])
    expect(b.lower.slice(0, 4)).toEqual([null, null, null, null])
    expect(b.bandwidth.slice(0, 4)).toEqual([null, null, null, null])
    expect(b.mid[4]).toBeCloseTo(10, 10)
    expect(b.upper[4]).toBeCloseTo(10 + 2 * Math.sqrt(2), 10)
    expect(b.lower[4]).toBeCloseTo(10 - 2 * Math.sqrt(2), 10)
    expect(b.bandwidth[4]).toBeCloseTo((4 * Math.sqrt(2) / 10) * 100, 8)
    expect(b.mid[5]).toBeCloseTo(10.8, 10)
    expect(b.upper[5]).toBeCloseTo(10.8 + 2 * Math.sqrt(2.96), 10)
    expect(b.lower[5]).toBeCloseTo(10.8 - 2 * Math.sqrt(2.96), 10)
  })

  it('中轨就是第 11 章的 sma：逐格相等', () => {
    expect(b.mid).toEqual(sma(cs, 5))
  })

  it('k 是带宽的放大器：k=3 的带宽恰为 k=2 的 1.5 倍', () => {
    const b3 = bollinger(cs, 5, 3)
    expect(b3.bandwidth[5]!).toBeCloseTo(b.bandwidth[5]! * 1.5, 8)
    expect(b3.upper[5]!).toBeCloseTo(10.8 + 3 * Math.sqrt(2.96), 10)
  })

  it('默认参数 20/2：第 20 根成形，与显式传参逐格一致', () => {
    const flat = closesToBars(Array<number>(25).fill(10).map((v, i) => v + (i % 3) - 1))
    const byDefault = bollinger(flat)
    expect(byDefault.mid[DEFAULT_BB_N - 2]).toBeNull()
    expect(byDefault.mid[DEFAULT_BB_N - 1]).toBeCloseTo(sma(flat, 20)[19]!, 10)
    expect(byDefault).toEqual(bollinger(flat, DEFAULT_BB_N, DEFAULT_BB_K))
  })

  it('窗口含当根的枷锁：n=5 时离群收盘只能恰好压在带上（z 最大 √(n−1) = 2），越不出去', () => {
    // 窗口 [10,10,10,10,100]：平均 28、平方和 324×4+5184=6480、方差 1296、σ=36、上轨 = 28+72 = 100
    // ——收盘 100 恰好踩在上轨上，严格越出口径下带外为 0
    const spike = closesToBars([10, 10, 10, 10, 100])
    const bs = bollinger(spike, 5, 2)
    expect(bs.upper[4]).toBe(100)
    const o = outsideStats(spike, 5, 2)
    expect(o.formed).toBe(1)
    expect(o.outside).toBe(0)
    expect(o.ratio).toBe(0)
  })
})

describe('带宽与收口检测', () => {
  // 前 65 根绕 10 元震荡、振幅从 0.2 一路线性收窄到 0.04；第 66 根起换成 1.6 的风暴振幅。
  // 收口段（成形且凑满回看窗之后）带宽逐格创新低；风暴段带宽数倍于收口段、不再有新低。
  const cycle = [-1, -1 / 3, 1 / 3, 1]
  const squeezeBars = (): Candle[] => {
    const closes: number[] = []
    for (let i = 0; i < 95; i++) {
      const amp = i < 65 ? 0.2 * (1 - (i / 64) * 0.8) : 1.6
      closes.push(10 + cycle[i % 4]! * amp)
    }
    return closesToBars(closes)
  }
  const sqBars = squeezeBars()
  const bb = bollinger(sqBars, 20, 2)
  const sq = squeezes(sqBars, { lookback: 20 })

  it('带宽头部 null；收口末段带宽不足 3%，风暴段带宽是它的 10 倍以上', () => {
    expect(bb.bandwidth[18]).toBeNull()
    expect(bb.bandwidth[19]).not.toBeNull()
    expect(bb.bandwidth[64]!).toBeLessThan(3)
    expect(bb.bandwidth[90]!).toBeGreaterThan(10 * bb.bandwidth[64]!)
  })

  it('收口检测全部落在收口段（下标 < 65），最深的一处紧贴风暴起点（第 65 根）', () => {
    expect(sq.length).toBeGreaterThanOrEqual(10)
    for (const s of sq) expect(s.index).toBeLessThan(65)
    expect(sq[sq.length - 1]!.index).toBe(64)
    expect(sq[sq.length - 1]!.bandwidth).toBeCloseTo(bb.bandwidth[64]!, 8)
  })

  it('回看窗越短越容易判新低：lookback 5 的收口点不少于 lookback 20', () => {
    expect(squeezes(sqBars, { lookback: 5 }).length).toBeGreaterThanOrEqual(sq.length)
  })

  it('凑不满判据的短序列返回空列表，不抛错', () => {
    expect(squeezes(closesToBars([10, 10.1, 10.2]), { lookback: 5 })).toEqual([])
  })
})

describe('带外占比：正态直觉与肥尾', () => {
  // 实验设计：绕 10 元的平稳震荡（把「分布形状」从「趋势」里剥出来），总 σ=0.15；
  // 肥尾列 = 88% 的日子小幅噪声（0.1σ）+ 12% 的日子大跳（跳幅按总 σ 不变解出 ≈2.87σ）——
  // 两列的总标准差相同，只有形状不同：这就是「同 σ 不同命」的公平对照
  const EXP_COUNT = 1600
  const EXP_SIGMA = 0.15
  const around = (draws: number[]): Candle[] => closesToBars(draws.map((d) => 10 + d))
  const normalSeries = around(normalDraws(createRng(1803), EXP_COUNT, EXP_SIGMA))
  const fatSeries = around(leptokurticDraws(createRng(1803), EXP_COUNT, EXP_SIGMA))
  const rn = outsideStats(normalSeries)
  const rf = outsideStats(fatSeries)

  it('公平对照前提：两列读数的总标准差相差不超过一成', () => {
    const sn = stdev(normalSeries.map((c) => c.close))
    const sf = stdev(fatSeries.map((c) => c.close))
    expect(Math.abs(sf - sn)).toBeLessThanOrEqual(0.1 * sn)
  })

  it('正态序列 ±2σ 带外占比接近约 5%（实测约 4%），且双向都有带外事件', () => {
    expect(rn.formed).toBe(EXP_COUNT - 19)
    expect(rn.ratio).toBeGreaterThanOrEqual(0.03)
    expect(rn.ratio).toBeLessThanOrEqual(0.065)
    expect(rn.outside).toBe(rn.above + rn.below)
    expect(rn.above).toBeGreaterThan(0)
    expect(rn.below).toBeGreaterThan(0)
  })

  it('同 σ 的尖峰肥尾序列显著更高：至少多 2 个百分点、1.6 倍以上', () => {
    expect(rf.ratio).toBeGreaterThanOrEqual(rn.ratio + 0.02)
    expect(rf.ratio).toBeGreaterThanOrEqual(1.6 * rn.ratio)
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = closesToBars([9, 11, 10, 12, 8, 13])
  it.each([
    ['bollinger 空数组', () => bollinger([], 5, 2)],
    ['bollinger 窗口为 0', () => bollinger(ok, 0, 2)],
    ['bollinger 窗口非整数', () => bollinger(ok, 2.5, 2)],
    ['bollinger 倍数为 0', () => bollinger(ok, 5, 0)],
    ['bollinger 倍数 NaN', () => bollinger(ok, 5, NaN)],
    ['bollinger 收盘价 NaN', () => bollinger([bar(0, 10, 10.5, 9.5, NaN)], 5, 2)],
    ['squeezes 回看窗 1 根', () => squeezes(ok, { lookback: 1 })],
    ['squeezes 回看窗非整数', () => squeezes(ok, { lookback: 4.5 })],
    ['outsideStats 不足一个窗口', () => outsideStats(closesToBars([10, 10.1, 10.2]), 20, 2)],
    ['normalDraws 个数为 0', () => normalDraws(createRng(1), 0, 1)],
    ['normalDraws σ 为负', () => normalDraws(createRng(1), 10, -1)],
    ['leptokurticDraws 跳变概率 0', () => leptokurticDraws(createRng(1), 10, 1, 0)],
    ['leptokurticDraws 跳变概率 1', () => leptokurticDraws(createRng(1), 10, 1, 1)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
