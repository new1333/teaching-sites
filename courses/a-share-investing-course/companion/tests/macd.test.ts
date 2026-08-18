import { describe, expect, it } from 'vitest'
import { macd, detectDivergence } from '../src/indicators/macd'
import type { Candle } from '../src/types'

/**
 * MACD 与背离检测的行为断言：只喂 K 线序列与窗口参数，只看返回的三条序列与背离列表，
 * 内部怎么递推、怎么扫枢轴一概不问。全章核心命题在这里受审：
 * 1. 三层读数与手算一致——固定收盘序列逐格复算：
 *    DIF = EMA(fast) − EMA(slow)（第 11 章 ema 的直接复用：首窗 SMA 种子、α=2/(n+1) 递推）；
 *    DEA = 对 DIF 的成形段再作一次 EMA(signal)；柱 = DIF − DEA；
 * 2. 头部未成形处是 null 且三条序列与 K 线等长——默认参数 12/26/9 下
 *    DIF 自第 26 根起有值、DEA 与柱自第 34 根起有值；
 * 3. 柱的正负只由 DIF 与 DEA 的高低决定——柱翻负时 DIF 仍可在零轴上方（动量在减速，不在反向）；
 * 4. 顶背离 = 价格峰创新高而 DIF 峰拒绝新高（峰对峰比），底背离镜像；
 *    同步新高的序列不误报；DIF 尚未成形的峰对不比、不猜；
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

/** 以 mid 为中心的对称 K 线：high=mid+0.5、low=mid−0.5，全章手工排布峰谷的积木 */
const midBars = (mids: number[]): Candle[] =>
  mids.map((m, i) => bar(i, m, m + 0.5, m - 0.5, m))

describe('macd：三层读数可手算', () => {
  // closes=[10,10,10,13,14,14,12,12]，fast/slow/signal=3/5/3：
  //   EMA3 首窗 (10,10,10) 均值 10 起步、α=0.5；EMA5 首窗均值 11.4 起步、α=1/3；
  //   DIF=EMA3−EMA5 自第 5 根起有值；DEA 以 DIF 前 3 个值的均值起步、自第 7 根起有值
  it('小样本逐格复算：DIF/DEA/柱与手算一致，头部未成形处是 null', () => {
    const r = macd(midBars([10, 10, 10, 13, 14, 14, 12, 12]), { fast: 3, slow: 5, signal: 3 })
    expect(r.dif).toHaveLength(8)
    expect(r.dif.slice(0, 4)).toEqual([null, null, null, null]) // EMA5 未成形，DIF 无从谈起
    expect(r.dif[4]).toBeCloseTo(1.35, 6)
    expect(r.dif[5]).toBeCloseTo(1.1083333, 6)
    expect(r.dif[6]).toBeCloseTo(0.5097222, 6)
    expect(r.dif[7]).toBeCloseTo(0.2252315, 6)
    expect(r.dea.slice(0, 6)).toEqual([null, null, null, null, null, null]) // DIF 成形后还要攒够 3 个，DEA 才起步
    expect(r.dea[6]).toBeCloseTo(0.9893519, 6)
    expect(r.dea[7]).toBeCloseTo(0.6072917, 6)
    expect(r.hist.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(r.hist[6]).toBeCloseTo(-0.4796296, 6)
    expect(r.hist[7]).toBeCloseTo(-0.3820602, 6)
  })

  it('默认参数 12/26/9：DIF 自第 26 根、DEA 与柱自第 34 根成形；常数行情三条线全为 0', () => {
    const r = macd(midBars(Array<number>(40).fill(10)))
    expect(r.dif.slice(0, 25)).toEqual(Array<number | null>(25).fill(null))
    expect(r.dif[25]).toBeCloseTo(0, 10)
    expect(r.dea.slice(0, 33)).toEqual(Array<number | null>(33).fill(null))
    expect(r.dea[33]).toBeCloseTo(0, 10)
    expect(r.hist.slice(0, 33)).toEqual(Array<number | null>(33).fill(null))
    expect(r.hist[33]).toBeCloseTo(0, 10)
  })

  it('柱的正负 = DIF 与 DEA 的高低：柱翻负时 DIF 仍在零轴上方（动量在减速，不在反向）', () => {
    const r = macd(midBars([10, 10, 10, 13, 14, 14, 12, 12]), { fast: 3, slow: 5, signal: 3 })
    expect(r.hist[7]).toBeLessThan(0)
    expect(r.dif[7]).toBeGreaterThan(0) // 快线仍压着慢线，只是被追近了——趋势没掉头，推力在卸
  })
})

// 顶背离样本（fast/slow/signal=3/5/3）：先急爬到 13（第 7 根见峰），深回撤到 9，
// 再慢爬到 13.1——价格峰 13.6 > 13.5 创新高，DIF 峰 0.49 < 0.80 拒绝跟随
const TOP_MIDS = [9, 9, 9, 10, 11, 12, 13, 12, 11, 10, 9, 10, 11, 12, 13.1, 12, 11, 10]
// 底背离样本：TOP_MIDS 关于 11.5 元逐根镜像——峰变谷，第二谷 9.4 < 9.5 创新低而 DIF 抬高
const BOTTOM_MIDS = [14, 14, 14, 13, 12, 11, 10, 11, 12, 13, 14, 13, 12, 11, 9.9, 11, 12, 13]
// 同步新高样本：第一峰爬得缓（DIF 只有 0.35），第二峰爬得陡且高（14.5 创新高，DIF 0.73 同创新高）
const SYNC_MIDS = [9, 9, 9, 9.5, 10, 10.4, 10, 9.6, 9.2, 9, 9.2, 10, 11, 12, 13, 14, 13, 12, 11]

const macd353 = (cs: readonly Candle[]): ReturnType<typeof macd> => macd(cs, { fast: 3, slow: 5, signal: 3 })

describe('detectDivergence：峰对峰比动量', () => {
  it('价格创新高而 DIF 未新高：标为顶背离，两处读数一并返回', () => {
    const cs = midBars(TOP_MIDS)
    const out = detectDivergence(cs, macd353(cs))
    expect(out).toHaveLength(1)
    const d = out[0]!
    expect(d.kind).toBe('top')
    expect(d.index).toBe(14) // 背离记在第二个峰上
    expect(d.prevIndex).toBe(6)
    expect(d.price).toBe(13.6)
    expect(d.prevPrice).toBe(13.5)
    expect(d.prevDif).toBeCloseTo(0.7958333, 6)
    expect(d.dif).toBeCloseTo(0.4896437, 6)
    expect(d.dif).toBeLessThan(d.prevDif) // 价格与动量唱了反调
  })

  it('镜像：价格创新低而 DIF 不创新低，标为底背离', () => {
    const cs = midBars(BOTTOM_MIDS)
    const out = detectDivergence(cs, macd353(cs))
    expect(out).toHaveLength(1)
    const d = out[0]!
    expect(d.kind).toBe('bottom')
    expect(d.index).toBe(14)
    expect(d.prevIndex).toBe(6)
    expect(d.price).toBe(9.4)
    expect(d.prevPrice).toBe(9.5)
    expect(d.prevDif).toBeCloseTo(-0.7958333, 6)
    expect(d.dif).toBeGreaterThan(d.prevDif) // 价格创新低，动量的坑却变浅了
  })

  it('同步新高：价格与 DIF 一起创新高，不误报', () => {
    const cs = midBars(SYNC_MIDS)
    expect(detectDivergence(cs, macd353(cs))).toEqual([])
  })

  it('DIF 尚未成形的峰对（默认 26 根窗口没攒够）：不比、不猜，也不炸', () => {
    const cs = midBars(TOP_MIDS)
    expect(detectDivergence(cs, macd(cs))).toEqual([])
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok = midBars(TOP_MIDS)
  const okMacd = macd353(ok)
  it.each([
    ['空数组', () => macd([])],
    ['fast 不短于 slow', () => macd(ok, { fast: 5, slow: 5 })],
    ['signal 为 0', () => macd(ok, { fast: 3, slow: 5, signal: 0 })],
    ['signal 非整数', () => macd(ok, { fast: 3, slow: 5, signal: 2.5 })],
    ['收盘价 NaN', () => macd([bar(0, 10, 10.5, 9.5, NaN)])],
    ['背离检测喂空数组', () => detectDivergence([], okMacd)],
    ['指标序列与 K 线不等长', () => detectDivergence(ok.slice(0, 10), okMacd)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
