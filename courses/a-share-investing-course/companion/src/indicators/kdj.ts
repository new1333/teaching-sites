import type { Candle } from '../types'

/**
 * KDJ（随机指标）：A 股软件副图的默认住户，与 RSI 同源不同尺。
 * 三层积木，每层都是一次「位置 → 平滑」：
 *   RSV =（收盘 − 近 n 日最低）÷（近 n 日最高 − 近 n 日最低）× 100
 *         ——今天的收盘站在最近 n 天高低区间的百分之几：贴顶 100、贴底 0；
 *   K   = 2/3 × 昨K + 1/3 × RSV——RSV 的平滑线（新值只占三分之一）；
 *   D   = 2/3 × 昨D + 1/3 × K——对 K 再平滑一次，更慢的那条；
 *   J   = 3K − 2D = K + 2×(K−D)——K 自己加上两倍「K 偏离 D 的程度」，放大镜线，
 *         会冲出 0~100 的上下界。
 * K 与 D 的初值取 50（国内软件通行约定）：行情还什么都没说时，先站在不偏不倚的中间。
 */

/** 与 K 线等长的读数序列：头部不足 n 根的格子是 null——窗口还没攒满 */
export type KdjLine = (number | null)[]

/** KDJ 全链路：RSV 原料与 K/D/J 三条序列逐根对齐 */
export type KdjSeries = {
  /** 未平滑的原料：收盘在近 n 日高低区间的位置百分比 */
  rsv: KdjLine
  k: KdjLine
  d: KdjLine
  j: KdjLine
}

/** A 股软件默认窗口 9 日 */
export const DEFAULT_KDJ = 9

/** K 与 D 的初值（也是 RSV 分母为零时的读数）：不偏不倚的中间位 */
export const KDJ_SEED = 50

/** 平滑权重：新值占 1/3、历史占 2/3——比第 11 章 EMA(9) 的 α=0.2 略快 */
export const KDJ_ALPHA = 1 / 3

/** KDJ 三层积木：RSV 自第 n 根起可算（窗口含当根，凑满 n 根），K/D 自同一根起步
 *  （种子 50），J = 3K − 2D 与 K/D 同格成形。之前的格子是 null，不猜。
 *  窗口内最高=最低（一字横盘）时分母为零：RSV 记 50，与走平的 RSI 同一个约定。 */
export function kdj(candles: readonly Candle[], n: number = DEFAULT_KDJ): KdjSeries {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('kdj：candles 不能为空')
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`kdj：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
      throw new Error(`kdj：第 ${i} 根的最高/最低/收盘价必须是有限数字，收到 high=${c.high}、low=${c.low}、close=${c.close}`)
    }
    if (c.high < c.low) {
      throw new Error(`kdj：第 ${i} 根的最高价不能低于最低价（high=${c.high} < low=${c.low}）`)
    }
    if (c.close > c.high || c.close < c.low) {
      throw new Error(`kdj：第 ${i} 根的收盘价必须落在最高与最低之间（close=${c.close}、high=${c.high}、low=${c.low}）`)
    }
  }

  const rsv: KdjLine = new Array(candles.length).fill(null)
  const k: KdjLine = new Array(candles.length).fill(null)
  const d: KdjLine = new Array(candles.length).fill(null)
  const j: KdjLine = new Array(candles.length).fill(null)

  // 朴素滑窗：每根全窗扫描（窗口最大 9 根，可读性优先；增量优化的数据契约见差异清单）
  let prevK: number | null = KDJ_SEED
  let prevD: number | null = KDJ_SEED
  for (let i = 0; i < candles.length; i++) {
    if (i < n - 1) continue // 窗口未满：RSV 无从谈起，K/D 没有新原料
    let hh = -Infinity
    let ll = Infinity
    for (let w = i - n + 1; w <= i; w++) {
      if (candles[w].high > hh) hh = candles[w].high
      if (candles[w].low < ll) ll = candles[w].low
    }
    const span = hh - ll
    rsv[i] = span === 0 ? KDJ_SEED : ((candles[i].close - ll) / span) * 100 // 分母为零：贴不了顶也探不了底，记 50

    // K = 2/3·昨K + 1/3·RSV；D 对 K 同款再来一次——两层平滑，一层比一层慢
    prevK = prevK! * (1 - KDJ_ALPHA) + rsv[i]! * KDJ_ALPHA
    prevD = prevD! * (1 - KDJ_ALPHA) + prevK * KDJ_ALPHA
    k[i] = prevK
    d[i] = prevD
    // J = 3K − 2D = K + 2×(K−D)：K 与 D 的差距放大两倍再叠回 K——差距一小段，J 冲一大截
    j[i] = 3 * prevK - 2 * prevD
  }
  return { rsv, k, d, j }
}
