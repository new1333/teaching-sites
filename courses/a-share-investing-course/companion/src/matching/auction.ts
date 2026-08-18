/**
 * 集合竞价撮合：第 2 章的开盘价怎么「投」出来。
 * 集合竞价（call auction）——开盘前只收单不成交，9:25 一刻把攒下的全部申报
 * 按同一个价格一次性撮合。算式与正文演算一字不差：候选价取全部申报价，
 * 每个价格上「出价不低于它的买单合计」与「要价不高于它的卖单合计」取小，
 * 即该价可成交量；可成交量最大的候选价当选开盘价——
 * 开盘价不是第一笔成交，是全市场按最大成交量投出来的一个数。
 */

/** 一张申报：price 报价（元），shares 申报股数 */
export type AuctionOrder = {
  price: number
  shares: number
}

/** 一个候选价上的撮合读数：两侧意愿与可成交量 */
export type AuctionLevel = {
  price: number
  /** 愿买股数：出价不低于候选价的买单合计 */
  buyShares: number
  /** 愿卖股数：要价不高于候选价的卖单合计 */
  sellShares: number
  /** 可成交量：两侧取小 */
  volume: number
}

export type AuctionResult = {
  /** 全部候选价，按报价从高到低排列（正文表格的行序） */
  levels: AuctionLevel[]
  /** 开盘价：可成交量最大的候选价 */
  openingPrice: number
  /** 开盘价上的可成交量 */
  openingVolume: number
}

/** 入参体检：空申报、非正报价、非正整数股数，当场抛中文错误 */
function assertOrders(orders: readonly AuctionOrder[], label: string): void {
  if (!Array.isArray(orders) || orders.length === 0) {
    throw new Error(`${label}：申报列表不能为空`)
  }
  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    if (!Number.isFinite(o.price) || o.price <= 0) {
      throw new Error(`${label}：第 ${i + 1} 张申报的报价必须是正数，收到的是 ${o.price}`)
    }
    if (!Number.isInteger(o.shares) || o.shares <= 0) {
      throw new Error(`${label}：第 ${i + 1} 张申报的股数必须是正整数，收到的是 ${o.shares}`)
    }
  }
}

/** 集合竞价：逐候选价算可成交量，最大者当选开盘价。
 *  并列最大时的细则（先取未成交量更小的价格、再并列沪深分叉）正文声明「本例用不上」——
 *  这里同样不猜：出现并列时如实抛错，把口径问题交回调用方。 */
export function callAuction(buys: readonly AuctionOrder[], sells: readonly AuctionOrder[]): AuctionResult {
  assertOrders(buys, 'callAuction：buys')
  assertOrders(sells, 'callAuction：sells')
  const prices = [...new Set([...buys, ...sells].map((o) => o.price))].sort((a, b) => b - a)
  const levels: AuctionLevel[] = prices.map((price) => {
    const buyShares = buys.filter((o) => o.price >= price).reduce((s, o) => s + o.shares, 0)
    const sellShares = sells.filter((o) => o.price <= price).reduce((s, o) => s + o.shares, 0)
    return { price, buyShares, sellShares, volume: Math.min(buyShares, sellShares) }
  })
  const best = Math.max(...levels.map((l) => l.volume))
  const winners = levels.filter((l) => l.volume === best)
  if (winners.length > 1) {
    throw new Error(
      `callAuction：可成交量 ${best} 股在 ${winners.map((w) => w.price).join('/')} 元并列最大——并列细则（未成交量更小者优先、再并列沪深分叉）不在本函数实现范围，调用方需给定口径`,
    )
  }
  const winner = winners[0]!
  return { levels, openingPrice: winner.price, openingVolume: winner.volume }
}
