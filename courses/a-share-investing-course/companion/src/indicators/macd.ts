import type { Candle } from '../types'
import { ema } from './ma'
import { pivots, DEFAULT_PIVOT_WINDOW } from '../levels/pivots'

/**
 * MACD：两条均线的差值能告诉你什么。
 * 第 11 章的均线把趋势画成线，本章把「推着价格走的那股劲」画成数，一共三层：
 * DIF = 快慢两条 EMA 的差——价格跑得越急，快线甩开慢线越远；
 * DEA = 对 DIF 再作一次 EMA——给动量自己立一条均线，当「正常速度」的参照；
 * 柱 = DIF − DEA——动量超出自身常态多少，正负号就是快慢线在张开还是收拢。
 * 默认参数 12/26/9 是作者 Appel 按上世纪美股日线节拍试出来的经验值，后来成了全行业默认。
 */

/** 与 K 线等长的 MACD 线：头部未成形处是 null（与第 11 章 MaSeries 同语义） */
export type MacdLine = (number | null)[]

/** MACD 全链路：DIF/DEA/柱三条序列逐根对齐 */
export type MacdSeries = {
  dif: MacdLine
  dea: MacdLine
  hist: MacdLine
}

/** 背离方向：top=顶背离（价格新高而 DIF 不认），bottom=底背离（镜像） */
export type DivergenceKind = 'top' | 'bottom'

/** 一处背离：两个同侧枢轴的读数全部带上，图上可回核 */
export type Divergence = {
  kind: DivergenceKind
  /** 背离成立的 K 线下标——第二个峰（谷）那一根；枢轴判据要等右侧 k 根凑满才确认 */
  index: number
  /** 参与比较的前一个同侧枢轴（峰对峰、谷对谷）下标 */
  prevIndex: number
  /** 两处枢轴价：峰取高点、谷取低点 */
  price: number
  prevPrice: number
  /** 两处 DIF 读数——背离的证据本身 */
  dif: number
  prevDif: number
}

export type MacdOpts = {
  fast?: number
  slow?: number
  signal?: number
}

export type DivergenceOpts = {
  /** 枢轴确认窗（左右各 k 根），复用第 13 章 pivots 的口径 */
  k?: number
}

/** 默认参数：快 EMA=12、慢 EMA=26、DEA=9 */
export const DEFAULT_MACD = { fast: 12, slow: 26, signal: 9 } as const

/** MACD 全链路：先复用第 11 章的 ema 算快慢两条线，差出 DIF；再把 DIF 当作
 *  一条「收盘价序列」喂给同一个 ema 得到 DEA；柱 = DIF − DEA。
 *  三条序列都与入参 K 线等长：DIF 自慢线成形那根起有值（默认第 26 根），
 *  DEA 与柱还要等 DIF 攒够 signal 个值（默认第 34 根），之前的格子是 null，不猜。 */
export function macd(candles: readonly Candle[], opts: MacdOpts = {}): MacdSeries {
  const fast = opts.fast ?? DEFAULT_MACD.fast
  const slow = opts.slow ?? DEFAULT_MACD.slow
  const signal = opts.signal ?? DEFAULT_MACD.signal
  for (const [name, n] of [
    ['fast', fast],
    ['slow', slow],
    ['signal', signal],
  ] as const) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`macd：${name} 窗口必须是正整数，收到的是 ${n}`)
    }
  }
  if (fast >= slow) {
    throw new Error(`macd：fast 窗口必须短于 slow（收到 fast=${fast}、slow=${slow}）——快慢差比的是谁窗口短`)
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('macd：candles 不能为空')
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`macd：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }

  // 第一层：快慢两条 EMA 直接复用第 11 章——首窗 SMA 种子、α=2/(n+1) 递推，一字不改
  const fastE = ema(candles, fast)
  const slowE = ema(candles, slow)
  const dif: MacdLine = candles.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i]! - slowE[i]! : null,
  )

  // 第二层：DEA 是对 DIF 的成形段再作一次 EMA——把每个 DIF 当作那根的「收盘价」，
  // 喂给与第一层同一个 ema。动量自己也被平均一遍，得到动量的均线
  const first = dif.findIndex((v) => v != null)
  const dea: MacdLine = new Array<number | null>(candles.length).fill(null)
  if (first >= 0 && candles.length - first >= signal) {
    const segCandles: Candle[] = dif.slice(first).map((v, i) => ({
      date: candles[first + i]!.date,
      open: v!,
      high: v!,
      low: v!,
      close: v!, // ema 只看 close：把 DIF 伪装成一条只有收盘价的行情
      volume: 0,
    }))
    const segEma = ema(segCandles, signal)
    for (let i = 0; i < segEma.length; i++) dea[first + i] = segEma[i]
  }

  // 第三层：柱 = DIF − DEA。正号 = DIF 站上自己的均线（动量还在加速），负号 = 被追近（在减速）
  const hist: MacdLine = dif.map((d, i) => (d != null && dea[i] != null ? d - dea[i]! : null))
  return { dif, dea, hist }
}

/** 背离检测：峰对峰（谷对谷）比两个数——价格创新高/新低，DIF 拒绝跟随，记一笔背离。
 *  拐角复用第 13 章的 pivots（默认左右各 3 根的严格局部极值）；pivots 峰谷交替，
 *  所以隔一个就是同侧前驱。DIF 尚未成形的峰对直接跳过：不比，不猜。 */
export function detectDivergence(
  candles: readonly Candle[],
  indicator: MacdSeries,
  opts: DivergenceOpts = {},
): Divergence[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectDivergence：candles 不能为空')
  }
  if (indicator.dif.length !== candles.length) {
    throw new Error(
      `detectDivergence：indicator.dif 长度 ${indicator.dif.length} 与 K 线根数 ${candles.length} 不一致——两条序列必须逐根对齐`,
    )
  }
  const ps = pivots(candles, opts.k ?? DEFAULT_PIVOT_WINDOW)
  const out: Divergence[] = []
  for (let w = 2; w < ps.length; w++) {
    const cur = ps[w]
    const prev = ps[w - 2] // 峰谷交替，隔一个必是同侧
    const dNow = indicator.dif[cur.index]
    const dPrev = indicator.dif[prev.index]
    if (dNow == null || dPrev == null) continue
    if (cur.side === 'high') {
      // 顶背离：价格更高的高点，DIF 却更低——推力没跟上价格
      if (cur.price > prev.price && dNow < dPrev) {
        out.push({ kind: 'top', index: cur.index, prevIndex: prev.index, price: cur.price, prevPrice: prev.price, dif: dNow, prevDif: dPrev })
      }
    } else if (cur.price < prev.price && dNow > dPrev) {
      // 底背离：价格更低的低点，DIF 的坑却更浅——下砸的劲在衰减
      out.push({ kind: 'bottom', index: cur.index, prevIndex: prev.index, price: cur.price, prevPrice: prev.price, dif: dNow, prevDif: dPrev })
    }
  }
  return out
}
