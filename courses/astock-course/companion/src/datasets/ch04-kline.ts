// companion/src/datasets/ch04-kline.ts · 第 4 章数据集：合成 K 线教学行情 kline-demo.json
// 行情由 src/market.ts 固定种子生成（教学示意·课程自产合成数据，与任何真实个股无关）。
// 正文（docs/04-k-line.md）的一切承重数字取自本模块的导出产物，不以手写数字为准。

import {
  BASE_VOLUME_LOTS,
  CANDLE_COUNT,
  HIDDEN_COUNT,
  START_PRICE,
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
} from '../market'
import { round2 } from '../round'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

interface CandleFeature {
  day: string
  open: number
  high: number
  low: number
  close: number
  prev_close: number
  yang: boolean
  body: number
  body_pct: number
  upper_shadow: number
  lower_shadow: number
  volume: number
  volume_vs_median: number
}

function featureOf(candles: Candle[], n: number, median: number): CandleFeature {
  const c = candles[n - 1] as Candle
  const prev = candles[n - 2] as Candle | undefined
  return {
    day: c.day,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    prev_close: prev ? prev.close : c.open,
    yang: isYang(c),
    body: bodyOf(c),
    body_pct: round2((bodyOf(c) / c.open) * 100),
    upper_shadow: upperShadowOf(c),
    lower_shadow: lowerShadowOf(c),
    volume: c.volume,
    volume_vs_median: round2(c.volume / median),
  }
}

export function buildCh04(): Dataset {
  const candles = generateDailyCandles()
  const median = medianVolume(candles)
  const maxDay = maxVolumeDay(candles)

  // 误区对账：阳线之后次日收跌的次数
  let yangDays = 0
  let yangNextDayDown = 0
  for (let i = 0; i < candles.length - 1; i += 1) {
    const cur = candles[i] as Candle
    const next = candles[i + 1] as Candle
    if (isYang(cur)) {
      yangDays += 1
      if (next.close < cur.close) yangNextDayDown += 1
    }
  }

  // 揭晓段（后 20 根）的走势要点
  const hidden = candles.slice(VISIBLE_COUNT)
  const peak = hidden.reduce((a, b) => (b.close > a.close ? b : a))
  const trough = hidden.reduce((a, b) => (b.low < a.low ? b : a))
  const last = candles[candles.length - 1] as Candle
  const visibleLast = candles[VISIBLE_COUNT - 1] as Candle

  const yangStreak = longestStreak(candles, true)
  const yinStreak = longestStreak(candles, false)
  const d36 = featureOf(candles, 36, median)
  const d37 = featureOf(candles, 37, median)

  return {
    file: 'kline-demo.json',
    data: {
      labeling:
        '教学示意·课程自产合成数据：行情为固定种子生成的剧情序列 D1–D60，与任何真实个股无关',
      meta: {
        seed: 42,
        generator: 'companion/src/market.ts · generateDailyCandles',
        total: CANDLE_COUNT,
        visible: VISIBLE_COUNT,
        hidden: HIDDEN_COUNT,
        visible_days: 'D1–D40',
        hidden_days: 'D41–D60',
        start_price: START_PRICE,
        base_volume_lots: BASE_VOLUME_LOTS,
        volume_unit: '手（1 手 = 100 股）',
      },
      candles,
      features: {
        yang_streak: {
          ...yangStreak,
          days: `D${yangStreak.from}–D${yangStreak.to}`,
          note: '最长连续阳线段（序号含首尾）',
        },
        yin_streak: {
          ...yinStreak,
          days: `D${yinStreak.from}–D${yinStreak.to}`,
          note: '最长连续阴线段（序号含首尾）',
        },
        long_upper_shadow: featureOf(candles, 19, median),
        long_lower_shadow: featureOf(candles, 30, median),
        gap_fade_day: featureOf(candles, 31, median),
        big_yang_heavy: d36,
        big_yang_light: d37,
        small_yin_light: featureOf(candles, 40, median),
        max_volume_day: {
          day: `D${maxDay}`,
          volume: (candles[maxDay - 1] as Candle).volume,
          volume_vs_median: round2((candles[maxDay - 1] as Candle).volume / median),
        },
        hidden_long_lower_day: featureOf(candles, 53, median),
      },
      worksheet: {
        volume_median_lots: median,
        yang_days: yangDays,
        yang_next_day_down: yangNextDayDown,
        hook_pair: {
          heavy: d36,
          light: d37,
          daily_gain_heavy_pct: round2(((d36.close - d36.prev_close) / d36.prev_close) * 100),
          daily_gain_light_pct: round2(((d37.close - d37.prev_close) / d37.prev_close) * 100),
          volume_ratio_heavy_to_light: round2(d36.volume / d37.volume),
        },
        reveal: {
          visible_last: { day: visibleLast.day, close: visibleLast.close },
          hidden_peak: { day: peak.day, close: peak.close },
          hidden_trough: { day: trough.day, low: trough.low },
          drawdown_from_peak_pct: round2(((trough.low - peak.close) / peak.close) * 100),
          final_day: last.day,
          final_close: last.close,
          final_vs_heavy_close_pct: round2(((last.close - d36.close) / d36.close) * 100),
        },
      },
    },
  }
}
