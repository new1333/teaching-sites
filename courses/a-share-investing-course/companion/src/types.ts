/** 共享词汇：全实验场通用的三个基础类型（命名由 .course/bible.json 的 API 契约固定） */

/** 逐笔成交：time 为 UTC 毫秒时间戳，price 为成交价（元），size 为成交股数 */
export type Tick = { time: number; price: number; size: number }

/** 一根K线：date 为 'YYYY-MM-DD' 日期标签（按 UTC 解释），volume 为股数 */
export type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 交易时段：open 与 close 为 'HH:mm' 格式的时刻（按 UTC 解释），如 { open: '09:30', close: '15:00' } */
export type Session = { open: string; close: string }
