import { assertEdgeStats, type EdgeStats } from './expectancy'

/**
 * 凯利公式：有优势时，每一注该押多少。
 * f* = 胜率 − 败率 ÷ 盈亏比——让长期资金增长最快的下注比例（1956 年贝尔实验室 Kelly
 * 从信息论推出来的答案）。口径注意：这里的 f 是「一注愿意亏掉的资金比例」（风险口径，
 * 赌桌上一注输光就是输 f）；换算成 A 股的仓位要再除以止损幅度——仓位 = 风险 ÷ 止损距离。
 * 实战只取它的分数（半凯利、四分之一凯利）：参数是估计值，且满凯利的路上回撤很深。
 */

/** 凯利分数：最优下注比例（风险口径）。负数 = 负期望，数学在说「这局别坐上桌」，读数取 0。 */
export function kellyFraction(stats: EdgeStats): number {
  assertEdgeStats(stats, 'kellyFraction')
  const q = 1 - stats.winRate
  const payoff = stats.avgWin / stats.avgLoss // 盈亏比：平均盈利 ÷ 平均亏损
  return stats.winRate - q / payoff
}
