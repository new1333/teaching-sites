import type { Candle } from '../types'
import { createRng } from '../data/generate'

/**
 * 形态统计验货：把「这个形态灵不灵」从吵不完的口水资源问题，变成三行读数。
 * evaluatePattern 回答「命中之后赢面多大、比不看形态瞎做高多少」；
 * shuffleControl 回答「这么点样本，随机凑一组也能碰出这个胜率吗」。
 * 判定「输赢」用收盘对收盘：命中日收盘买入（看涨视角）、horizon 根后收盘卖出——
 * 不含费用、不查涨跌停可成交性，那是第 21 章回测引擎的事。
 */

/** 形态判定器：第 i 根是否命中某个形态（单根/双根/多根识别器都能包进来） */
export type PatternMatcher = (candles: readonly Candle[], index: number) => boolean

/** 看涨=之后收盘更高才算赢；看跌=之后收盘更低才算赢。平手双向都算输 */
export type TradeDirection = 'bull' | 'bear'

export type PatternStats = {
  /** 胜率：命中的判定日里，horizon 根后收盘朝约定方向走的比例；无命中记 0 */
  winRate: number
  /** 样本量：既命中、又走完了 horizon 根的判定日个数——窗口外的命中不算数 */
  sampleSize: number
  /** 基准概率：全部走完 horizon 根的K线里，收盘朝同方向走的比例——不看形态的成绩单 */
  baseline: number
}

export type ShuffleStats = {
  /** 对照组组数 */
  trials: number
  /** 每组抽样的判定日个数（等于形态的有效命中数） */
  sampleSize: number
  /** 实测胜率（与 evaluatePattern 的 winRate 同源） */
  winRate: number
  /** 各随机对照组胜率的平均：没有优势时应贴着基准概率 */
  meanWinRate: number
  /** 对照组胜率达到实测的组数占比——越接近 0，实测优势越不像碰巧；无命中记 1（读数无意义） */
  beatRatio: number
  /** 各对照组的胜率（按生成顺序，长度 = trials）：分布本身就是读数——抖多宽、挤在哪，一眼可见 */
  rates: number[]
}

export type ShuffleOpts = {
  /** 对照组组数，默认 200 */
  trials?: number
  /** 固定种子（createRng 的入参），默认 42：同一种子跑两遍，读数逐项一致 */
  seed?: number
  /** 输赢方向，与 evaluatePattern 同款，默认看涨 */
  direction?: TradeDirection
}

/** 赢面判定：horizon 根后的收盘对命中日收盘，严格朝约定方向才算赢（平手算输） */
function isWin(candles: readonly Candle[], index: number, horizon: number, direction: TradeDirection): boolean {
  const now = candles[index].close
  const then = candles[index + horizon].close
  return direction === 'bull' ? then > now : then < now
}

function assertSeries(candles: readonly Candle[], horizon: number, label: string): number {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${label}：candles 不能为空`)
  }
  if (!Number.isInteger(horizon) || horizon < 1) {
    throw new Error(`${label}：horizon 必须是正整数，收到的是 ${horizon}`)
  }
  if (candles.length <= horizon) {
    throw new Error(`${label}：序列至少要 ${horizon + 1} 根K线才走得完一个前瞻窗口，收到的是 ${candles.length} 根`)
  }
  const last = candles.length - 1 - horizon
  for (let i = 0; i <= last + horizon; i++) {
    const close = candles[i].close
    if (!Number.isFinite(close)) {
      throw new Error(`${label}：第 ${i} 根的收盘价必须是有限数字，收到的是 ${close}`)
    }
  }
  return last
}

/** 给形态验货：命中日的胜率、样本量，与「不看形态」的基准概率同场对比。
 *  两个方向判据同构：胜率高出本方向的基准才算真有优势——看跌形态的胜率与基准都以「之后收跌」为赢的口径。 */
export function evaluatePattern(
  candles: readonly Candle[],
  matcher: PatternMatcher,
  horizon: number,
  direction: TradeDirection = 'bull',
): PatternStats {
  if (typeof matcher !== 'function') {
    throw new Error(`evaluatePattern：matcher 必须是函数，收到的是 ${typeof matcher}`)
  }
  if (direction !== 'bull' && direction !== 'bear') {
    throw new Error(`evaluatePattern：direction 必须是 bull/bear 之一，收到的是 ${direction}`)
  }
  const last = assertSeries(candles, horizon, 'evaluatePattern')

  let wins = 0
  let hits = 0
  let baseWins = 0
  for (let i = 0; i <= last; i++) {
    if (isWin(candles, i, horizon, direction)) baseWins++
    if (matcher(candles, i)) {
      hits++
      if (isWin(candles, i, horizon, direction)) wins++
    }
  }
  return {
    winRate: hits === 0 ? 0 : wins / hits,
    sampleSize: hits,
    baseline: baseWins / (last + 1), // assertSeries 保证 last ≥ 0
  }
}

/** 随机对照：从全部可判定日里随机抽出与形态命中数同样多的日子，算一遍胜率——重复 trials 组。
 *  回答的是样本量问题：胜率 0.6 看着神，若随机凑的日子十组里有八组也能到 0.6，那就不是形态的本事。
 *  beatRatio = 对照组里胜率达到实测的占比：200 组里 0 组反超（beatRatio=0）是有优势的硬证据；
 *  beatRatio 越大，实测胜率越可能只是这个样本量下的正常抖动。 */
export function shuffleControl(
  candles: readonly Candle[],
  matcher: PatternMatcher,
  horizon: number,
  opts: ShuffleOpts = {},
): ShuffleStats {
  const trials = opts.trials ?? 200
  const seed = opts.seed ?? 42
  const direction = opts.direction ?? 'bull'
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`shuffleControl：trials 必须是正整数，收到的是 ${trials}`)
  }
  if (!Number.isInteger(seed)) {
    throw new Error(`shuffleControl：seed 必须是整数，收到的是 ${seed}`)
  }
  const actual = evaluatePattern(candles, matcher, horizon, direction)
  const last = candles.length - 1 - horizon
  const pool = Array.from({ length: last + 1 }, (_, i) => i) // 全部走得完前瞻窗口的判定日

  if (actual.sampleSize === 0) {
    return { trials, sampleSize: 0, winRate: 0, meanWinRate: 0, beatRatio: 1, rates: [] }
  }

  const rng = createRng(seed)
  let sum = 0
  let beat = 0
  const rates: number[] = []
  for (let t = 0; t < trials; t++) {
    // 每组都从完整的池子重抽：partial Fisher–Yates 洗牌取前 sampleSize 个（不重复抽样）
    const bag = [...pool]
    for (let k = 0; k < actual.sampleSize; k++) {
      const j = k + Math.floor(rng() * (bag.length - k))
      ;[bag[k], bag[j]] = [bag[j], bag[k]]
    }
    let wins = 0
    for (let k = 0; k < actual.sampleSize; k++) {
      if (isWin(candles, bag[k], horizon, direction)) wins++
    }
    const rate = wins / actual.sampleSize
    rates.push(rate)
    sum += rate
    if (rate >= actual.winRate) beat++
  }
  return {
    trials,
    sampleSize: actual.sampleSize,
    winRate: actual.winRate,
    meanWinRate: sum / trials,
    beatRatio: beat / trials,
    rates,
  }
}
