// companion/tests/price-trend.test.ts · 价格走势图纯逻辑（固定输入，无网络无时间无随机源）
import { describe, expect, it } from 'vitest'
import {
  type ChartScales,
  type PricePoint,
  buildAreaPath,
  buildLinePath,
  buildSmoothPath,
  computeScales,
  dayToLabel,
  findNearestPoint,
  formatSignedPct,
  formatYuan,
  generateMarketHistory,
  generatePriceHistory,
  generateVolume,
  localExtremes,
  movingAverage,
  niceTicks,
  summarizeRange,
  xTickIndices,
} from '../app/utils/price-trend'

// 手工构造的坐标换算：x = day×10，y = 1000−cents——期望值可以手算，不依赖实现
const fakeScales: ChartScales = {
  minCents: 0,
  maxCents: 1000,
  plotLeft: 0,
  plotRight: 100,
  plotTop: 0,
  plotBottom: 100,
  x: (day) => day * 10,
  y: (cents) => 1000 - cents,
}

const P = (day: number, priceCents: number): PricePoint => ({ day, priceCents })

describe('走势生成（确定性）', () => {
  it('同一商品两次生成逐点相等，不同商品得到不同走势', () => {
    const a1 = generatePriceHistory(1, 129)
    const a2 = generatePriceHistory(1, 129)
    expect(a1).toEqual(a2)
    expect(a1).not.toEqual(generatePriceHistory(2, 129))
  })

  it('默认 365 个点，价格为整数分且夹在基准价 0.55~1.7 倍之间', () => {
    const pts = generatePriceHistory(1, 129)
    expect(pts).toHaveLength(365)
    for (const p of pts) {
      expect(Number.isInteger(p.priceCents)).toBe(true)
      expect(p.priceCents).toBeGreaterThanOrEqual(Math.round(12900 * 0.55))
      expect(p.priceCents).toBeLessThanOrEqual(Math.round(12900 * 1.7))
    }
  })

  it('市场参考走势同样确定，且与同基准价的单品走势不同', () => {
    const m1 = generateMarketHistory('雨具', 129)
    const m2 = generateMarketHistory('雨具', 129)
    expect(m1).toEqual(m2)
    expect(m1).not.toEqual(generatePriceHistory(1, 129))
    expect(generateMarketHistory('厨房', 129)).not.toEqual(m1)
  })

  it('销量序列确定，且每个值落在 [40, 260] 件', () => {
    const v1 = generateVolume(1)
    const v2 = generateVolume(1)
    expect(v1).toEqual(v2)
    expect(v1).toHaveLength(365)
    for (const v of v1) {
      expect(v.volume).toBeGreaterThanOrEqual(40)
      expect(v.volume).toBeLessThanOrEqual(260)
    }
  })
})

describe('坐标与刻度', () => {
  it('computeScales：值域两端各留 10% 呼吸空间，x/y 按线性映射', () => {
    const pts = [P(0, 100), P(10, 300), P(20, 200)]
    const s = computeScales(pts, {
      width: 220,
      height: 100,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
    })
    expect(s.minCents).toBe(80) // 100 − (300−100)×0.1
    expect(s.maxCents).toBe(320) // 300 + 20
    expect(s.x(10)).toBe(110) // 中点天数 → 220 的一半
    expect(s.y(300)).toBeCloseTo((320 - 300) / 240 * 100, 5)
    expect(s.y(100)).toBeCloseTo((320 - 100) / 240 * 100, 5)
    expect(s.plotRight).toBe(220)
    expect(s.plotBottom).toBe(100)
  })

  it('niceTicks：步长规整到 25，落在区间内', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(9600, 20400, 4)).toEqual([10000, 15000, 20000])
  })

  it('xTickIndices：首尾必取、均匀分布、去重', () => {
    expect(xTickIndices(10, 5)).toEqual([0, 2, 5, 7, 9])
    expect(xTickIndices(3, 5)).toEqual([0, 1, 2])
    expect(xTickIndices(1, 5)).toEqual([0])
  })
})

describe('路径构建（固定手算期望）', () => {
  const pts = [P(1, 900), P(2, 800), P(3, 950)]

  it('折线路径：M 起点后一路 L，坐标取 1 位小数', () => {
    expect(buildLinePath(pts, fakeScales)).toBe('M 10 100 L 20 200 L 30 50')
  })

  it('平滑路径：Catmull-Rom 转三次贝塞尔，过每个数据点', () => {
    expect(buildSmoothPath(pts, fakeScales)).toBe(
      'M 10 100 C 11.7 116.7 16.7 208.3 20 200 C 23.3 191.7 28.3 75 30 50',
    )
  })

  it('面积路径：平滑曲线沿绘图底边闭合', () => {
    expect(buildAreaPath(pts, fakeScales).endsWith('L 30 100 L 10 100 Z')).toBe(true)
  })

  it('移动平均：与输入逐位对齐，前 window−1 位为 null', () => {
    const ma = movingAverage([P(0, 10), P(1, 20), P(2, 30), P(3, 40)], 2)
    expect(ma).toEqual([null, 15, 25, 35])
  })
})

describe('悬浮命中（最邻近点）', () => {
  // x(day) = day×10：三个点落在 x = 0 / 100 / 200
  const pts = [P(0, 100), P(10, 300), P(20, 200)]

  it('命中距离最近的数据点', () => {
    expect(findNearestPoint(pts, 95, fakeScales)).toBe(1)
    expect(findNearestPoint(pts, 130, fakeScales)).toBe(1)
    expect(findNearestPoint(pts, 199, fakeScales)).toBe(2)
  })

  it('等距平局取左侧', () => {
    expect(findNearestPoint(pts, 50, fakeScales)).toBe(0)
    expect(findNearestPoint(pts, 150, fakeScales)).toBe(1)
  })

  it('越界输入自然夹到首尾', () => {
    expect(findNearestPoint(pts, -30, fakeScales)).toBe(0)
    expect(findNearestPoint(pts, 999, fakeScales)).toBe(2)
  })
})

describe('汇总与格式化', () => {
  it('区间极值：并列取先出现者', () => {
    expect(localExtremes([P(0, 300), P(1, 100), P(2, 200)])).toEqual({
      high: P(0, 300),
      low: P(1, 100),
    })
  })

  it('区间汇总：涨跌与年化波动按公式可复算', () => {
    const s = summarizeRange([P(0, 100), P(1, 150), P(2, 120)])
    expect(s.highCents).toBe(150)
    expect(s.lowCents).toBe(100)
    expect(s.changePct).toBe(20)
    // 日收益率 [0.5, −0.2]：均值 0.15、方差 0.1225 → √(0.1225×365)×100
    expect(s.annualVolatilityPct).toBe(Math.round(Math.sqrt(0.1225 * 365) * 100 * 10) / 10)
  })

  it('日期标签：固定起点 + 整数天，跨月跨年正确', () => {
    expect(dayToLabel(0)).toBe('2025-01-01')
    expect(dayToLabel(31)).toBe('2025-02-01')
    expect(dayToLabel(364)).toBe('2025-12-31')
  })

  it('金额与百分比：千分位分组与符号', () => {
    expect(formatYuan(123456)).toBe('¥1,234.56')
    expect(formatYuan(12900)).toBe('¥129.00')
    expect(formatSignedPct(1.234)).toBe('+1.23%')
    expect(formatSignedPct(-0.5)).toBe('-0.50%')
    expect(formatSignedPct(0)).toBe('0.00%')
  })
})
