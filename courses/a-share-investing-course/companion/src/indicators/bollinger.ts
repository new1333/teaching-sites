import type { Candle } from '../types'
import { sma } from './ma'
import { stdev } from '../stats/stdev'

/**
 * 布林带：把波动率装进通道的指标。
 * 中轨就是第 11 章的均线（默认 MA20）；上下轨 = 中轨 ± k 倍标准差（默认 k=2）——
 * 用「最近 n 根收盘价的颠簸幅度」当尺子，波大带子宽、波小带子窄，通道自己会呼吸。
 * 带子量的是速度不是位置：带宽收口说明颠簸在变小（风暴前的安静），开口说明变大的颠簸已经上路。
 * 三件套：bollinger 算三条带与带宽；squeezes 找收口点；outsideStats 数带外占比。
 */

/** 与 K 线等长的带线序列：头部不足 n 根的格子是 null——带子还没成形 */
export type BandLine = (number | null)[]

/** 布林带全链路：三条带与带宽逐根对齐 */
export type BollingerSeries = {
  /** 中轨：n 根收盘价的均线（与第 11 章 sma 同一条线） */
  mid: BandLine
  /** 上轨：中轨 + k·σ */
  upper: BandLine
  /** 下轨：中轨 − k·σ */
  lower: BandLine
  /** 带宽：(上轨−下轨)÷中轨×100——带子宽窄的百分比读数，收口开口全看它 */
  bandwidth: BandLine
}

/** 一个收口点：带宽在回看窗内创下严格新低的那根 K 线 */
export type BollingerSqueeze = {
  index: number
  /** 当根带宽（百分比），图与正文直接引用 */
  bandwidth: number
}

/** 带外占比统计：±kσ 通道外收盘的记账 */
export type BollingerOutside = {
  /** 带子成形的根数（序列长 − n + 1，不足时 outsideStats 直接抛错） */
  formed: number
  /** 收盘严格越出上下轨的根数（恰好压在轨上不算） */
  outside: number
  /** 收盘高于上轨的根数 */
  above: number
  /** 收盘低于下轨的根数 */
  below: number
  /** outside ÷ formed：带外事件的发生频率 */
  ratio: number
}

/** 发明人 Bollinger 的经典默认：20 日窗口、2 倍标准差 */
export const DEFAULT_BB_N = 20
export const DEFAULT_BB_K = 2

/** 收口检测的回看窗：带宽要创「最近 20 根」的严格新低才算收口（课程操作化默认，可传参改） */
export const DEFAULT_SQUEEZE_LOOKBACK = 20

/** 三个公共入口共用的入参体检：空序列、非正整数窗口、非正倍数、非有限收盘价，当场抛错 */
function assertBollingerArgs(candles: readonly Candle[], n: number, k: number, label: string): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${label}：candles 不能为空`)
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label}：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  if (!Number.isFinite(k) || k <= 0) {
    throw new Error(`${label}：倍数 k 必须是正数，收到的是 ${k}`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`${label}：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }
}

/** 布林带：中轨复用第 11 章 sma，上下轨在中轨上加减 k·σ（窗口含当根的总体标准差），
 *  带宽换算成百分比。窗口未攒满的格子是 null，不猜。 */
export function bollinger(candles: readonly Candle[], n: number = DEFAULT_BB_N, k: number = DEFAULT_BB_K): BollingerSeries {
  assertBollingerArgs(candles, n, k, 'bollinger')
  const mid = sma(candles, n)
  const upper: BandLine = new Array(candles.length).fill(null)
  const lower: BandLine = new Array(candles.length).fill(null)
  const bandwidth: BandLine = new Array(candles.length).fill(null)
  const window: number[] = []
  for (let i = 0; i < candles.length; i++) {
    window.push(candles[i].close)
    if (window.length > n) window.shift() // 滑窗：进一根新的，退一根最老的
    if (i < n - 1) continue
    const sd = stdev(window) // 最近 n 根收盘价的颠簸幅度——带子宽窄的唯一来源
    const m = mid[i]!
    upper[i] = m + k * sd
    lower[i] = m - k * sd
    bandwidth[i] = ((upper[i]! - lower[i]!) / m) * 100
  }
  return { mid, upper, lower, bandwidth }
}

/** 收口检测：带宽逐格与回看窗内的前 lookback−1 根比，全部严格更高才算创下新低。
 *  判据要凑满（头部不够回看窗的格子不判），所以最早也要在第 n+lookback−2 根才可能出现收口点；
 *  连续下行的带宽会连出多个收口点——「收口进行中」本来就是一段日子，不是一根 K 线。 */
export function squeezes(
  candles: readonly Candle[],
  opts: { n?: number; k?: number; lookback?: number } = {},
): BollingerSqueeze[] {
  const n = opts.n ?? DEFAULT_BB_N
  const k = opts.k ?? DEFAULT_BB_K
  const lookback = opts.lookback ?? DEFAULT_SQUEEZE_LOOKBACK
  assertBollingerArgs(candles, n, k, 'squeezes')
  if (!Number.isInteger(lookback) || lookback < 2) {
    throw new Error(`squeezes：lookback 必须是不小于 2 的整数，收到的是 ${lookback}`)
  }
  const { bandwidth } = bollinger(candles, n, k)
  const out: BollingerSqueeze[] = []
  // 从 n−1+lookback−1 起：当根带宽已成形，且前面凑得满 lookback−1 个成形带宽
  for (let i = n - 1 + lookback - 1; i < candles.length; i++) {
    const cur = bandwidth[i]!
    let isNewLow = true
    for (let j = i - lookback + 1; j < i; j++) {
      if (bandwidth[j]! <= cur) {
        isNewLow = false
        break
      }
    }
    if (isNewLow) out.push({ index: i, bandwidth: cur })
  }
  return out
}

/** 带外占比统计：带子成形的每根收盘与上下轨比，严格越出才记账（恰好压在轨上算带内）。
 *  序列不足 n 根时带子一根都没成形，占比无从谈起，抛错。 */
export function outsideStats(
  candles: readonly Candle[],
  n: number = DEFAULT_BB_N,
  k: number = DEFAULT_BB_K,
): BollingerOutside {
  assertBollingerArgs(candles, n, k, 'outsideStats')
  if (candles.length < n) {
    throw new Error(`outsideStats：序列至少要 ${n} 根K线才凑得出第一条带，收到的是 ${candles.length} 根`)
  }
  const { upper, lower } = bollinger(candles, n, k)
  let formed = 0
  let above = 0
  let below = 0
  for (let i = n - 1; i < candles.length; i++) {
    formed++
    if (candles[i].close > upper[i]!) above++
    else if (candles[i].close < lower[i]!) below++
  }
  const outside = above + below
  return { formed, outside, above, below, ratio: outside / formed }
}
