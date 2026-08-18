import type { Candle } from '../types'
import { candleAnatomy } from '../candles/anatomy'
import { trendContext, type TrendOpts } from './context'

/**
 * 双根组合形态识别：看涨/看跌吞没、乌云盖顶、刺透、看涨/看跌孕线、十字孕线、平顶、平底。
 * 单根 K 线读的是「今天谁赢了」；双根组合读的是「今天怎么回应昨天」——
 * 回应是扩张（吞没：连本带利收回来）、攻进腹地（乌云盖顶/刺透：高开或低开后的反击），
 * 还是收缩（孕线：攻势踩了刹车），各有各的判据。全部判据只落在两根 K 线的开高低收数字上；
 * 背景沿用第 5 章的趋势窗口（只用形态之前的数据，不看未来），flat 一律不命名——没有趋势就没有反转。
 */

export type TwoCandlePatternId =
  | 'bullish-engulfing' // 看涨吞没：阳线实体整个包住昨天的阴线实体
  | 'bearish-engulfing' // 看跌吞没：阴线实体整个包住昨天的阳线实体
  | 'dark-cloud-cover' // 乌云盖顶：高开阴线收进昨天阳线实体的中点之下
  | 'piercing' // 刺透形态：低开阳线收进昨天阴线实体的中点之上
  | 'bullish-harami' // 看涨孕线：小阳实体缩在昨天大阴实体之内
  | 'bearish-harami' // 看跌孕线：小阴实体缩在昨天大阳实体之内
  | 'doji-harami' // 十字孕线：十字星缩在昨天大实体之内
  | 'tweezer-top' // 平顶：两根高点落在同一价位——同一卖压两次把价格打了回去
  | 'tweezer-bottom' // 平底：两根低点落在同一价位——同一买压两次把价格接了回来

export type TwoCandlePattern = {
  id: TwoCandlePatternId
  /** 完成日（第二根 K 线）在数组中的下标：双根形态由第二根画上句号 */
  index: number
  /** 方向倾向：bull=偏多线索，bear=偏空线索；十字孕线的倾向来自背景、仍待次日确认 */
  direction: 'bull' | 'bear'
  /** 形态出现之前的背景（第 5 章同款窗口量出） */
  position: 'falling' | 'rising' | 'flat'
}

/** 吞没的前一天必须有像样实体：昨天开收打平（十字族地盘 ≤5%）就没有「战果」可吞 */
const ENGULF_PREV_BODY = 0.05
/** 孕线的昨天必须是大实体（复用第 5 章「大」的口径）：昨天不够大，谈不上「缩在内」 */
const HARAMI_PREV_BODY = 0.7
/** 孕线的收缩要明显：今天实体不超过昨天实体的三分之一 */
const HARAMI_SHRINK = 1 / 3
/** 十字孕线的边界：今天实体占振幅不超过该比例归十字族（与第 6 章家族边界一致） */
const DOJI_BODY_RATIO = 0.05
/** 平顶/平底的「同一价位」容差：两根高点（低点）的差距不超过参照振幅的一成 */
const TWEEZER_TOL = 0.1

/** 与第 5 章共用的背景窗口参数（lookback 默认 5、threshold 默认 0.05） */
export type TwoCandleOpts = TrendOpts

export function detectTwoCandle(candles: readonly Candle[], opts: TwoCandleOpts = {}): TwoCandlePattern[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectTwoCandle：candles 不能为空')
  }
  const lookback = opts.lookback ?? 5
  const out: TwoCandlePattern[] = []
  // 完成日 i 最早是 lookback+1：它的前一天（形态第一根）要放得下一个完整背景窗口
  for (let i = lookback + 1; i < candles.length; i++) {
    const prev = candles[i - 1] // 昨天：形态的第一根
    const cur = candles[i] // 今天：回应发生、形态完成的一根
    const pa = candleAnatomy(prev)
    const ca = candleAnatomy(cur)
    const ctx = trendContext(candles, i - 1, { lookback, threshold: opts.threshold }) // 背景在形态之前结束

    const prevTop = Math.max(prev.open, prev.close)
    const prevBottom = Math.min(prev.open, prev.close)
    const curTop = Math.max(cur.open, cur.close)
    const curBottom = Math.min(cur.open, cur.close)
    const midpoint = (prev.open + prev.close) / 2 // 昨天实体的中点：乌云盖顶与刺透共用的战线

    // —— 吞没：今天的实体把昨天的实体整个包住。至少一头严格越过——两根一模一样的实体没有「回应」 ——
    const engulf =
      pa.bodyRatio > ENGULF_PREV_BODY &&
      curTop >= prevTop &&
      curBottom <= prevBottom &&
      (curTop > prevTop || curBottom < prevBottom)
    if (engulf && ca.direction === 'yang' && ctx.position === 'falling') {
      out.push({ id: 'bullish-engulfing', index: i, direction: 'bull', position: ctx.position })
    }
    if (engulf && ca.direction === 'yin' && ctx.position === 'rising') {
      out.push({ id: 'bearish-engulfing', index: i, direction: 'bear', position: ctx.position })
    }

    // —— 乌云盖顶与刺透：高开/低开之后攻进昨天实体的腹地，但收在那儿、没有整个吞掉 ——
    // 镜像关系：同一条中点线，乌云盖顶要收在它之下（但仍在昨天实体内），刺透要收在它之上（同理）。
    if (
      ctx.position === 'rising' &&
      pa.direction === 'yang' &&
      ca.direction === 'yin' &&
      cur.open > prev.close && // 高开：最后的乐观
      cur.close < midpoint && // 收不过昨天实体的中点：战线丢了
      cur.close > prev.open // 仍收在昨天实体之内——整个吞掉是吞没的地盘
    ) {
      out.push({ id: 'dark-cloud-cover', index: i, direction: 'bear', position: ctx.position })
    }
    if (
      ctx.position === 'falling' &&
      pa.direction === 'yin' &&
      ca.direction === 'yang' &&
      cur.open < prev.close && // 低开：最后的恐慌
      cur.close > midpoint && // 收回昨天实体的中点之上：买方正面顶回来了
      cur.close < prev.open // 收在昨天实体之内，与吞没分界
    ) {
      out.push({ id: 'piercing', index: i, direction: 'bull', position: ctx.position })
    }

    // —— 孕线：昨天大实体，今天整个缩在其内——扩张的对偶是收缩。判据先问骨架（昨天够大），
    // 再问位置（严格缩在内），最后问今天的身份：十字归十字孕线，小实体看收缩幅度。 ——
    const prevBig = pa.bodyRatio >= HARAMI_PREV_BODY
    const inside = curTop < prevTop && curBottom > prevBottom
    if (prevBig && inside) {
      if (ca.bodyRatio <= DOJI_BODY_RATIO) {
        // 十字孕线：今天连方向都没给出，倾向只能来自背景，且要等次日确认（第 6 章的道理）
        if (ctx.position === 'falling') {
          out.push({ id: 'doji-harami', index: i, direction: 'bull', position: ctx.position })
        } else if (ctx.position === 'rising') {
          out.push({ id: 'doji-harami', index: i, direction: 'bear', position: ctx.position })
        }
      } else if (ca.body <= pa.body * HARAMI_SHRINK) {
        if (ca.direction === 'yang' && ctx.position === 'falling') {
          out.push({ id: 'bullish-harami', index: i, direction: 'bull', position: ctx.position })
        }
        if (ca.direction === 'yin' && ctx.position === 'rising') {
          out.push({ id: 'bearish-harami', index: i, direction: 'bear', position: ctx.position })
        }
      }
    }

    // —— 平顶/平底：两根的高点（低点）落在同一价位。多近算「同一」？拿形态之前 lookback 根的
    // 平均振幅当尺（第 6 章的参照尺）：差距在噪声尺度的一成以内，才算两次碰到同一个价位。 ——
    let sum = 0
    for (let j = i - 1 - lookback; j <= i - 2; j++) sum += candles[j].high - candles[j].low
    const tol = TWEEZER_TOL * (sum / lookback)
    if (ctx.position === 'rising' && Math.abs(prev.high - cur.high) <= tol) {
      out.push({ id: 'tweezer-top', index: i, direction: 'bear', position: ctx.position })
    }
    if (ctx.position === 'falling' && Math.abs(prev.low - cur.low) <= tol) {
      out.push({ id: 'tweezer-bottom', index: i, direction: 'bull', position: ctx.position })
    }
  }
  return out
}
