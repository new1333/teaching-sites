import type { Candle } from '../types'
import { candleAnatomy } from '../candles/anatomy'
import type { TrendContext } from './context'

/**
 * 单根影线族形态识别：大阳线、大阴线、光头光脚、锤子、上吊、射击之星、倒锤子。
 * 全部判据只用 candleAnatomy 量出的数字（实体、影线、占振幅比例），不看像素长相；
 * 锤子/上吊、倒锤子/射击之星是同一形状，由背景（TrendContext）决定叫哪个名字。
 */

export type WickPatternId =
  | 'big-yang'
  | 'big-yin'
  | 'marubozu'
  | 'hammer'
  | 'hanging-man'
  | 'shooting-star'
  | 'inverted-hammer'

/** 实体占全天振幅达到该比例记「大」：一方从开盘压到收盘 */
const BIG_BODY_RATIO = 0.7
/** 上下影各不超过振幅的该比例记「光头光脚」：全天没有像样的反攻 */
const BALD_WICK_RATIO = 0.05
/** 影线达到实体的该倍数才算「长影」 */
const WICK_VS_BODY = 2
/** 实体占比低于该值的近十字K线留给十字星家族（下一章） */
const BODY_FLOOR_RATIO = 0.05

const POSITIONS: readonly TrendContext['position'][] = ['falling', 'rising', 'flat']

export function classifyWicks(c: Candle, context: TrendContext): WickPatternId[] {
  if (!context || !POSITIONS.includes(context.position)) {
    throw new Error(`classifyWicks：context.position 必须是 falling/rising/flat 之一，收到的是 ${context?.position}`)
  }
  const a = candleAnatomy(c) // 四价守门与实体/影线读数都复用第 3 章的解剖器
  const out: WickPatternId[] = []

  // —— 与位置无关的三个形状 ——
  if (a.direction === 'yang' && a.bodyRatio >= BIG_BODY_RATIO) out.push('big-yang')
  if (a.direction === 'yin' && a.bodyRatio >= BIG_BODY_RATIO) out.push('big-yin')
  if (
    a.direction !== 'doji' &&
    a.upperWickRatio <= BALD_WICK_RATIO &&
    a.lowerWickRatio <= BALD_WICK_RATIO
  ) {
    out.push('marubozu')
  }

  // —— 位置换算的两个形状对：同一形状，背景下跌叫一个名字，背景上涨叫另一个 ——
  const hasBody = a.bodyRatio > BODY_FLOOR_RATIO
  const longLower = a.lowerWick >= WICK_VS_BODY * a.body && a.upperWick <= a.body
  const longUpper = a.upperWick >= WICK_VS_BODY * a.body && a.lowerWick <= a.body
  if (hasBody && longLower) {
    if (context.position === 'falling') out.push('hammer')
    else if (context.position === 'rising') out.push('hanging-man')
  }
  if (hasBody && longUpper) {
    if (context.position === 'rising') out.push('shooting-star')
    else if (context.position === 'falling') out.push('inverted-hammer')
  }
  return out
}
