import type { Candle } from '../types'

/**
 * 枢轴点：pivots。
 * 第 10 章讲趋势时，图上的 HH/HL/LH/LL 标注用的是「左右各 k 根」的局部极值草稿判据，
 * 当时声明过：正式的识别器到支撑阻力一章才建。本章兑现——判据一字不改地搬进实验场，
 * 只是从此可对任意行情调用、可被测试与图表反复使用。
 * 枢轴是画趋势线、找支撑阻力位的原材料：拐角定了，线才有地方落笔。
 */

/** 枢轴侧别：high=波峰（局部高点拐角），low=波谷（局部低点拐角） */
export type PivotSide = 'high' | 'low'

/** 一个枢轴：index 是 K 线下标，price 是峰的高点或谷的低点 */
export type Pivot = {
  index: number
  side: PivotSide
  price: number
}

/** 默认确认窗：左右各 3 根——第 10 章教学标注的同款口径 */
export const DEFAULT_PIVOT_WINDOW = 3

/** 入参体检：空序列、非法窗口、非法价格，当场抛中文错误 */
function assertPivotArgs(candles: readonly Candle[], k: number, label: string): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${label}：candles 不能为空`)
  }
  if (!Number.isInteger(k) || k < 1) {
    throw new Error(`${label}：k 必须是正整数（左右各 k 根的确认窗），收到的是 ${k}`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].high) || !Number.isFinite(candles[i].low)) {
      throw new Error(`${label}：第 ${i} 根的高低价必须是有限数字，收到的是 ${candles[i].high}/${candles[i].low}`)
    }
  }
}

/** 枢轴识别：一个高点在左右各 k 根内都是严格最高，是波峰；一个低点同理是波谷。
 *  判据与第 10 章教学标注逐字一致：
 *  - 严格不等号——两个相等的高点谁也不是峰（平顶留给第 7 章的双根形态，这里不越界）；
 *  - 需要右侧 k 根——最新 k 根内的拐角要等窗口凑满才确认，这不是缺陷是诚实：
 *    枢轴是回顾性判据，把它当实时信号用，等于逼它在没有证据时下结论；
 *  - 原始极值里同类相邻时只留更极端的一个——峰谷必须交替，行情才被切成一段段坡。 */
export function pivots(candles: readonly Candle[], k: number = DEFAULT_PIVOT_WINDOW): Pivot[] {
  assertPivotArgs(candles, k, 'pivots')
  const raw: Pivot[] = []
  for (let i = k; i < candles.length - k; i++) {
    let isHigh = true
    let isLow = true
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue
      if (candles[j].high >= candles[i].high) isHigh = false
      if (candles[j].low <= candles[i].low) isLow = false
    }
    if (isHigh) raw.push({ index: i, side: 'high', price: candles[i].high })
    if (isLow) raw.push({ index: i, side: 'low', price: candles[i].low })
  }
  const kept: Pivot[] = []
  for (const p of raw) {
    const last = kept[kept.length - 1]
    if (!last || last.side !== p.side) kept.push({ ...p })
    else if ((p.side === 'high' && p.price > last.price) || (p.side === 'low' && p.price < last.price))
      kept[kept.length - 1] = { ...p }
  }
  return kept
}
