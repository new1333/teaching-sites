// companion/src/portfolio.ts · 组合、相关性与再平衡演算（第 10 章函数实现与图表数据的唯一实现）
//
// 约定：
// - 收益率一律用小数（0.03 = 3%）；金额为元；比例（权重）用小数。
// - 「组合逐期收益率」采用每月末把比例拨回目标的口径：当月组合涨跌 = w×甲涨跌 + (1−w)×乙涨跌。
//   相关性实验台与钩子组合均按此口径；漂移对照区的「买入持有」路径由 sleeveValues / periodicRebalancePath 承担。
// - 舍入只在导出边界做（src/round.ts），函数本身返回原始精度，期望答案由 tests/portfolio.test.ts 锁定。

/** 皮尔逊相关系数：两串等长收益率涨跌同步程度的度量，取值 −1 到 +1，越接近 0 互相抵消越强。
 *  任一序列没有颠簸（母体标准差为 0）时相关系数无定义，抛错。 */
export function correlation(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n === 0 || n !== ys.length) {
    throw new Error('correlation: 两个序列需等长且非空')
  }
  const meanX = xs.reduce((s, x) => s + x, 0) / n
  const meanY = ys.reduce((s, y) => s + y, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i += 1) {
    const dx = (xs[i] as number) - meanX
    const dy = (ys[i] as number) - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  if (varX === 0 || varY === 0) {
    throw new Error('correlation: 序列需各有颠簸（标准差非 0），否则相关系数无定义')
  }
  return cov / Math.sqrt(varX * varY)
}

/** 组合逐期收益率：每期 w×rA + (1−w)×rB（每月末把比例拨回 w 的口径，见文件头注） */
export function mixReturns(weightA: number, returnsA: number[], returnsB: number[]): number[] {
  const n = returnsA.length
  if (n !== returnsB.length) {
    throw new Error('mixReturns: 两个收益率序列需等长')
  }
  const out: number[] = []
  for (let i = 0; i < n; i += 1) {
    out.push(weightA * (returnsA[i] as number) + (1 - weightA) * (returnsB[i] as number))
  }
  return out
}

/** 买入持有仓位金额：startAmount 按净值路径逐点放大（不调仓，任其漂移） */
export function sleeveValues(startAmount: number, path: number[]): number[] {
  return path.map((v) => startAmount * v)
}

/** 两个仓位金额的当前占比 */
export interface SleeveWeights {
  /** 甲仓位占比（小数） */
  weightA: number
  /** 乙仓位占比（小数） */
  weightB: number
}

export function sleeveWeights(sleeveA: number, sleeveB: number): SleeveWeights {
  const total = sleeveA + sleeveB
  return { weightA: sleeveA / total, weightB: sleeveB / total }
}

/** 再平衡结果：为回到目标比例需要的调仓金额（负数 = 卖出）与调仓后的仓位金额 */
export interface RebalanceResult {
  /** 甲仓位的调仓金额（元），负数 = 卖出 */
  tradeA: number
  /** 乙仓位的调仓金额（元），正数 = 买入 */
  tradeB: number
  /** 调仓后甲仓位金额（元） */
  afterA: number
  /** 调仓后乙仓位金额（元） */
  afterB: number
}

/** 再平衡：卖出超配部分、买入低配部分，把组合拨回目标比例（tradeA 与 tradeB 金额相等、方向相反） */
export function rebalanceTo(sleeveA: number, sleeveB: number, targetWeightA: number): RebalanceResult {
  const total = sleeveA + sleeveB
  const afterA = total * targetWeightA
  const afterB = total * (1 - targetWeightA)
  return { tradeA: afterA - sleeveA, tradeB: afterB - sleeveB, afterA, afterB }
}

/**
 * 周期再平衡的总资产路径：起点金额按 weightA/(1−weightA) 分两仓，每过 periodMonths 期
 * 把两仓比例拨回目标（拨比例不改总资产），其余时间各仓按自己的净值路径买入持有。
 * 返回与输入路径等长的总资产序列（含起点）。
 */
export function periodicRebalancePath(
  pathA: number[],
  pathB: number[],
  weightA: number,
  startAmount: number,
  periodMonths: number,
): number[] {
  if (pathA.length !== pathB.length || pathA.length === 0) {
    throw new Error('periodicRebalancePath: 两条净值路径需等长且非空')
  }
  const out: number[] = []
  let sleeveA = startAmount * weightA
  let sleeveB = startAmount * (1 - weightA)
  for (let i = 0; i < pathA.length; i += 1) {
    if (i > 0) {
      sleeveA *= (pathA[i] as number) / (pathA[i - 1] as number)
      sleeveB *= (pathB[i] as number) / (pathB[i - 1] as number)
    }
    if (i > 0 && i % periodMonths === 0) {
      const total = sleeveA + sleeveB
      sleeveA = total * weightA
      sleeveB = total * (1 - weightA)
    }
    out.push(sleeveA + sleeveB)
  }
  return out
}
