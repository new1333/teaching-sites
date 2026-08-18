import { describe, expect, it } from 'vitest'
import { createRng, generateCandles, generateTicks } from '../src/data/generate'
import { aggregateTicks, resample } from '../src/candles/aggregate'
import { candleAnatomy } from '../src/candles/anatomy'
import type { Candle, Session, Tick } from '../src/types'

/** 实验场统一按 UTC 解释时间戳：'2026-03-02' + '10:15' → 当日该时刻的毫秒数 */
const at = (date: string, hhmm: string): number =>
  Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Number(hhmm.slice(0, 2)),
    Number(hhmm.slice(3, 5)),
  )

const tick = (date: string, hhmm: string, price: number, size: number): Tick => ({
  time: at(date, hhmm),
  price,
  size,
})

const SESSION: Session = { open: '09:30', close: '15:00' }

/** 手工造一根日K：价格故意排得互不相同，方便断言极值来自哪里 */
const day = (i: number): Candle => ({
  date: `2026-03-${String(i + 1).padStart(2, '0')}`,
  open: 100 + i,
  high: 101 + i,
  low: 99 + i,
  close: 100.5 + i,
  volume: i + 1,
})

describe('createRng：固定种子是全书合成数据的唯一随机源', () => {
  it('同一种子得到同一串数，且都落在 [0, 1)', () => {
    const a = createRng(42)
    const b = createRng(42)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).toEqual(seqB)
    for (const x of seqA) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThan(1)
    }
  })

  it('不同种子得到不同的序列', () => {
    const a = createRng(1)
    const b = createRng(2)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })
})

describe('generateTicks：固定种子合成逐笔成交', () => {
  it('同一颗种子两次生成逐字节一致的序列（实验可复现）', () => {
    const opts = { days: 3, ticksPerDay: 20, startPrice: 10 }
    const first = generateTicks(createRng(7), opts)
    const second = generateTicks(createRng(7), opts)
    expect(first).toEqual(second)
  })

  it('逐笔按时间升序、价格为正、全部落在交易时段内', () => {
    const ticks = generateTicks(createRng(7), { days: 3, ticksPerDay: 20, startPrice: 10 })
    expect(ticks.length).toBe(60)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i].time).toBeGreaterThan(ticks[i - 1].time)
    for (const t of ticks) {
      expect(t.price).toBeGreaterThan(0)
      const m = new Date(t.time).getUTCHours() * 60 + new Date(t.time).getUTCMinutes()
      expect(m).toBeGreaterThanOrEqual(9 * 60 + 30)
      expect(m).toBeLessThanOrEqual(15 * 60)
    }
  })
})

describe('aggregateTicks：逐笔聚成日K', () => {
  it('手工逐笔聚合出的开高低收与成交量，和手算一致', () => {
    const ticks = [
      tick('2026-03-02', '09:30', 10.0, 200),
      tick('2026-03-02', '10:15', 10.4, 100),
      tick('2026-03-02', '11:05', 9.8, 300),
      tick('2026-03-02', '14:00', 10.1, 100),
      tick('2026-03-02', '14:57', 10.25, 400),
    ]
    expect(aggregateTicks(ticks, SESSION)).toEqual([
      { date: '2026-03-02', open: 10.0, high: 10.4, low: 9.8, close: 10.25, volume: 1100 },
    ])
  })

  it('跨日逐笔按天分组，K线按旧到新排列，各天各自聚合', () => {
    const ticks = [
      tick('2026-03-02', '09:30', 10.0, 100),
      tick('2026-03-02', '10:00', 10.5, 100),
      tick('2026-03-02', '15:00', 10.2, 100),
      tick('2026-03-03', '09:30', 10.3, 200),
      tick('2026-03-03', '15:00', 9.9, 300),
    ]
    expect(aggregateTicks(ticks, SESSION)).toEqual([
      { date: '2026-03-02', open: 10.0, high: 10.5, low: 10.0, close: 10.2, volume: 300 },
      { date: '2026-03-03', open: 10.3, high: 10.3, low: 9.9, close: 9.9, volume: 500 },
    ])
  })

  it('时段外的逐笔不计入当天的蜡烛', () => {
    const ticks = [
      tick('2026-03-02', '09:20', 99.0, 100),
      tick('2026-03-02', '09:30', 10.0, 100),
      tick('2026-03-02', '11:00', 10.2, 100),
      tick('2026-03-02', '15:10', 0.5, 100),
    ]
    const candles = aggregateTicks(ticks, SESSION)
    expect(candles).toEqual([
      { date: '2026-03-02', open: 10.0, high: 10.2, low: 10.0, close: 10.2, volume: 200 },
    ])
  })

  it('整天都在时段外的逐笔不产生K线', () => {
    const ticks = [
      tick('2026-03-02', '09:30', 10.0, 100),
      tick('2026-03-02', '15:00', 10.1, 100),
      tick('2026-03-04', '09:00', 50.0, 100),
    ]
    expect(aggregateTicks(ticks, SESSION)).toHaveLength(1)
  })

  it('空数组和乱序输入直接报错', () => {
    expect(() => aggregateTicks([], SESSION)).toThrow()
    const bad = [
      tick('2026-03-02', '11:00', 10.0, 100),
      tick('2026-03-02', '10:00', 10.1, 100),
    ]
    expect(() => aggregateTicks(bad, SESSION)).toThrow()
  })

  it('固定种子逐笔聚合后，每天的高高低低约束都成立', () => {
    const ticks = generateTicks(createRng(42), { days: 5, ticksPerDay: 60, startPrice: 20 })
    const candles = aggregateTicks(ticks, SESSION)
    expect(candles).toHaveLength(5)
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.high).toBeGreaterThanOrEqual(c.low)
      expect(c.volume).toBeGreaterThan(0)
    }
    const dates = candles.map((c) => c.date)
    expect([...dates].sort()).toEqual(dates)
    expect(new Set(dates).size).toBe(5)
  })
})

describe('resample：n 根日K并成 1 根大周期K线', () => {
  const daily = Array.from({ length: 10 }, (_, i) => day(i))

  it('10 根日K并成 2 根周K：开=首根开、收=末根收、高=最高、低=最低、量=求和', () => {
    const [w1, w2] = resample(daily, 5)
    expect(w1).toEqual({
      date: '2026-03-01',
      open: daily[0].open,
      high: Math.max(...daily.slice(0, 5).map((c) => c.high)),
      low: Math.min(...daily.slice(0, 5).map((c) => c.low)),
      close: daily[4].close,
      volume: 1 + 2 + 3 + 4 + 5,
    })
    expect(w2).toEqual({
      date: '2026-03-06',
      open: daily[5].open,
      high: Math.max(...daily.slice(5).map((c) => c.high)),
      low: Math.min(...daily.slice(5).map((c) => c.low)),
      close: daily[9].close,
      volume: 6 + 7 + 8 + 9 + 10,
    })
  })

  it('结尾不足 n 根的尾组照样并成一根（收在最后可得的数据上）', () => {
    const seven = daily.slice(0, 7)
    const out = resample(seven, 5)
    expect(out).toHaveLength(2)
    expect(out[1].open).toBe(seven[5].open)
    expect(out[1].close).toBe(seven[6].close)
    expect(out[1].volume).toBe(7 + 6)
  })

  it('空数组与非法 n 直接报错', () => {
    expect(() => resample([], 5)).toThrow()
    expect(() => resample(daily, 1)).toThrow()
    expect(() => resample(daily, 0)).toThrow()
    expect(() => resample(daily, 2.5)).toThrow()
  })
})

describe('candleAnatomy：量出实体与影线', () => {
  it('阳线：实体=收开之差，影线=实体外的探出部分，占比以全天振幅为分母', () => {
    const a = candleAnatomy({ date: '2026-03-02', open: 10, high: 11, low: 9.5, close: 10.5, volume: 100 })
    expect(a.direction).toBe('yang')
    expect(a.body).toBe(0.5)
    expect(a.upperWick).toBe(0.5)
    expect(a.lowerWick).toBe(0.5)
    expect(a.range).toBe(1.5)
    expect(a.bodyRatio).toBeCloseTo(1 / 3, 10)
    expect(a.upperWickRatio).toBeCloseTo(1 / 3, 10)
    expect(a.lowerWickRatio).toBeCloseTo(1 / 3, 10)
  })

  it('阴线：同样的算式，方向翻转', () => {
    const a = candleAnatomy({ date: '2026-03-02', open: 11, high: 11.5, low: 9.75, close: 10, volume: 100 })
    expect(a.direction).toBe('yin')
    expect(a.body).toBe(1)
    expect(a.upperWick).toBe(0.5)
    expect(a.lowerWick).toBe(0.25)
    expect(a.bodyRatio).toBeCloseTo(1 / 1.75, 10)
  })

  it('开收同价是十字：实体为 0；四价合一是其极端形态', () => {
    const cross = candleAnatomy({ date: '2026-03-02', open: 10, high: 10.5, low: 9.5, close: 10, volume: 100 })
    expect(cross.direction).toBe('doji')
    expect(cross.body).toBe(0)
    expect(cross.upperWick).toBe(0.5)
    expect(cross.lowerWick).toBe(0.5)

    const flat = candleAnatomy({ date: '2026-03-02', open: 10, high: 10, low: 10, close: 10, volume: 100 })
    expect(flat.direction).toBe('doji')
    expect(flat.range).toBe(0)
    expect(flat.bodyRatio).toBe(0)
    expect(flat.upperWick).toBe(0)
    expect(flat.lowerWick).toBe(0)
  })

  it('结构性非法输入直接报错', () => {
    expect(() =>
      candleAnatomy({ date: '2026-03-02', open: 1, high: 0.9, low: 1, close: 1, volume: 100 }),
    ).toThrow()
    expect(() =>
      candleAnatomy({ date: '2026-03-02', open: 1, high: 2, low: 0.5, close: Number.NaN, volume: 100 }),
    ).toThrow()
  })
})

describe('generateCandles：不经过逐笔、直接合成日K（后续章节的地基）', () => {
  it('固定种子确定性输出，日期跳过周末且升序，高低收开约束成立', () => {
    const a = generateCandles(createRng(11), { days: 10, startPrice: 15 })
    const b = generateCandles(createRng(11), { days: 10, startPrice: 15 })
    expect(a).toEqual(b)
    expect(a).toHaveLength(10)
    expect(a[0].date).toBe('2026-01-05')
    for (let i = 1; i < a.length; i++) expect(a[i].date > a[i - 1].date).toBe(true)
    for (const c of a) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close))
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close))
      expect(c.volume).toBeGreaterThan(0)
    }
  })

  it('日期跳过周末：首日之后的下一个交易日不是周六周日', () => {
    const a = generateCandles(createRng(11), { days: 7, startPrice: 15 })
    for (const c of a) {
      const dow = new Date(`${c.date}T00:00:00Z`).getUTCDay()
      expect(dow).not.toBe(0)
      expect(dow).not.toBe(6)
    }
  })
})
