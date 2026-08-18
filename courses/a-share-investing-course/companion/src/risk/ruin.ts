import { createRng } from '../data/generate'
import { assertEdgeStats, type EdgeStats } from './expectancy'

/**
 * 破产概率的蒙特卡洛实验室：优势写在参数里，生死写在路径里。
 * 每一注用 fraction 的资金下注：赢，资金 ×(1+fraction×avgWin)；输，×(1−fraction×avgLoss)。
 * 同一套参数跑 trials 条平行宇宙，数一数多少条在路上把资金跌破了破产线——
 * 这就是「仓位越重、破产概率越高」从口号变成读数的地方。
 */

export type RuinOpts = {
  /** 固定种子（createRng 的入参），默认 42：同一种子跑两遍，读数逐项一致 */
  seed?: number
  /** 破产线：资金跌到初始资金的该比例即记破产，默认 0.5（亏掉一半算报废）。分数下注的乘法资金永不归零，只会缩到没法看——破产必须操作化成一条线 */
  ruinLine?: number
}

export type RuinReport = {
  /** 累计破产概率曲线：第 k 项 = 前 k+1 注之内触到破产线的路径占比（吸收口径，单调不降） */
  ruinCurve: number[]
  /** 打满 bets 注后的破产概率 = ruinCurve 末项 */
  ruinProbability: number
  /** 破产路径平均在第几注触线（从 1 数起）；一条都没死记 null */
  meanRuinBet: number | null
  bets: number
  trials: number
  /** 下注用的资金比例（仓位口径：1 = 每注全仓进出） */
  fraction: number
  ruinLine: number
  seed: number
}

function assertRuinArgs(bets: number, trials: number, fraction: number, opts: RuinOpts, label: string): number {
  if (!Number.isInteger(bets) || bets < 1) {
    throw new Error(`${label}：bets 必须是正整数，收到的是 ${bets}`)
  }
  if (!Number.isInteger(trials) || trials < 1) {
    throw new Error(`${label}：trials 必须是正整数，收到的是 ${trials}`)
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`${label}：fraction 必须在 (0,1] 内（仓位口径，1=全仓），收到的是 ${fraction}`)
  }
  const ruinLine = opts.ruinLine ?? 0.5
  if (!Number.isFinite(ruinLine) || ruinLine <= 0 || ruinLine >= 1) {
    throw new Error(`${label}：ruinLine 必须在 (0,1) 内，收到的是 ${ruinLine}`)
  }
  const seed = opts.seed ?? 42
  if (!Number.isInteger(seed)) {
    throw new Error(`${label}：seed 必须是整数，收到的是 ${seed}`)
  }
  return ruinLine
}

/** 蒙特卡洛破产概率：同一套参数、同一个仓位，trials 条平行宇宙各打 bets 注。
 *  返回的不只是一个数——ruinCurve 把「第几注时已经死了多少条」整条曲线交出来，
 *  「破产概率随交易次数上升」不再是断言，是曲线本身。 */
export function monteCarloRuin(
  stats: EdgeStats,
  bets: number,
  trials: number,
  fraction: number,
  opts: RuinOpts = {},
): RuinReport {
  assertEdgeStats(stats, 'monteCarloRuin')
  const ruinLine = assertRuinArgs(bets, trials, fraction, opts, 'monteCarloRuin')
  const rng = createRng(opts.seed ?? 42)
  const winMul = 1 + fraction * stats.avgWin
  const lossMul = 1 - fraction * stats.avgLoss

  const hits = new Array<number>(bets).fill(0) // 每一注的累计死亡数
  const ruinBets: number[] = []
  for (let t = 0; t < trials; t++) {
    let equity = 1
    let ruinedAt = -1
    for (let k = 0; k < bets; k++) {
      equity *= rng() < stats.winRate ? winMul : lossMul
      if (equity <= ruinLine) {
        ruinedAt = k
        break // 破产是吸收态：破了产的钱不再翻本，后面的注不打了
      }
    }
    if (ruinedAt < 0) continue
    ruinBets.push(ruinedAt + 1)
    for (let k = ruinedAt; k < bets; k++) hits[k]++ // 从触线那注起，之后每一格都算「已破产」
  }

  const ruinCurve = hits.map((h) => h / trials)
  const meanRuinBet =
    ruinBets.length === 0
      ? null
      : ruinBets.reduce((a, b) => a + b, 0) / ruinBets.length
  return {
    ruinCurve,
    ruinProbability: ruinCurve[ruinCurve.length - 1],
    meanRuinBet,
    bets,
    trials,
    fraction,
    ruinLine,
    seed: opts.seed ?? 42,
  }
}

/** 资金路径：paths 条平行宇宙各自打 bets 注的余额序列（每条从 1 起步），扇形图的原料。
 *  纯乘法模拟、不设破产线截断——数学资金永不归零，只会缩到没法看；「何时算死」的口径在 monteCarloRuin。 */
export function equityPaths(
  stats: EdgeStats,
  bets: number,
  paths: number,
  fraction: number,
  opts: { seed?: number } = {},
): number[][] {
  assertEdgeStats(stats, 'equityPaths')
  if (!Number.isInteger(bets) || bets < 1) {
    throw new Error(`equityPaths：bets 必须是正整数，收到的是 ${bets}`)
  }
  if (!Number.isInteger(paths) || paths < 1) {
    throw new Error(`equityPaths：paths 必须是正整数，收到的是 ${paths}`)
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`equityPaths：fraction 必须在 (0,1] 内，收到的是 ${fraction}`)
  }
  const seed = opts.seed ?? 42
  if (!Number.isInteger(seed)) {
    throw new Error(`equityPaths：seed 必须是整数，收到的是 ${seed}`)
  }
  const rng = createRng(seed)
  const winMul = 1 + fraction * stats.avgWin
  const lossMul = 1 - fraction * stats.avgLoss

  const out: number[][] = []
  for (let t = 0; t < paths; t++) {
    const path: number[] = [1]
    let equity = 1
    for (let k = 0; k < bets; k++) {
      equity *= rng() < stats.winRate ? winMul : lossMul
      path.push(equity)
    }
    out.push(path)
  }
  return out
}
