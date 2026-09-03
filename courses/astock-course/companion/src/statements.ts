// companion/src/statements.ts · 财报三张表体检演算（第 6 章 worksheet 的唯一实现）
//
// 约定：
// - 金额单位为亿元；比率与增速以小数存储，呈现时转百分数并保留 2 位小数（0.1295 = 12.95%），
//   对应 bible verification_conventions.rounding.ratio 与 fixtures/statements.json conventions。
// - 比率一律用原始科目一步算完再舍入（roundRatio = 百分数保留 2 位，即小数保留 4 位），
//   不中途取整；舍入沿用 src/round.ts。
// - 判读门槛（温和 ±5 个百分点、激增 > 20 个百分点、含金量与覆盖 ≥ 100%）与
//   fixtures/statements.json conventions.judgement_rules 一致。
// - 期望答案锁定在 fixtures/statements.json，由 tests/statements.test.ts 断言一致。
// - 公司甲、乙及自查案例丙均为合成教学数据，与任何真实上市公司无关（差异附录登记）。

import { round2 } from './round'

/** 毛利：营业收入 − 营业成本 */
export function grossProfit(revenue: number, cost: number): number {
  return round2(revenue - cost)
}

/** 比率舍入：按百分数保留 2 位小数（即小数保留 4 位），一步算完再舍入 */
export function roundRatio(x: number): number {
  return Math.round(x * 10000) / 10000
}

/** 毛利率：毛利 ÷ 营业收入——卖价里超出直接成本的部分占比，衡量生意好不好做 */
export function grossMargin(revenue: number, cost: number): number {
  return roundRatio((revenue - cost) / revenue)
}

/** 净利率：净利润 ÷ 营业收入——每一元收入最后剩下多少 */
export function netMargin(netProfit: number, revenue: number): number {
  return roundRatio(netProfit / revenue)
}

/** 利润含金量：经营现金流净额 ÷ 净利润——利润里有多少变成了到手的现金（第 5 项闸门之前的第一道闸） */
export function cashToProfit(operatingCashFlow: number, netProfit: number): number {
  return roundRatio(operatingCashFlow / netProfit)
}

/** 同比增速：（本期 − 上期）÷ 上期——收益率公式（第 1 章）在科目上的老用法 */
export function growthRate(current: number, previous: number): number {
  return roundRatio((current - previous) / previous)
}

/** 应收-营收增速差：应收账款增速 − 营业收入增速——正得越多，压货冲收入的嫌疑越大 */
export function receivablesVsRevenueGap(receivablesGrowth: number, revenueGrowth: number): number {
  return roundRatio(receivablesGrowth - revenueGrowth)
}

/** 现金债务覆盖：期末货币资金 ÷ 期末有息负债——账上的钱够不够把借款还清 */
export function cashToDebt(cash: number, interestBearingDebt: number): number {
  return roundRatio(cash / interestBearingDebt)
}

// ---- 判读规则（与 fixtures/statements.json conventions.judgement_rules 一致）----

/** 含金量闸门：经营现金流 ≥ 净利润（比率 ≥ 1）视为利润有现金背书 */
export function ocfCoversProfit(ocfToProfitRatio: number): boolean {
  return ocfToProfitRatio >= 1
}

/** 应收温和：应收-营收增速差的绝对值 ≤ 5 个百分点（0.05）；超过 20 个百分点（0.20）即激增红旗 */
export function receivablesCalm(receivablesGap: number): boolean {
  return Math.abs(receivablesGap) <= 0.05
}

/** 覆盖无虞：期末货币资金 ≥ 期末有息负债（比率 ≥ 1） */
export function cashCoversDebt(cashToDebtRatio: number): boolean {
  return cashToDebtRatio >= 1
}

/** 存贷双高嫌疑：账上现金够还债（≥ 1）但经营不造血（含金量 < 1）——钱可能是借来的，甚至可能不在账上 */
export function depositLoanBothHigh(cashToDebtRatio: number, ocfToProfitRatio: number): boolean {
  return cashToDebtRatio >= 1 && ocfToProfitRatio < 1
}

/** 体检总判读：含金量达标、应收温和、且无存贷双高嫌疑 = 健康；任一红旗 = 体检不通过 */
export function isHealthy(
  ocfToProfitRatio: number,
  receivablesGap: number,
  cashToDebtRatio: number,
): boolean {
  return (
    ocfCoversProfit(ocfToProfitRatio) && receivablesCalm(receivablesGap) && !depositLoanBothHigh(cashToDebtRatio, ocfToProfitRatio)
  )
}
