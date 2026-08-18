import type { Candle } from '../types'
import { candleAnatomy } from '../candles/anatomy'
import { trendContext, type TrendContext, type TrendOpts } from './context'

/**
 * 十字星家族识别：普通十字、长腿十字、蜻蜓线、墓碑线、一字线、纺锤线。
 * 家族地盘 = 实体占振幅 ≤5%——与第 5 章影线族（实体 >5%）互补，不重叠、不留缝。
 * 家族内部不再随位置换名（蜻蜓就是蜻蜓，不分上涨后下跌后），位置只影响解读：
 * 犹豫本身没有方向，方向要等次日的新证据——这是「次日确认」的全部来由。
 */

export type DojiKind =
  | 'four-price' // 一字线：四价合一
  | 'spinning-top' // 纺锤线：整根振幅缩水，市场打盹
  | 'doji' // 普通十字：开收打平，两条腿均分
  | 'long-legged' // 长腿十字：振幅追过近期日常，两边各被推翻一次
  | 'dragonfly' // 蜻蜓线：开收贴着最高点，全天砸下去又被全额买回
  | 'gravestone' // 墓碑线：开收贴着最低点，冲高的买盘全军覆没

/** 犹豫程度：dozing 打盹 < tied 打平 < torn 撕裂；locked 不在刻度上——一字线是锁死，不是犹豫 */
export type Hesitation = 'locked' | 'dozing' | 'tied' | 'torn'

/** 犹豫程度的数值刻度（教学承诺：数字可比较，locked 恒为 0 表示刻度之外） */
export const HESITATION_LEVEL: Record<Hesitation, number> = { locked: 0, dozing: 1, tied: 2, torn: 3 }

/** 一字线的涨跌停语境：贴着涨停 / 贴着跌停 / 都不贴（四价合一未必是涨跌停） */
export type LimitVerdict = 'limit-up' | 'limit-down' | 'none'

export type DojiResult = {
  kind: DojiKind
  hesitation: Hesitation
  /** 仅一字线给出：用昨收与涨跌幅边界核对，不靠猜 */
  limit?: LimitVerdict
}

/** 家族边界：实体占振幅不超过该比例归十字星家族（第 5 章影线族取 >5%，两章互补） */
const DOJI_BODY_RATIO = 0.05
/** 蜻蜓/墓碑「贴边」的容差：贴边一侧的影线占振幅不超过该比例 */
const EDGE_WICK_RATIO = 0.05
/** 蜻蜓/墓碑的主导影线占振幅下限：另一侧的腿至少撑起八成战场 */
const LEG_WICK_RATIO = 0.8
/** 长腿十字的两条腿各占振幅下限：缺一条腿的只是单向试探 */
const LONG_LEG_SHARE = 0.3
/** 长腿十字的振幅相对参照尺的倍数下限：追平不算长，要明显长过日常 */
const LONG_RANGE_MULT = 1.2
/** 纺锤线的振幅相对参照尺的倍数上限：缩到日常一半以下才算打盹 */
const SHRINK_RANGE_MULT = 0.5

const POSITIONS: readonly TrendContext['position'][] = ['falling', 'rising', 'flat']

/** 十字族背景：在第 5 章趋势背景之上加两把尺——参照振幅与昨收 */
export type DojiContext = TrendContext & {
  /** 形态之前 lookback 根的平均振幅（元）：「长腿」与「打盹」的比较基准 */
  avgRange: number
  /** 前一根 K 线的收盘价：一字线核对涨跌停语境用 */
  prevClose: number
  /** 涨跌幅边界（比例）：教学默认取主板 10% 口径，规则会修订、板块各有不同，一律作为参数传入 */
  limitRatio: number
}

export type DojiContextOpts = TrendOpts & {
  /** 涨跌幅边界，默认 0.1（截至写作时的主板口径；创业板/科创板/北交所请显式传入） */
  limitRatio?: number
}

/** 从行情序列量出十字族背景：位置复用第 5 章的 trendContext，同一窗口再算平均振幅 */
export function dojiContext(candles: readonly Candle[], index: number, opts: DojiContextOpts = {}): DojiContext {
  const lookback = opts.lookback ?? 5
  const limitRatio = opts.limitRatio ?? 0.1
  if (!Number.isFinite(limitRatio) || !(limitRatio > 0) || !(limitRatio < 1)) {
    throw new Error(`dojiContext：limitRatio 必须是 0 与 1 之间的比例（主板 0.1、创业板 0.2），收到的是 ${limitRatio}`)
  }
  const base = trendContext(candles, index, { lookback, threshold: opts.threshold }) // 窗口与守门全部复用第 5 章
  let sum = 0
  for (let i = index - lookback; i < index; i++) sum += candles[i].high - candles[i].low
  const prevClose = candles[index - 1].close
  if (!Number.isFinite(prevClose) || !(prevClose > 0)) {
    throw new Error(`dojiContext：前一根K线的收盘价必须是正的有限数字，收到的是 ${prevClose}`)
  }
  return { ...base, avgRange: sum / lookback, prevClose, limitRatio }
}

/** 交易所口径的边界价：昨收 ×（1±涨跌幅），四舍五入到分 */
const limitPrice = (prevClose: number, ratio: number, sign: 1 | -1): number =>
  Math.round(prevClose * (1 + sign * ratio) * 100) / 100

/** 一字线的涨跌停核对：四价合一的那个价格是否恰好贴在边界价上 */
function verdictAtLimit(price: number, prevClose: number, ratio: number): LimitVerdict {
  if (price === limitPrice(prevClose, ratio, 1)) return 'limit-up'
  if (price === limitPrice(prevClose, ratio, -1)) return 'limit-down'
  return 'none'
}

/**
 * 十字星家族分类：不属于本家族（实体占比 >5%）返回 null，交回调用方找别的家族。
 * 判定次序即教学次序：先认四价合一，再认贴边形状（蜻蜓/墓碑），再量大小（长腿/纺锤），
 * 最后剩下的才是普通十字——形状优先于大小，大小必须参照近邻。
 */
export function classifyDoji(c: Candle, context: DojiContext): DojiResult | null {
  if (!context || !POSITIONS.includes(context.position)) {
    throw new Error(`classifyDoji：context.position 必须是 falling/rising/flat 之一，收到的是 ${context?.position}`)
  }
  if (!Number.isFinite(context.avgRange) || context.avgRange < 0) {
    throw new Error(`classifyDoji：avgRange（参照振幅）必须是不为负的有限数字，收到的是 ${context.avgRange}`)
  }
  if (!Number.isFinite(context.limitRatio) || !(context.limitRatio > 0) || !(context.limitRatio < 1)) {
    throw new Error(`classifyDoji：limitRatio 必须是 0 与 1 之间的比例，收到的是 ${context.limitRatio}`)
  }
  const a = candleAnatomy(c) // 四价守门与实体/影线读数复用第 3 章的解剖器

  // —— 一字线：四价合一，振幅为零。它不是犹豫的极致，是犹豫刻度的出局者——
  // 全天只在一个价位成交，多空根本没交上手；最常见的成因是一字涨停/跌停（排队锁死），
  // 但是否贴着边界要用昨收核对，代码不假设。
  if (a.range === 0) {
    return {
      kind: 'four-price',
      hesitation: 'locked',
      limit: verdictAtLimit(c.close, context.prevClose, context.limitRatio),
    }
  }
  if (a.bodyRatio > DOJI_BODY_RATIO) return null // 有身子的K线归第 5 章影线族

  // —— 贴边的两个形状：开收贴着当天的一端，另一端的影线撑起八成以上战场 ——
  if (a.upperWickRatio <= EDGE_WICK_RATIO && a.lowerWickRatio >= LEG_WICK_RATIO) {
    return { kind: 'dragonfly', hesitation: 'tied' }
  }
  if (a.lowerWickRatio <= EDGE_WICK_RATIO && a.upperWickRatio >= LEG_WICK_RATIO) {
    return { kind: 'gravestone', hesitation: 'tied' }
  }

  // —— 大小两档：与之前五根的平均振幅比。同一形状，参照尺换，名字换 ——
  if (a.range >= LONG_RANGE_MULT * context.avgRange && a.upperWickRatio >= LONG_LEG_SHARE && a.lowerWickRatio >= LONG_LEG_SHARE) {
    return { kind: 'long-legged', hesitation: 'torn' }
  }
  if (a.range <= SHRINK_RANGE_MULT * context.avgRange) {
    return { kind: 'spinning-top', hesitation: 'dozing' }
  }
  return { kind: 'doji', hesitation: 'tied' }
}
