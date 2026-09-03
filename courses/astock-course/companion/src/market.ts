// companion/src/market.ts · 合成日线生成器（第 4 章 K线教学行情的唯一数据来源）
// 教学示意·固定种子合成数据：以几何随机游走为底（mulberry32 + gaussian，SEED=42），
// 按剧情段设定每日漂移 / 波动 / 量能，并在少数事件日施加形态指令
//（长上影 / 长下影 / 放量大阳 / 缩量大阳 / 缩量小阴 / 高开回落），
// 让「可教特征」稳定存在——特征是否真的成立，由 tests/market.test.ts 的断言锁定。
// 日期一律用相对序号 D1…D60，不冒充任何真实交易日；全部价格满足主板 ±10% 涨跌幅约束。

import { SEED, gaussian, mulberry32 } from './rng'
import { round2 } from './round'

export const CANDLE_COUNT = 60
export const VISIBLE_COUNT = 40 // 「先猜后揭晓」：默认展示前 40 根
export const HIDDEN_COUNT = 20 // 揭晓后展开的后 20 根
export const START_PRICE = 10 // 起始价（元）
export const BASE_VOLUME_LOTS = 80_000 // 基线成交量（手，1 手 = 100 股）
export const DAILY_LIMIT = 0.1 // 主板涨跌幅约束（幅度 10%）

export interface Candle {
  day: string // 'D1'…'D60'
  open: number
  close: number
  high: number
  low: number
  volume: number // 手
}

type Shape = 'plain' | 'long-upper' | 'long-lower' | 'big-yang-heavy' | 'big-yang-light' | 'small-yin-light' | 'gap-fade'

interface DayScript {
  drift: number // 当日对数收益中心
  vol: number // 当日对数收益标准差
  act: number // 量能相对基线倍数
  dir?: 'up' | 'down' // 连续段：强制当日收阳 / 收阴（且收于昨收之上 / 之下）
  shape?: Shape
}

/** 剧情段速记：连续 n 天同一组参数 */
function seg(days: number, drift: number, vol: number, act: number, extra: Partial<DayScript> = {}): DayScript[] {
  return Array.from({ length: days }, () => ({ drift, vol, act, ...extra }))
}

// 剧情脚本（60 根，day = 下标 + 1）：
// 基期横盘 → 连阳上攻 → 长上影见压 → 连阴回调 → 长下影探底 → 缩量蓄势
// → 放量大阳（D36）→ 缩量大阳（D37）→ 高位犹豫 → 缩量小阴（D40，可见部分到此为止）
// → 揭晓段：滞涨 → 回落 → 放量长下影二次探底 → 低位横盘收官
const SCRIPT: DayScript[] = [
  ...seg(12, 0.0005, 0.007, 1.0), // D1–D12 基期横盘
  ...seg(6, 0.013, 0.008, 1.35, { dir: 'up' }), // D13–D18 连续阳线
  { drift: 0.002, vol: 0.006, act: 1.9, shape: 'long-upper' }, // D19 冲高回落·长上影
  { drift: -0.008, vol: 0.009, act: 1.1, dir: 'down' }, // D20 过渡小阴
  ...seg(6, -0.014, 0.01, 1.25, { dir: 'down' }), // D21–D26 连续阴线
  ...seg(3, -0.006, 0.009, 1.0), // D27–D29 阴跌尾段
  { drift: -0.004, vol: 0.008, act: 1.7, shape: 'long-lower' }, // D30 探底回升·长下影
  { drift: 0, vol: 0.006, act: 0.5, shape: 'gap-fade' }, // D31 高开回落·小阴（收盘仍高于昨收）
  ...seg(3, 0.001, 0.006, 0.55), // D32–D34 缩量横盘
  { drift: 0.004, vol: 0.007, act: 0.6, dir: 'up' }, // D35 微阳蓄势
  { drift: 0, vol: 0.006, act: 2.8, shape: 'big-yang-heavy' }, // D36 放量大阳
  { drift: 0, vol: 0.006, act: 0.35, shape: 'big-yang-light' }, // D37 缩量大阳（钩子的另一半）
  ...seg(2, 0.003, 0.007, 0.5, { dir: 'up' }), // D38–D39 高位犹豫小阳
  { drift: 0, vol: 0.005, act: 0.35, shape: 'small-yin-light' }, // D40 缩量小阴（可见区收尾）
  ...seg(4, 0, 0.008, 0.5), // D41–D44 高位滞涨
  ...seg(6, -0.011, 0.011, 0.9), // D45–D50 回落
  ...seg(2, -0.009, 0.012, 1.1), // D51–D52 加速探底
  { drift: -0.005, vol: 0.009, act: 1.8, shape: 'long-lower' }, // D53 放量长下影·二次探底回升
  ...seg(7, 0.0008, 0.006, 0.7), // D54–D60 低位横盘收官
]

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

export function generateDailyCandles(): Candle[] {
  const rng = mulberry32(SEED)
  const candles: Candle[] = []
  let prevClose = START_PRICE

  for (const [i, s] of SCRIPT.entries()) {
    let open: number
    let close: number
    let high: number
    let low: number

    switch (s.shape) {
      case 'long-upper': {
        // 冲高回落：小幅高开 → 盘中冲到高处 → 收在开盘附近（小阳，上影远长于实体）
        open = prevClose * (1 + 0.004 + 0.002 * gaussian(rng))
        close = open * (1 + 0.004 + 0.002 * gaussian(rng))
        high = open * (1 + 0.045 + 0.008 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.004 * Math.abs(gaussian(rng)))
        break
      }
      case 'long-lower': {
        // 探底回升：盘中深跌 → 尾盘拉回开盘上方（小阳，下影远长于实体）
        open = prevClose * (1 - 0.003 + 0.002 * gaussian(rng))
        close = open * (1 + 0.003 + 0.0015 * gaussian(rng))
        low = open * (1 - 0.05 - 0.008 * Math.abs(gaussian(rng)))
        high = Math.max(open, close) * (1 + 0.003 * Math.abs(gaussian(rng)))
        break
      }
      case 'big-yang-heavy':
      case 'big-yang-light': {
        // 大阳线：实体约 4%~5%；两者的差别只在量能（act），形态刻意同款
        open = prevClose * (1 + 0.004 + 0.002 * gaussian(rng))
        close = open * (1 + 0.042 + 0.004 * gaussian(rng))
        high = Math.max(open, close) * (1 + 0.003 * Math.abs(gaussian(rng)))
        low = open * (1 - 0.003 * Math.abs(gaussian(rng)))
        break
      }
      case 'small-yin-light': {
        // 缩量小阴：实体不足半个百分点，影线极短
        open = prevClose * (1 + 0.001 + 0.0015 * gaussian(rng))
        close = open * (1 - 0.004 - 0.001 * gaussian(rng))
        high = Math.max(open, close) * (1 + 0.002 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.002 * Math.abs(gaussian(rng)))
        break
      }
      case 'gap-fade': {
        // 高开回落：跳空高开 2% → 收盘低于开盘（阴线）但高于昨收——
        // 「收>昨收」与「收>开」两条判定在这根蜡烛上答案相反，供定向破坏用
        open = prevClose * (1 + 0.02 + 0.003 * gaussian(rng))
        close = open * (1 - 0.006 - 0.002 * gaussian(rng))
        high = open * (1 + 0.002 * Math.abs(gaussian(rng)))
        low = Math.min(open, close) * (1 - 0.003 * Math.abs(gaussian(rng)))
        break
      }
      default: {
        const gap = clamp(0.002 * gaussian(rng), -0.015, 0.015)
        let logRet = s.drift + s.vol * gaussian(rng)
        if (s.dir === 'up') {
          open = prevClose * (1 + Math.min(Math.abs(gap), 0.012))
          logRet = Math.abs(logRet) + 0.002
          close = open * Math.exp(Math.min(logRet, 0.094))
        } else if (s.dir === 'down') {
          open = prevClose * (1 - Math.min(Math.abs(gap), 0.012))
          logRet = -(Math.abs(logRet) + 0.002)
          close = open * Math.exp(Math.max(logRet, -0.094))
        } else {
          open = prevClose * (1 + gap)
          logRet = clamp(logRet, -0.094, 0.094)
          close = prevClose * Math.exp(logRet)
        }
        const wickUp = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
        const wickDown = Math.abs(gaussian(rng)) * (2.5 * s.vol + 0.002)
        high = Math.max(open, close) * (1 + wickUp)
        low = Math.min(open, close) * (1 - wickDown)
      }
    }

    // 价格统一到分，并保证 OHLC 大小关系在舍入后仍成立
    const o = round2(open)
    const c = round2(close)
    const h = round2(Math.max(high, open, close))
    const l = round2(Math.min(low, open, close))
    candles.push({
      day: `D${i + 1}`,
      open: o,
      close: c,
      high: h,
      low: l,
      volume: Math.round(BASE_VOLUME_LOTS * s.act * Math.exp(0.22 * gaussian(rng))),
    })
    prevClose = c
  }

  return candles
}

// ---- 读图辅助（数据集与测试共用同一实现，禁止平行手抄） ----

export const isYang = (c: Candle): boolean => c.close > c.open
export const bodyOf = (c: Candle): number => round2(c.close - c.open)
export const upperShadowOf = (c: Candle): number => round2(c.high - Math.max(c.open, c.close))
export const lowerShadowOf = (c: Candle): number => round2(Math.min(c.open, c.close) - c.low)

/** 成交量中位数（手）——量能倍数的分母 */
export function medianVolume(candles: Candle[]): number {
  const vs = candles.map((c) => c.volume).sort((a, b) => a - b)
  const mid = Math.floor(vs.length / 2)
  return vs.length % 2 === 1 ? (vs[mid] as number) : Math.round(((vs[mid - 1] as number) + (vs[mid] as number)) / 2)
}

export interface Streak {
  from: number // 起始序号（与 D{n} 一致，1-based）
  to: number
  length: number
}

/** 最长连续阳线（yang=true）或连续阴线（yang=false）段 */
export function longestStreak(candles: Candle[], yang: boolean): Streak {
  let best: Streak = { from: 0, to: 0, length: 0 }
  let start = 0
  for (let i = 0; i <= candles.length; i += 1) {
    const hit = i < candles.length && (yang ? isYang(candles[i] as Candle) : !isYang(candles[i] as Candle))
    if (!hit) {
      const length = i - start
      if (length > best.length) best = { from: start + 1, to: i, length }
      start = i + 1
    }
  }
  return best
}

/** 全天量能最大的交易日序号（1-based） */
export function maxVolumeDay(candles: Candle[]): number {
  let best = 0
  for (let i = 1; i < candles.length; i += 1) {
    if ((candles[i] as Candle).volume > (candles[best] as Candle).volume) best = i
  }
  return best + 1
}
