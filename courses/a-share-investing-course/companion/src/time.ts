/**
 * 时间基元：实验场统一按 UTC 解释时间戳与日期标签。
 * 为什么用 UTC：本地时区会让「同一段代码在不同机器上算出不同的日期桶」，
 * 固定 UTC 后，任何机器上跑出的K线都一样。
 */

/** 'HH:mm' → 当日第几分钟：'09:30' → 570 */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm)
  if (!m) throw new Error(`时间格式必须是 'HH:mm'，收到的是「${hhmm}」`)
  const minute = Number(m[1]) * 60 + Number(m[2])
  if (minute >= 24 * 60) throw new Error(`时刻不能超过一天，收到的是「${hhmm}」`)
  return minute
}

/** 时间戳落在当日的第几分钟（UTC） */
export function minuteOfDay(time: number): number {
  const d = new Date(time)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/** 时间戳 → 'YYYY-MM-DD' 日期标签（UTC） */
export function dayKey(time: number): string {
  return new Date(time).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' → 当日 00:00 的 UTC 毫秒数 */
export function dayStart(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`日期格式必须是 'YYYY-MM-DD'，收到的是「${date}」`)
  }
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

/** 'YYYY-MM-DD' → 是否周六或周日（UTC） */
export function isWeekendDate(date: string): boolean {
  const dow = new Date(dayStart(date)).getUTCDay()
  return dow === 0 || dow === 6
}

/** 'YYYY-MM-DD' → 下一天的日期标签 */
export function nextDay(date: string): string {
  return dayKey(dayStart(date) + 86_400_000)
}
