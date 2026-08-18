import type { Candle } from '../types'

/**
 * 筹码分布：chipDistribution（换手衰减模型）。
 * 第 13 章的位回答「价格到哪里会堵」，本章回答「路口为什么这么堵」——
 * 每个价位上还压着多少持仓量。行情软件里的山峰图就是这张地图的等高线。
 * 模型只有两条规则：
 * 1. 历史筹码按当日换手率等比例衰减——今天换了 30% 的手，每个价位的旧持仓都乘上 70%；
 * 2. 当日成交量均匀分摊到当日价格区间——当天在哪一段成交，新的筹码就落在哪一段。
 * 简化假设（正文与差异清单已声明）：均匀分摊、等比例衰减、首日全流通盘落位首日区间。
 */

/** 一个价位桶：price 是桶中心价（binWidth 的整数倍），quantity 是压在这里的持仓量（股） */
export type ChipBucket = {
  price: number
  quantity: number
}

/** 一天的筹码快照：分布轮廓加上由它读出的全部读数 */
export type ChipDay = {
  /** 日期标签（与当根 K 线一致） */
  date: string
  /** 当日收盘价——获利/套牢的分界线 */
  close: number
  /** 价位-持仓量分布，按价位升序，只含非零桶 */
  buckets: ChipBucket[]
  /** 获利盘比例：成本不高于收盘价的持仓占比（恰好等于现价的算获利） */
  winnerRatio: number
  /** 套牢盘比例：成本高于收盘价的持仓占比，与获利盘互补 */
  trappedRatio: number
  /** 平均成本：全部分布的持仓量加权平均价 */
  averageCost: number
  /** 筹码峰：持仓量最大的桶——拥挤的历史成本区；并列时取更低价位 */
  peak: ChipBucket
}

export type ChipDistributionOpts = {
  /** 流通股本（股），分布总量的分母与首日落位的基数，默认 1 亿股 */
  floatShares?: number
  /** 价位桶宽（元），默认 0.1——分布图的横向分辨率 */
  binWidth?: number
}

const DEFAULT_OPTS = { floatShares: 100_000_000, binWidth: 0.1 }

/** 入参体检：空序列、非法参数、非法价格或成交量，当场抛中文错误 */
function assertChipArgs(candles: readonly Candle[], floatShares: number, binWidth: number): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('chipDistribution：candles 不能为空')
  }
  if (!(floatShares > 0) || !Number.isFinite(floatShares)) {
    throw new Error(`chipDistribution：floatShares 必须是正数（流通股本），收到的是 ${floatShares}`)
  }
  if (!(binWidth > 0) || !Number.isFinite(binWidth)) {
    throw new Error(`chipDistribution：binWidth 必须是正数（价位桶宽），收到的是 ${binWidth}`)
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
      throw new Error(`chipDistribution：第 ${i} 根的价格必须是有限数字，收到的是 ${c.high}/${c.low}/${c.close}`)
    }
    if (c.high < c.low) {
      throw new Error(`chipDistribution：第 ${i} 根的高价不能低于低价，收到的是 ${c.high} < ${c.low}`)
    }
    if (!(c.low > 0)) {
      throw new Error(`chipDistribution：第 ${i} 根的最低价必须是正数，收到的是 ${c.low}`)
    }
    if (!Number.isFinite(c.volume) || c.volume < 0) {
      throw new Error(`chipDistribution：第 ${i} 根的成交量必须是不小于 0 的有限数字，收到的是 ${c.volume}`)
    }
  }
}

/** 把 amount 股均匀铺进 [low, high] 覆盖的各价位桶，按重叠长度分摊；一字价全部落进一个桶 */
function spreadInto(chips: Map<number, number>, low: number, high: number, amount: number, binWidth: number): void {
  if (amount <= 0) return
  if (high === low) {
    const price = Math.round(low / binWidth) * binWidth
    chips.set(price, (chips.get(price) ?? 0) + amount)
    return
  }
  const span = high - low
  const half = binWidth / 2
  const kLo = Math.round(low / binWidth)
  const kHi = Math.round(high / binWidth)
  for (let k = kLo; k <= kHi; k++) {
    const price = k * binWidth
    const overlap = Math.min(price + half, high) - Math.max(price - half, low)
    if (overlap > 0) chips.set(price, (chips.get(price) ?? 0) + (amount * overlap) / span)
  }
}

/** 筹码分布：逐根 K 线推进换手衰减模型，返回每天的分布快照（时间旧→新）。
 *  - 首日是初始化假设：全部流通盘均匀落位首日价格区间（更早的历史无从得知，只能从第一天开始记账）；
 *  - 此后每天：换手率 t = 成交量 ÷ 流通股本（封顶 100%——T+1 之下单日不会有更多筹码换手，
 *    封顶只防合成数据越界），旧分布全体乘 (1−t)，当日成交量按 t 对应的股数均匀铺进当日区间；
 *  - 任何一天持仓量总和恒等于流通股本：筹码换的是主人，不是数量；
 *  - 获利盘/套牢盘以收盘价分界（恰等于现价算获利），平均成本与筹码峰由分布直接读出。 */
export function chipDistribution(candles: readonly Candle[], opts: ChipDistributionOpts = {}): ChipDay[] {
  const floatShares = opts.floatShares ?? DEFAULT_OPTS.floatShares
  const binWidth = opts.binWidth ?? DEFAULT_OPTS.binWidth
  assertChipArgs(candles, floatShares, binWidth)
  const chips = new Map<number, number>()
  const eps = binWidth * 1e-9 // 浮点噪声容差：桶中心 12.000000000000002 与收盘 12 视为同价
  const days: ChipDay[] = []
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (i === 0) {
      spreadInto(chips, c.low, c.high, floatShares, binWidth)
    } else {
      const t = Math.min(c.volume / floatShares, 1)
      if (t > 0) {
        for (const [price, q] of chips) chips.set(price, q * (1 - t))
        spreadInto(chips, c.low, c.high, t * floatShares, binWidth)
      }
    }
    // 当日快照：从分布读出全部读数
    const buckets = [...chips.entries()]
      .map(([price, quantity]) => ({ price, quantity }))
      .filter((b) => b.quantity > 1e-9)
      .sort((a, b) => a.price - b.price)
    const total = buckets.reduce((s, b) => s + b.quantity, 0)
    if (total <= 0) {
      // 首日零成交且无历史：没有筹码就没有读数，获利盘记 0、平均成本无定义
      days.push({ date: c.date, close: c.close, buckets, winnerRatio: 0, trappedRatio: 0, averageCost: NaN, peak: { price: Math.round(c.close / binWidth) * binWidth, quantity: 0 } })
      continue
    }
    let winner = 0
    let costSum = 0
    let peak = buckets[0]!
    for (const b of buckets) {
      if (b.price <= c.close + eps) winner += b.quantity
      costSum += b.price * b.quantity
      if (b.quantity > peak.quantity) peak = b
    }
    days.push({
      date: c.date,
      close: c.close,
      buckets,
      winnerRatio: winner / total,
      trappedRatio: 1 - winner / total,
      averageCost: costSum / total,
      peak: { price: peak.price, quantity: peak.quantity },
    })
  }
  return days
}
