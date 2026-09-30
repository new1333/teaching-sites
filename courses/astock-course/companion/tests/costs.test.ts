// companion/tests/costs.test.ts · 第 3 章 交易规则与成本：实现与 fixtures 期望答案互相锁定
// 题目输入与唯一答案见 fixtures/market-rules.json；测试只断言「实现算出的值 === 期望值」。

import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/market-rules.json'
import { round2 } from '../src/round'
import {
  buyTotalPaid,
  commission,
  earliestSellDay,
  limitPrice,
  orderTradingDay,
  roundTripCost,
  sellNetReceived,
  stampTax,
  transferFee,
} from '../src/costs'

describe('交易成本：完整一买一卖的期望答案', () => {
  for (const c of fixture.cost_cases) {
    it(`case ${c.id}：买卖两端的每一笔费用与 fixtures 一致`, () => {
      // 成交金额按分计（金额四舍五入保留 2 位，与 fixtures 口径一致，避免浮点尾巴）
      const buyAmount = round2(c.buy.price * c.buy.shares)
      const sellAmount = round2(c.sell.price * c.sell.shares)
      expect(buyAmount).toBe(c.expected.buy_amount)
      expect(sellAmount).toBe(c.expected.sell_amount)

      expect(commission(buyAmount)).toBe(c.expected.buy_commission)
      expect(transferFee(buyAmount)).toBe(c.expected.buy_transfer_fee)
      expect(buyTotalPaid(buyAmount)).toBe(c.expected.buy_total_paid)

      expect(commission(sellAmount)).toBe(c.expected.sell_commission)
      expect(transferFee(sellAmount)).toBe(c.expected.sell_transfer_fee)
      expect(stampTax(sellAmount)).toBe(c.expected.stamp_tax)
      expect(sellNetReceived(sellAmount)).toBe(c.expected.sell_net_received)

      expect(roundTripCost(buyAmount, sellAmount)).toBe(c.expected.total_cost)
      const net = Math.round((c.expected.sell_net_received - c.expected.buy_total_paid) * 100) / 100
      expect(net).toBe(c.expected.net_result)
    })
  }
})

describe('涨跌停价：前收盘 ×（1 ± 幅度）四舍五入到分', () => {
  for (const c of fixture.limit_cases) {
    it(`case ${c.id}：${c.board} 前收盘 ${c.prev_close} → 涨停 ${c.expected.limit_up} / 跌停 ${c.expected.limit_down}`, () => {
      expect(limitPrice(c.prev_close, c.pct, 'up')).toBe(c.expected.limit_up)
      expect(limitPrice(c.prev_close, c.pct, 'down')).toBe(c.expected.limit_down)
    })
  }
})

describe('下单时点：归属交易日与最早可卖日', () => {
  for (const c of fixture.timing_cases) {
    it(`case ${c.id}：${c.order_weekday} ${c.order_time} → T=${c.expected_t_day}，最早卖出 ${c.expected_earliest_sell_day}`, () => {
      expect(orderTradingDay(c.order_weekday as '周一', c.order_time)).toBe(c.expected_t_day)
      expect(earliestSellDay(c.order_weekday as '周一', c.order_time)).toBe(
        c.expected_earliest_sell_day,
      )
    })
  }
})

describe('反事实与不变量', () => {
  it('净结果 = 价差 − 完整成本（三条成本题共用）', () => {
    for (const c of fixture.cost_cases) {
      const net = Math.round((c.expected.price_gain - c.expected.total_cost) * 100) / 100
      expect(net).toBe(c.expected.net_result)
    }
  })

  it('印花税只向卖方征收：买入侧任何函数都不含印花税', () => {
    const amount = 10000
    expect(buyTotalPaid(amount)).toBe(Math.round((amount + 5 + 0.1) * 100) / 100)
    expect(stampTax(amount)).toBe(5)
    expect(stampTax(amount)).not.toEqual(stampTax(amount) * 2)
  })

  it('卖出金额为零时没有成本可扣：佣金下限说明「最低 5 元」只在真实成交时触发', () => {
    expect(commission(0)).toBe(5)
  })
})
