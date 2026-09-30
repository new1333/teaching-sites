// companion/tests/finance.test.ts · 第 1 章 货币时间价值：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/time-value.json；测试只断言「实现算出的值 === 期望值」。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/time-value.json'
import {
  annualizedReturn,
  futureValue,
  priceFactor,
  realPurchasingPower,
  roundRate4,
  simpleFutureValue,
} from '../src/finance'

describe('货币时间价值：题目期望答案', () => {
  for (const c of fixture.cases) {
    it(`case ${c.id}：终值与实际购买力与 fixtures 一致`, () => {
      expect(futureValue(c.principal, c.annual_rate, c.years)).toBe(c.expected.future_value)
      expect(realPurchasingPower(c.principal, c.annual_rate, c.annual_inflation, c.years)).toBe(
        c.expected.real_purchasing_power,
      )
      if (c.expected.simple_future_value !== null) {
        expect(simpleFutureValue(c.principal, c.annual_rate, c.years)).toBe(
          c.expected.simple_future_value,
        )
      }
    })
  }
})

describe('收益率年化：跨年限比较', () => {
  for (const p of fixture.annualization) {
    it(`plan ${p.id}：${p.label} 年化为 ${(p.expected_annualized * 100).toFixed(2)}%`, () => {
      expect(roundRate4(annualizedReturn(1 + p.total_return, p.years))).toBe(
        p.expected_annualized,
      )
    })
  }
})

describe('反事实与不变量', () => {
  it('通胀为零时，实际购买力等于名义终值（A 的反事实世界）', () => {
    const fv = futureValue(10000, 0.03, 10)
    expect(realPurchasingPower(10000, 0.03, 0, 10)).toBe(fv)
  })

  it('物价因子从 1 开始逐年放大：1.02^10 ≈ 1.2189944（正文跟算用）', () => {
    expect(priceFactor(0.02, 10)).toBeCloseTo(1.2189944, 6)
  })

  it('收益率恰好等于通胀率时，实际购买力不变（自查第 2 问的事实面）', () => {
    expect(realPurchasingPower(10000, 0.03, 0.03, 10)).toBe(10000)
  })
})
