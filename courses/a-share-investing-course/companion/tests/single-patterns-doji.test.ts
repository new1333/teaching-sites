import { describe, expect, it } from 'vitest'
import {
  classifyDoji,
  dojiContext,
  HESITATION_LEVEL,
  type DojiContext,
} from '../src/patterns/doji'
import { classifyWicks } from '../src/patterns/wicks'
import type { TrendPosition } from '../src/patterns/context'
import type { Candle } from '../src/types'

/**
 * 十字星家族的行为断言：只喂 K 线与背景，只看返回的分类与犹豫程度。
 * 全章核心命题在这里受审：
 * 1. 六种十字族形态互相排斥，一种 K 线只有一个名字；
 * 2. 「长」与「打盹」不在 K 线自己身上，在与之前五根的比较里；
 * 3. 一字线不在犹豫刻度上——它单独标记，并给出涨跌停语境；
 * 4. 实体占比 ≤5% 归本章、>5% 归第 5 章影线族，两章分界互补。
 */

const c = (
  open: number,
  high: number,
  low: number,
  close: number,
  date = '2026-04-01',
  volume = 1000,
): Candle => ({ date, open, high, low, close, volume })

/** 手搓十字族背景：avgRange 是之前五根的平均振幅（「长腿」与「打盹」的参照尺） */
const dctx = (
  avgRange: number,
  position: TrendPosition = 'flat',
  prevClose = 10,
  limitRatio = 0.1,
): DojiContext => ({ position, change: 0, bars: 5, avgRange, prevClose, limitRatio })

/** 由一串收盘价手搓背景行情：开=昨收，高=两者较大者+0.02，低=较小者−0.02（每根振幅=涨跌幅+0.04） */
const seriesFromCloses = (closes: number[]): Candle[] =>
  closes.map((close, i) => {
    const open = i === 0 ? closes[0] : closes[i - 1]
    return c(open, Math.max(open, close) + 0.02, Math.min(open, close) - 0.02, close, `2026-04-${String(i + 1).padStart(2, '0')}`)
  })

// 每天约 −2% 的下跌背景：每根振幅都是 0.44（0.40 的跌幅 + 0.04 的手工影线）
const FALLING = seriesFromCloses([20, 19.6, 19.2, 18.8, 18.4, 18, 17.6, 17.2])

// 六个核心样本：判据余量留足，四舍五入抖动翻不了案
const PLAIN_DOJI = c(10.0, 10.6, 9.4, 10.0) // 实体 0、上下影各 0.60、振幅 1.20
const LONG_LEGGED = c(10.0, 10.9, 9.1, 10.0) // 实体 0、上下影各 0.90、振幅 1.80
const DRAGONFLY = c(10.0, 10.0, 9.0, 10.0) // 实体 0、上影 0、下影 1.00
const GRAVESTONE = c(10.0, 11.0, 10.0, 10.0) // 实体 0、上影 1.00、下影 0
const SPINNING = c(10.0, 10.05, 9.95, 10.0) // 振幅 0.10，缩到参照尺的四分之一
const sameShape = c(10.0, 10.5, 9.5, 10.0) // 实体 0、上下影各 0.50：同一形状，下面换参照尺用

describe('classifyDoji：六种形态与犹豫程度', () => {
  it('普通十字星：开收同价、两条腿均分，犹豫程度「打平」', () => {
    const r = classifyDoji(PLAIN_DOJI, dctx(1.5))
    expect(r?.kind).toBe('doji')
    expect(r?.hesitation).toBe('tied')
  })

  it('长腿十字：振幅追过参照尺 1.2 倍且两腿在场，犹豫程度「撕裂」', () => {
    const r = classifyDoji(LONG_LEGGED, dctx(1.0))
    expect(r?.kind).toBe('long-legged')
    expect(r?.hesitation).toBe('torn')
  })

  it('蜻蜓线：开收贴着最高点、下影占八成以上；墓碑线是它的镜子', () => {
    expect(classifyDoji(DRAGONFLY, dctx(1.0))?.kind).toBe('dragonfly')
    expect(classifyDoji(GRAVESTONE, dctx(1.0))?.kind).toBe('gravestone')
  })

  it('纺锤线：整根振幅缩到参照尺一半以下，犹豫程度只是「打盹」', () => {
    const r = classifyDoji(SPINNING, dctx(0.4))
    expect(r?.kind).toBe('spinning-top')
    expect(r?.hesitation).toBe('dozing')
  })

  it('一字线：四价合一单独标记，犹豫程度是「锁死」，不在犹豫刻度上', () => {
    const r = classifyDoji(c(11.0, 11.0, 11.0, 11.0), dctx(1.0, 'flat', 10.0))
    expect(r?.kind).toBe('four-price')
    expect(r?.hesitation).toBe('locked')
    expect(r?.limit).toBe('limit-up')
  })

  it('犹豫程度有序：打盹 < 打平 < 撕裂；锁死是 0 级（刻度之外）', () => {
    expect(HESITATION_LEVEL.dozing).toBeLessThan(HESITATION_LEVEL.tied)
    expect(HESITATION_LEVEL.tied).toBeLessThan(HESITATION_LEVEL.torn)
    expect(HESITATION_LEVEL.locked).toBe(0)
  })
})

describe('「长」在比较里：同一形状，参照尺换，名字换', () => {
  it('同一组 0.50/0.50 双腿数字：参照尺 1.5 时是普通十字，参照尺 0.5 时是长腿十字', () => {
    expect(classifyDoji(sameShape, dctx(1.5))?.kind).toBe('doji')
    expect(classifyDoji(sameShape, dctx(0.5))?.kind).toBe('long-legged')
  })

  it('形状先于大小：巨大的单向长影仍判蜻蜓，不会被「振幅大」抢成长腿十字', () => {
    const hugeDragonfly = c(10.0, 10.0, 8.2, 10.0) // 振幅 1.80，全部在下影
    expect(classifyDoji(hugeDragonfly, dctx(0.5))?.kind).toBe('dragonfly')
  })
})

describe('一字线的涨跌停语境：用昨收核对，不靠猜', () => {
  it('昨收 10 元、边界 10%：9.00 的一字是跌停，11.00 的一字是涨停', () => {
    expect(classifyDoji(c(9.0, 9.0, 9.0, 9.0), dctx(1.0, 'flat', 10.0))?.limit).toBe('limit-down')
    expect(classifyDoji(c(11.0, 11.0, 11.0, 11.0), dctx(1.0, 'flat', 10.0))?.limit).toBe('limit-up')
  })

  it('昨收 9.12 元、边界 10%：涨停价按交易所口径四舍五入到分，是 10.03 而不是 10.02', () => {
    const r = classifyDoji(c(10.03, 10.03, 10.03, 10.03), dctx(1.0, 'flat', 9.12))
    expect(r?.limit).toBe('limit-up')
    expect(classifyDoji(c(10.02, 10.02, 10.02, 10.02), dctx(1.0, 'flat', 9.12))?.limit).toBe('none')
  })

  it('四价合一但价格没贴着边界：limit 记 none——代码不假设一字必是涨跌停', () => {
    const r = classifyDoji(c(10.0, 10.0, 10.0, 10.0), dctx(1.0, 'flat', 10.0))
    expect(r?.kind).toBe('four-price')
    expect(r?.limit).toBe('none')
  })

  it('边界是参数：创业板口径 20% 下，涨 10% 的一字不算贴边', () => {
    const r = classifyDoji(c(11.0, 11.0, 11.0, 11.0), dctx(1.0, 'flat', 10.0, 0.2))
    expect(r?.limit).toBe('none')
  })
})

describe('dojiContext：从行情里量出参照尺与昨收', () => {
  it('平均振幅取之前五根：等差下跌背景里每根振幅 0.44，昨收是前一根的收盘', () => {
    const ctx = dojiContext(FALLING, 7)
    expect(ctx.position).toBe('falling')
    expect(ctx.avgRange).toBeCloseTo(0.44, 10)
    expect(ctx.prevClose).toBe(17.6)
    expect(ctx.limitRatio).toBe(0.1) // 教学默认取主板口径，传参可换
  })

  it('端到端：下跌背景接两个连续一字，都在 −10% 边界上，都判「锁死·跌停」', () => {
    const day1 = c(15.48, 15.48, 15.48, 15.48, '2026-04-09') // 昨收 17.2 × 0.9 = 15.48
    const day2 = c(13.93, 13.93, 13.93, 13.93, '2026-04-10') // 15.48 × 0.9 = 13.932 → 四舍五入 13.93
    const series = [...FALLING, day1, day2]
    const r1 = classifyDoji(series[8], dojiContext(series, 8))
    const r2 = classifyDoji(series[9], dojiContext(series, 9))
    expect(r1?.kind).toBe('four-price')
    expect(r1?.limit).toBe('limit-down')
    expect(r2?.kind).toBe('four-price')
    expect(r2?.limit).toBe('limit-down')
  })
})

describe('与第 5 章的分界：实体占比 5% 互补', () => {
  it('实体恰占振幅 5%：归十字星家族（普通十字），影线族不给名字', () => {
    const edge = c(9.9, 10.4, 9.4, 9.95) // 实体 0.05、振幅 1.00，占比恰 5%
    expect(classifyDoji(edge, dctx(1.5))?.kind).toBe('doji')
    expect(classifyWicks(edge, { position: 'falling', change: -0.06, bars: 5 })).toEqual([])
  })

  it('实体占 6%：归第 5 章（下跌背景判锤子），十字星家族退回 null', () => {
    const edge = c(10.0, 10.1, 9.5, 10.06) // 实体 0.06、振幅 0.60、下影 0.50
    expect(classifyDoji(edge, dctx(1.0))).toBeNull()
    expect(classifyWicks(edge, { position: 'falling', change: -0.06, bars: 5 })).toEqual(['hammer'])
  })

  it('大实体与普通 K 线都不是十字族：classifyDoji 返回 null 而不是空名单', () => {
    expect(classifyDoji(c(10.0, 10.75, 9.95, 10.7), dctx(1.0))).toBeNull() // 大阳线，第 5 章的地盘
    expect(classifyDoji(c(10.0, 10.3, 9.7, 10.2), dctx(1.0))).toBeNull() // 实体 0.20、振幅 0.60，占比 33%
  })
})

describe('非法输入直接报错', () => {
  it('K 线四价不守恒、背景缺字段或越界，都抛中文错误', () => {
    expect(() => classifyDoji(c(10, 9.9, 10, 10), dctx(1.0))).toThrow() // 最高价低于实体
    expect(() => classifyDoji(PLAIN_DOJI, dctx(-1))).toThrow() // 参照尺不能为负
    expect(() => classifyDoji(c(11, 11, 11, 11), dctx(1.0, 'flat', 10.0, 0))).toThrow() // 边界比例非法
    const badCtx = { position: 'up', change: 0, bars: 5, avgRange: 1, prevClose: 10, limitRatio: 0.1 } as unknown as DojiContext
    expect(() => classifyDoji(PLAIN_DOJI, badCtx)).toThrow()
  })

  it('dojiContext：窗口放不下、边界比例不在 0 与 1 之间，都抛错', () => {
    expect(() => dojiContext(FALLING, 4)).toThrow() // 前面只有 4 根，放不满默认 5 根窗口
    expect(() => dojiContext(FALLING, 7, { limitRatio: 0 })).toThrow()
    expect(() => dojiContext(FALLING, 7, { limitRatio: 1 })).toThrow()
  })
})
