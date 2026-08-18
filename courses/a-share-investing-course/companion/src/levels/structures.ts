import type { Candle } from '../types'
import { pivots, DEFAULT_PIVOT_WINDOW } from './pivots'

/**
 * 反转结构：structures。
 * 第 13 章把拐角做成了枢轴（pivots）、把路口做成了位（levels）；本章用同一副原材料搭大结构：
 * 头肩顶、双顶、双底——枢轴序列里反复出现的「三峰两谷」「两峰一谷」骨架，
 * 外加一条结构成立判据：骨架成形之后、第一次收盘越过颈线。
 * 颈线（neckline——头肩/双顶结构中连接回撤低点的参考线，跌破它结构才算成立）
 * 是大结构的命门：它把「画得像」变成「算得出」——结构有多高、破线后看多深，都从它量起。
 */

/** 结构种类：头肩顶 / 双顶 / 双底（头肩底是头肩顶的镜像，本课程不实现，差异见登记账） */
export type StructureId = 'head-and-shoulders' | 'double-top' | 'double-bottom'

/** 一个反转结构：枢轴下标、颈线、破位日与量度目标，件件可回图核对 */
export type Structure = {
  id: StructureId
  /** 方向：头肩顶与双顶看跌（bear），双底看涨（bull） */
  direction: 'bear' | 'bull'
  /** 构成结构的枢轴下标（时间旧→新）：头肩顶 [左肩,左谷,头,右谷,右肩]，双顶 [峰,谷,峰]，双底 [谷,峰,谷] */
  indices: number[]
  /** 颈线价：头肩顶取两谷枢轴价的均值，双顶/双底取中间谷/峰的枢轴价——简化为水平线 */
  neckline: number
  /** 破位 K 线下标：右肩/第二峰之后第一根收盘越过颈线的 K 线，结构在这天成立（盘中影线不算） */
  breakIndex: number
  /** 量度目标：结构高度（头/顶价到颈线）从颈线向破位方向投影的价位——参考区，不是承诺 */
  target: number
}

export type StructuresOpts = {
  /** 枢轴确认窗（左右各 k 根），默认 3，与 pivots 同款 */
  k?: number
  /** 同水平容差（单位：元）：两肩/两峰/两谷的价差不超过它算同一水平。
   *  默认取全序列平均振幅的一半——与 levels 的聚类容差同款：比一根普通 K 线的身子窄，比噪声抖动宽 */
  tol?: number
}

/** 平均振幅：全序列每根 high−low 的平均，容差的尺（与 levels 同款口径） */
function avgRange(candles: readonly Candle[]): number {
  let sum = 0
  for (const c of candles) sum += c.high - c.low
  return sum / candles.length
}

/** 反转结构检测：先让 pivots 把行情切成峰谷交替的拐角序列，再在拐角序列上找两类反转候选——
 *  「高、低、高、低、高」五连是头肩顶候选（头要高出一截、两肩与两谷各自同水平）；
 *  「高、低、高」/「低、高、低」三连是双顶/双底候选（两端同水平、中间要拉开深度）。
 *  骨架只是候选：还要右肩/第二峰之后有一根 K 线收盘越过颈线，结构才成立——
 *  这与第 10 章趋势线、第 13 章破位的收盘口径一字不差，盘中影线刺破不算数。 */
export function detectStructures(candles: readonly Candle[], opts: StructuresOpts = {}): Structure[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectStructures：candles 不能为空')
  }
  const k = opts.k ?? DEFAULT_PIVOT_WINDOW
  const tol = opts.tol ?? avgRange(candles) / 2
  if (!(tol > 0) || !Number.isFinite(tol)) {
    throw new Error(`detectStructures：tol 必须是正数（同水平容差），收到的是 ${tol}`)
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
      throw new Error(`detectStructures：第 ${i} 根的高低收盘价必须是有限数字，收到的是 ${c.high}/${c.low}/${c.close}`)
    }
  }
  const ps = pivots(candles, k)
  if (ps.length === 0) return [] // 拐角都没有，结构无从谈起：不猜

  /** 破线扫描：from 起第一根收盘越过 neckline 的 K 线（向下 <，向上 >）；找不到返回 -1 */
  const breakAfter = (from: number, neckline: number, up: boolean): number => {
    for (let i = from; i < candles.length; i++) {
      if (up ? candles[i].close > neckline : candles[i].close < neckline) return i
    }
    return -1
  }

  const out: Structure[] = []

  // 双顶 / 双底：连续三个枢轴两端同侧（pivots 峰谷交替，三连必是 X、Y、X）
  for (let w = 0; w + 3 <= ps.length; w++) {
    const [a, mid, b] = [ps[w], ps[w + 1], ps[w + 2]]
    if (Math.abs(a.price - b.price) > tol) continue // 两端不同水平：LH/HL 是台阶，不是双顶/双底
    if (a.side === 'high') {
      // 双顶：中间谷要拉开深度——浅折返只是同一波上涨里的歇脚
      if (Math.min(a.price, b.price) - mid.price < tol) continue
      const neckline = mid.price
      const breakIndex = breakAfter(b.index + 1, neckline, false)
      if (breakIndex < 0) continue
      const top = (a.price + b.price) / 2
      out.push({
        id: 'double-top',
        direction: 'bear',
        indices: [a.index, mid.index, b.index],
        neckline,
        breakIndex,
        target: 2 * neckline - top,
      })
    } else {
      // 双底：中间峰要拉开高度
      if (mid.price - Math.max(a.price, b.price) < tol) continue
      const neckline = mid.price
      const breakIndex = breakAfter(b.index + 1, neckline, true)
      if (breakIndex < 0) continue
      const bottom = (a.price + b.price) / 2
      out.push({
        id: 'double-bottom',
        direction: 'bull',
        indices: [a.index, mid.index, b.index],
        neckline,
        breakIndex,
        target: 2 * neckline - bottom,
      })
    }
  }

  // 头肩顶：连续五个枢轴「高、低、高、低、高」，头居中
  for (let w = 0; w + 5 <= ps.length; w++) {
    const [ls, a, head, b, rs] = [ps[w], ps[w + 1], ps[w + 2], ps[w + 3], ps[w + 4]]
    if (ls.side !== 'high') continue
    if (Math.abs(ls.price - rs.price) > tol) continue // 两肩不同水平：三峰错落是别的形状
    if (head.price < Math.max(ls.price, rs.price) + tol) continue // 头没高出一截：贴着肩的峰是平台
    if (Math.abs(a.price - b.price) > tol) continue // 两谷不同水平：水平颈线（简化）的前提
    const neckline = (a.price + b.price) / 2
    if (Math.min(ls.price, rs.price) - neckline < tol) continue // 肩与颈线要拉开：贴着肩的谷构不成头肩
    const breakIndex = breakAfter(rs.index + 1, neckline, false)
    if (breakIndex < 0) continue
    out.push({
      id: 'head-and-shoulders',
      direction: 'bear',
      indices: [ls.index, a.index, head.index, b.index, rs.index],
      neckline,
      breakIndex,
      target: 2 * neckline - head.price,
    })
  }

  // 按结构起点从旧到新返回
  return out.sort((m, n) => m.indices[0] - n.indices[0] || m.breakIndex - n.breakIndex)
}
