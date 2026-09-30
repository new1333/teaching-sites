// companion/src/costs.ts · 交易规则与成本演算（第 3 章 worksheet 的唯一实现）
//
// 约定：
// - 费率与最小佣金取自 fixtures/market-rules.json 的 fee_assumptions（= bible fee_assumptions），
//   佣金为课程示例值，实际以开户券商合同为准。
// - 舍入沿用 src/round.ts：费用与金额 round2；涨跌停价 roundTick（四舍五入到 0.01 元）。
// - 时点判定：15:00 收盘为 T 日分界；T+1 按交易日计数，周一至周五循环、周五后跳回周一
//   （课程简化：不含节假日，交易日历以交易所公告为准）。
// - 期望答案锁定在 fixtures/market-rules.json，由 tests/costs.test.ts 断言一致。

import { round2, roundTick } from './round'

/** 费率假设：课程示例值（佣金），其余为公告口径，生效日期见注释 */
export const FEES = {
  commissionRate: 0.00025, // 万 2.5，双向（课程示例值，实际以开户券商合同为准）
  commissionMin: 5, // 单笔最低 5 元（课程示例值）
  stampTaxRate: 0.0005, // 万 5，仅卖出单边（财政部 税务总局公告2023年第39号，2023-08-28 起）
  transferFeeRate: 0.00001, // 万 0.1，双向（中国结算，2022-04-29 起）
} as const

/** 佣金：成交金额 × 万 2.5，不足 5 元按 5 元收（买卖双向各算一次） */
export function commission(amount: number): number {
  return round2(Math.max(amount * FEES.commissionRate, FEES.commissionMin))
}

/** 过户费：成交金额 × 万 0.1，买卖双向（2022-04-29 起） */
export function transferFee(amount: number): number {
  return round2(amount * FEES.transferFeeRate)
}

/** 印花税：只在卖出时征收，卖出金额 × 万 5（2023-08-28 起） */
export function stampTax(sellAmount: number): number {
  return round2(sellAmount * FEES.stampTaxRate)
}

/** 买入总付出：成交金额 + 佣金 + 过户费——买入当天账户实际扣掉的钱 */
export function buyTotalPaid(amount: number): number {
  return round2(amount + commission(amount) + transferFee(amount))
}

/** 卖出总到手：成交金额 − 佣金 − 过户费 − 印花税——卖出后账户实际剩下的钱 */
export function sellNetReceived(amount: number): number {
  return round2(amount - commission(amount) - transferFee(amount) - stampTax(amount))
}

/** 一买一卖的完整交易成本：两次佣金 + 两次过户费 + 卖出印花税（买入侧无印花税） */
export function roundTripCost(buyAmount: number, sellAmount: number): number {
  return round2(
    commission(buyAmount) +
      transferFee(buyAmount) +
      commission(sellAmount) +
      transferFee(sellAmount) +
      stampTax(sellAmount),
  )
}

/** 涨跌停价：前收盘 ×（1 ± 幅度），四舍五入到分（roundTick） */
export function limitPrice(prevClose: number, pct: number, direction: 'up' | 'down'): number {
  const raw = prevClose * (1 + (direction === 'up' ? pct : -pct))
  return roundTick(raw)
}

// ---- 下单时点判定 ----

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** 下一个交易日：周五之后跳过周末回到周一（课程简化：不含节假日） */
export function nextTradingDay(day: Weekday): Weekday {
  const i = WEEKDAYS.indexOf(day)
  const next = WEEKDAYS[(i + 1) % WEEKDAYS.length]
  return next ?? '周一'
}

/** 下单归属交易日：15:00 收盘为分界，之前（含集合竞价时段）算当天，之后算下一个交易日 */
export function orderTradingDay(day: Weekday, time: string): Weekday {
  return time < '15:00' ? day : nextTradingDay(day)
}

/** T+1 最早可卖日：当日买入的股票，次一交易日才能卖出（现行载体为沪深交易所《交易规则》） */
export function earliestSellDay(day: Weekday, time: string): Weekday {
  return nextTradingDay(orderTradingDay(day, time))
}
