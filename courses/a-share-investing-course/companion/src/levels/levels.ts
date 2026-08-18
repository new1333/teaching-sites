import type { Candle } from '../types'
import { pivots, DEFAULT_PIVOT_WINDOW, type Pivot } from './pivots'

/**
 * 支撑阻力位：levels。
 * 枢轴只是拐角，位是拐角的聚类：同一价位附近被反复触碰的枢轴并成一群，
 * 群的平均价是位价，群的大小是触碰次数——「人多的路口」从此有了可数的定义。
 * 手画支撑位之所以破了又立，是因为「同一个价位」全凭眼睛裁量；
 * 聚类把裁量写成判据：价位从低到高排，相邻差不超过容差就并成一群。
 */

/** 位的角色：位在最新收盘价上方是阻力（涨到有人抛），下方是支撑（跌到有人接） */
export type LevelKind = 'support' | 'resistance'

/** 一个支撑/阻力位 */
export type Level = {
  /** 位价：簇内枢轴价位的算术平均 */
  price: number
  /** 触碰次数：聚进这个位的枢轴个数——路口被路过几次 */
  touches: number
  /** 与最新收盘价比出的角色：位本身不变，角色随价格站边换（支撑阻力互换的机制落点） */
  kind: LevelKind
  /** 触碰发生的 K 线下标（时间旧→新），逐个可回图核对 */
  indices: number[]
}

export type LevelsOpts = {
  /** 枢轴确认窗（左右各 k 根），默认 3，与 pivots 同款 */
  k?: number
  /** 聚类容差（单位：元）：相邻枢轴价位差不超过它就并成同一位。
   *  默认取全序列平均振幅的一半——比一根普通 K 线的身子窄，比噪声抖动宽 */
  tol?: number
}

/** 平均振幅：全序列每根 high−low 的平均，容差的尺 */
function avgRange(candles: readonly Candle[]): number {
  let sum = 0
  for (const c of candles) sum += c.high - c.low
  return sum / candles.length
}

/** 支撑阻力位：先把行情交给 pivots 找拐角，再把拐角价位聚类成位，按价格从高到低返回。
 *  一个位就是一个「被反复证明的价位」：触碰次数越多，挂单与记忆在这个路口堆得越厚。 */
export function levels(candles: readonly Candle[], opts: LevelsOpts = {}): Level[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('levels：candles 不能为空')
  }
  const k = opts.k ?? DEFAULT_PIVOT_WINDOW
  const tol = opts.tol ?? avgRange(candles) / 2
  if (!(tol > 0) || !Number.isFinite(tol)) {
    throw new Error(`levels：tol 必须是正数（聚类容差），收到的是 ${tol}`)
  }
  const lastClose = candles[candles.length - 1].close
  if (!Number.isFinite(lastClose)) {
    throw new Error(`levels：最后一根的收盘价必须是有限数字（位的角色由它比出），收到的是 ${lastClose}`)
  }
  const ps = pivots(candles, k)
  if (ps.length === 0) return [] // 凑不出枢轴就凑不出位：不猜
  // 聚类：价位升序排，相邻差 ≤ tol 并成一群（顺序聚类，一群可略宽于 tol——拥挤本身就说明这是个宽路口）
  const sorted = [...ps].sort((a, b) => a.price - b.price)
  const clusters: Pivot[][] = []
  for (const p of sorted) {
    const cur = clusters[clusters.length - 1]
    if (cur && p.price - cur[cur.length - 1].price <= tol) cur.push(p)
    else clusters.push([p])
  }
  return clusters
    .map((cluster): Level => {
      const price = cluster.reduce((s, p) => s + p.price, 0) / cluster.length
      return {
        price,
        touches: cluster.length,
        kind: price > lastClose ? 'resistance' : 'support',
        indices: [...cluster].sort((a, b) => a.index - b.index).map((p) => p.index),
      }
    })
    .sort((a, b) => b.price - a.price)
}
