// companion/src/finance.ts · 货币时间价值与风险演算（第 1、9 章函数实现与图表数据的唯一实现）
//
// 约定：
// - 利率、通胀率、回撤与波动率一律用小数（0.03 = 3%），见 fixtures/time-value.json conventions。
// - 舍入沿用 src/round.ts：金额 round2；年化收益率按「百分数保留 2 位」即 roundRate4。
// - 实际购买力一步连算到最后再舍入（本金 × 增值因子 ÷ 物价因子），不中途取整。
// - 期望答案锁定在 fixtures/time-value.json，由 tests/finance.test.ts 断言一致；
//   第 9 章三函数（回撤/回本/波动率）由 tests/risk-math.test.ts 与 datasets/ch09-risk.ts 互锁。
// - 年化波动率按「月收益率标准差 ×√12」的课程简化口径（母体标准差、月频假设），
//   未采用日频 ×√252 等实务口径——差异登记附录「简化与差异清单」。

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

// ---------------------------------------------------------------------------
// 第 9 章 · 风险的数学：回撤、回本与波动率
// ---------------------------------------------------------------------------

/** 逐期收益率：相邻两点的涨跌，path[i+1] / path[i] − 1（第 1 章的收益率公式逐期套用） */
export function periodReturns(path: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < path.length; i += 1) {
    const prev = path[i - 1] as number
    const curr = path[i] as number
    out.push(curr / prev - 1)
  }
  return out
}

/** 最大回撤结果：回撤幅度（小数）与它在路径上的峰、谷位置（峰值之后最低点） */
export interface DrawdownResult {
  /** 回撤幅度小数（0.5 = 从峰跌 50%） */
  drawdown: number
  /** 峰值下标：截至该点是路径的历史最高 */
  peakIndex: number
  /** 谷值下标：峰值之后的最低点 */
  troughIndex: number
}

/**
 * 最大回撤：从历史最高点到其后最低点的最大跌幅。
 * 走一遍净值，随手记历史最高峰，每个点算（峰 − 现值）÷ 峰，取最大。
 * path 需为正数净值序列（首点 > 0），全上涨路径回撤为 0。
 */
export function maxDrawdown(path: number[]): DrawdownResult {
  const first = path[0]
  if (first === undefined || first <= 0) {
    throw new Error('maxDrawdown: 需要首点为正数的净值序列')
  }
  let peak = first
  let peakIndex = 0
  let best: DrawdownResult = { drawdown: 0, peakIndex: 0, troughIndex: 0 }
  for (let i = 1; i < path.length; i += 1) {
    const v = path[i] as number
    if (v > peak) {
      peak = v
      peakIndex = i
    }
    const dd = (peak - v) / peak
    if (dd > best.drawdown) best = { drawdown: dd, peakIndex, troughIndex: i }
  }
  return best
}

/** 回本涨幅：亏损幅度 loss（小数）回到成本价所需的涨幅（小数）——由复利不变量 (1−loss)×(1+g)=1 解出 */
export function recoveryGain(loss: number): number {
  if (loss < 0 || loss >= 1) {
    throw new Error('recoveryGain: 亏损幅度需在 [0, 1) 内')
  }
  return loss / (1 - loss)
}

/**
 * 年化波动率：月收益率标准差 ×√12 折成年度口径（课程简化口径，见文件头注）。
 * 标准差取母体口径（除以 n）：描述「这串月涨跌平均离自己的均值多远」。
 */
export function annualizedVolatility(monthlyReturns: number[]): number {
  const n = monthlyReturns.length
  if (n === 0) throw new Error('annualizedVolatility: 收益率序列不能为空')
  const mean = monthlyReturns.reduce((s, r) => s + r, 0) / n
  const variance = monthlyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / n
  return Math.sqrt(variance) * Math.sqrt(12)
}
