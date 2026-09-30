// companion/tests/statements.test.ts · 第 6 章 财报三张表：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/statements.json；测试只断言「实现算出的值 === 期望值」。
// 公司甲、乙均为合成教学数据，与任何真实上市公司无关。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/statements.json'
import { round2 } from '../src/round'
import {
  cashToDebt,
  cashToProfit,
  cashCoversDebt,
  depositLoanBothHigh,
  grossMargin,
  grossProfit,
  growthRate,
  isHealthy,
  netMargin,
  ocfCoversProfit,
  receivablesCalm,
  receivablesVsRevenueGap,
} from '../src/statements'

const YEARS = ['2023', '2024', '2025'] as const
type Year = (typeof YEARS)[number]

function incomeOf(c: (typeof fixture.companies)[number], y: Year) {
  const row = c.income_statement.find((r) => r.year === Number(y))
  if (!row) throw new Error(`缺少 ${c.id} 的 ${y} 年利润表`)
  return row
}
function balanceOf(c: (typeof fixture.companies)[number], y: Year) {
  const row = c.balance_sheet.find((r) => r.year === Number(y))
  if (!row) throw new Error(`缺少 ${c.id} 的 ${y} 年资产负债表`)
  return row
}
function cashFlowOf(c: (typeof fixture.companies)[number], y: Year) {
  const row = c.cash_flow_statement.find((r) => r.year === Number(y))
  if (!row) throw new Error(`缺少 ${c.id} 的 ${y} 年现金流量表`)
  return row
}

describe('报表内部恒等式：三张表必须互相咬合（全部年份）', () => {
  for (const c of fixture.companies) {
    it(`${c.id}：毛利 = 营收 − 成本，净利润 = 毛利 − 费用与税`, () => {
      for (const y of YEARS) {
        const r = incomeOf(c, y)
        expect(grossProfit(r.revenue, r.cost)).toBe(r.gross_profit)
        expect(round2(r.gross_profit - r.expense_and_tax)).toBe(r.net_profit)
      }
    })

    it(`${c.id}：资产总计 = 各项资产之和 = 负债合计 + 所有者权益`, () => {
      for (const y of YEARS) {
        const b = balanceOf(c, y)
        const assetSum = round2(b.cash + b.receivables + b.inventory + b.fixed_and_other)
        expect(assetSum).toBe(b.total_assets)
        expect(round2(b.interest_bearing_debt + b.other_liabilities)).toBe(b.total_liabilities)
        expect(round2(b.total_liabilities + b.equity)).toBe(b.total_assets)
      }
    })

    it(`${c.id}：净增加额 = 经营 + 投资 + 筹资，期末现金 = 期初 + 净增加`, () => {
      for (const y of YEARS) {
        const f = cashFlowOf(c, y)
        expect(round2(f.operating + f.investing + f.financing)).toBe(f.net_change)
        expect(round2(f.cash_beginning + f.net_change)).toBe(f.cash_ending)
        expect(f.cash_ending).toBe(balanceOf(c, y).cash)
      }
    })
  }
})

describe('五项体检指标：实现与 fixtures 期望答案逐分一致', () => {
  for (const c of fixture.companies) {
    it(`${c.id}：毛利率三年、净利率与增速、含金量三年、应收差、现金覆盖`, () => {
      for (const y of YEARS) {
        const inc = incomeOf(c, y)
        expect(grossMargin(inc.revenue, inc.cost)).toBe(c.expected.gross_margin[y])
        if (y === '2025') {
          expect(netMargin(inc.net_profit, inc.revenue)).toBe(c.expected.net_margin_2025)
          const prev = incomeOf(c, '2024')
          expect(growthRate(inc.revenue, prev.revenue)).toBe(c.expected.revenue_growth_2025)
          expect(growthRate(inc.net_profit, prev.net_profit)).toBe(c.expected.net_profit_growth_2025)
        }
      }
      const ocf25 = cashFlowOf(c, '2025').operating
      const np25 = incomeOf(c, '2025').net_profit
      expect(cashToProfit(ocf25, np25)).toBe(c.expected.ocf_to_profit['2025'])
      for (const y of ['2023', '2024'] as const) {
        expect(cashToProfit(cashFlowOf(c, y).operating, incomeOf(c, y).net_profit)).toBe(
          c.expected.ocf_to_profit[y],
        )
      }
      const b25 = balanceOf(c, '2025')
      const b24 = balanceOf(c, '2024')
      expect(growthRate(b25.receivables, b24.receivables)).toBe(c.expected.receivables_growth_2025)
      expect(
        receivablesVsRevenueGap(
          growthRate(b25.receivables, b24.receivables),
          growthRate(incomeOf(c, '2025').revenue, incomeOf(c, '2024').revenue),
        ),
      ).toBe(c.expected.recv_vs_revenue_gap_2025)
      expect(cashToDebt(b25.cash, b25.interest_bearing_debt)).toBe(c.expected.cash_to_debt_2025)
    })

    it(`${c.id}：三年合计口径与 fixtures 一致`, () => {
      const t = c.expected.three_year_totals
      const sum = (pick: (y: Year) => number) => round2(YEARS.reduce((s, y) => round2(s + pick(y)), 0))
      expect(sum((y) => cashFlowOf(c, y).operating)).toBe(t.operating)
      expect(sum((y) => cashFlowOf(c, y).investing)).toBe(t.investing)
      expect(sum((y) => cashFlowOf(c, y).financing)).toBe(t.financing)
      expect(sum((y) => incomeOf(c, y).net_profit)).toBe(t.net_profit)
      const ocf3 = sum((y) => cashFlowOf(c, y).operating)
      const np3 = sum((y) => incomeOf(c, y).net_profit)
      expect(cashToProfit(ocf3, np3)).toBe(t.ocf_to_profit)
    })
  }
})

describe('体检判读规则：两家公司答案唯一且落在相反两侧', () => {
  for (const c of fixture.companies) {
    const ocf25 = cashFlowOf(c, '2025').operating
    const np25 = incomeOf(c, '2025').net_profit
    const ocfRatio = c.expected.ocf_to_profit['2025']
    const gap = c.expected.recv_vs_revenue_gap_2025
    const cover = c.expected.cash_to_debt_2025
    const flags = c.expected.health_flags

    it(`${c.id}：四条规则复算的旗子与 fixtures 的 health_flags 一致（${flags.verdict}）`, () => {
      expect(ocfCoversProfit(ocfRatio)).toBe(flags.ocf_covers_profit_2025)
      expect(ocfCoversProfit(ocf25 / np25)).toBe(flags.ocf_covers_profit_2025)
      expect(receivablesCalm(gap)).toBe(flags.receivables_calm_2025)
      expect(cashCoversDebt(cover)).toBe(flags.cash_covers_debt_2025)
      expect(depositLoanBothHigh(cover, ocf25 / np25)).toBe(flags.deposit_loan_both_high)
      expect(isHealthy(ocfRatio, gap, cover)).toBe(flags.verdict === '健康')
    })
  }

  it('甲与乙在每一面旗子上结论互斥——「哪家健康」有唯一答案', () => {
    const [jia, yi] = fixture.companies
    if (!jia || !yi) throw new Error('fixture 缺少公司数据')
    expect(jia.expected.health_flags.verdict).toBe('健康')
    expect(yi.expected.health_flags.verdict).not.toBe('健康')
    expect(jia.expected.ocf_to_profit['2025']).toBeGreaterThanOrEqual(1)
    expect(yi.expected.ocf_to_profit['2025']).toBeLessThan(0)
    expect(Math.abs(jia.expected.recv_vs_revenue_gap_2025)).toBeLessThanOrEqual(0.05)
    expect(yi.expected.recv_vs_revenue_gap_2025).toBeGreaterThan(0.2)
    expect(jia.expected.cash_to_debt_2025).toBeGreaterThanOrEqual(1)
    expect(yi.expected.cash_to_debt_2025).toBeGreaterThanOrEqual(1)
    expect(jia.expected.three_year_totals.ocf_to_profit).toBeGreaterThan(1)
    expect(yi.expected.three_year_totals.ocf_to_profit).toBeLessThan(0.2)
  })
})

describe('自查案例丙：五项指标期望答案', () => {
  const bing = fixture.self_check
  const i = bing.inputs_2025
  const e = bing.expected

  it('公司丙：五项指标与 fixtures 一致', () => {
    expect(grossMargin(i.revenue, i.cost)).toBe(e.gross_margin)
    expect(netMargin(i.net_profit, i.revenue)).toBe(e.net_margin)
    expect(cashToProfit(i.operating_cash_flow, i.net_profit)).toBe(e.ocf_to_profit)
    expect(growthRate(i.revenue, i.revenue_prev_year)).toBe(e.revenue_growth)
    expect(growthRate(i.receivables, i.receivables_prev_year)).toBe(e.receivables_growth)
    expect(
      receivablesVsRevenueGap(
        growthRate(i.receivables, i.receivables_prev_year),
        growthRate(i.revenue, i.revenue_prev_year),
      ),
    ).toBe(e.recv_vs_revenue_gap)
    expect(cashToDebt(i.cash, i.interest_bearing_debt)).toBe(e.cash_to_debt)
  })

  it('公司丙：判读落在红旗一侧（含金量 < 100%、应收激增、覆盖不足）', () => {
    expect(isHealthy(e.ocf_to_profit, e.recv_vs_revenue_gap, e.cash_to_debt)).toBe(false)
    expect(receivablesCalm(e.recv_vs_revenue_gap)).toBe(false)
    expect(cashCoversDebt(e.cash_to_debt)).toBe(false)
  })
})
