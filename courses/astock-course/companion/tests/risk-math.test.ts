// companion/tests/risk-math.test.ts · 第 9 章 风险的数学：回撤/回本/波动率与数据集互锁
// 已知值断言锁 finance 三函数；buildCh09() 的导出数据用同一套实现重算互锁——
// 正文组件标注值（drawdown-paths.json）与公式结果必须一致，不允许平行手抄第二套数字。

import { describe, expect, it } from 'vitest'
import { annualizedVolatility, maxDrawdown, periodReturns, recoveryGain } from '../src/finance'
import { round2 } from '../src/round'
import { buildCh09 } from '../src/datasets/ch09-risk'
import type { Ch09Data } from '../src/datasets/ch09-risk'

describe('盈亏不对称：回本涨幅已知值', () => {
  it('亏 50% 要涨 100% 才回本（钩子那一笔）', () => {
    expect(recoveryGain(0.5)).toBe(1)
  })
  it('亏 10% 要涨 11.11%——小亏近似对称，直觉从这里来', () => {
    expect(recoveryGain(0.1)).toBeCloseTo(0.1111111, 6)
  })
  it('亏 30% 要涨 42.86%', () => {
    expect(recoveryGain(0.3)).toBeCloseTo(0.4285714, 6)
  })
  it('亏 70% 要涨 233.33%——深亏的代价按指数上涨', () => {
    expect(recoveryGain(0.7)).toBeCloseTo(2.3333333, 6)
  })
  it.each([0.05, 0.15, 0.3, 0.5, 0.62, 0.7])(
    '复利不变量：亏损 %d 后按回本涨幅乘回去，净值恰好回到 1',
    (loss) => {
      expect((1 - loss) * (1 + recoveryGain(loss))).toBeCloseTo(1, 12)
    },
  )
})

describe('最大回撤：峰到谷', () => {
  it('净值 1 → 1.2 → 0.6 → 0.9 → 1.1：峰在第 2 点、谷在第 3 点，回撤 50%', () => {
    const r = maxDrawdown([1, 1.2, 0.6, 0.9, 1.1])
    expect(r.drawdown).toBeCloseTo(0.5, 12)
    expect(r.peakIndex).toBe(1)
    expect(r.troughIndex).toBe(2)
  })
  it('更高的历史峰压住后面的谷：1 → 0.9 → 1.1 → 0.55 → 0.8', () => {
    const r = maxDrawdown([1, 0.9, 1.1, 0.55, 0.8])
    expect(r.drawdown).toBeCloseTo(0.5, 12)
    expect(r.peakIndex).toBe(2)
    expect(r.troughIndex).toBe(3)
  })
  it('峰值取历史最高点，不是最近的局部高点：1 → 1.5 → 1.2 → 1.4 → 0.7 回撤 53.33%', () => {
    const r = maxDrawdown([1, 1.5, 1.2, 1.4, 0.7])
    expect(r.drawdown).toBeCloseTo(0.8 / 1.5, 12)
    expect(r.peakIndex).toBe(1)
    expect(r.troughIndex).toBe(4)
  })
  it('一路上涨的路径没有回撤：drawdown 为 0', () => {
    expect(maxDrawdown([1, 1.1, 1.2]).drawdown).toBe(0)
  })
})

describe('波动率：月收益率标准差 ×√12（课程简化口径）', () => {
  it('逐期收益率：1 → 1.1 → 0.99 给出 +10%、−10%', () => {
    const rs = periodReturns([1, 1.1, 0.99])
    expect(rs[0]).toBeCloseTo(0.1, 12)
    expect(rs[1]).toBeCloseTo(-0.1, 12)
  })
  it('每月固定 +1%：涨跌不离均值，标准差为 0，年化波动率为 0（浮点残差内）', () => {
    expect(annualizedVolatility(Array(12).fill(0.01))).toBeCloseTo(0, 12)
  })
  it('±10% 交替：月标准差 10%，年化 √12×10% ≈ 34.64%', () => {
    expect(annualizedVolatility([0.1, -0.1, 0.1, -0.1])).toBeCloseTo(0.1 * Math.sqrt(12), 12)
  })
})

describe('数据集互锁：drawdown-paths.json 与实现重算一致', () => {
  const ds = buildCh09()
  const data = ds.data as unknown as Ch09Data

  it('导出文件名与三条路径、对照曲线齐备', () => {
    expect(ds.file).toBe('drawdown-paths.json')
    expect(data.paths).toHaveLength(3)
    expect(data.paths.map((p) => p.id)).toEqual(['shallow', 'halved', 'grinder'])
    expect(data.recovery_curve.highlights).toEqual([30, 50, 70])
  })

  for (const p of data.paths) {
    it(`路径 ${p.id}：回撤、峰谷、回本涨幅、年化波动率全部可由实现重算`, () => {
      const mdd = maxDrawdown(p.values)
      expect(round2(mdd.drawdown * 100)).toBe(p.max_drawdown.drawdown_pct)
      expect(mdd.peakIndex).toBe(p.max_drawdown.peak_index)
      expect(mdd.troughIndex).toBe(p.max_drawdown.trough_index)
      expect(round2(recoveryGain(mdd.drawdown) * 100)).toBe(p.max_drawdown.recovery_gain_pct)
      expect(
        round2(annualizedVolatility(periodReturns(p.values)) * 100),
      ).toBe(p.volatility_annual_pct)
    })
  }

  it('对照曲线：每个亏损档位的回本涨幅都等于 recoveryGain(loss)', () => {
    for (const c of data.recovery_curve.curve) {
      expect(round2(recoveryGain(c.loss_pct / 100) * 100)).toBe(c.recovery_pct)
    }
  })

  it('慢磨路径的年化波动率低于浅回撤路径，最大回撤却更深——两个尺子量不同的东西', () => {
    const shallow = data.paths.find((p) => p.id === 'shallow')
    const grinder = data.paths.find((p) => p.id === 'grinder')
    if (!shallow || !grinder) throw new Error('缺少 shallow/grinder 路径')
    expect(grinder.volatility_annual_pct).toBeLessThan(shallow.volatility_annual_pct)
    expect(grinder.max_drawdown.drawdown_pct).toBeGreaterThan(shallow.max_drawdown.drawdown_pct)
  })
})
