/**
 * 期望值：把「这套策略长期每注平均赚多少」压成一个数。
 * 第 9 章的胜率只数次数——六成胜率照样可能亏钱；期望值把幅度乘进来：
 * 期望值 = 胜率 × 平均盈利 − 败率 × 平均亏损。正数才值得上桌，负数再高的胜率都是漏水的桶。
 */

/** 一套策略的三个血参数（全部比例口径，不带单位「元」） */
export type EdgeStats = {
  /** 胜率：盈利交易占全部交易的比例，[0,1] */
  winRate: number
  /** 平均盈利：每次盈利交易平均赚到下注额的多少（0.04 = 一赢赚下注额的 4%） */
  avgWin: number
  /** 平均亏损：每次亏损交易平均亏掉下注额的多少（0.12 = 一输亏下注额的 12%），记正数 */
  avgLoss: number
}

/** 三参数的结构校验：胜率在 [0,1]、平均盈利与平均亏损是正的有限数——本章三个函数共用一道门 */
export function assertEdgeStats(stats: EdgeStats, label: string): void {
  if (typeof stats !== 'object' || stats === null) {
    throw new Error(`${label}：stats 必须是对象，收到的是 ${String(stats)}`)
  }
  if (!Number.isFinite(stats.winRate) || stats.winRate < 0 || stats.winRate > 1) {
    throw new Error(`${label}：winRate 必须在 [0,1] 内，收到的是 ${stats.winRate}`)
  }
  if (!Number.isFinite(stats.avgWin) || stats.avgWin <= 0) {
    throw new Error(`${label}：avgWin 必须是正数（赚多大幅度），收到的是 ${stats.avgWin}`)
  }
  if (!Number.isFinite(stats.avgLoss) || stats.avgLoss <= 0) {
    throw new Error(`${label}：avgLoss 必须是正数（亏多大幅度，记正数），收到的是 ${stats.avgLoss}`)
  }
}

/** 期望值 = 胜率 × 平均盈利 − 败率 × 平均亏损：长期平均每一注的盈亏（以下注额为 1 的比例）。
 *  读法：+0.025 是每注平均赚下注额的 2.5%；−0.024 是每注平均亏 2.4%——负数不是「做得差」，
 *  是「做多少次都是亏」，注码和心态都救不了它，只有换策略。 */
export function expectancy(stats: EdgeStats): number {
  assertEdgeStats(stats, 'expectancy')
  const q = 1 - stats.winRate
  return stats.winRate * stats.avgWin - q * stats.avgLoss
}
