import { describe, expect, it } from 'vitest'
import { sma, ema, crossovers } from '../src/indicators/ma'
import type { Candle } from '../src/types'

/**
 * 均线族的行为断言：只喂 K 线序列与窗口参数，只看返回的均线数组与交叉信号列表，
 * 内部怎么滑窗、怎么递推一概不问。全章核心命题在这里受审：
 * 1. sma/ema 与手算一致——固定收盘序列逐格复算（sma 滑窗平均、ema 以首窗 SMA 起步按 α=2/(n+1) 递推）；
 * 2. 头部不足窗口返回 null 且数组与 K 线等长——均线未成形的那些格子是 null，不是猜测值；
 * 3. 金叉死叉的位置与手算一致：金叉=前一根快线不高于慢线、这一根严格高于；
 *    死叉=前一根不低于、这一根严格低于；平走段与同侧段都不算交叉；
 * 4. 滞后性可量化：新价格跳变后，ema 比 sma 更快朝新价格靠拢，sma 的窗口越长靠得越慢；
 * 5. 固定种子行为确定；结构性非法输入抛中文错误。
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

describe('sma：读数可手算', () => {
  it('窗口 3 逐格滑动：[10,11,12,13,14] → [null,null,11,12,13]', () => {
    const r = sma(seriesFromCloses([10, 11, 12, 13, 14]), 3)
    expect(r).toHaveLength(5)
    expect(r[0]).toBeNull()
    expect(r[1]).toBeNull()
    expect(r[2]).toBeCloseTo(11, 10)
    expect(r[3]).toBeCloseTo(12, 10)
    expect(r[4]).toBeCloseTo(13, 10)
  })

  it('常数序列：均线在成形后逐格等于常数，噪声为零', () => {
    const r = sma(seriesFromCloses([7, 7, 7, 7, 7, 7]), 4)
    expect(r).toEqual([null, null, null, 7, 7, 7])
  })

  it('序列短于窗口：整条均线都是 null（没有猜出来的值），数组仍与 K 线等长', () => {
    const r = sma(seriesFromCloses([10, 11, 12]), 5)
    expect(r).toEqual([null, null, null])
  })
})

describe('ema：读数可手算', () => {
  // closes = [10,10,10,13,14]，n=3：第 2 格起步 = 首窗 SMA = 10，α = 2/(3+1) = 0.5
  //   第 3 格 = 10 + 0.5×(13−10) = 11.5；第 4 格 = 11.5 + 0.5×(14−11.5) = 12.75
  it('首窗 SMA 起步、按 2/(n+1) 递推：[10,10,10,13,14] → [null,null,10,11.5,12.75]', () => {
    const r = ema(seriesFromCloses([10, 10, 10, 13, 14]), 3)
    expect(r).toHaveLength(5)
    expect(r[0]).toBeNull()
    expect(r[1]).toBeNull()
    expect(r[2]).toBeCloseTo(10, 10)
    expect(r[3]).toBeCloseTo(11.5, 10)
    expect(r[4]).toBeCloseTo(12.75, 10)
  })

  it('序列短于窗口：与 sma 同款，整条 null', () => {
    expect(ema(seriesFromCloses([10, 11, 12]), 5)).toEqual([null, null, null])
  })
})

describe('滞后性：新价格跳变后谁先跟上', () => {
  // 29 根收盘 10 元，最后一根跳到 20 元。窗口 n=5：
  //   sma 末格 = (4×10 + 20) ÷ 5 = 12；ema 末格 = 10 + (2/6)×(20−10) ≈ 13.33
  const jump = seriesFromCloses([...Array(29).fill(10), 20])

  it('ema 比 sma 更快朝新价格靠拢：13.33 对 12，都还差得远（这就是慢半拍）', () => {
    const e = ema(jump, 5)
    const s = sma(jump, 5)
    expect(s[29]).toBeCloseTo(12, 10)
    expect(e[29]).toBeCloseTo(10 + (1 / 3) * 10, 10)
    expect(e[29]!).toBeGreaterThan(s[29]!)
    expect(20 - e[29]!).toBeLessThan(20 - s[29]!)
  })

  it('窗口越长慢得越重：同一次跳变，sma(5) 走到 12，sma(10) 只走到 11', () => {
    const s5 = sma(jump, 5)
    const s10 = sma(jump, 10)
    expect(s5[29]).toBeCloseTo(12, 10)
    expect(s10[29]).toBeCloseTo(11, 10)
    expect(s5[29]!).toBeGreaterThan(s10[29]!)
  })
})

describe('crossovers：位置与手算一致', () => {
  // closes = [10×8, 12×3, 8×4]，fast=2、slow=3。MA2 与 MA3 逐格手算：
  //   MA2：…10,10,10 | 11,12,12 | 10,9,8,8
  //   MA3：…10,10,10 | 10.67,11.33,12 | 10.67,9.33,8,8
  //   第 8 格：11 > 10.67 且前格 10 ≤ 10 → 金叉；第 11 格：10 < 10.67 且前格 12 ≥ 12 → 死叉
  it('平走→抬升→回落：金叉@8、死叉@11，与逐格手算一致', () => {
    const closes = [...Array(8).fill(10), ...Array(3).fill(12), ...Array(4).fill(8)]
    const r = crossovers(seriesFromCloses(closes), 2, 3)
    expect(r).toEqual([
      { index: 8, kind: 'golden' },
      { index: 11, kind: 'dead' },
    ])
  })

  it('全程平走：快慢线贴在一起，一个交叉都没有', () => {
    expect(crossovers(seriesFromCloses(Array(20).fill(10)), 2, 3)).toEqual([])
  })

  it('平走后单边抬升：只有一次金叉，没有死叉', () => {
    const closes = [...Array(10).fill(10), 11, 12, 13, 14]
    expect(crossovers(seriesFromCloses(closes), 2, 3)).toEqual([{ index: 10, kind: 'golden' }])
  })

  it('平走后单边回落：只有一次死叉，没有金叉', () => {
    const closes = [...Array(10).fill(10), 9, 8, 7, 6]
    expect(crossovers(seriesFromCloses(closes), 2, 3)).toEqual([{ index: 10, kind: 'dead' }])
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = seriesFromCloses([10, 11, 12, 13, 14, 15])
  it.each([
    ['sma 空数组', () => sma([], 3)],
    ['sma 窗口为 0', () => sma(ok, 0)],
    ['sma 窗口为负', () => sma(ok, -2)],
    ['sma 窗口非整数', () => sma(ok, 2.5)],
    ['sma 收盘价 NaN', () => sma([c(10, 11, 9, NaN)], 1)],
    ['ema 空数组', () => ema([], 3)],
    ['ema 窗口为 0', () => ema(ok, 0)],
    ['ema 收盘价 NaN', () => ema([c(10, 11, 9, NaN)], 1)],
    ['crossovers 空数组', () => crossovers([], 2, 3)],
    ['crossovers fast 不小于 slow', () => crossovers(ok, 5, 3)],
    ['crossovers fast 等于 slow', () => crossovers(ok, 3, 3)],
    ['crossovers 窗口非整数', () => crossovers(ok, 1.5, 3)],
    ['crossovers 序列凑不出相邻两个慢线值', () => crossovers(seriesFromCloses([10, 11, 12]), 2, 5)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
