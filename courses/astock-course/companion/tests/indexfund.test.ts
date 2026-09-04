// companion/tests/indexfund.test.ts · 第 13 章 指数基金与 ETF：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/index-etf.json；测试只断言「实现算出的值 === 期望值」。
// 组装证据：费率吞噬复用第 1 章 finance.growthFactor / annualizedReturn，最深坑复用第 9 章
// maxDrawdown / recoveryGain，定投回测直接调用第 11 章 position.dcaSchedule（一行未改），
// 一次性对照复用第 10 章 portfolio.sleeveValues——旧函数一行不改进入本章验证物。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/index-etf.json'
import ch11Fixture from '../fixtures/position.json'
import { annualizedReturn, growthFactor, maxDrawdown, recoveryGain } from '../src/finance'
import { sleeveValues } from '../src/portfolio'
import { round2 } from '../src/round'
import { feeDrag, premiumCost, syntheticFundNav } from '../src/indexfund'
import { dcaSchedule } from '../src/position'

describe('费率吞噬：两档费率的 20 年 / 10 年终值差', () => {
  for (const c of fixture.fee_drag_cases) {
    it(`case ${c.id}：净收益率、两档终值与差额和 fixtures 一致`, () => {
      const r = feeDrag(c.principal, c.gross_rate, c.low_fee, c.high_fee, c.years)
      expect(r.netLowRate).toBe(c.expected.net_low_rate)
      expect(r.netHighRate).toBe(c.expected.net_high_rate)
      expect(r.lowEnd).toBe(c.expected.low_end)
      expect(r.highEnd).toBe(c.expected.high_end)
      expect(r.gap).toBe(c.expected.gap)
      expect(r.gapPctOfPrincipal).toBe(c.expected.gap_pct_of_principal)
      // 组装证据：终值就是第 1 章复利公式，未另设第二套算法
      expect(r.lowEnd).toBe(round2(c.principal * growthFactor(c.gross_rate - c.low_fee, c.years)))
    })
  }

  it('年限减半，费率差按复利缩水：10 年终值差 24213.89 元，不足 20 年 96768.75 元的三成', () => {
    const r20 = fixture.fee_drag_cases[0]!
    const r10 = fixture.fee_drag_cases[1]!
    expect(r10.expected.gap).toBe(24213.89)
    expect(r20.expected.gap).toBe(96768.75)
    expect(r10.expected.gap).toBeLessThan(r20.expected.gap * 0.3)
  })

  it('定向破坏对照：把单利当复利，同一道题的终值差从 96768.75 缩水到 26000——费率差在复利里滚', () => {
    const simpleLow = round2(100000 * (1 + 0.078 * 20))
    const simpleHigh = round2(100000 * (1 + 0.065 * 20))
    expect(simpleLow).toBe(256000)
    expect(simpleHigh).toBe(230000)
    expect(round2(simpleLow - simpleHigh)).toBe(26000)
    expect(26000).toBeLessThan(96768.75)
  })

  it('两档费率相同时差额为 0：费率吞噬的全部来源就是费率差本身', () => {
    const r = feeDrag(100000, 0.08, 0.002, 0.002, 20)
    expect(r.gap).toBe(0)
    expect(r.lowEnd).toBe(r.highEnd)
  })

  it('输入不合法时拒绝求解', () => {
    expect(() => feeDrag(0, 0.08, 0.002, 0.015, 20)).toThrow()
    expect(() => feeDrag(100000, 0.08, 0.015, 0.002, 20)).toThrow()
    expect(() => feeDrag(100000, 0.08, 0.002, 0.015, 0)).toThrow()
    expect(() => feeDrag(100000, 0.08, -0.002, 0.015, 20)).toThrow()
  })
})

describe('十年赌局数字核对（authority：伯克希尔 2017 年度信十年终局表）', () => {
  it('authority 输入原样锁在 fixtures：指数 125.8%，五只组合 21.7%、42.3%、87.7%、2.8%、27.0%', () => {
    expect(fixture.bet.index_cum_pct).toBe(125.8)
    expect(fixture.bet.funds_cum_pct).toEqual([21.7, 42.3, 87.7, 2.8, 27.0])
    expect(fixture.bet.years).toBe(10)
  })

  it('累计 125.8% 折年化 8.49%，与 authority 口径「年化约 8.5%」相容（第 1 章 annualizedReturn）', () => {
    const annual = round2(annualizedReturn(1 + 125.8 / 100, 10) * 100)
    expect(annual).toBe(fixture.bet.expected.index_annual_pct)
    expect(annual).toBe(8.49)
  })

  it('五只组合的年化在 0.31%–6.5%（2.8% 一只按九年计）：没有一只追平指数的 8.49%', () => {
    const expected = fixture.bet.expected.funds_annual_pct
    expect(expected).toEqual([1.98, 3.59, 6.5, 0.31, 2.42])
    for (const a of expected) expect(a).toBeLessThan(8.49)
    // 2.8% 那只 2017 年清算，年化按 2008-2016 九年计（authority 口径 0.3%）
    expect(round2(annualizedReturn(1.028, 9) * 100)).toBe(0.31)
  })

  it('四只组合连指数的一半线（62.9%）都没够到；唯一的越线者 87.7% 也只拿到约七成（倍数 1.43）', () => {
    expect(fixture.bet.expected.index_to_best_ratio).toBe(1.43)
    expect(fixture.bet.expected.half_of_index_pct).toBe(62.9)
    expect(fixture.bet.expected.funds_below_half_count).toBe(4)
    expect(fixture.bet.expected.best_above_half_pp).toBe(24.8)
    // 用输入重验：低于一半线的恰好四只，最好的 87.7% 越线，125.8 ÷ 87.7 ≈ 1.43
    expect(fixture.bet.funds_cum_pct.filter((f) => f < 62.9).length).toBe(4)
    expect(fixture.bet.expected.best_fund_cum_pct).toBe(87.7)
    expect(fixture.bet.expected.best_fund_cum_pct).toBeGreaterThan(62.9)
    expect(round2(125.8 / 87.7)).toBe(1.43)
  })
})

describe('ETF 折溢价：市价与净值是两个数', () => {
  it('溢价 1% 买 1000 份，比按净值多付 15.00 元', () => {
    const c = fixture.etf_premium_case
    const r = premiumCost(c.nav, c.market_price, c.units)
    expect(r.premiumPct).toBe(c.expected.premium_pct)
    expect(r.payAtMarket).toBe(c.expected.pay_at_market)
    expect(r.payAtNav).toBe(c.expected.pay_at_nav)
    expect(r.extraPaid).toBe(c.expected.extra_paid)
  })

  it('折价是同一个公式的负号：市价 1.4700 对净值 1.5000，折价 2%、少付 60 元', () => {
    const r = premiumCost(1.5, 1.47, 2000)
    expect(r.premiumPct).toBe(-2)
    expect(r.extraPaid).toBe(-60)
  })

  it('净值、市价或份额非正时拒绝求解', () => {
    expect(() => premiumCost(0, 1.5, 100)).toThrow()
    expect(() => premiumCost(1.5, 0, 100)).toThrow()
    expect(() => premiumCost(1.5, 1.5, 0)).toThrow()
  })
})

describe('定投回测：第 11 章 dcaSchedule 换上合成指数净值，一行未改', () => {
  const c = fixture.dca_index_case
  // 净值序列由固定种子生成，与 fixtures 内嵌的 240 期逐位一致——图表与题目共用同一条路径
  const prices = syntheticFundNav(c.months, c.mean_monthly, c.sigma_monthly, c.seed)
  const result = dcaSchedule(c.monthly_amount, prices)

  it('fixtures 内嵌净值与 syntheticFundNav 输出逐位一致', () => {
    expect(prices).toEqual(c.prices)
    expect(prices.length).toBe(240)
  })

  it('汇总：总投入 240000 元、平均成本 1.96 元、期末市值 397225.24 元、赚 65.51%', () => {
    const e = c.expected
    expect(result.summary.totalAmount).toBe(e.total_amount)
    expect(result.summary.totalFees).toBe(e.total_fees)
    expect(result.summary.totalPaid).toBe(e.total_paid)
    expect(result.summary.totalShares).toBe(e.total_shares)
    expect(result.summary.avgCostExFee).toBe(e.avg_cost_ex_fee)
    expect(result.summary.avgCost).toBe(e.avg_cost)
    expect(result.summary.endPrice).toBe(e.end_nav)
    expect(result.summary.endValue).toBe(e.end_value)
    expect(result.summary.plPct).toBe(e.pl_pct)
    expect(result.summary.netPlPct).toBe(e.net_pl_pct)
  })

  it('前两期可纸笔跟算：931.2721 份与 866.1008 份，平均成本 1.08 → 1.12', () => {
    c.expected.spot_checks.forEach((s, i) => {
      const p = result.periods[i]!
      expect(p.month).toBe(s.month)
      expect(p.price).toBe(s.price)
      expect(p.shares).toBe(s.shares)
      expect(p.cumShares).toBe(s.cum_shares)
      expect(p.cumPaid).toBe(s.cum_paid)
      expect(p.avgCost).toBe(s.avg_cost)
      // 第 11 章的份额公式原样可用：份额 = 每期投入 ÷ 当期净值
      expect(p.shares).toBe(Math.round((c.monthly_amount / s.price) * 10000) / 10000)
    })
  })

  it('定投照样深亏过：第 104 期盯市市值 80441.71 元，比已投入的 104000 元浮亏 22.65%', () => {
    let worst = { month: 0, pct: 0, mark: 0, cum: 0 }
    for (const p of result.periods) {
      const mark = round2(p.cumShares * p.price)
      const u = round2(((mark - p.cumAmount) / p.cumAmount) * 100)
      if (u < worst.pct) worst = { month: p.month, pct: u, mark, cum: p.cumAmount }
    }
    expect(worst.month).toBe(c.expected.deepest_underwater.month)
    expect(worst.mark).toBe(c.expected.deepest_underwater.mark)
    expect(worst.cum).toBe(c.expected.deepest_underwater.cum_amount)
    expect(worst.pct).toBe(c.expected.deepest_underwater.underwater_pct)
    expect(result.summary.plPct).toBeGreaterThan(0) // 但拿满 240 期后是正的
  })

  it('一次性对照（第 10 章 sleeveValues）：240000 元买入并持有，期末 722793.82 元、赚 201.16%', () => {
    const buyNav = prices[0] as number
    const lump = sleeveValues(240000, prices.map((p) => p / buyNav))
    const end = round2(lump[lump.length - 1] as number)
    expect(end).toBe(722793.82)
    expect(round2((prices[prices.length - 1]! / buyNav - 1) * 100)).toBe(201.16)
    // 这轮单边修复的行情里一次性反超定投——定投赢的是纪律与过程，不是每一段收益
    expect(end).toBeGreaterThan(result.summary.endValue)
  })

  it('组装证据：旧函数行为未变——同一 dcaSchedule 跑第 11 章 V 形行情仍是 +26.50%', () => {
    const v = ch11Fixture.dca_cases[0]!
    const old = dcaSchedule(v.monthly_amount, v.prices)
    expect(old.summary.plPct).toBe(26.5)
    expect(old.summary.avgCost).toBe(1.75)
  })

  it('合成净值的形状：最深坑 39.32%（M67 峰 → M104 谷），回本要涨 64.8%（第 9 章两把尺）', () => {
    const mdd = maxDrawdown(prices)
    const e = fixture.drawdown_case.expected
    expect(`M${mdd.peakIndex + 1}`).toBe(e.peak_month)
    expect(`M${mdd.troughIndex + 1}`).toBe(e.trough_month)
    expect(prices[mdd.peakIndex]).toBe(e.peak_nav)
    expect(prices[mdd.troughIndex]).toBe(e.trough_nav)
    expect(round2(mdd.drawdown * 100)).toBe(e.drawdown_pct)
    expect(round2(recoveryGain(mdd.drawdown) * 100)).toBe(e.recovery_gain_pct)
  })

  it('定投输入不合法时拒绝求解（沿用第 11 章校验）', () => {
    expect(() => dcaSchedule(0, prices.slice(0, 2))).toThrow()
    expect(() => dcaSchedule(1000, [])).toThrow()
  })
})
