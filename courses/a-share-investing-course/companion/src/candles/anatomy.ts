import type { Candle } from '../types'

/**
 * K线解剖：把一根蜡烛量成「方向 + 实体 + 上下影线 + 各占全天振幅的比例」。
 * 后续所有形态识别（锤子、十字、吞没……）都从这几个读数出发。
 */

/** yang=阳线（收高于开）；yin=阴线（收低于开）；doji=开收同价（多空打平） */
export type CandleDirection = 'yang' | 'yin' | 'doji'

export type CandleAnatomy = {
  direction: CandleDirection
  /** 实体：收盘价与开盘价的距离 */
  body: number
  /** 上影线：最高价到实体顶端的距离 */
  upperWick: number
  /** 下影线：实体底端到最低价的距离 */
  lowerWick: number
  /** 全天振幅：最高价减最低价 */
  range: number
  /** 实体占振幅的比例；四价合一（振幅为 0）时记 0 */
  bodyRatio: number
  upperWickRatio: number
  lowerWickRatio: number
}

export function candleAnatomy(c: Candle): CandleAnatomy {
  const { open, high, low, close } = c
  for (const v of [open, high, low, close]) {
    if (!Number.isFinite(v)) throw new Error(`candleAnatomy：开高低收必须是有限数字，收到的是 ${v}`)
  }
  if (high < low) throw new Error('candleAnatomy：最高价不能低于最低价')
  if (high < open || high < close || low > open || low > close) {
    throw new Error('candleAnatomy：最高/最低价必须包住开盘价与收盘价')
  }
  const body = Math.abs(close - open)
  const upperWick = high - Math.max(open, close)
  const lowerWick = Math.min(open, close) - low
  const range = high - low
  return {
    direction: close > open ? 'yang' : close < open ? 'yin' : 'doji',
    body,
    upperWick,
    lowerWick,
    range,
    bodyRatio: range > 0 ? body / range : 0,
    upperWickRatio: range > 0 ? upperWick / range : 0,
    lowerWickRatio: range > 0 ? lowerWick / range : 0,
  }
}
