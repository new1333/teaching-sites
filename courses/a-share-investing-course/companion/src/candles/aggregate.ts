import type { Candle, Session, Tick } from '../types'
import { dayKey, minuteOfDay, minutesOfDay } from '../time'

/**
 * 周期聚合：逐笔 → 日K → 更大周期。
 * 三个不变量：输入按时间从旧到新；输出同样从旧到新；时段外的逐笔不属于任何一根蜡烛。
 */

/** 逐笔聚成日K：按 UTC 日期分桶，每桶取首笔价为开、末笔价为收、最高最低为高低、数量求和 */
export function aggregateTicks(ticks: readonly Tick[], session: Session): Candle[] {
  if (ticks.length === 0) throw new Error('aggregateTicks：ticks 不能为空')
  const openMin = minutesOfDay(session.open)
  const closeMin = minutesOfDay(session.close)
  if (closeMin <= openMin) throw new Error('aggregateTicks：session.close 必须晚于 session.open')

  const byDay = new Map<string, Tick[]>()
  for (let i = 0; i < ticks.length; i++) {
    const t = ticks[i]
    if (i > 0 && t.time < ticks[i - 1].time) {
      throw new Error('aggregateTicks：ticks 必须按时间从旧到新排列')
    }
    if (!Number.isFinite(t.price) || t.price <= 0) {
      throw new Error(`aggregateTicks：第 ${i + 1} 笔的价格必须是正数`)
    }
    if (!Number.isFinite(t.size) || t.size <= 0) {
      throw new Error(`aggregateTicks：第 ${i + 1} 笔的数量必须是正数`)
    }
    const m = minuteOfDay(t.time)
    if (m < openMin || m > closeMin) continue // 早盘前、收盘后的逐笔不计入当天的蜡烛
    const key = dayKey(t.time)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(t)
    else byDay.set(key, [t])
  }

  const candles: Candle[] = []
  for (const [date, bucket] of byDay) {
    candles.push({
      date,
      open: bucket[0].price,
      high: Math.max(...bucket.map((t) => t.price)),
      low: Math.min(...bucket.map((t) => t.price)),
      close: bucket[bucket.length - 1].price,
      volume: bucket.reduce((sum, t) => sum + t.size, 0),
    })
  }
  return candles
}

/** n 根日K并成 1 根大周期K线（n=5 即周K）：开=首根开、收=末根收、高=最高、低=最低、量=求和；不足 n 根的尾组照样并成一根 */
export function resample(daily: readonly Candle[], n: number): Candle[] {
  if (daily.length === 0) throw new Error('resample：daily 不能为空')
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`resample：n 必须是不小于 2 的整数（1 根并 1 根没有意义），收到的是 ${n}`)
  }
  for (let i = 1; i < daily.length; i++) {
    if (daily[i].date <= daily[i - 1].date) {
      throw new Error('resample：daily 必须按日期从旧到新排列')
    }
  }
  const merged: Candle[] = []
  for (let i = 0; i < daily.length; i += n) {
    const group = daily.slice(i, i + n)
    merged.push({
      date: group[0].date,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    })
  }
  return merged
}
