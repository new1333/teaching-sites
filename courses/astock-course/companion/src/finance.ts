// companion/src/finance.ts · 货币时间价值演算（第 1 章 worksheet 与图表数据的唯一实现）
//
// 约定：
// - 利率、通胀率一律用小数（0.03 = 3%），见 fixtures/time-value.json conventions。
// - 舍入沿用 src/round.ts：金额 round2；年化收益率按「百分数保留 2 位」即 roundRate4。
// - 实际购买力一步连算到最后再舍入（本金 × 增值因子 ÷ 物价因子），不中途取整。
// - 期望答案锁定在 fixtures/time-value.json，由 tests/finance.test.ts 断言一致。

import { round2 } from './round'

/** 增值因子：（1 + 年收益率）^年数，1 元钱按该收益率滚 n 年变成几元 */
export function growthFactor(rate: number, years: number): number {
  return Math.pow(1 + rate, years)
}

/** 物价因子：（1 + 年通胀率）^年数，n 年前 1 元能买到的东西现在值几元 */
export function priceFactor(inflation: number, years: number): number {
  return Math.pow(1 + inflation, years)
}

/** 复利终值：本金 ×（1 + 年收益率）^年数，收益并入本金再生收益 */
export function futureValue(principal: number, rate: number, years: number): number {
  return round2(principal * growthFactor(rate, years))
}

/** 单利终值（反事实对照）：收益不并入本金，每年利息固定，增长是直线 */
export function simpleFutureValue(principal: number, rate: number, years: number): number {
  return round2(principal * (1 + rate * years))
}

/**
 * 实际购买力：期末名义金额按物价折算后真正能买到的东西。
 * 用本金一步连算（不取中间终值），与 fixtures 期望答案的口径一致。
 */
export function realPurchasingPower(
  principal: number,
  rate: number,
  inflation: number,
  years: number,
): number {
  return round2((principal * growthFactor(rate, years)) / priceFactor(inflation, years))
}

/** 年化收益率：把 n 年的总涨幅折算成「相当于每年涨多少」，总涨幅以增长倍数传入（如 1.3 = 涨 30%） */
export function annualizedReturn(totalGrowth: number, years: number): number {
  return Math.pow(totalGrowth, 1 / years) - 1
}

/** 年化收益率舍入：按百分数保留 2 位小数（0.091393 → 0.0914，呈现为 9.14%） */
export function roundRate4(x: number): number {
  return Math.round(x * 10000) / 10000
}
