// companion/tests/portfolio.test.ts · 第 10 章 免费的午餐：相关性/组合波动/再平衡与数据集互锁
// 已知值断言锁 portfolio 四组函数；buildCh10() 的导出数据用同一套实现重算互锁——
// 正文组件标注值（portfolio-mix.json）与公式结果必须一致，不允许平行手抄第二套数字。

import { describe, expect, it } from 'vitest'
import { annualizedVolatility, maxDrawdown, periodReturns } from '../src/finance'
import { round2 } from '../src/round'
import { correlation, mixReturns, periodicRebalancePath, rebalanceTo, sleeveValues, sleeveWeights } from '../src/portfolio'
import { buildCh10 } from '../src/datasets/ch10-mix'
import type { Ch10Data } from '../src/datasets/ch10-mix'

describe('相关性：同步程度的尺子', () => {
  it('与自己完全同步：相关系数为 1', () => {
    expect(correlation([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 12)
  })
  it('完全反向：相关系数为 −1', () => {
    expect(correlation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1, 12)
  })
  it('正交的两串涨跌：相关系数为 0', () => {
    expect(correlation([1, -1, 1, -1], [1, 1, -1, -1])).toBeCloseTo(0, 12)
  })
  it('序列没有颠簸（标准差为 0）时相关系数无定义', () => {
    expect(() => correlation([1, 1, 1], [1, 2, 3])).toThrow()
  })
})

describe('组合收益率与买入持有仓位', () => {
  it('各半组合：+10% 与 −10% 相加恰好抵消', () => {
    expect(mixReturns(0.5, [0.1], [-0.1])[0]).toBeCloseTo(0, 12)
  })
  it('60/40 组合：0.6×10% + 0.4×2% = 6.8%', () => {
    expect(mixReturns(0.6, [0.1], [0.02])[0]).toBeCloseTo(0.068, 12)
  })
  it('买入持有：60000 元按 1 → 1.2 → 1.3 放大成 60000 → 72000 → 78000', () => {
    expect(sleeveValues(60000, [1, 1.2, 1.3])).toEqual([60000, 72000, 78000])
  })
  it('仓位占比：90000 对 30000 为 75/25', () => {
    const w = sleeveWeights(90000, 30000)
    expect(w.weightA).toBeCloseTo(0.75, 12)
    expect(w.weightB).toBeCloseTo(0.25, 12)
  })
})

describe('再平衡：卖超配、买低配', () => {
  it('117186 / 42448 拨回 60/40：卖出 21405.60 元、买入 21405.60 元', () => {
    const r = rebalanceTo(117186, 42448, 0.6)
    expect(r.afterA).toBeCloseTo(95780.4, 2)
    expect(r.afterB).toBeCloseTo(63853.6, 2)
    expect(r.tradeA).toBeCloseTo(-21405.6, 2)
    expect(r.tradeB).toBeCloseTo(21405.6, 2)
  })
  it('已经在目标比例上：交易额为 0', () => {
    const r = rebalanceTo(60000, 40000, 0.6)
    expect(Math.abs(r.tradeA)).toBeLessThan(1e-9)
    expect(Math.abs(r.tradeB)).toBeLessThan(1e-9)
  })
  it('周期再平衡：每 2 个月拨回 60/40，总资产路径可重算', () => {
    const path = periodicRebalancePath([1, 1.2, 1.3, 1.6], [1, 1.0, 1.02, 1.02], 0.6, 100000, 2)
    expect(path[0]).toBeCloseTo(100000, 6)
    expect(path[1]).toBeCloseTo(112000, 6)
    // 第 2 个月末总资产先长到 78000 + 40800，再拨比例——拨比例不改总资产
    expect(path[2]).toBeCloseTo(118800, 6)
    expect(path[3]).toBeCloseTo(71280 * (1.6 / 1.3) + 47520, 4)
  })
})

describe('数据集互锁：portfolio-mix.json 与实现重算一致', () => {
  const ds = buildCh10()
  const data = ds.data as unknown as Ch10Data

  it('导出文件名与四大区块齐备', () => {
    expect(ds.file).toBe('portfolio-mix.json')
    expect(data.hook.asset_a.values).toHaveLength(25)
    expect(data.correlation_lab.variants).toHaveLength(5)
    expect(data.correlation_lab.variants.map((v) => v.level)).toEqual([-0.8, -0.4, 0, 0.4, 0.8])
    expect(data.drift.stock_sleeve_values).toHaveLength(37)
  })

  it('钩子：甲乙各自最深坑都超过 40%，组合最大回撤远浅于两只', () => {
    const a = data.hook.asset_a
    const b = data.hook.asset_b
    expect(a.max_drawdown.drawdown_pct).toBeGreaterThanOrEqual(40)
    expect(b.max_drawdown.drawdown_pct).toBeGreaterThanOrEqual(40)
    expect(data.hook.combo.max_drawdown.drawdown_pct).toBeLessThan(a.max_drawdown.drawdown_pct)
    expect(data.hook.combo.max_drawdown.drawdown_pct).toBeLessThan(b.max_drawdown.drawdown_pct)
  })

  it('钩子：组合波动率低于任一单只的六成——抵消真的发生了', () => {
    const minVol = Math.min(data.hook.asset_a.volatility_annual_pct, data.hook.asset_b.volatility_annual_pct)
    expect(data.hook.combo.volatility_annual_pct).toBeLessThan(minVol * 0.6)
  })

  for (const p of [data.hook.asset_a, data.hook.asset_b, data.hook.combo]) {
    it(`路径 ${p.id}：波动率与最大回撤可由实现从存量净值重算`, () => {
      const mdd = maxDrawdown(p.values)
      expect(round2(mdd.drawdown * 100)).toBe(p.max_drawdown.drawdown_pct)
      expect(mdd.peakIndex).toBe(p.max_drawdown.peak_index)
      expect(mdd.troughIndex).toBe(p.max_drawdown.trough_index)
      expect(round2(annualizedVolatility(periodReturns(p.values)) * 100)).toBe(p.volatility_annual_pct)
    })
  }

  it('钩子相关系数：从存量月收益率重算一致', () => {
    const ra = periodReturns(data.hook.asset_a.values)
    const rb = periodReturns(data.hook.asset_b.values)
    expect(correlation(ra, rb)).toBeCloseTo(data.hook.correlation, 2)
  })

  for (const v of data.correlation_lab.variants) {
    it(`实验台 ρ=${v.level}：样本相关系数精确等于档位，伙伴资产独自颠簸与甲相同`, () => {
      expect(v.sample_correlation).toBeCloseTo(v.level, 9)
      const ra = periodReturns(data.correlation_lab.base_asset.values)
      const rb = periodReturns(v.partner_values)
      expect(correlation(ra, rb)).toBeCloseTo(v.level, 2)
      const volJia = data.correlation_lab.base_asset.volatility_annual_pct
      expect(Math.abs(v.partner_volatility_annual_pct - volJia)).toBeLessThanOrEqual(0.1)
    })
    it(`实验台 ρ=${v.level}：组合波动率与最大回撤可由实现重算`, () => {
      const combo = v.combo
      expect(round2(annualizedVolatility(periodReturns(combo.values)) * 100)).toBe(combo.volatility_annual_pct)
      expect(round2(maxDrawdown(combo.values).drawdown * 100)).toBe(combo.max_drawdown.drawdown_pct)
    })
  }

  it('实验台：相关性越高组合越颠，五个档位单调不降', () => {
    const vols = data.correlation_lab.variants.map((v) => v.combo.volatility_annual_pct)
    for (let i = 1; i < vols.length; i += 1) {
      expect(vols[i] as number).toBeGreaterThanOrEqual((vols[i - 1] as number) - 0.005)
    }
  })

  it('实验台：两端差距巨大——ρ=+0.8 的组合波动至少是 ρ=−0.8 的两倍多', () => {
    const lo = data.correlation_lab.variants[0]!.combo.volatility_annual_pct
    const hi = data.correlation_lab.variants[4]!.combo.volatility_annual_pct
    expect(hi).toBeGreaterThan(lo * 2)
  })

  it('伪分散：丙丁相关 0.95，各半组合波动几乎没降（≥ 单只的 96%）', () => {
    const p = data.pseudo
    expect(p.correlation).toBeCloseTo(0.95, 9)
    const minVol = Math.min(p.stock_c.volatility_annual_pct, p.stock_d.volatility_annual_pct)
    expect(p.combo.volatility_annual_pct).toBeGreaterThan(minVol * 0.96)
    expect(p.combo.volatility_annual_pct).toBeLessThanOrEqual(minVol)
  })

  it('伪分散：组合最大回撤与单只几乎一样深（与钩子组合形成对照）', () => {
    const p = data.pseudo
    const minDd = Math.min(p.stock_c.max_drawdown.drawdown_pct, p.stock_d.max_drawdown.drawdown_pct)
    expect(p.combo.max_drawdown.drawdown_pct).toBeGreaterThanOrEqual(minDd - 5)
  })

  it('漂移：三年后股票占比明显越过目标，落到 68%–78% 之间', () => {
    const d = data.drift
    expect(d.end.stock_weight_pct).toBeGreaterThan(68)
    expect(d.end.stock_weight_pct).toBeLessThan(78)
  })

  it('漂移：再平衡交易额可由实现重算，拨回后恰为 60/40', () => {
    const d = data.drift
    const stockEnd = d.stock_sleeve_values[36] as number
    const bondEnd = d.bond_sleeve_values[36] as number
    const r = rebalanceTo(stockEnd, bondEnd, d.rebalance.target_stock_weight)
    expect(round2(r.tradeA)).toBe(d.rebalance.trade_stock_amount)
    expect(round2(r.afterA)).toBe(d.rebalance.after_stock_amount)
    expect(round2(r.afterB)).toBe(d.rebalance.after_bond_amount)
    expect(d.rebalance.after_stock_amount).toBeCloseTo(0.6 * (stockEnd + bondEnd), 0)
  })

  it('漂移：单边上行的行情里，每年再平衡的期末略低于放着不动——诚实对照成立', () => {
    const d = data.drift
    expect(d.annual_rebalance_total_values[36] as number).toBeLessThan(d.total_values[36] as number)
    expect(d.annual_rebalance_difference).toBe(
      round2((d.total_values[36] as number) - (d.annual_rebalance_total_values[36] as number)),
    )
  })
})
