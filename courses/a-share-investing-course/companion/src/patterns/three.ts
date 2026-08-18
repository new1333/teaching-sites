import type { Candle } from '../types'
import { candleAnatomy } from '../candles/anatomy'
import { trendContext, type TrendOpts } from './context'

/**
 * 三根及以上组合形态识别：早晨之星、黄昏之星、红三兵、红三兵受阻、黑三鸦、上升三法、下降三法。
 * 双根读「今天怎么回应昨天」；三根以上才演得成完整的戏——
 * 晨星/暮星是三幕反转剧（卖压枯竭 → 犹豫 → 接管确认），三兵/三鸦是三连推进（趋势自身的缩影），
 * 三法是五幕中继剧（推进 → 歇脚 → 再推进）。
 * 背景门分两档：反转（晨星/暮星）与中继（三法）沿用第 5 章的背景窗口——没有趋势，就没有可反转
 * 或可中继的对象；推进（三兵/三鸦/受阻）不设背景门——三根同向推进的 K 线就是自己的语境。
 * 判据口径与前两章共用：大实体 0.7、收缩三分之一、长影两倍于实体；全部只落在开高低收与成交量上。
 */

export type ThreeCandlePatternId =
  | 'morning-star' // 早晨之星：大阴 + 悬在其实体之下的小实体星线 + 收过中点的阳线
  | 'evening-star' // 黄昏之星：大阳 + 悬在其实体之上的小实体星线 + 失守中点的阴线
  | 'three-white-soldiers' // 红三兵：三根开盘嵌在前根实体内的饱满阳线，收盘逐根抬高
  | 'stalled-pattern' // 红三兵受阻：三兵之后高开却收小实体或长上影——推进撞上了墙
  | 'three-black-crows' // 黑三鸦：红三兵的镜像——三根饱满阴线，收盘逐根压低
  | 'rising-three-methods' // 上升三法：大阳 + 缩在其影线内回撤的三根小实体 + 收回新高的阳线
  | 'falling-three-methods' // 下降三法：镜像的下跌中继——大阴 + 框内小回升 + 杀回新低

export type ThreeCandlePattern = {
  id: ThreeCandlePatternId
  /** 完成日（最后一根 K 线）在数组中的下标：三根以上形态由最后一根画上句号 */
  index: number
  /** 方向倾向：bull=偏多线索，bear=偏空线索 */
  direction: 'bull' | 'bear'
  /** 形态出现之前的背景（第 5 章同款窗口量出；推进形态不设门，仅如实报告） */
  position: 'falling' | 'rising' | 'flat'
  /** 仅晨星/暮星给出：第三幕的确认状态。收复幅度（收过第一根实体中点）是硬判据，
   *  量能比（第三根量 ≥ 前两根较大者的 1.2 倍）不足则降级为未确认 */
  confirmed?: boolean
}

/** 晨星/暮星的第一幕与三法的首尾幕必须是大实体（复用第 5 章「大」的口径） */
const LEAD_BODY_RATIO = 0.7
/** 星线的收缩上限：实体不超过第一根实体的三分之一（与孕线同款） */
const STAR_SHRINK = 1 / 3
/** 三兵/三鸦每根实体的最低占比：推进要有身子，纺锤不算兵 */
const MARCH_BODY_RATIO = 0.5
/** 受阻的第四根小实体边界：实体占自身振幅不超过该比例 */
const STALLED_BODY_RATIO = 0.3
/** 受阻的长上影口径：上影达到实体的该倍数（与第 5 章长影同款） */
const STALLED_WICK_VS_BODY = 2
/** 三法中间三根的实体上限：不超过第一根实体的三分之一 */
const METHODS_SHRINK = 1 / 3
/** 晨星/暮星第三幕的量能确认：第三根成交量须达到前两根较大者的该倍数 */
const CONFIRM_VOL_MULT = 1.2

/** 与前两章共用的背景窗口参数（lookback 默认 5、threshold 默认 0.05） */
export type ThreeCandleOpts = TrendOpts

/** 三连推进的骨架：红三兵（dir='yang'）与黑三鸦（dir='yin'）共用——
 *  三根同向、实体饱满、开盘逐根嵌在前根实体之内（温和推进不跳空抢跑）、收盘逐根推进（压低） */
function isMarch(candles: readonly Candle[], end: number, dir: 'yang' | 'yin'): boolean {
  const a = candles[end - 2]
  const b = candles[end - 1]
  const last = candles[end]
  const aa = candleAnatomy(a)
  const ab = candleAnatomy(b)
  const al = candleAnatomy(last)
  if (aa.direction !== dir || ab.direction !== dir || al.direction !== dir) return false
  if (aa.bodyRatio < MARCH_BODY_RATIO || ab.bodyRatio < MARCH_BODY_RATIO || al.bodyRatio < MARCH_BODY_RATIO) {
    return false
  }
  const aTop = Math.max(a.open, a.close)
  const aBottom = Math.min(a.open, a.close)
  const bTop = Math.max(b.open, b.close)
  const bBottom = Math.min(b.open, b.close)
  const nested = aBottom <= b.open && b.open <= aTop && bBottom <= last.open && last.open <= bTop
  if (!nested) return false
  return dir === 'yang'
    ? a.close < b.close && b.close < last.close
    : a.close > b.close && b.close > last.close
}

export function detectThreeCandle(candles: readonly Candle[], opts: ThreeCandleOpts = {}): ThreeCandlePattern[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectThreeCandle：candles 不能为空')
  }
  const lookback = opts.lookback ?? 5
  const out: ThreeCandlePattern[] = []
  // 完成日 i 最早是 lookback+2：三根形态的第一根（i-2）前面要放得下一个完整背景窗口
  for (let i = lookback + 2; i < candles.length; i++) {
    const cur = candles[i]
    const ca = candleAnatomy(cur) // 完成日永远过一遍解剖：非数字价格在这里被拦下
    const ctx = trendContext(candles, i - 2, { lookback, threshold: opts.threshold }) // 背景在形态之前结束

    // —— 三幕剧：晨星与暮星。第一幕大实体定战场，第二幕小实体星线悬在战场之外（脱离了才叫犹豫），
    // 第三幕收复（失守）第一根实体的中点——第 7 章的战线原封不动搬过来，当第三幕的及格线。 ——
    const first = candles[i - 2]
    const star = candles[i - 1]
    const fa = candleAnatomy(first)
    const sa = candleAnatomy(star)
    const firstTop = Math.max(first.open, first.close)
    const firstBottom = Math.min(first.open, first.close)
    const midpoint = (first.open + first.close) / 2 // 第一根实体的中点：第三幕收复幅度的刻度
    const starSmall = sa.body <= fa.body * STAR_SHRINK
    const confirmed = cur.volume >= CONFIRM_VOL_MULT * Math.max(first.volume, star.volume)

    if (
      ctx.position === 'falling' &&
      fa.direction === 'yin' &&
      fa.bodyRatio >= LEAD_BODY_RATIO &&
      starSmall &&
      Math.max(star.open, star.close) < firstBottom && // 星线悬在第一根实体之下
      ca.direction === 'yang' &&
      cur.close > midpoint // 收复过半：收不回中点的只是下跌中继里的反抽
    ) {
      out.push({ id: 'morning-star', index: i, direction: 'bull', position: ctx.position, confirmed })
    }
    if (
      ctx.position === 'rising' &&
      fa.direction === 'yang' &&
      fa.bodyRatio >= LEAD_BODY_RATIO &&
      starSmall &&
      Math.min(star.open, star.close) > firstTop && // 星线悬在第一根实体之上
      ca.direction === 'yin' &&
      cur.close < midpoint // 失守中点：跌不破中点的只是上涨途中的回调
    ) {
      out.push({ id: 'evening-star', index: i, direction: 'bear', position: ctx.position, confirmed })
    }

    // —— 三连推进：红三兵与黑三鸦。不设背景门——三根同向推进的 K 线就是自己的语境 ——
    if (isMarch(candles, i, 'yang')) {
      out.push({ id: 'three-white-soldiers', index: i, direction: 'bull', position: ctx.position })
    }
    if (isMarch(candles, i, 'yin')) {
      out.push({ id: 'three-black-crows', index: i, direction: 'bear', position: ctx.position })
    }

    // —— 受阻：三兵的第四幕警告。姿态还在冲（开盘不低于第三根收盘），身子却缩了（小实体）
    // 或被打回来了（长上影）——推进撞上了墙。四根一组，背景窗口得再往前挪一天，
    // 不能让三兵自己的第一根混进背景里。完成日最早 lookback+3。 ——
    if (i >= lookback + 3 && isMarch(candles, i - 1, 'yang')) {
      const third = candles[i - 1]
      const sCtx = trendContext(candles, i - 3, { lookback, threshold: opts.threshold })
      if (
        cur.open >= third.close &&
        (ca.bodyRatio <= STALLED_BODY_RATIO || ca.upperWick >= STALLED_WICK_VS_BODY * ca.body)
      ) {
        out.push({ id: 'stalled-pattern', index: i, direction: 'bear', position: sCtx.position })
      }
    }

    // —— 五幕剧：上升/下降三法。第一根大实体立框，中间三根小实体缩在框内回撤（歇脚），
    // 第五根大实体收回框外（再启程）——歇脚不折返。完成日最早 lookback+4。 ——
    if (i >= lookback + 4) {
      const lead = candles[i - 4]
      const la = candleAnatomy(lead)
      const mCtx = trendContext(candles, i - 4, { lookback, threshold: opts.threshold }) // 中继要有可中继的趋势
      const middles = [candles[i - 3], candles[i - 2], candles[i - 1]]
      const boxed = (m: Candle, away: 'below' | 'above'): boolean =>
        m.high <= lead.high &&
        m.low >= lead.low &&
        candleAnatomy(m).body <= la.body * METHODS_SHRINK &&
        (away === 'below' ? m.close < lead.close : m.close > lead.close)
      if (
        mCtx.position === 'rising' &&
        la.direction === 'yang' &&
        la.bodyRatio >= LEAD_BODY_RATIO &&
        middles.every((m) => boxed(m, 'below')) &&
        ca.direction === 'yang' &&
        ca.bodyRatio >= LEAD_BODY_RATIO &&
        cur.close > lead.close // 收回第一根的收盘之上：回撤被全额收复
      ) {
        out.push({ id: 'rising-three-methods', index: i, direction: 'bull', position: mCtx.position })
      }
      if (
        mCtx.position === 'falling' &&
        la.direction === 'yin' &&
        la.bodyRatio >= LEAD_BODY_RATIO &&
        middles.every((m) => boxed(m, 'above')) &&
        ca.direction === 'yin' &&
        ca.bodyRatio >= LEAD_BODY_RATIO &&
        cur.close < lead.close
      ) {
        out.push({ id: 'falling-three-methods', index: i, direction: 'bear', position: mCtx.position })
      }
    }
  }
  return out
}
