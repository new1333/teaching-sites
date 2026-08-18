/**
 * 绩效指标：把一段资金曲线、一列交易盈亏压成人话读数。
 * 第 9 章的胜率、第 20 章的盈亏比在这里重逢——那时它们是口头报的参数，
 * 现在它们从回测的交易列表里现场数出来。总收益只看两头，最大回撤看路上最深的一次下坡。
 */

function assertCurve(equity: readonly number[], label: string): void {
  if (!Array.isArray(equity) || equity.length === 0) {
    throw new Error(`${label}：equity 不能为空`)
  }
  for (let i = 0; i < equity.length; i++) {
    if (!Number.isFinite(equity[i])) {
      throw new Error(`${label}：第 ${i} 个资金值必须是有限数字，收到的是 ${equity[i]}`)
    }
  }
}

/** 最大回撤（max drawdown）——资金曲线从已到过的山顶到其后最深谷底的最大跌幅，记正数比例。
 *  总收益只回答「终点在哪」，回撤回答「路上最深摔过多少」：+40% 的曲线若中途腰斩过，
 *  多数人早在谷底离场了——两个读数必须同场读。 */
export function maxDrawdown(equity: readonly number[]): number {
  assertCurve(equity, 'maxDrawdown')
  let peak = equity[0]
  let worst = 0
  for (const v of equity) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = 1 - v / peak // 相对「到此为止最高点」的下坡幅度
      if (dd > worst) worst = dd
    }
  }
  return worst
}

/** 总收益 = 期末资金 ÷ 期初资金 − 1：整场彩排赚了或亏了几成。
 *  期初必须大于 0——资金不是从零起步的。 */
export function totalReturn(equity: readonly number[]): number {
  assertCurve(equity, 'totalReturn')
  const first = equity[0]
  if (!(first > 0)) {
    throw new Error(`totalReturn：期初资金必须是正数，收到的是 ${first}`)
  }
  return equity[equity.length - 1] / first - 1
}

/** 一列交易盈亏（元）压成的四件读数；无交易时 winRate 记 0、盈亏比记 null */
export type TradeStats = {
  /** 已平仓交易笔数 */
  count: number
  /** 盈利笔数（盈亏 > 0 才算赢；平手算输——与第 9 章统计口径一致） */
  wins: number
  /** 胜率：盈利笔数 ÷ 总笔数；无交易记 0 */
  winRate: number
  /** 平均盈利（元）：盈利交易的平均每笔赚多少；无盈利交易记 0 */
  avgWin: number
  /** 平均亏损（元，记正数）：亏损交易的平均每笔亏多少；无亏损交易记 0 */
  avgLoss: number
  /** 盈亏比 = 平均盈利 ÷ 平均亏损（第 20 章的同名参数）；无亏损交易记 null——除数不存在，不是无穷大 */
  payoffRatio: number | null
}

/** 交易统计：胜率与盈亏比从真实盈亏列表里数出来——第 20 章口头报的参数，在这里变成读数 */
export function tradeStats(pnls: readonly number[]): TradeStats {
  if (!Array.isArray(pnls)) {
    throw new Error(`tradeStats：pnls 必须是数组，收到的是 ${typeof pnls}`)
  }
  for (let i = 0; i < pnls.length; i++) {
    if (!Number.isFinite(pnls[i])) {
      throw new Error(`tradeStats：第 ${i} 笔盈亏必须是有限数字，收到的是 ${pnls[i]}`)
    }
  }
  let wins = 0
  let winSum = 0
  let lossSum = 0
  for (const p of pnls) {
    if (p > 0) {
      wins++
      winSum += p
    } else {
      lossSum += -p // 平手（0）落进亏损侧：没赚就是输，口径与第 9 章一致
    }
  }
  const losses = pnls.length - wins
  return {
    count: pnls.length,
    wins,
    winRate: pnls.length === 0 ? 0 : wins / pnls.length,
    avgWin: wins === 0 ? 0 : winSum / wins,
    avgLoss: losses === 0 ? 0 : lossSum / losses,
    payoffRatio: losses === 0 ? null : winSum / wins / (lossSum / losses),
  }
}
