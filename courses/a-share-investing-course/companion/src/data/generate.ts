import type { Candle, Session, Tick } from '../types'
import { dayStart, isWeekendDate, minutesOfDay, nextDay } from '../time'

/**
 * 合成行情生成器：全书实验的唯一数据来源。
 * 不接网络、不读真实行情——固定种子跑一遍是这段代码的全部意义。
 */

export type GenerateTicksOpts = {
  days: number
  ticksPerDay: number
  startPrice: number
  /** 每笔价格最大变动比例，默认 0.004（±0.4%） */
  volatility?: number
  /** 首个交易日，'YYYY-MM-DD'，默认 '2026-01-05'（周一） */
  startDate?: string
  /** 逐笔落点的交易时段，默认 09:30–15:00 连续时段 */
  session?: Session
}

export type GenerateCandlesOpts = {
  days: number
  startPrice: number
  /** 每日价格最大变动比例，默认 0.02（±2%） */
  volatility?: number
  /** 首个交易日，'YYYY-MM-DD'，默认 '2026-01-05'（周一） */
  startDate?: string
}

/** mulberry32：确定性伪随机数生成器——同一种子永远吐出同一串数，全书合成数据的唯一随机源 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round2 = (x: number): number => Math.round(x * 100) / 100

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`generate：${label} 必须是正整数，收到的是 ${value}`)
  }
}

/** 从 startDate 起取 days 个交易日（跳过周六周日）的日期标签 */
export function tradingDates(startDate: string, days: number): string[] {
  const dates: string[] = []
  let cursor = startDate
  while (dates.length < days) {
    if (!isWeekendDate(cursor)) dates.push(cursor)
    cursor = nextDay(cursor)
  }
  return dates
}

/** 合成逐笔成交：价格做随机游走，数量以整手（100 股的整数倍）生成 */
export function generateTicks(rng: () => number, opts: GenerateTicksOpts): Tick[] {
  assertPositiveInt(opts.days, 'days')
  assertPositiveInt(opts.ticksPerDay, 'ticksPerDay')
  if (!(opts.startPrice > 0) || !Number.isFinite(opts.startPrice)) {
    throw new Error(`generate：startPrice 必须是正数，收到的是 ${opts.startPrice}`)
  }
  const volatility = opts.volatility ?? 0.004
  const session = opts.session ?? { open: '09:30', close: '15:00' }
  const openMin = minutesOfDay(session.open)
  const closeMin = minutesOfDay(session.close)
  if (closeMin <= openMin) {
    throw new Error('generate：session.close 必须晚于 session.open')
  }
  const ticks: Tick[] = []
  let price = opts.startPrice
  for (const date of tradingDates(opts.startDate ?? '2026-01-05', opts.days)) {
    const base = dayStart(date)
    for (let i = 0; i < opts.ticksPerDay; i++) {
      const minute = openMin + Math.floor(((closeMin - openMin) * i) / opts.ticksPerDay)
      price = Math.max(0.01, round2(price * (1 + (rng() * 2 - 1) * volatility)))
      const size = 100 * (1 + Math.floor(rng() * 10))
      ticks.push({ time: base + minute * 60_000, price, size })
    }
  }
  return ticks
}

/** 直接合成日K（跳过逐笔细节）：开盘跳空、收盘游走、影线再各自随机伸出 */
export function generateCandles(rng: () => number, opts: GenerateCandlesOpts): Candle[] {
  assertPositiveInt(opts.days, 'days')
  if (!(opts.startPrice > 0) || !Number.isFinite(opts.startPrice)) {
    throw new Error(`generate：startPrice 必须是正数，收到的是 ${opts.startPrice}`)
  }
  const volatility = opts.volatility ?? 0.02
  const candles: Candle[] = []
  let prevClose = opts.startPrice
  for (const date of tradingDates(opts.startDate ?? '2026-01-05', opts.days)) {
    const open = round2(prevClose * (1 + (rng() * 2 - 1) * volatility))
    const close = round2(open * (1 + (rng() * 2 - 1) * volatility))
    const high = round2(Math.max(open, close) * (1 + rng() * volatility))
    const low = Math.max(0.01, round2(Math.min(open, close) * (1 - rng() * volatility)))
    const volume = 100 * (1 + Math.floor(rng() * 1000))
    candles.push({ date, open, high, low, close, volume })
    prevClose = close
  }
  return candles
}
