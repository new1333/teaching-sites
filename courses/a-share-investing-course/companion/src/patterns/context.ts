import type { Candle } from '../types'

/**
 * 趋势位置判定：一根 K 线的形态含义不由它自己决定，还由它「之前那段行情」决定。
 * 这里只用形态当天以前的数据——「末端」要等未来走出来才能确认，事中可判的只有
 * 「它出现在一段上涨/下跌之后」。回看窗口、起算阈值都是教学约定，作为参数传入。
 */

export type TrendPosition = 'falling' | 'rising' | 'flat'

export type TrendContext = {
  position: TrendPosition
  /** 背景段涨跌幅（比例）：窗口末根收盘 ÷ 首根收盘 − 1，如 -0.085 表示跌了 8.5% */
  change: number
  /** 参与判定的背景K线根数（等于实际使用的 lookback） */
  bars: number
}

export type TrendOpts = {
  /** 回看的背景K线根数，默认 5 */
  lookback?: number
  /** 窗口涨跌幅超过该比例才算有方向，默认 0.05（5%） */
  threshold?: number
}

export function trendContext(candles: readonly Candle[], index: number, opts: TrendOpts = {}): TrendContext {
  const lookback = opts.lookback ?? 5
  const threshold = opts.threshold ?? 0.05
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('trendContext：candles 不能为空')
  }
  if (!Number.isInteger(index) || index < 0 || index >= candles.length) {
    throw new Error(`trendContext：index 必须落在数组范围内（0 到 ${candles.length - 1}），收到的是 ${index}`)
  }
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error(`trendContext：lookback 必须是正整数，收到的是 ${lookback}`)
  }
  if (!Number.isFinite(threshold) || !(threshold > 0)) {
    throw new Error(`trendContext：threshold 必须是正数，收到的是 ${threshold}`)
  }
  if (index < lookback) {
    throw new Error(`trendContext：判定第 ${index} 根的位置需要它前面至少 ${lookback} 根K线做背景`)
  }
  const first = candles[index - lookback]
  const last = candles[index - 1]
  for (const end of [first, last]) {
    if (!Number.isFinite(end.close) || !(end.close > 0)) {
      throw new Error(`trendContext：背景窗口两端的收盘价必须是正的有限数字，收到的是 ${end.close}`)
    }
  }
  const change = (last.close - first.close) / first.close
  const position: TrendPosition = change <= -threshold ? 'falling' : change >= threshold ? 'rising' : 'flat'
  return { position, change, bars: lookback }
}
