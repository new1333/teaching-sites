/**
 * 标准差与分布样本生产线：第 18 章的两件统计件。
 * stdev 量「一组数离平均数平均有多远」——布林带的宽窄全由它决定；
 * normalDraws / leptokurticDraws 造实验样本：前者吐正态噪声，后者吐「小波动打底、
 * 偶发大跳」的尖峰肥尾噪声，两列的总标准差被解到分毫不差——肥尾实验的公平对照前提。
 */

/**
 * 总体标准差：先算平均，再算每个数离平均的离差，平方求和除以个数（÷n 口径），最后开方。
 * 统计课的样本标准差（÷(n−1)）会稍大一点；行情软件的布林带通行总体口径，本实验场随行就市。
 */
export function stdev(values: readonly number[]): number {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('stdev：values 不能为空')
  }
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`stdev：第 ${i} 个值必须是有限数字，收到的是 ${values[i]}`)
    }
    sum += values[i]
  }
  const mean = sum / values.length
  let squares = 0
  for (let i = 0; i < values.length; i++) {
    squares += (values[i] - mean) * (values[i] - mean)
  }
  return Math.sqrt(squares / values.length)
}

/** Box–Muller 的单值发生器：把 [0,1) 均匀随机源变成正态随机源，多余的一个值存进 spare 下次再吐 */
function normalNext(rng: () => number): () => number {
  let spare: number | null = null
  return () => {
    if (spare != null) {
      const cached = spare
      spare = null
      return cached
    }
    const u1 = 1 - rng() // 1−rng() 落在 (0,1]：log(0) 无从发生
    const u2 = rng()
    const r = Math.sqrt(-2 * Math.log(u1))
    spare = r * Math.sin(2 * Math.PI * u2)
    return r * Math.cos(2 * Math.PI * u2)
  }
}

/** count 个正态读数：均值 mean（默认 0）、标准差 sigma（默认 1），固定种子确定性输出 */
export function normalDraws(rng: () => number, count: number, sigma = 1, mean = 0): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`normalDraws：count 必须是正整数，收到的是 ${count}`)
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new Error(`normalDraws：sigma 必须是非负有限数，收到的是 ${sigma}`)
  }
  const next = normalNext(rng)
  const out: number[] = []
  for (let i = 0; i < count; i++) out.push(mean + next() * sigma)
  return out
}

/** 尖峰肥尾混合：概率 spikeChance 的日子跳变分量 N(0, L·σ)、其余日子小波动分量 N(0, quietShare·σ)。
 *  L 不是拍脑袋定的——它被「总标准差恰为 sigma」反解出来：
 *  (1−p)·quietShare² + p·L² = 1，与 normalDraws 的同 σ 序列才配当公平对照。 */
export function leptokurticDraws(
  rng: () => number,
  count: number,
  sigma = 1,
  spikeChance = 0.12,
  quietShare = 0.1,
): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`leptokurticDraws：count 必须是正整数，收到的是 ${count}`)
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new Error(`leptokurticDraws：sigma 必须是非负有限数，收到的是 ${sigma}`)
  }
  if (!Number.isFinite(spikeChance) || spikeChance <= 0 || spikeChance >= 1) {
    throw new Error(`leptokurticDraws：spikeChance 必须是 (0,1) 内的数，收到的是 ${spikeChance}`)
  }
  if (!Number.isFinite(quietShare) || quietShare < 0 || quietShare >= 1) {
    throw new Error(`leptokurticDraws：quietShare 必须是 [0,1) 内的数，收到的是 ${quietShare}`)
  }
  const L = Math.sqrt((1 - (1 - spikeChance) * quietShare * quietShare) / spikeChance)
  const next = normalNext(rng)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push((rng() < spikeChance ? next() * L : next() * quietShare) * sigma)
  }
  return out
}
