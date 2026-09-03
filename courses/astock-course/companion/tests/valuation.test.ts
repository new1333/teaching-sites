// companion/tests/valuation.test.ts · 第 7 章 估值倍数：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/valuation.json；测试只断言「实现算出的值 === 期望值」。
// 股票 A、B 与公司丁、戊、己、庚、辛、壬均为合成教学标的，与任何真实上市公司无关。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/valuation.json'
import { growthRate } from '../src/statements'
import {
  RISK_FREE_DEPOSIT_1Y,
  bookValuePerShare,
  coreEarningsPerShare,
  depositAnchorVerdict,
  dividendYield,
  earningsPerShare,
  earningsYield,
  pbMeaningful,
  pbRatio,
  peFromMarketCap,
  peRatio,
} from '../src/valuation'

const A = fixture.stocks.a
const B = fixture.stocks.b
const C = fixture.companies
const S = fixture.self_check

// fixture 的 questions 为异构数组（各题 expected 形状不同），按题取用并在此声明形状；
// 数值的正确性仍由「实现算出的值 === 期望值」断言保证。
function question(id: string): { label: string; asks: string[]; expected: Record<string, any> } {
  const q = fixture.questions.find((x) => x.id === id)
  if (!q) throw new Error(`fixture 缺少题目 ${id}`)
  return q as { label: string; asks: string[]; expected: Record<string, any> }
}

/** 从总量路线输入（净利润/所有者权益 + 总股本）推出每股口径 */
function perShare(c: { net_profit_yi: number; equity_yi?: number; total_shares_yi: number }) {
  const eps = earningsPerShare(c.net_profit_yi, c.total_shares_yi)
  const bvps = c.equity_yi === undefined ? undefined : bookValuePerShare(c.equity_yi, c.total_shares_yi)
  return { eps, bvps }
}

describe('题1·钩子复算：两只 10 元的股票（A 与 B）', () => {
  const e = question('q1-hook-a-vs-b').expected

  it('A：每股路线与总量路线同一市盈率 10.0 倍，盈利收益率 10.00%、股息率 5.00% → 不输存款', () => {
    const eps = earningsPerShare(A.net_profit_yi, A.total_shares_yi)
    expect(eps).toBe(1)
    expect(peRatio(A.price, eps)).toBe(e.a.pe)
    expect(peFromMarketCap(A.price * A.total_shares_yi, A.net_profit_yi)).toBe(e.a.pe_via_market_cap)
    expect(earningsYield(eps, A.price)).toBe(e.a.earnings_yield)
    expect(dividendYield(A.dps, A.price)).toBe(e.a.dividend_yield)
    expect(depositAnchorVerdict(earningsYield(eps, A.price))).toBe(e.a.verdict)
  })

  it('B：市盈率 1000.0 倍、盈利收益率 0.10%、股息率 0.00% → 贵得危险', () => {
    const eps = earningsPerShare(B.net_profit_yi, B.total_shares_yi)
    expect(eps).toBe(0.01)
    expect(peRatio(B.price, eps)).toBe(e.b.pe)
    expect(peFromMarketCap(B.price * B.total_shares_yi, B.net_profit_yi)).toBe(e.b.pe_via_market_cap)
    expect(earningsYield(eps, B.price)).toBe(e.b.earnings_yield)
    expect(dividendYield(B.dps, B.price)).toBe(e.b.dividend_yield)
    expect(depositAnchorVerdict(earningsYield(eps, B.price))).toBe(e.b.verdict)
  })

  it('同价的两只股票判定互斥——「谁贵」有唯一答案', () => {
    expect(e.a.verdict).not.toBe(e.b.verdict)
    expect(e.b.pe).toBeGreaterThan(e.a.pe * 50)
    expect(e.b.earnings_yield).toBeLessThan(RISK_FREE_DEPOSIT_1Y)
    expect(e.a.earnings_yield).toBeGreaterThan(RISK_FREE_DEPOSIT_1Y)
  })
})

describe('题2·公司丁：四把尺子一次称全', () => {
  const d = C.ding
  const e = question('q2-ding-full-suite').expected
  const { eps, bvps } = perShare(d)

  it('市盈率 10.0、市净率 2.0、盈利收益率 10.00%、股息率 4.00% → 不输存款', () => {
    expect(eps).toBe(2.4)
    expect(bvps).toBe(12)
    expect(peRatio(d.price, eps)).toBe(e.pe)
    expect(pbRatio(d.price, bvps as number)).toBe(e.pb)
    expect(earningsYield(eps, d.price)).toBe(e.earnings_yield)
    expect(dividendYield(d.dps, d.price)).toBe(e.dividend_yield)
    expect(depositAnchorVerdict(earningsYield(eps, d.price))).toBe(e.verdict)
  })
})

describe('题3·市净率的适用边界：戊（银行）与己（软件）', () => {
  const e = question('q3-pb-boundary').expected
  const wu = C.wu
  const ji = C.ji

  it('戊：每股净资产 12.00 元，市净率 0.7 倍、市盈率 8.0 倍——家底上账，PB 有称重意义', () => {
    const { eps, bvps } = perShare(wu)
    expect(eps).toBe(1.05)
    expect(bvps).toBe(12)
    expect(pbRatio(wu.price, bvps as number)).toBe(e.wu.pb)
    expect(peRatio(wu.price, eps)).toBe(e.wu.pe)
    expect(pbMeaningful(wu.book_quality as 'asset-heavy' | 'asset-light')).toBe(e.wu.pb_meaningful)
  })

  it('己：每股净资产 1.20 元，市净率 30.0 倍、市盈率 20.0 倍——核心家底不上账，PB 参考意义弱', () => {
    const { eps, bvps } = perShare(ji)
    expect(eps).toBe(1.8)
    expect(bvps).toBe(1.2)
    expect(pbRatio(ji.price, bvps as number)).toBe(e.ji.pb)
    expect(peRatio(ji.price, eps)).toBe(e.ji.pe)
    expect(pbMeaningful(ji.book_quality as 'asset-heavy' | 'asset-light')).toBe(e.ji.pb_meaningful)
  })
})

describe('题4·股息率：现金回报下限对照存款锚', () => {
  const e = question('q4-dividend-floor').expected

  it('戊 5.00%、己 0.50%：一上一下夹住存款线 0.95%，答案唯一', () => {
    expect(dividendYield(C.wu.dps, C.wu.price)).toBe(e.wu.dividend_yield)
    expect(dividendYield(C.ji.dps, C.ji.price)).toBe(e.ji.dividend_yield)
    expect(e.ji.dividend_yield).toBeLessThan(RISK_FREE_DEPOSIT_1Y)
    expect(e.wu.dividend_yield).toBeGreaterThan(RISK_FREE_DEPOSIT_1Y)
  })

  it('粗筛的边界：己的盈利收益率 5.00% 过线——锚放行结构性贵，正文点名这层局限', () => {
    const { eps } = perShare(C.ji)
    expect(depositAnchorVerdict(earningsYield(eps, C.ji.price))).toBe('不输存款')
    expect(e.ji.dividend_yield).toBeLessThan(RISK_FREE_DEPOSIT_1Y)
  })
})

describe('题5·公司庚：便宜的一侧', () => {
  const g = C.geng
  const e = question('q5-geng-cheap-side').expected
  const { eps, bvps } = perShare(g)

  it('市盈率 5.0、市净率 1.7、盈利收益率 20.00%、股息率 5.00% → 不输存款', () => {
    expect(peRatio(g.price, eps)).toBe(e.pe)
    expect(pbRatio(g.price, bvps as number)).toBe(e.pb)
    expect(earningsYield(eps, g.price)).toBe(e.earnings_yield)
    expect(dividendYield(g.dps, g.price)).toBe(e.dividend_yield)
    expect(depositAnchorVerdict(earningsYield(eps, g.price))).toBe(e.verdict)
  })
})

describe('题6·公司辛：低市盈率的陷阱（一次性收益与主业口径）', () => {
  const x = C.xin
  const e = question('q6-xin-pe-trap').expected

  it('表观口径：市盈率 6.7 倍、盈利收益率 15.00%、报表利润增速 150.00%', () => {
    expect(peRatio(x.price, x.eps_reported_2025)).toBe(e.pe_reported)
    expect(earningsYield(x.eps_reported_2025, x.price)).toBe(e.earnings_yield_reported)
    expect(growthRate(x.eps_reported_2025, x.eps_reported_2024)).toBe(e.profit_growth_2025)
  })

  it('主业口径：两年主业每股盈利都是 0.15 元，市盈率 133.3 倍、盈利收益率 0.75%', () => {
    expect(coreEarningsPerShare(x.eps_reported_2025, x.one_off_2025)).toBe(e.core_eps)
    expect(coreEarningsPerShare(x.eps_reported_2024, x.one_off_2024)).toBe(e.core_eps)
    expect(growthRate(coreEarningsPerShare(x.eps_reported_2025, x.one_off_2025), coreEarningsPerShare(x.eps_reported_2024, x.one_off_2024))).toBe(0)
    expect(peRatio(x.price, e.core_eps)).toBe(e.pe_core)
    expect(earningsYield(e.core_eps, x.price)).toBe(e.earnings_yield_core)
  })

  it('两种口径判定互斥：表观「不输存款」、主业「贵得危险」——分母来路决定结论', () => {
    expect(depositAnchorVerdict(e.earnings_yield_reported)).not.toBe(e.verdict)
    expect(depositAnchorVerdict(e.earnings_yield_core)).toBe(e.verdict)
    expect(depositAnchorVerdict(e.earnings_yield_core)).toBe('贵得危险')
  })
})

describe('存款锚判定规则本身：阈值与舍入口径', () => {
  it('锚值为 2025-05-20 挂牌的 0.95%，与 fixtures 记录一致', () => {
    expect(RISK_FREE_DEPOSIT_1Y).toBe(fixture.risk_free_anchor.deposit_1y)
    expect(RISK_FREE_DEPOSIT_1Y).toBe(0.0095)
  })

  it('阈值边界唯一：恰好等于存款利率算「不输存款」，低一丝即「贵得危险」', () => {
    expect(depositAnchorVerdict(0.0095)).toBe('不输存款')
    expect(depositAnchorVerdict(0.0094)).toBe('贵得危险')
  })

  it('盈利收益率按一步口径舍入：不从舍入后的倍数取倒数（辛的表观 15.00% ≠ 1 ÷ 6.7）', () => {
    expect(earningsYield(3, 20)).toBe(0.15)
    expect(earningsYield(3, 20)).not.toBe(1 / peRatio(20, 3))
    expect(earningsYield(1, 10)).toBe(1 / peRatio(10, 1))
  })
})

describe('两条路线同一倍数：每股路线 = 总量路线（组装证据）', () => {
  it('A、B、丁、戊、己、庚两条路线算出的市盈率逐分一致', () => {
    const cases = [
      { price: A.price, np: A.net_profit_yi, shares: A.total_shares_yi },
      { price: B.price, np: B.net_profit_yi, shares: B.total_shares_yi },
      { price: C.ding.price, np: C.ding.net_profit_yi, shares: C.ding.total_shares_yi },
      { price: C.wu.price, np: C.wu.net_profit_yi, shares: C.wu.total_shares_yi },
      { price: C.ji.price, np: C.ji.net_profit_yi, shares: C.ji.total_shares_yi },
      { price: C.geng.price, np: C.geng.net_profit_yi, shares: C.geng.total_shares_yi },
    ]
    for (const c of cases) {
      const eps = earningsPerShare(c.np, c.shares)
      expect(peFromMarketCap(c.price * c.shares, c.np)).toBe(peRatio(c.price, eps))
    }
  })
})

describe('自查锚：股票壬', () => {
  const i = S.inputs
  const e = S.expected
  const { eps, bvps } = perShare(i)

  it('市盈率 25.0、市净率 2.0、盈利收益率 4.00%、股息率 2.00% → 不输存款', () => {
    expect(eps).toBe(2)
    expect(bvps).toBe(25)
    expect(peRatio(i.price, eps)).toBe(e.pe)
    expect(pbRatio(i.price, bvps as number)).toBe(e.pb)
    expect(earningsYield(eps, i.price)).toBe(e.earnings_yield)
    expect(dividendYield(i.dps, i.price)).toBe(e.dividend_yield)
    expect(depositAnchorVerdict(earningsYield(eps, i.price))).toBe(e.verdict)
  })
})
