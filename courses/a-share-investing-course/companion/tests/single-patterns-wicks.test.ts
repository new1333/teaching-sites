import { describe, expect, it } from 'vitest'
import { classifyWicks } from '../src/patterns/wicks'
import { trendContext, type TrendContext, type TrendPosition } from '../src/patterns/context'
import type { Candle } from '../src/types'

/**
 * 单根影线族形态的行为断言：只喂 K 线与背景，只看返回的形态名单。
 * 全章的核心命题在这里受审：同一形状在不同趋势位置，含义反转。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-04-01',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 手搓一个背景上下文（不经过 trendContext，专供纯形状判定用） */
const ctx = (position: TrendPosition, change = 0): TrendContext => ({ position, change, bars: 5 })
const FLAT = ctx('flat')

/** 由一串收盘价手搓背景行情：开=昨收，高=两者较大者+0.02，低=较小者−0.02 */
const seriesFromCloses = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return c(open, Math.max(open, close) + 0.02, Math.min(open, close) - 0.02, close, `2026-04-${String(i + 1).padStart(2, '0')}`)
  })

// 三段背景：每天约 −2% / 等差横盘 / 每天约 +2%，数字全部手写可复算
const FALLING = seriesFromCloses([20, 19.6, 19.2, 18.8, 18.4, 18, 17.6, 17.2])
const RISING = seriesFromCloses([7.5, 7.65, 7.8, 7.95, 8.1, 8.25, 8.4, 8.55])
const SIDWAYS = seriesFromCloses([10, 10.1, 9.9, 10, 10.1, 9.9, 10, 10.1])

// 两个核心样本：同一组数字，靠背景换名字
const HAMMER_SHAPE = c(10.0, 10.18, 8.8, 10.15) // 实体 0.15、上影 0.03、下影 1.2
const STAR_SHAPE = c(10.0, 11.35, 10.0, 10.15) // 实体 0.15、上影 1.2、下影 0

describe('trendContext：形态之前的行情说了什么', () => {
  it('等差下跌的背景判 falling，涨跌幅等于窗口两端收盘价之比（手算一致）', () => {
    const a = trendContext(FALLING, 7)
    expect(a.position).toBe('falling')
    expect(a.bars).toBe(5)
    // 窗口是第 2..6 根的收盘：19.2 → 17.6
    expect(a.change).toBeCloseTo((17.6 - 19.2) / 19.2, 10)
  })

  it('等差上涨的背景判 rising；来回横盘的背景判 flat', () => {
    expect(trendContext(RISING, 7).position).toBe('rising')
    const a = trendContext(SIDWAYS, 7)
    expect(a.position).toBe('flat')
    // 窗口第 2..6 根收盘：9.9 → 10
    expect(a.change).toBeCloseTo(0.1 / 9.9, 10)
  })

  it('阈值与窗口都是参数：跌幅 8.3% 在 20% 阈值下不算下跌；3 根窗口看不到 7 根的趋势', () => {
    expect(trendContext(FALLING, 7, { threshold: 0.2 }).position).toBe('flat')
    expect(trendContext(RISING, 7, { lookback: 3 }).position).toBe('flat')
    expect(trendContext(RISING, 7, { lookback: 7 }).position).toBe('rising')
  })

  it('背景窗放不下、下标越界、空数组直接报错', () => {
    expect(() => trendContext(FALLING, 4)).toThrow() // 前面只有 4 根，放不满默认 5 根窗口
    expect(() => trendContext(FALLING, -1)).toThrow()
    expect(() => trendContext(FALLING, 8, { lookback: 0 })).toThrow()
    expect(() => trendContext([], 0)).toThrow()
  })
})

describe('classifyWicks：大实体与光头光脚（与位置无关的形状）', () => {
  it('实体占振幅约 88% 的阳线/阴线判大阳线/大阴线（上下影太短不够光头光脚则只是「大」）', () => {
    expect(classifyWicks(c(10, 10.75, 9.95, 10.7), FLAT)).toEqual(['big-yang'])
    expect(classifyWicks(c(10.7, 10.75, 9.95, 10.0), FLAT)).toEqual(['big-yin'])
  })

  it('实体占 66%：不到七成，不叫「大」', () => {
    expect(classifyWicks(c(10, 10.66, 9.66, 10.66), FLAT)).toEqual([])
  })

  it('上下影都为零：光头光脚，与大阳/大阴同时出现在名单里', () => {
    expect(classifyWicks(c(10, 10.85, 10, 10.85), FLAT)).toEqual(['big-yang', 'marubozu'])
    expect(classifyWicks(c(10.85, 10.85, 10, 10), FLAT)).toEqual(['big-yin', 'marubozu'])
  })

  it('实体薄过振幅 5% 的近十字K线与四价合一都不归影线族（留给十字星家族）', () => {
    expect(classifyWicks(c(10, 10.02, 8.8, 10.0), FLAT)).toEqual([]) // 蜻蜓样子的长下影
    expect(classifyWicks(c(10, 10, 10, 10), FLAT)).toEqual([]) // 一字
  })

  it('非法K线与非法背景直接报错', () => {
    expect(() => classifyWicks(c(10, 9.9, 10, 10), FLAT)).toThrow()
    const badCtx = { position: 'up', change: 0, bars: 5 } as unknown as TrendContext // 越过类型，专测运行时守门
    expect(() => classifyWicks(HAMMER_SHAPE, badCtx)).toThrow()
  })
})

describe('位置换算：同一形状，名字随背景反转（本章核心）', () => {
  it('同一根长下影小实体：下跌背景判锤子，上涨背景判上吊，横盘不命名', () => {
    expect(classifyWicks(HAMMER_SHAPE, ctx('falling'))).toEqual(['hammer'])
    expect(classifyWicks(HAMMER_SHAPE, ctx('rising'))).toEqual(['hanging-man'])
    expect(classifyWicks(HAMMER_SHAPE, FLAT)).toEqual([])
  })

  it('同一根长上影小实体：上涨背景判射击之星，下跌背景判倒锤子，横盘不命名', () => {
    expect(classifyWicks(STAR_SHAPE, ctx('rising'))).toEqual(['shooting-star'])
    expect(classifyWicks(STAR_SHAPE, ctx('falling'))).toEqual(['inverted-hammer'])
    expect(classifyWicks(STAR_SHAPE, FLAT)).toEqual([])
  })

  it('端到端：同一组数字接在两段真实背景后面，trendContext 喂给 classifyWicks 后名字互换', () => {
    const afterFall = [...FALLING, HAMMER_SHAPE]
    const afterRise = [...RISING, HAMMER_SHAPE]
    expect(afterFall[8]).toEqual(afterRise[8]) // 同一根K线、同一组数字
    expect(classifyWicks(afterFall[8], trendContext(afterFall, 8))).toEqual(['hammer'])
    expect(classifyWicks(afterRise[8], trendContext(afterRise, 8))).toEqual(['hanging-man'])
  })

  it('影线不够长、或两头都拖长影，都不给名字', () => {
    expect(classifyWicks(c(10, 10.4, 10, 10.15), ctx('rising'))).toEqual([]) // 上影 0.25 < 实体×2
    expect(classifyWicks(c(10, 10.18, 9.75, 10.15), ctx('falling'))).toEqual([]) // 下影 0.25 < 实体×2
    expect(classifyWicks(c(10, 10.5, 8.8, 10.15), ctx('falling'))).toEqual([]) // 上下影都长，是分歧不是锤子
  })
})
