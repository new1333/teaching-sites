import type { Candle } from '../types'

/**
 * RSI（相对强弱指标）：最近一段上涨幅度占全部波动的百分比。
 * 把每天的涨跌差拆成「涨的一列」与「跌的一列」，各取平均，再算占比：
 *   RSI = 100 × 平均涨幅 ÷（平均涨幅 + 平均跌幅）
 * 它量的是买方力量的持久度——涨的那列越占上风，读数越靠近 100。
 * 平均用 Wilder 平滑：首个值取前 n 个涨跌差的算术平均，此后每根递推
 *   新平均 =（旧平均 ×(n−1) + 当日新值）÷ n
 * 这就是第 11 章 EMA 的近亲：α 从 2/(n+1) 换成 1/n，记忆更长久。
 */

/** RSI 序列：与入参 K 线等长、逐根对齐；头部不足 n 个涨跌差的格子是 null——指标还没成形 */
export type RsiSeries = (number | null)[]

/** Wilder 原版默认窗口 14（A 股软件常见 6/12/24 三线，口径相同、窗口不同） */
export const DEFAULT_RSI = 14

/** 三个比例尺：行情软件画在副图上的水平参考线——刻度，不是开关 */
export const RSI_LEVELS = { overbought: 70, oversold: 30, strong: 80, weak: 20 } as const

/** RSI：分子是平均涨幅、分母是全部波动。两个边界约定如实声明：
 *  平均跌幅为零（窗口内只涨不跌）→ 100；分子分母同零（窗口内纹丝不动）→ 50，
 *  没涨没跌谈不上强弱，读数取不偏不倚的 50，不猜方向。 */
export function rsi(candles: readonly Candle[], n: number = DEFAULT_RSI): RsiSeries {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('rsi：candles 不能为空')
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`rsi：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`rsi：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }
  const out: RsiSeries = new Array(candles.length).fill(null)
  if (candles.length <= n) return out // 攒不出 n 个涨跌差：整条 null，不猜

  // 第一格：前 n 个涨跌差各拆成涨/跌两列，取算术平均——RSI 的种子
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= n; i++) {
    const change = candles[i].close - candles[i - 1].close
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= n
  avgLoss /= n
  out[n] = rsiValue(avgGain, avgLoss)

  // 此后每根：Wilder 递推——旧平均扛 (n−1)/n 的权重，新值只占 1/n，记忆长、反应缓
  for (let i = n + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close
    avgGain = (avgGain * (n - 1) + (change > 0 ? change : 0)) / n
    avgLoss = (avgLoss * (n - 1) + (change < 0 ? -change : 0)) / n
    out[i] = rsiValue(avgGain, avgLoss)
  }
  return out
}

/** 比例尺换算：涨的那列占全部波动的百分比。两列同零记 50（不偏不倚），只涨不跌记 100。
 *  先算比值再乘 100：平均跌幅为零时比值恰为 1，读数钉在 100 一字不差——
 *  「钉死」是本章要断言的行为，不能让浮点误差在末位晃动。 */
function rsiValue(avgGain: number, avgLoss: number): number {
  const total = avgGain + avgLoss
  if (total === 0) return 50
  return 100 * (avgGain / total)
}
