import { describe, expect, it } from 'vitest'
import { detectThreeCandle, type ThreeCandlePattern } from '../src/patterns/three'
import { createRng, generateCandles } from '../src/data/generate'
import type { Candle } from '../src/types'

/**
 * 三根以上组合形态的行为断言：只喂 K 线序列，只看返回的形态列表（类型、完成日、方向、背景、确认状态）。
 * 全章核心命题在这里受审：
 * 1. 七种形态各归各位——早晨之星、黄昏之星、红三兵、红三兵受阻、黑三鸦、上升三法、下降三法（后两种五根）；
 * 2. 晨星/暮星的确认机制有数值标准：第三根收复第一根实体中点是硬判据（压线不判），
 *    第三根量能不足（低于前两根较大者的 1.2 倍）则形态照判、降级为「未确认」；
 * 3. 形状接近的干扰序列（收复差一分、星线与第一根实体重叠、跳空抢跑的三兵、出框的三法中间根）不误报；
 * 4. 背景门分两档：反转（晨星/暮星）与中继（三法）沿用老规矩——flat 不命名；
 *    推进（三兵/三鸦/受阻）不设背景门——三根同向推进就是自己的语境。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-05-01',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 由一串收盘价手搓背景行情：开=昨收，高=两者较大者+0.02，低=较小者−0.02 */
const seriesFromCloses = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return c(open, Math.max(open, close) + 0.02, Math.min(open, close) - 0.02, close, `2026-05-${String(i + 1).padStart(2, '0')}`)
  })

// 下跌背景（掺两根反抽：背景段自身不许走出黑三鸦——识别器连背景一起扫）
const FALLING = seriesFromCloses([20, 19.2, 19.3, 18.3, 18.4, 17.4, 17.5, 16.2])
// 上涨背景（掺两根回踩：同理，背景段自身不许走出红三兵）
const RISING = seriesFromCloses([5, 5.8, 5.7, 6.7, 6.6, 7.6, 7.5, 8.6])
// 围绕 10 元小幅晃动的横盘背景：窗口涨跌幅远小于 5%，判 flat
const FLAT = seriesFromCloses([10, 10.02, 9.99, 10.01, 10.0, 10.02, 9.99, 10.0])

const hit = (
  id: ThreeCandlePattern['id'],
  index: number,
  direction: 'bull' | 'bear',
  position: string,
  confirmed?: boolean,
): ThreeCandlePattern => ({ id, index, direction, position, confirmed } as ThreeCandlePattern)

// —— 晨星样本：第一根大阴实体 [16.0, 17.0]，中点 16.5（取半元，浮点数里精确）——
const MS_FIRST = c(17.0, 17.05, 15.9, 16.0, '2026-06-01', 130000)
const MS_STAR = c(15.8, 15.9, 15.4, 15.5, '2026-06-02', 90000) // 星线：实体 [15.5, 15.8] 悬在第一根实体之下
const MS_THIRD = c(15.6, 17.1, 15.5, 16.8, '2026-06-03', 200000) // 收 16.8，收复第一根实体 80%

// —— 暮星样本：第一根大阳实体 [5.7, 6.9]，中点 6.3 ——
const ES_FIRST = c(5.7, 6.95, 5.65, 6.9, '2026-06-01', 130000)
const ES_STAR = c(7.0, 7.35, 6.95, 7.3, '2026-06-02', 90000) // 星线：实体 [7.0, 7.3] 悬在第一根实体之上
const ES_THIRD = c(7.25, 7.3, 5.6, 5.7, '2026-06-03', 200000) // 收 5.7，失守中点

// —— 红三兵样本：三根饱满阳线，开盘逐根嵌在前根实体内 ——
const S1 = c(10.0, 10.6, 9.95, 10.5, '2026-06-01', 100000) // 实体 [10.0, 10.5]
const S2 = c(10.3, 10.95, 10.25, 10.85, '2026-06-02', 120000) // 开盘 10.3 嵌在 S1 实体内
const S3 = c(10.7, 11.3, 10.65, 11.2, '2026-06-03', 140000) // 开盘 10.7 嵌在 S2 实体内

// —— 三法样本（五根）：第一根大实体立框，中间三根缩在框内回撤，第五根大实体收回去 ——
const R3_BIG = c(5.7, 7.0, 5.65, 6.9, '2026-06-01', 160000) // 大阳：实体 [5.7, 6.9]，振幅框 [5.65, 7.0]
const R3_M1 = c(6.8, 6.95, 6.5, 6.6, '2026-06-02', 50000) // 缩在框内、收在 6.9 之下
const R3_M2 = c(6.6, 6.7, 6.25, 6.4, '2026-06-03', 45000)
const R3_M3 = c(6.4, 6.5, 6.05, 6.2, '2026-06-04', 40000)
const R3_FIFTH = c(6.35, 7.15, 6.3, 7.05, '2026-06-05', 170000) // 大阳收 7.05 > 6.9，收回新高

const F3_BIG = c(17.0, 17.05, 15.9, 16.0, '2026-06-01', 160000) // 大阴：实体 [16.0, 17.0]，振幅框 [15.9, 17.05]
const F3_N1 = c(16.1, 16.55, 16.05, 16.35, '2026-06-02', 50000) // 缩在框内、收在 16.0 之上
const F3_N2 = c(16.4, 16.8, 16.35, 16.6, '2026-06-03', 45000)
const F3_N3 = c(16.65, 17.0, 16.6, 16.85, '2026-06-04', 40000)
const F3_FIFTH = c(16.8, 16.85, 15.7, 15.8, '2026-06-05', 170000) // 大阴收 15.8 < 16.0，杀回新低

describe('早晨之星：三幕反转剧', () => {
  it('下跌后大阴+悬空星线+收过中点的放量阳线：早晨之星（已确认）', () => {
    expect(detectThreeCandle([...FALLING, MS_FIRST, MS_STAR, MS_THIRD])).toEqual([
      hit('morning-star', 10, 'bull', 'falling', true),
    ])
  })

  it('同一组价格、第三根量能不足：形态照判，但降级为「未确认」', () => {
    const weak = { ...MS_THIRD, volume: 100000 } // 10 万 < 前两根较大者 13 万的 1.2 倍
    expect(detectThreeCandle([...FALLING, MS_FIRST, MS_STAR, weak])).toEqual([
      hit('morning-star', 10, 'bull', 'falling', false),
    ])
  })

  it('第三根收复幅度的硬边界：收 16.51 判、收 16.50（恰好压在中点上）与 16.49 都不判', () => {
    const mk = (close: number) => detectThreeCandle([...FALLING, MS_FIRST, MS_STAR, { ...MS_THIRD, close }])
    expect(mk(16.51)).toEqual([hit('morning-star', 10, 'bull', 'falling', true)])
    expect(mk(16.5)).toEqual([])
    expect(mk(16.49)).toEqual([])
  })

  it('干扰：星线实体与第一根实体重叠（没有脱离战场）：不算晨星', () => {
    const star = c(16.3, 16.5, 15.9, 16.1, '2026-06-02', 90000) // 实体 [16.1, 16.3] 与 [16.0, 17.0] 重叠
    expect(detectThreeCandle([...FALLING, MS_FIRST, star, MS_THIRD])).toEqual([])
  })
})

describe('黄昏之星：晨星的镜像', () => {
  it('上涨后大阳+悬空星线+失守中点的放量阴线：黄昏之星（已确认）', () => {
    expect(detectThreeCandle([...RISING, ES_FIRST, ES_STAR, ES_THIRD])).toEqual([
      hit('evening-star', 10, 'bear', 'rising', true),
    ])
  })

  it('第三根量能不足：降级为「未确认」', () => {
    const weak = { ...ES_THIRD, volume: 110000 } // 11 万 < 13 万的 1.2 倍
    expect(detectThreeCandle([...RISING, ES_FIRST, ES_STAR, weak])).toEqual([
      hit('evening-star', 10, 'bear', 'rising', false),
    ])
  })
})

describe('红三兵：三连推进', () => {
  it('三根饱满阳线、开盘嵌在前根实体内、收盘逐根抬高：红三兵（横盘里照样命名——推进形态不设背景门）', () => {
    expect(detectThreeCandle([...FLAT, S1, S2, S3])).toEqual([hit('three-white-soldiers', 10, 'bull', 'flat')])
  })

  it('同一组数字在上涨背景里同样判：背景只被如实报告，不拦', () => {
    expect(detectThreeCandle([...RISING, S1, S2, S3])).toEqual([hit('three-white-soldiers', 10, 'bull', 'rising')])
  })

  it('第三根开盘跳到前根实体之下（跳空低开抢跑）：不算红三兵', () => {
    const s3 = c(10.2, 11.3, 10.15, 11.2, '2026-06-03', 140000) // 开盘 10.2 低于 S2 实体底 10.3
    expect(detectThreeCandle([...FLAT, S1, S2, s3])).toEqual([])
  })

  it('中间一根实体太瘦（占振幅 0.45）：不算红三兵', () => {
    const s2 = c(10.3, 10.75, 10.2, 10.55, '2026-06-02', 120000) // 实体 0.25、振幅 0.55
    expect(detectThreeCandle([...FLAT, S1, s2, S3])).toEqual([])
  })
})

describe('红三兵受阻：第四根撞墙', () => {
  it('三兵之后高开却收出缩量小实体：受阻（三兵与受阻同图并存）', () => {
    const fourth = c(11.25, 11.35, 11.15, 11.3, '2026-06-04', 80000) // 开盘 ≥ S3 收盘 11.2，实体占比 0.25
    expect(detectThreeCandle([...FLAT, S1, S2, S3, fourth])).toEqual([
      hit('three-white-soldiers', 10, 'bull', 'flat'),
      hit('stalled-pattern', 11, 'bear', 'flat'),
    ])
  })

  it('受阻的另一副面孔：高开长上影（冲高被打回）', () => {
    const fourth = c(11.25, 12.8, 11.2, 11.75, '2026-06-04', 90000) // 上影 1.05 ≥ 2×实体 0.5
    expect(detectThreeCandle([...FLAT, S1, S2, S3, fourth])).toEqual([
      hit('three-white-soldiers', 10, 'bull', 'flat'),
      hit('stalled-pattern', 11, 'bear', 'flat'),
    ])
  })

  it('干扰：第四根低开（开盘低于第三根收盘）：不算受阻——窗口滑一格，判的还是红三兵', () => {
    const fourth = c(11.1, 11.6, 11.05, 11.55, '2026-06-04', 90000) // 开盘 11.1 < 11.2，但嵌在 S3 实体内
    // 滑动窗口的背景把 S1 也算了进去（窗口涨跌恰 +5%），报告 rising——背景只被如实报告，不拦
    expect(detectThreeCandle([...FLAT, S1, S2, S3, fourth])).toEqual([
      hit('three-white-soldiers', 10, 'bull', 'flat'),
      hit('three-white-soldiers', 11, 'bull', 'rising'),
    ])
  })

  it('干扰：第四根放量长阳继续推进：不算受阻', () => {
    const fourth = c(11.25, 12.15, 11.2, 12.05, '2026-06-04', 200000) // 实体占比 0.84
    expect(detectThreeCandle([...FLAT, S1, S2, S3, fourth])).toEqual([
      hit('three-white-soldiers', 10, 'bull', 'flat'),
    ])
  })
})

describe('黑三鸦：红三兵的镜像', () => {
  it('三根饱满阴线、开盘嵌在前根实体内、收盘逐根压低：黑三鸦', () => {
    const k1 = c(10.5, 10.55, 9.9, 10.0, '2026-06-01', 100000) // 实体 [10.0, 10.5]
    const k2 = c(10.2, 10.25, 9.6, 9.7, '2026-06-02', 120000) // 开盘 10.2 嵌在 k1 实体内
    const k3 = c(9.75, 9.8, 9.1, 9.2, '2026-06-03', 140000) // 开盘 9.75 嵌在 k2 实体内
    expect(detectThreeCandle([...FLAT, k1, k2, k3])).toEqual([hit('three-black-crows', 10, 'bear', 'flat')])
  })
})

describe('上升三法与下降三法：五幕中继剧', () => {
  it('上涨中大阳+框内三根小回撤+收复新高：上升三法（歇脚不折返）', () => {
    expect(detectThreeCandle([...RISING, R3_BIG, R3_M1, R3_M2, R3_M3, R3_FIFTH])).toEqual([
      hit('rising-three-methods', 12, 'bull', 'rising'),
    ])
  })

  it('框内三根小阴线形状像乌鸦但实体不够格：不误报黑三鸦', () => {
    const hits = detectThreeCandle([...RISING, R3_BIG, R3_M1, R3_M2, R3_M3, R3_FIFTH])
    expect(hits.some((h) => h.id === 'three-black-crows')).toBe(false)
  })

  it('干扰：中间一根影线伸出第一根的领地（高点越过框顶）：歇脚出了框，不判三法', () => {
    const m1 = c(6.8, 7.05, 6.5, 6.6, '2026-06-02', 50000) // 高点 7.05 > 框顶 7.0
    expect(detectThreeCandle([...RISING, R3_BIG, m1, R3_M2, R3_M3, R3_FIFTH])).toEqual([])
  })

  it('干扰：第五根收不回第一根的收盘（差 0.05）：只是深回撤，不是三法', () => {
    const fifth = c(6.35, 6.95, 6.3, 6.85, '2026-06-05', 170000) // 收 6.85 < 6.9
    expect(detectThreeCandle([...RISING, R3_BIG, R3_M1, R3_M2, R3_M3, fifth])).toEqual([])
  })

  it('下跌中大阴+框内三根小回升+杀回新低：下降三法', () => {
    expect(detectThreeCandle([...FALLING, F3_BIG, F3_N1, F3_N2, F3_N3, F3_FIFTH])).toEqual([
      hit('falling-three-methods', 12, 'bear', 'falling'),
    ])
  })

  it('框内三根小阳线形状像兵群但实体不够格：不误报红三兵', () => {
    const hits = detectThreeCandle([...FALLING, F3_BIG, F3_N1, F3_N2, F3_N3, F3_FIFTH])
    expect(hits.some((h) => h.id === 'three-white-soldiers')).toBe(false)
  })
})

describe('背景门与扫描范围', () => {
  it('横盘背景走出教科书级晨星形状：不判——没有趋势，就没有反转', () => {
    expect(detectThreeCandle([...FLAT, MS_FIRST, MS_STAR, MS_THIRD])).toEqual([])
  })

  it('纯背景段整段扫过：零误报', () => {
    expect(detectThreeCandle(FALLING)).toEqual([])
    expect(detectThreeCandle(RISING)).toEqual([])
    expect(detectThreeCandle(FLAT)).toEqual([])
  })

  it('合成随机行情全序列扫描：每个命中的完成日都有完整背景窗口，且同一完成日不重复报同一形态', () => {
    const hits = detectThreeCandle(generateCandles(createRng(816), { days: 120, startPrice: 10 }))
    expect(hits.length).toBeGreaterThan(0)
    for (const h of hits) expect(h.index).toBeGreaterThanOrEqual(7)
    const keys = new Set(hits.map((h) => `${h.id}@${h.index}`))
    expect(keys.size).toBe(hits.length)
  })

  it('序列太短放不满背景窗口：返回空列表而不是报错', () => {
    expect(detectThreeCandle(FLAT.slice(0, 7))).toEqual([])
  })

  it('空数组、非数组、含 NaN 的 K 线：抛中文错误', () => {
    expect(() => detectThreeCandle([])).toThrow()
    expect(() => detectThreeCandle('不是数组' as unknown as Candle[])).toThrow()
    expect(() => detectThreeCandle([...FLAT, c(NaN, 10.5, 9.9, 10.0)])).toThrow()
  })
})
