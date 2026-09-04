// companion/src/position.ts · 仓位反推与定投核算（第 11 章 worksheet 的唯一实现）
//
// 约定：
// - 仓位管理两条铁律的算术载体：先定「输多少」（单笔风险预算），再反推「买多少」（股数与仓位上限）。
// - 费用沿用第 3 章课程示例值（src/costs.ts 的 FEES 与函数原样复用，不在本章另设口径）：
//   佣金 万2.5 双向、单笔最低 5 元；过户费 万0.1 双向；印花税 万5 仅卖出单边。
// - 取整纪律：可买数量向下取整到 100 股（1 手）的整数倍，实际风险永远 ≤ 预算；
//   理论股数不足 1 手时数量为 0（这笔交易放弃）。
// - 舍入沿用 src/round.ts：金额 round2；定投份额 round4（累计份额由舍入后的逐期份额累加）。

import { commission, sellNetReceived, stampTax, transferFee } from './costs'
import { round2 } from './round'

/** 保留 4 位小数（定投份额口径：bible rounding 约定的课程延伸，就地定义、不改旧文件） */
const sharesRound = (x: number): number => Math.round(x * 10000) / 10000

/** 仓位反推计划：从「最多输多少」推出的买入数量与仓位上限 */
export interface PositionPlan {
  /** 单笔可亏上限（元）= 总资金 × 预算比例 */
  budgetAmount: number
  /** 每股最大亏损（元）= 买入价 − 止损价 */
  perShareRisk: number
  /** 理论股数 = 预算 ÷ 每股风险（未取整） */
  rawShares: number
  /** 实际可买股数：向下取整到 1 手（100 股）的整数倍；不足 1 手时为 0（放弃这笔交易） */
  shares: number
  /** 实际最大亏损（元）= 股数 × 每股风险，永远 ≤ 预算 */
  actualRisk: number
  /** 持仓市值（元）= 股数 × 买入价 */
  positionValue: number
  /** 仓位上限（小数）= 持仓市值 ÷ 总资金 */
  positionCap: number
}

/**
 * 仓位反推：给定总资金、单笔风险预算比例、买入价与止损价，反推可买数量与仓位上限。
 * 顺序不能反——先有预算与止损位，才有资格谈数量；止损价必须低于买入价。
 */
export function positionFromRiskBudget(
  totalCapital: number,
  budgetRate: number,
  buyPrice: number,
  stopPrice: number,
): PositionPlan {
  if (totalCapital <= 0 || budgetRate <= 0) {
    throw new Error('positionFromRiskBudget: 总资金与预算比例需为正数')
  }
  if (stopPrice >= buyPrice) {
    throw new Error('positionFromRiskBudget: 止损价必须低于买入价，否则每股最大亏损非正')
  }
  const budgetAmount = round2(totalCapital * budgetRate)
  const perShareRisk = round2(buyPrice - stopPrice)
  const rawShares = budgetAmount / perShareRisk
  const shares = Math.floor(rawShares / 100) * 100
  const actualRisk = round2(shares * perShareRisk)
  const positionValue = round2(shares * buyPrice)
  const positionCap = positionValue / totalCapital
  return { budgetAmount, perShareRisk, rawShares, shares, actualRisk, positionValue, positionCap }
}

/** 定投单期记录：一期买入的成本核算与滚动累计 */
export interface DcaPeriod {
  /** 期数（从 1 开始，月频） */
  month: number
  /** 当期价格（元） */
  price: number
  /** 当期投入（成交金额，元） */
  investAmount: number
  /** 当期买入份额（保留 4 位小数） */
  shares: number
  /** 累计成交金额（元） */
  cumAmount: number
  /** 当期佣金（元，小额定投通常撞 5 元下限） */
  commission: number
  /** 当期过户费（元） */
  transferFee: number
  /** 当期总付出（元）= 成交金额 + 佣金 + 过户费 */
  periodPaid: number
  /** 累计份额（由舍入后的逐期份额累加，保留 4 位） */
  cumShares: number
  /** 累计总付出（元，含费） */
  cumPaid: number
  /** 平均成本（元，含费）= 累计总付出 ÷ 累计份额 */
  avgCost: number
}

/** 定投汇总：整段计划的投入、成本与期末盈亏 */
export interface DcaSummary {
  /** 累计成交金额（元，不含费） */
  totalAmount: number
  /** 全部费用（元）= 12 期佣金与过户费之和 */
  totalFees: number
  /** 累计总付出（元，含费） */
  totalPaid: number
  /** 累计份额 */
  totalShares: number
  /** 平均成本（元，不含费）= 累计成交金额 ÷ 累计份额 */
  avgCostExFee: number
  /** 平均成本（元，含费）= 累计总付出 ÷ 累计份额 */
  avgCost: number
  /** 期末价格（元，最后一名成员的当期价格） */
  endPrice: number
  /** 期末市值（元）= 累计份额 × 期末价格 */
  endValue: number
  /** 相对成交金额的盈亏（元）= 期末市值 − 累计成交金额 */
  plAmount: number
  /** 相对成交金额的盈亏（%） */
  plPct: number
  /** 卖出佣金（元，期末一次全部卖出） */
  sellCommission: number
  /** 卖出过户费（元） */
  sellTransferFee: number
  /** 印花税（元，卖出单边万5） */
  stampTax: number
  /** 卖出净到手（元，第 3 章 sellNetReceived 口径） */
  netReceived: number
  /** 净盈亏（元）= 净到手 − 累计总付出 */
  netPl: number
  /** 净盈亏（%，相对总付出） */
  netPlPct: number
}

/** 定投核算结果：逐期记录 + 汇总 */
export interface DcaResult {
  periods: DcaPeriod[]
  summary: DcaSummary
}

/**
 * 定投核算：每期固定投入 monthlyAmount（成交金额口径），按当期价格买入，
 * 逐期记录费用、份额与平均成本，期末按最后一名成员的价格估值并核算卖出落袋。
 * 行情为课程合成教学数据；份额允许碎股（课程简化），保留 4 位小数。
 */
export function dcaSchedule(monthlyAmount: number, prices: number[]): DcaResult {
  if (monthlyAmount <= 0) {
    throw new Error('dcaSchedule: 每期投入需为正数')
  }
  if (prices.length === 0) {
    throw new Error('dcaSchedule: 价格序列不能为空')
  }
  if (prices.some((p) => p <= 0)) {
    throw new Error('dcaSchedule: 价格需为正数')
  }

  const periods: DcaPeriod[] = []
  let cumShares = 0
  let cumAmount = 0
  let cumPaid = 0

  prices.forEach((price, i) => {
    const shares = sharesRound(monthlyAmount / price)
    const buyCommission = commission(monthlyAmount)
    const fee = transferFee(monthlyAmount)
    const periodPaid = round2(monthlyAmount + buyCommission + fee)
    cumShares = sharesRound(cumShares + shares)
    cumAmount = round2(cumAmount + monthlyAmount)
    cumPaid = round2(cumPaid + periodPaid)
    periods.push({
      month: i + 1,
      price,
      investAmount: monthlyAmount,
      shares,
      cumAmount,
      commission: buyCommission,
      transferFee: fee,
      periodPaid,
      cumShares,
      cumPaid,
      avgCost: round2(cumPaid / cumShares),
    })
  })

  const endPrice = prices[prices.length - 1] as number
  const endValue = round2(cumShares * endPrice)
  const sellCommission = commission(endValue)
  const sellTransferFee = transferFee(endValue)
  const tax = stampTax(endValue)
  const netReceived = sellNetReceived(endValue)
  const totalFees = round2(cumPaid - cumAmount)
  const summary: DcaSummary = {
    totalAmount: cumAmount,
    totalFees,
    totalPaid: cumPaid,
    totalShares: cumShares,
    avgCostExFee: round2(cumAmount / cumShares),
    avgCost: round2(cumPaid / cumShares),
    endPrice,
    endValue,
    plAmount: round2(endValue - cumAmount),
    plPct: round2((endValue / cumAmount - 1) * 100),
    sellCommission,
    sellTransferFee,
    stampTax: tax,
    netReceived,
    netPl: round2(netReceived - cumPaid),
    netPlPct: round2((netReceived / cumPaid - 1) * 100),
  }
  return { periods, summary }
}
