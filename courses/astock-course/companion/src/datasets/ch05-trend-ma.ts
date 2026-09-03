// companion/src/datasets/ch05-trend-ma.ts · 第 5 章数据集：均线交叉回测 ma-cross.json
// 行情由 src/market.ts 固定种子生成（教学示意·课程自产合成数据，与任何真实个股无关）；
// 回测直接调用 src/market.ts 的均线/交叉实现与 src/costs.ts 的成本函数，无平行第二套算法。
// 正文（docs/05-trend-ma.md）的一切承重数字取自本模块的导出产物，不以手写数字为准。

import { TREND_COUNT, backtestMaCross, generateTrendCandles, isYang, ma, medianVolume } from '../market'
import { round2 } from '../round'
import type { Candle } from '../market'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

/** 震荡区（D101–D180）内用于讲支撑与压力的局部极值日（与正文引用一一对应） */
const CHOP_PIVOT_DAYS = {
  chop_first: 101,
  chop_last: 180,
  resistance_days: [119, 132], // 两次冲高回落的局部高点
  support_days: [115, 155, 166], // 三次回踩的局部低点
}

export function buildCh05(): Dataset {
  const candles = generateTrendCandles()
  const closes = candles.map((c) => c.close)
  const ma5 = ma(closes, 5)
  const ma20 = ma(closes, 20)
  const bt = backtestMaCross(candles)
  const median = medianVolume(candles)

  const at = (n: number): Candle => candles[n - 1] as Candle
  const volX = (n: number): number => round2(at(n).volume / median)

  // 震荡区极值与突破观察（正文支撑/压力小节的承重数字）
  const chopCloses = closes.slice(CHOP_PIVOT_DAYS.chop_first - 1, CHOP_PIVOT_DAYS.chop_last)
  const chopHi = Math.max(...chopCloses)
  const chopLo = Math.min(...chopCloses)
  let breakoutDay = ''
  let breakoutClose = 0
  let breakoutVolX = 0
  for (let i = CHOP_PIVOT_DAYS.chop_last; i < candles.length; i += 1) {
    if ((closes[i] as number) > chopHi) {
      breakoutDay = (candles[i] as Candle).day
      breakoutClose = closes[i] as number
      breakoutVolX = round2((candles[i] as Candle).volume / median)
      break
    }
  }

  // 趋势台阶：年内最低收盘 vs 震荡区最低收盘 vs 期末收盘（低点抬升的可读证据）
  const minClose = Math.min(...closes)
  const minDay = (candles[closes.indexOf(minClose)] as Candle).day
  const maxClose = Math.max(...closes)
  const maxDay = (candles[closes.indexOf(maxClose)] as Candle).day
  const yangDays = candles.filter((c) => isYang(c)).length

  return {
    file: 'ma-cross.json',
    data: {
      labeling:
        '教学示意·课程自产合成数据：行情为固定种子生成的剧情序列 D1–D250，与任何真实个股无关；回测仅演示均线交叉策略的机制，不构成任何投资建议',
      meta: {
        seed: 42,
        generator: 'companion/src/market.ts · generateTrendCandles + backtestMaCross',
        total: TREND_COUNT,
        days: 'D1–D250',
        short_ma: 5,
        long_ma: 20,
        initial_capital: 10_000,
        lot_size: 100,
        execution: '金叉/死叉在信号确认日的次一交易日开盘价成交；持有不动在 D1 开盘买入后不再交易',
        fee_note:
          '佣金（万2.5、单笔最低5元）与过户费（万0.1）买卖双边，卖出另收印花税（万5）——课程示例值，实际以开户券商合同为准；免费对照组仅把费率置零，交易序列不变',
        volume_median_lots: median,
        yang_days: yangDays,
      },
      candles,
      ma5,
      ma20,
      crosses: bt.crosses.map((c) => ({
        index: c.index,
        day: c.day,
        type: c.type,
        ma5: c.ma5,
        ma20: c.ma20,
        exec_day: c.exec_day,
        exec_price: c.exec_price,
        acted: c.acted,
        lag_days: c.lag_days,
        lag_pct: c.lag_pct,
      })),
      backtest: {
        initial_capital: bt.initial_capital,
        strategy_final: bt.strategy_final,
        strategy_final_no_fee: bt.strategy_final_no_fee,
        hold_final: bt.hold_final,
        strategy_return_pct: round2((bt.strategy_final / bt.initial_capital - 1) * 100),
        strategy_no_fee_return_pct: round2((bt.strategy_final_no_fee / bt.initial_capital - 1) * 100),
        hold_return_pct: round2((bt.hold_final / bt.initial_capital - 1) * 100),
        gap_pct: round2((bt.hold_final / bt.initial_capital - 1) * 100 - (bt.strategy_final / bt.initial_capital - 1) * 100),
        total_fees: bt.total_fees,
        fees_pct_of_capital: round2((bt.total_fees / bt.initial_capital) * 100),
        trade_count: bt.strategy_trades.length,
        round_trips: bt.round_trips,
        whipsaw_round_trips: bt.whipsaw_round_trips,
        strategy_trades: bt.strategy_trades,
        hold_trades: bt.hold_trades,
        strategy_equity: bt.strategy_equity,
        hold_equity: bt.hold_equity,
      },
      reading: {
        lowest_close: { day: minDay, close: minClose },
        highest_close: { day: maxDay, close: maxClose },
        resistance: {
          days: CHOP_PIVOT_DAYS.resistance_days.map((n) => ({ day: at(n).day, close: at(n).close })),
          zone: '震荡区两次冲高回落的顶部区域（压力素材）',
        },
        support: {
          days: CHOP_PIVOT_DAYS.support_days.map((n) => ({ day: at(n).day, close: at(n).close, volume_vs_median: volX(n) })),
          zone: '震荡区三次回踩获承接的底部区域（支撑素材）',
        },
        chop_range: { high_close: chopHi, low_close: chopLo, days: 'D101–D180' },
        breakout: { day: breakoutDay, close: breakoutClose, volume_vs_median: breakoutVolX, note: '末段首次收在震荡区高点之上' },
      },
    },
  }
}
