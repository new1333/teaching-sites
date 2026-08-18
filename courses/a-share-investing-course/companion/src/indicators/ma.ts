import type { Candle } from '../types'

/**
 * 均线族：sma / ema / crossovers。
 * 第 10 章的趋势靠波峰波谷——只在拐角处读方向，一条稀疏路线；均线是稠密路线：
 * 每根 K 线都用最近 n 个收盘价算一个平均，噪声互相抵消，剩下的是平滑的趋势线。
 * 代价写在 lag 里：均线永远等价格先走、自己后到，窗口越长到得越晚。
 */

/** 均线序列：与入参 K 线等长、逐根对齐；头部不足一个窗口的格子是 null——均线还没成形 */
export type MaSeries = (number | null)[]

/** 一次交叉：金叉=快线上穿慢线，死叉=快线下穿慢线 */
export type MaCross = {
  /** 交叉成立的 K 线下标——这一根收盘算完，快线与慢线刚分出高下的那一刻 */
  index: number
  /** golden=金叉（前一根快线不高于慢线、这一根严格高于）；dead=死叉（前一根不低于、这一根严格低于） */
  kind: 'golden' | 'dead'
}

/** 三个公共入口共用的入参体检：空序列、非正整数窗口、非有限收盘价，当场抛错 */
function assertMaArgs(candles: readonly Candle[], n: number, label: string): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${label}：candles 不能为空`)
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label}：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`${label}：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }
}

/** 简单移动平均：最近 n 个收盘价的算术平均。滑窗只做一加一减，整条均线每个格子都是真平均 */
export function sma(candles: readonly Candle[], n: number): MaSeries {
  assertMaArgs(candles, n, 'sma')
  const out: MaSeries = new Array(candles.length).fill(null)
  if (candles.length < n) return out // 不足一个窗口：整条都是 null，不猜
  let sum = 0
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close
    if (i >= n) sum -= candles[i - n].close // 窗口右移一格：进一根新的，退一根最老的
    if (i >= n - 1) out[i] = sum / n
  }
  return out
}

/** 指数移动平均：给越新的价格越大的权重，反应比 sma 快、但仍滞后。
 *  第一个值取首窗 n 个收盘价的 sma 作种子，此后每根递推：
 *  ema[i] = ema[i−1] + α × (close[i] − ema[i−1])，α = 2 ÷ (n+1)。 */
export function ema(candles: readonly Candle[], n: number): MaSeries {
  assertMaArgs(candles, n, 'ema')
  const out: MaSeries = new Array(candles.length).fill(null)
  if (candles.length < n) return out
  const alpha = 2 / (n + 1)
  let seed = 0
  for (let i = 0; i < n; i++) seed += candles[i].close
  let prev = seed / n
  out[n - 1] = prev
  for (let i = n; i < candles.length; i++) {
    prev = prev + alpha * (candles[i].close - prev) // 新价格只按 α 拽动均线一步，剩下的 (1−α) 是历史惯性
    out[i] = prev
  }
  return out
}

/** 金叉死叉扫描：快慢两条 sma 的逐格比较，返回全部交叉信号（按时间旧→新）。
 *  A 股软件里默认的 MA5/MA20 金叉死叉就是它。窗口口径取 sma（与行情软件默认一致），
 *  要比 ema 快慢线，把两条 MaSeries 自己比一遍即可，口径先声明。 */
export function crossovers(candles: readonly Candle[], fast: number, slow: number): MaCross[] {
  if (!Number.isInteger(fast) || fast < 1) {
    throw new Error(`crossovers：fast 必须是正整数，收到的是 ${fast}`)
  }
  if (!Number.isInteger(slow) || slow < 1) {
    throw new Error(`crossovers：slow 必须是正整数，收到的是 ${slow}`)
  }
  if (fast >= slow) {
    throw new Error(`crossovers：fast 窗口必须短于 slow（收到 fast=${fast}、slow=${slow}）——快慢线比的是谁窗口短`)
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('crossovers：candles 不能为空')
  }
  if (candles.length <= slow) {
    throw new Error(`crossovers：序列至少要 ${slow + 1} 根K线才凑得出相邻两个慢线值，收到的是 ${candles.length} 根`)
  }
  const fastMa = sma(candles, fast)
  const slowMa = sma(candles, slow)
  const out: MaCross[] = []
  // 循环从 slow 起步：i 与 i−1 都 ≥ slow−1，两条均线在这些格子必然已成形（滑窗算术保证，不是猜）
  for (let i = slow; i < candles.length; i++) {
    const fPrev = fastMa[i - 1]!
    const sPrev = slowMa[i - 1]!
    const fNow = fastMa[i]!
    const sNow = slowMa[i]!
    if (fNow > sNow && fPrev <= sPrev) out.push({ index: i, kind: 'golden' })
    else if (fNow < sNow && fPrev >= sPrev) out.push({ index: i, kind: 'dead' })
  }
  return out
}
