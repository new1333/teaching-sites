// companion/tests/position.test.ts · 第 11 章 仓位与定投：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/position.json；测试只断言「实现算出的值 === 期望值」。
// 组装证据：费用一律复用第 3 章 costs.ts 的原函数，回本涨幅复用第 9 章 finance.ts 的 recoveryGain，
// 旧函数一行未改进入本章验证物。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/position.json'
import { buyTotalPaid, commission, sellNetReceived, stampTax, transferFee } from '../src/costs'
import { recoveryGain } from '../src/finance'
import { round2 } from '../src/round'
import { dcaSchedule, positionFromRiskBudget } from '../src/position'

describe('仓位反推：先定输多少，再算买多少', () => {
  for (const c of fixture.position_cases) {
    it(`case ${c.id}：预算、每股风险、股数、仓位上限与 fixtures 一致`, () => {
      const plan = positionFromRiskBudget(c.total_capital, c.budget_rate, c.buy_price, c.stop_price)
      const e = c.expected
      expect(plan.budgetAmount).toBe(e.budget_amount)
      expect(plan.perShareRisk).toBe(e.per_share_risk)
      expect(Math.round(plan.rawShares * 10000) / 10000).toBe(e.raw_shares)
      expect(plan.shares).toBe(e.shares)
      expect(plan.shares / 100).toBe(e.lots)
      expect(plan.actualRisk).toBe(e.actual_risk)
      expect(plan.actualRisk).toBeLessThanOrEqual(e.budget_amount)
      expect(plan.positionValue).toBe(e.position_value)
      expect(round2(plan.positionCap * 100)).toBe(e.position_cap_pct)
      // 买入费用沿用第 3 章课程示例值（佣金万2.5下限5元 + 过户费万0.1）
      expect(commission(plan.positionValue)).toBe(e.buy_commission)
      expect(transferFee(plan.positionValue)).toBe(e.buy_transfer_fee)
      expect(buyTotalPaid(plan.positionValue)).toBe(e.buy_total_paid)
    })
  }

  it('实际风险永远不超过预算：取整只向下，不留超额敞口', () => {
    const inputs: Array<[number, number, number, number]> = [
      [100000, 0.01, 10.0, 9.5],
      [80000, 0.02, 20.0, 18.5],
      [50000, 0.02, 15.0, 13.5],
      [120000, 0.015, 7.7, 7.02],
      [30000, 0.01, 25.0, 24.1],
    ]
    for (const [capital, rate, buy, stop] of inputs) {
      const plan = positionFromRiskBudget(capital, rate, buy, stop)
      expect(plan.actualRisk).toBeLessThanOrEqual(capital * rate + 1e-9)
      expect(plan.positionCap).toBeLessThanOrEqual(1)
    }
  })

  it('止损放宽 → 每股风险变大 → 同一笔预算买得更少：仓位上限从 20% 降到 10%', () => {
    const tight = positionFromRiskBudget(100000, 0.01, 10.0, 9.5)
    const loose = positionFromRiskBudget(100000, 0.01, 10.0, 9.0)
    expect(tight.shares).toBe(2000)
    expect(loose.shares).toBe(1000)
    expect(round2(loose.positionCap * 100)).toBe(10.0)
  })

  it('理论股数不足 1 手时数量为 0：这笔交易放弃（1000 元预算 ÷ 每股 12.50 元 = 80 股）', () => {
    const plan = positionFromRiskBudget(100000, 0.01, 50.0, 37.5)
    expect(plan.shares).toBe(0)
    expect(plan.actualRisk).toBe(0)
    expect(plan.positionValue).toBe(0)
  })

  it('止损价不低于买入价、总资金或预算非正时拒绝求解', () => {
    expect(() => positionFromRiskBudget(100000, 0.01, 10.0, 10.0)).toThrow()
    expect(() => positionFromRiskBudget(100000, 0.01, 10.0, 10.5)).toThrow()
    expect(() => positionFromRiskBudget(0, 0.01, 10.0, 9.5)).toThrow()
    expect(() => positionFromRiskBudget(100000, 0, 10.0, 9.5)).toThrow()
  })
})

describe('定投核算：逐期成本与平均成本', () => {
  for (const c of fixture.dca_cases) {
    it(`case ${c.id}：12 期的份额、累计份额、费用、总付出、平均成本逐期对齐`, () => {
      const result = dcaSchedule(c.monthly_amount, c.prices)
      result.periods.forEach((p, i) => {
        const e = c.expected.periods[i] as
          | (typeof c.expected.periods)[number]
          | undefined
        if (!e) throw new Error(`fixture 缺少第 ${i + 1} 期期望`)
        expect(p.month).toBe(e.month)
        expect(p.price).toBe(e.price)
        expect(p.investAmount).toBe(e.invest_amount)
        expect(p.shares).toBe(e.shares)
        expect(p.cumShares).toBe(e.cum_shares)
        expect(p.cumAmount).toBe(e.cum_amount)
        expect(p.commission).toBe(e.commission)
        expect(p.transferFee).toBe(e.transfer_fee)
        expect(p.periodPaid).toBe(e.period_paid)
        expect(p.cumPaid).toBe(e.cum_paid)
        expect(p.avgCost).toBe(e.avg_cost)
      })
    })

    it(`case ${c.id}：汇总——总投入、总费用、平均成本、期末盈亏与落袋全对`, () => {
      const result = dcaSchedule(c.monthly_amount, c.prices)
      const s = c.expected.summary
      expect(result.summary.totalAmount).toBe(s.total_amount)
      expect(result.summary.totalFees).toBe(s.total_fees)
      expect(result.summary.totalPaid).toBe(s.total_paid)
      expect(result.summary.totalShares).toBe(s.total_shares)
      expect(result.summary.avgCostExFee).toBe(s.avg_cost_ex_fee)
      expect(result.summary.avgCost).toBe(s.avg_cost)
      expect(result.summary.endValue).toBe(s.end_value)
      expect(result.summary.plAmount).toBe(s.pl_amount)
      expect(result.summary.plPct).toBe(s.pl_pct)
      // 期末整表卖出：第 3 章五笔账的卖出侧
      expect(result.summary.sellCommission).toBe(s.sell_commission)
      expect(result.summary.sellTransferFee).toBe(s.sell_transfer_fee)
      expect(result.summary.stampTax).toBe(s.stamp_tax)
      expect(result.summary.netReceived).toBe(s.net_received)
      expect(result.summary.netPl).toBe(s.net_pl)
      expect(result.summary.netPlPct).toBe(s.net_pl_pct)
    })
  }

  it('平均成本恒等式：最后一期 avgCost = 累计总付出 ÷ 累计份额（逐期口径可跟算）', () => {
    for (const c of fixture.dca_cases) {
      const result = dcaSchedule(c.monthly_amount, c.prices)
      const last = result.periods[result.periods.length - 1]
      if (!last) throw new Error('定投表不应为空')
      expect(last.avgCost).toBe(round2(last.cumPaid / last.cumShares))
    }
  })

  it('小额定投每一期都撞佣金 5 元下限：12 期共 60.00 元，是按真实费率应收的 20 倍', () => {
    const result = dcaSchedule(1000, fixture.dca_cases[0]?.prices ?? [])
    expect(result.periods.every((p) => p.commission === 5.0)).toBe(true)
    expect(commission(1000)).toBe(5.0) // 按 万2.5 应收 0.25 元，被下限顶到 5 元
    expect(result.summary.totalFees).toBe(60.12)
  })

  it('V 形行情：定投 +26.50% 反超一次性买入的 +10.00%——低位买到更多份额', () => {
    const v = fixture.dca_cases[0]
    if (!v) throw new Error('fixture 缺少 dca-V')
    const result = dcaSchedule(v.monthly_amount, v.prices)
    // 一次性：12000 元在第 1 期价格 2.00 全买，期末按 2.20 估值
    const lumpShares = v.expected.periods[0]!.invest_amount * 12 / v.prices[0]!
    const lumpEnd = round2(lumpShares * v.prices[v.prices.length - 1]!)
    expect(round2(lumpEnd)).toBe(v.expected.summary.lump_sum_end_value)
    expect(round2((lumpEnd / 12000 - 1) * 100)).toBe(v.expected.summary.lump_sum_pl_pct)
    expect(result.summary.plPct).toBeGreaterThan(v.expected.summary.lump_sum_pl_pct)
  })

  it('下行行情反例：定投照样亏——平均成本 1.37 高于期末价 0.90，仍亏 34.01%', () => {
    const d = fixture.dca_cases[1]
    if (!d) throw new Error('fixture 缺少 dca-D')
    const result = dcaSchedule(d.monthly_amount, d.prices)
    expect(result.summary.avgCost).toBeGreaterThan(result.summary.endPrice)
    expect(result.summary.plPct).toBe(-34.01)
    // 但摊薄确实少亏：一次性买入同期亏 55%
    expect(result.summary.plPct).toBeGreaterThan(d.expected.summary.lump_sum_pl_pct)
  })

  it('定向破坏对照：把 V 形第 5 期 1.40 换成 2.40（拆掉低位多买），平均成本 1.75 → 1.83、期末市值缩水', () => {
    const v = fixture.dca_cases[0]
    if (!v) throw new Error('fixture 缺少 dca-V')
    const broken = [...v.prices]
    broken[4] = 2.4
    const result = dcaSchedule(v.monthly_amount, broken)
    expect(result.summary.avgCost).toBe(1.83)
    expect(result.summary.endValue).toBe(14525.41)
    expect(result.summary.plPct).toBe(21.05)
  })

  it('定投输入不合法时拒绝求解', () => {
    expect(() => dcaSchedule(0, [2, 1])).toThrow()
    expect(() => dcaSchedule(1000, [])).toThrow()
    expect(() => dcaSchedule(1000, [2, 0, 1])).toThrow()
  })
})

describe('组装证据：旧积木原样进入第 11 章', () => {
  it('第 3 章成本函数不改一行，直接算出本章的买入付出与卖出落袋', () => {
    expect(buyTotalPaid(20000)).toBe(20005.2)
    expect(sellNetReceived(15180.17)).toBe(15167.43)
    expect(stampTax(15180.17)).toBe(7.59)
  })

  it('第 9 章回本涨幅：同一次腰斩，满仓要 +100%、半仓 +33.33%、两成仓 +11.11%', () => {
    for (const c of fixture.full_position_ladder.cases) {
      const loss = c.account_loss_pct / 100
      expect(round2(recoveryGain(loss) * 100)).toBe(c.recovery_pct)
    }
    expect(recoveryGain(0.5)).toBe(1)
  })
})
