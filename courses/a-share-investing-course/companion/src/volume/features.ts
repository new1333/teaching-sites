import type { Candle } from '../types'

/**
 * 量能特征：volumeFeatures / turnoverRate。
 * 第 11 章的均线只看价格——一条腿走路；成交量是另一条腿：
 * 每一笔成交都同时吃掉一个愿意买的人和一个愿意卖的人，量就是这种「双方到场」的计数。
 * 价格可以是没人反对的漂移，量必须是真金白银的换手——量在价先的全部依据在这句话里。
 */

/** 量能标签：surge=放量、shrink=缩量、climax=天量、drought=地量 */
export type VolumeLabelKind = 'surge' | 'shrink' | 'climax' | 'drought'

/** 一枚量能标签：记在量的「变化」上——台阶站稳后高量不再是放量、低量不再是缩量 */
export type VolumeLabel = {
  /** 打标签的 K 线下标 */
  index: number
  kind: VolumeLabelKind
  /** 当根量 ÷ 前 lookback 根平均量——倍数本身是读数，2 即两倍于近段 */
  ratio: number
}

/** 量价背离点：价格创窗口新高/新低，量却缩到线下——燃料与舟唱反调 */
export type VolumeDivergence = {
  /** 背离成立的 K 线下标（逐根独立判定，不合并区间） */
  index: number
  /** top=价创新高量缩（顶背离）；bottom=价创新低量缩（底背离） */
  kind: 'top' | 'bottom'
  /** 当根量 ÷ 前 lookback 根平均量 */
  ratio: number
  /** 价格创新的幅度：top 为收盘对前窗最高收盘的超出比例，bottom 为对前窗最低收盘的跌出比例 */
  priceMargin: number
}

export type VolumeFeaturesOpts = {
  /** 量能参照窗：当根量与「前 lookback 根平均量」比，价格的新高/新低也在同一窗口里判，默认 5 */
  lookback?: number
  /** 放量线：当根量 ≥ 参照量的这个倍数记放量，默认 1.5 */
  surgeRatio?: number
  /** 缩量线：当根量 ≤ 参照量的这个倍数记缩量（也是背离的量萎缩线），默认 0.7 */
  shrinkRatio?: number
  /** 极值窗：天量/地量在这个根数（含当根）里取严格最大/最小，默认 20 */
  extremeWindow?: number
}

/** 一份量能体检报告：标签与背离点都按时间旧→新 */
export type VolumeReport = {
  labels: VolumeLabel[]
  divergences: VolumeDivergence[]
}

const DEFAULT_OPTS = { lookback: 5, surgeRatio: 1.5, shrinkRatio: 0.7, extremeWindow: 20 }

/** 入参体检：空序列、非法阈值、非法价格或成交量，当场抛中文错误 */
function assertVolumeArgs(candles: readonly Candle[], label: string): void {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error(`${label}：candles 不能为空`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`${label}：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
    if (!Number.isFinite(candles[i].volume) || candles[i].volume < 0) {
      throw new Error(`${label}：第 ${i} 根的成交量必须是不小于 0 的有限数字，收到的是 ${candles[i].volume}`)
    }
  }
}

/** 量能特征扫描：对每根凑得满参照窗的 K 线独立判定，返回全部标签与背离点。
 *  判据全部向后看（只看当根与之前），没有未来函数：
 *  - 放量/缩量看当根量对前 lookback 根平均量的倍数；
 *  - 天量/地量再要求当根量是极值窗（含当根共 extremeWindow 根）内的严格最大/最小——
 *    同根只记最高档：天量本身就是放量的极端、地量本身就是缩量的极端；
 *  - 量价背离=价格在同一窗口里创严格新高/新低、量却缩到 shrinkRatio 线下。 */
export function volumeFeatures(candles: readonly Candle[], opts: VolumeFeaturesOpts = {}): VolumeReport {
  assertVolumeArgs(candles, 'volumeFeatures')
  const lookback = opts.lookback ?? DEFAULT_OPTS.lookback
  const surgeRatio = opts.surgeRatio ?? DEFAULT_OPTS.surgeRatio
  const shrinkRatio = opts.shrinkRatio ?? DEFAULT_OPTS.shrinkRatio
  const extremeWindow = opts.extremeWindow ?? DEFAULT_OPTS.extremeWindow
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error(`volumeFeatures：lookback 必须是正整数，收到的是 ${lookback}`)
  }
  if (!Number.isInteger(extremeWindow) || extremeWindow < 1) {
    throw new Error(`volumeFeatures：extremeWindow 必须是正整数，收到的是 ${extremeWindow}`)
  }
  if (!(surgeRatio > 0) || !Number.isFinite(surgeRatio)) {
    throw new Error(`volumeFeatures：surgeRatio 必须是正数，收到的是 ${surgeRatio}`)
  }
  if (!(shrinkRatio > 0) || !Number.isFinite(shrinkRatio)) {
    throw new Error(`volumeFeatures：shrinkRatio 必须是正数，收到的是 ${shrinkRatio}`)
  }
  if (surgeRatio <= shrinkRatio) {
    throw new Error(`volumeFeatures：surgeRatio 必须大于 shrinkRatio（收到 ${surgeRatio} 对 ${shrinkRatio}）——放量线压不过缩量线，倍数就没了方向`)
  }
  const labels: VolumeLabel[] = []
  const divergences: VolumeDivergence[] = []
  // 主循环从 lookback 起：i 之前必须凑得满一整个参照窗，凑不满的头部不判（不猜）
  for (let i = lookback; i < candles.length; i++) {
    let volSum = 0
    let closeMax = -Infinity
    let closeMin = Infinity
    for (let j = i - lookback; j < i; j++) {
      volSum += candles[j].volume
      if (candles[j].close > closeMax) closeMax = candles[j].close
      if (candles[j].close < closeMin) closeMin = candles[j].close
    }
    const ref = volSum / lookback
    if (ref <= 0) continue // 前段全是零量：没有尺子，这根不量
    const ratio = candles[i].volume / ref
    // 极值窗（含当根）：凑得满一整个窗才参与极值判定，头部不足窗的只走倍数线
    let isExtremeMax = i >= extremeWindow - 1
    let isExtremeMin = i >= extremeWindow - 1
    if (isExtremeMax) {
      for (let j = i - extremeWindow + 1; j < i; j++) {
        if (candles[j].volume >= candles[i].volume) isExtremeMax = false
        if (candles[j].volume <= candles[i].volume) isExtremeMin = false
      }
    }
    const kind: VolumeLabelKind | null =
      ratio >= surgeRatio && isExtremeMax
        ? 'climax'
        : ratio <= shrinkRatio && isExtremeMin
          ? 'drought'
          : ratio >= surgeRatio
            ? 'surge'
            : ratio <= shrinkRatio
              ? 'shrink'
              : null
    if (kind) labels.push({ index: i, kind, ratio })
    // 量价背离：同一窗口里价格创严格新高/新低，量却萎缩——燃料不足而舟独行
    if (ratio <= shrinkRatio) {
      const close = candles[i].close
      if (close > closeMax) {
        divergences.push({ index: i, kind: 'top', ratio, priceMargin: close / closeMax - 1 })
      } else if (close < closeMin) {
        divergences.push({ index: i, kind: 'bottom', ratio, priceMargin: 1 - close / closeMin })
      }
    }
  }
  return { labels, divergences }
}

/** 换手率序列：每根 = 成交量 ÷ 流通股本，0.02 即 2%——今天有多少百分比的筹码换了主人。
 *  同样的成交量，流通盘越小换手越凶：量要除以盘子才有可比性。 */
export function turnoverRate(candles: readonly Candle[], floatShares: number): number[] {
  assertVolumeArgs(candles, 'turnoverRate')
  if (!(floatShares > 0) || !Number.isFinite(floatShares)) {
    throw new Error(`turnoverRate：floatShares 必须是正数（流通股本），收到的是 ${floatShares}`)
  }
  return candles.map((c) => c.volume / floatShares)
}
