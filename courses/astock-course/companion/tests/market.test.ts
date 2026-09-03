// companion/tests/market.test.ts · 第 4 章 合成行情：教学特征、已知值与数据集导出互相锁定
// 金标值（D1 / D36 / D37 的四价与量）来自固定种子生成器的实际输出，
// 任何参数改动若破坏这些值或教学特征，对应测试即红。

import { describe, expect, it } from 'vitest'
import { buildCh04 } from '../src/datasets/ch04-kline'
import {
  CANDLE_COUNT,
  HIDDEN_COUNT,
  VISIBLE_COUNT,
  bodyOf,
  generateDailyCandles,
  isYang,
  longestStreak,
  lowerShadowOf,
  maxVolumeDay,
  medianVolume,
  upperShadowOf,
  type Candle,
} from '../src/market'

const candles = generateDailyCandles()
const at = (n: number): Candle => candles[n - 1] as Candle

describe('生成器：确定性与形状', () => {
  it('同种子两次生成，逐根逐字段一致', () => {
    const again = generateDailyCandles()
    expect(again).toEqual(candles)
  })

  it(`共 ${CANDLE_COUNT} 根，日标签 D1…D60；前 ${VISIBLE_COUNT} 根可见、后 ${HIDDEN_COUNT} 根待揭晓`, () => {
    expect(candles).toHaveLength(CANDLE_COUNT)
    expect(at(1).day).toBe('D1')
    expect(at(CANDLE_COUNT).day).toBe(`D${CANDLE_COUNT}`)
    expect(candles[VISIBLE_COUNT - 1]?.day).toBe('D40')
    expect(candles[VISIBLE_COUNT]?.day).toBe('D41')
  })

  it('每根蜡烛 OHLC 大小关系成立，且全天不出主板 ±10% 涨跌幅约束', () => {
    for (let i = 0; i < candles.length; i += 1) {
      const c = candles[i] as Candle
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.volume).toBeGreaterThan(0)
      if (i > 0) {
        const prev = candles[i - 1] as Candle
        expect(c.high).toBeLessThanOrEqual(Math.round(prev.close * 1.1 * 100) / 100)
        expect(c.low).toBeGreaterThanOrEqual(Math.round(prev.close * 0.9 * 100) / 100)
      }
    }
  })
})

describe('教学特征：剧情保证可教，测试锁死', () => {
  it('至少一根长上影：上影 ≥ 当日收盘的 2%，且 ≥ 实体的 2 倍（D19 冲高回落）', () => {
    const hit = candles.some(
      (c) => upperShadowOf(c) >= 0.02 * c.close && upperShadowOf(c) >= 2 * Math.abs(bodyOf(c)),
    )
    expect(hit).toBe(true)
  })

  it('至少一根长下影：下影 ≥ 当日收盘的 2%，且 ≥ 实体的 2 倍（D30 探底回升）', () => {
    const hit = candles.some(
      (c) => lowerShadowOf(c) >= 0.02 * c.close && lowerShadowOf(c) >= 2 * Math.abs(bodyOf(c)),
    )
    expect(hit).toBe(true)
  })

  it('至少一根放量大阳：阳线、实体 ≥ 3%、量能 ≥ 中位数 2.2 倍', () => {
    const med = medianVolume(candles)
    const hit = candles.some(
      (c) => isYang(c) && bodyOf(c) >= 0.03 * c.open && c.volume >= 2.2 * med,
    )
    expect(hit).toBe(true)
  })

  it('至少一根缩量小阴：阴线、实体 ≤ 0.8%、量能 ≤ 中位数 0.6 倍', () => {
    const med = medianVolume(candles)
    const hit = candles.some(
      (c) => !isYang(c) && Math.abs(bodyOf(c)) <= 0.008 * c.open && c.volume <= 0.6 * med,
    )
    expect(hit).toBe(true)
  })

  it('有一段连续阳线与一段连续阴线，各不少于 4 根', () => {
    expect(longestStreak(candles, true).length).toBeGreaterThanOrEqual(4)
    expect(longestStreak(candles, false).length).toBeGreaterThanOrEqual(4)
  })

  it('全天量能最大的一天是 D36（放量大阳日）', () => {
    expect(maxVolumeDay(candles)).toBe(36)
  })

  it('钩子对照成立：D36 与 D37 实体几乎同款（差 ≤ 0.02 元），量能差 ≥ 5 倍', () => {
    const d36 = at(36)
    const d37 = at(37)
    expect(d36.close).toBeGreaterThan(d36.open)
    expect(d37.close).toBeGreaterThan(d37.open)
    expect(Math.abs(bodyOf(d36) - bodyOf(d37))).toBeLessThanOrEqual(0.02)
    expect(d36.volume / d37.volume).toBeGreaterThanOrEqual(5)
  })
})

describe('已知值：固定种子下的金标（防参数漂移）', () => {
  it('D1 的四价与量', () => {
    expect(at(1)).toEqual({ day: 'D1', open: 9.98, close: 9.99, high: 10.34, low: 9.76, volume: 71204 })
  })

  it('D36 放量大阳的四价与量', () => {
    expect(at(36)).toEqual({ day: 'D36', open: 10.33, close: 10.76, high: 10.83, low: 10.32, volume: 279173 })
  })

  it('D37 缩量大阳的四价与量', () => {
    expect(at(37)).toEqual({ day: 'D37', open: 10.82, close: 11.26, high: 11.31, low: 10.77, volume: 27381 })
  })

  it('定向破坏日 D31：收盘低于开盘（阴线）但高于昨收', () => {
    const d31 = at(31)
    expect(d31.open).toBeGreaterThan(d31.close)
    expect(d31.close).toBeGreaterThan(at(30).close)
  })
})

describe('读图辅助函数：手工样本对照', () => {
  it('实体与两影线的几何：O10 H10.8 L9.9 C10.5 → 实体 0.5 / 上影 0.3 / 下影 0.1，阳线', () => {
    const c: Candle = { day: 'DX', open: 10, close: 10.5, high: 10.8, low: 9.9, volume: 100 }
    expect(isYang(c)).toBe(true)
    expect(bodyOf(c)).toBe(0.5)
    expect(upperShadowOf(c)).toBe(0.3)
    expect(lowerShadowOf(c)).toBe(0.1)
  })
})

describe('数据集 kline-demo.json：与生成器互锁', () => {
  const { file, data } = buildCh04()
  interface KlineData {
    meta: { seed: number; total: number; visible: number; hidden: number; generator: string }
    candles: Candle[]
    features: {
      yang_streak: { length: number; days: string }
      yin_streak: { length: number; days: string }
      max_volume_day: { day: string }
    }
    worksheet: {
      volume_median_lots: number
      yang_days: number
      yang_next_day_down: number
      hook_pair: { heavy: { volume: number }; light: { volume: number }; volume_ratio_heavy_to_light: number }
    }
  }
  const parsed = data as unknown as KlineData

  it('文件名与元数据', () => {
    expect(file).toBe('kline-demo.json')
    expect(parsed.meta).toMatchObject({ seed: 42, total: 60, visible: 40, hidden: 20 })
    expect(parsed.meta.generator).toContain('market.ts')
  })

  it('candles 与生成器输出逐根一致（组件消费的就是这套数据）', () => {
    expect(parsed.candles).toEqual(candles)
  })

  it('worksheet 承重数字与市场实现一致', () => {
    expect(parsed.worksheet.volume_median_lots).toBe(medianVolume(candles))
    expect(parsed.features.yang_streak).toMatchObject({ days: 'D12–D19', length: 8 })
    expect(parsed.features.yin_streak).toMatchObject({ days: 'D20–D29', length: 10 })
    expect(parsed.features.max_volume_day.day).toBe('D36')
    expect(parsed.worksheet.yang_days).toBe(29)
    expect(parsed.worksheet.yang_next_day_down).toBe(8)
    expect(parsed.worksheet.hook_pair.heavy.volume).toBe(279173)
    expect(parsed.worksheet.hook_pair.light.volume).toBe(27381)
    expect(parsed.worksheet.hook_pair.volume_ratio_heavy_to_light).toBeCloseTo(10.2, 1)
  })
})
