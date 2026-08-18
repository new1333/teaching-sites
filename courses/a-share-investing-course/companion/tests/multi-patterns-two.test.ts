import { describe, expect, it } from 'vitest'
import { detectTwoCandle, type TwoCandlePattern } from '../src/patterns/two'
import { createRng, generateCandles } from '../src/data/generate'
import type { Candle } from '../src/types'

/**
 * 双根组合形态的行为断言：只喂 K 线序列，只看返回的形态列表（类型、完成日、方向、背景）。
 * 全章核心命题在这里受审：
 * 1. 九种形态各归各位——吞没（看涨/看跌）、乌云盖顶、刺透、孕线（看涨/看跌）、十字孕线、平顶、平底；
 * 2. 乌云盖顶与刺透的「昨天实体中点」是硬边界：收在中点这一分不差的位置上，两个都不判；
 * 3. 形状接近的干扰序列（差一点到中点、实体一样大、一头露在孕线外、高点差一截）不误报；
 * 4. 与第 5 章同一条规矩：背景 flat 不命名——没有趋势，就没有「反转」可言。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-05-01',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 由一串收盘价手搓背景行情：开=昨收，高=两者较大者+0.02，低=较小者−0.02（每根振幅=涨跌幅+0.04） */
const seriesFromCloses = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return c(open, Math.max(open, close) + 0.02, Math.min(open, close) - 0.02, close, `2026-05-${String(i + 1).padStart(2, '0')}`)
  })

// 每天约 −2% 的下跌背景：每根振幅都是 0.44（形态植入在第 9、10 根，参照振幅 = 0.44）
const FALLING = seriesFromCloses([20, 19.6, 19.2, 18.8, 18.4, 18, 17.6, 17.2])
// 每天约 +2% 的上涨背景：每根振幅都是 0.14
const RISING = seriesFromCloses([5, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7])
// 围绕 10 元小幅晃动的横盘背景：窗口涨跌幅远小于 5%，判 flat
const FLAT = seriesFromCloses([10, 10.02, 9.99, 10.01, 10.0, 10.02, 9.99, 10.0])

const hit = (id: TwoCandlePattern['id'], index: number, direction: 'bull' | 'bear', position: string): TwoCandlePattern =>
  ({ id, index, direction, position } as TwoCandlePattern)

describe('吞没：今天的实体把昨天的实体整个包住', () => {
  it('下跌后大阳线包住昨天大阴实体：看涨吞没，方向偏多', () => {
    const prev = c(17.2, 17.25, 15.9, 16.0) // 大阴：实体 [16.0, 17.2]
    const cur = c(15.8, 17.4, 15.7, 17.3) // 大阳：实体 [15.8, 17.3]，两头都严格越过
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([hit('bullish-engulfing', 9, 'bull', 'falling')])
  })

  it('上涨后大阴线包住昨天大阳实体：看跌吞没，方向偏空', () => {
    const prev = c(5.7, 7.0, 5.65, 6.9) // 大阳：实体 [5.7, 6.9]
    const cur = c(7.0, 7.05, 5.5, 5.6) // 大阴：实体 [5.6, 7.0]
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([hit('bearish-engulfing', 9, 'bear', 'rising')])
  })

  it('两根实体一模一样（没有任何一头严格越过）：不算吞没', () => {
    const prev = c(5.7, 6.95, 5.65, 6.9)
    const cur = c(6.9, 7.0, 5.65, 5.7) // 实体仍为 [5.7, 6.9]，只是换了个方向
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([])
  })
})

describe('乌云盖顶与刺透：收进昨天实体、越过它的中点', () => {
  // 实体 [5.75, 6.25]，中点恰为 6.00（取四分之一元，中点计算无浮点误差）
  const YANG_QUARTER = c(5.75, 6.3, 5.7, 6.25)
  // 实体 [8.75, 9.25]，中点恰为 9.00
  const YIN_QUARTER = c(9.25, 9.3, 8.7, 8.75)

  it('上涨后高开阴线收在昨天阳线中点之下：乌云盖顶', () => {
    const cur = c(6.5, 6.55, 5.9, 5.99) // 高开 6.5 > 昨收 6.25，收 5.99 越过中点 6.00
    expect(detectTwoCandle([...RISING, YANG_QUARTER, cur])).toEqual([hit('dark-cloud-cover', 9, 'bear', 'rising')])
  })

  it('乌云盖顶的中点边界：收 6.01（中点之上）与收 6.00（恰好压在中点上）都不判，收 5.99 才判', () => {
    const above = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.95, 6.01)])
    expect(above).toEqual([])
    const exact = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.9, 6.0)])
    expect(exact).toEqual([])
    const below = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.9, 5.99)])
    expect(below).toEqual([hit('dark-cloud-cover', 9, 'bear', 'rising')])
  })

  it('高开阴线但收在中点之上（差一点点到乌云盖顶）：不误报', () => {
    const prev = c(5.7, 6.95, 5.65, 6.9) // 实体 [5.7, 6.9]，中点 6.3
    const cur = c(7.0, 7.05, 6.2, 6.35) // 高开、收阴，但收 6.35 > 中点 6.3
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([])
  })

  it('下跌后低开阳线收在昨天阴线中点之上：刺透形态', () => {
    const prev = c(17.2, 17.25, 15.9, 16.0) // 大阴：实体 [16.0, 17.2]，中点 16.6
    const cur = c(15.9, 16.75, 15.8, 16.7) // 低开 15.9 < 昨收 16.0，收 16.7 越过中点
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([hit('piercing', 9, 'bull', 'falling')])
  })

  it('刺透的中点边界：收 9.01 判、收 9.00（恰好压在中点上）与收 8.99 都不判', () => {
    const base = seriesFromCloses([12, 11.6, 11.2, 10.8, 10.4, 10.0, 9.6, 9.2])
    const mk = (close: number): Candle[] => [...base, YIN_QUARTER, c(8.7, 9.06, 8.65, close)]
    expect(detectTwoCandle(mk(9.01))).toEqual([hit('piercing', 9, 'bull', 'falling')])
    expect(detectTwoCandle(mk(9.0))).toEqual([])
    expect(detectTwoCandle(mk(8.99))).toEqual([])
  })
})

describe('孕线与十字孕线：今天缩在昨天的实体之内', () => {
  it('下跌后大阴接小阳（缩在内、实体不到昨天三分之一）：看涨孕线', () => {
    const prev = c(17.2, 17.25, 15.9, 16.0) // 大阴：实体 1.2，占振幅 0.889
    const cur = c(16.5, 16.95, 16.45, 16.85) // 小阳：实体 0.35，[16.5, 16.85] 缩在 [16.0, 17.2] 之内
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([hit('bullish-harami', 9, 'bull', 'falling')])
  })

  it('上涨后大阳接小阴：看跌孕线', () => {
    const prev = c(5.7, 6.95, 5.65, 6.9) // 大阳：实体 1.2
    const cur = c(6.45, 6.5, 6.0, 6.1) // 小阴：实体 0.35，[6.1, 6.45] 缩在 [5.7, 6.9] 之内
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([hit('bearish-harami', 9, 'bear', 'rising')])
  })

  it('缩在内但实体占昨天的近四成（收缩不够明显）：不判孕线', () => {
    const prev = c(17.2, 17.25, 15.9, 16.0) // 实体 1.2，三分之一是 0.4
    const cur = c(16.1, 16.7, 16.05, 16.55) // 实体 0.45 > 0.4，虽然完全缩在内
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([])
  })

  it('上涨后大阳接缩在内的十字：十字孕线，倾向偏空（待次日确认）', () => {
    const prev = c(5.7, 6.95, 5.65, 6.9) // 大阳
    const cur = c(6.3, 6.5, 6.1, 6.3) // 十字：开=收 6.3，缩在 (5.7, 6.9) 之内
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([hit('doji-harami', 9, 'bear', 'rising')])
  })

  it('同一根十字孕线：下跌背景倾向偏多，上涨背景倾向偏空——背景换，倾向换', () => {
    const prevYin = c(17.2, 17.25, 15.9, 16.0) // 大阴
    const doji = c(16.6, 16.8, 16.4, 16.6) // 十字缩在 (16.0, 17.2) 之内
    expect(detectTwoCandle([...FALLING, prevYin, doji])).toEqual([hit('doji-harami', 9, 'bull', 'falling')])
  })

  it('干扰：小实体一头露在昨天实体外（低开阳线又收不到中点）：既非孕线也非刺透', () => {
    const prev = c(17.2, 17.25, 15.9, 16.0) // 实体 [16.0, 17.2]，中点 16.6
    const cur = c(15.9, 16.6, 15.85, 16.5) // 实体底 15.9 露在 16.0 之外；收 16.5 又没过中点
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([])
  })
})

describe('平顶与平底：两次测试同一个价位', () => {
  it('上涨后两根高点只差一分钱：平顶', () => {
    const prev = c(5.7, 6.35, 5.65, 6.25) // 高点 6.35
    const cur = c(6.2, 6.34, 5.9, 5.95) // 高点 6.34，差 0.01，在参照振幅 0.14 的一成以内
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([hit('tweezer-top', 9, 'bear', 'rising')])
  })

  it('下跌后两根低点只差两分钱：平底', () => {
    const prev = c(17.2, 17.6, 16.4, 16.5) // 低点 16.4
    const cur = c(16.45, 16.9, 16.42, 16.8) // 低点 16.42，差 0.02，在参照振幅 0.44 的一成以内
    expect(detectTwoCandle([...FALLING, prev, cur])).toEqual([hit('tweezer-bottom', 9, 'bull', 'falling')])
  })

  it('干扰：两根高点差了一截（超过参照振幅的一成）：不判平顶', () => {
    const prev = c(5.7, 6.35, 5.65, 6.25) // 高点 6.35
    const cur = c(6.2, 6.2, 5.9, 5.95) // 高点 6.2，差 0.15 > 0.014
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([])
  })

  it('形态判据彼此独立：高开阴线越中点且高点几乎相同，乌云盖顶与平顶同日并存', () => {
    const prev = c(5.7, 6.35, 5.65, 6.25) // 中点 6.0，高点 6.35
    const cur = c(6.3, 6.36, 5.9, 5.95) // 高开越昨收、收 5.95 过中点；高点差 0.01
    const hits = detectTwoCandle([...RISING, prev, cur])
    expect(hits).toHaveLength(2)
    expect(hits).toContainEqual(hit('dark-cloud-cover', 9, 'bear', 'rising'))
    expect(hits).toContainEqual(hit('tweezer-top', 9, 'bear', 'rising'))
  })
})

describe('背景与扫描范围', () => {
  it('横盘背景下即使走出教科书级吞没形状也不命名：没有趋势，就没有反转', () => {
    const prev = c(10.0, 10.05, 8.7, 8.8) // 大阴
    const cur = c(8.6, 10.4, 8.5, 10.3) // 大阳整个包住
    expect(detectTwoCandle([...FLAT, prev, cur])).toEqual([])
  })

  it('纯阴跌背景整段扫过：零误报', () => {
    expect(detectTwoCandle(FALLING)).toEqual([])
    expect(detectTwoCandle(RISING)).toEqual([])
  })

  it('合成随机行情全序列扫描：每个命中都有完整背景窗口，且同一完成日不重复报同一形态', () => {
    const hits = detectTwoCandle(generateCandles(createRng(707), { days: 120, startPrice: 10 }))
    for (const h of hits) expect(h.index).toBeGreaterThanOrEqual(6)
    const keys = new Set(hits.map((h) => `${h.id}@${h.index}`))
    expect(keys.size).toBe(hits.length)
  })

  it('序列太短放不满背景窗口：返回空列表而不是报错', () => {
    expect(detectTwoCandle(FALLING.slice(0, 6))).toEqual([])
  })

  it('空数组、非数组、含 NaN 的 K 线：抛中文错误', () => {
    expect(() => detectTwoCandle([])).toThrow()
    expect(() => detectTwoCandle('不是数组' as unknown as Candle[])).toThrow()
    expect(() => detectTwoCandle([...FALLING, c(NaN, 17.2, 16, 16.5)])).toThrow()
  })
})
