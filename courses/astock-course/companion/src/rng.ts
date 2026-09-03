// companion/src/rng.ts · 固定种子随机数（全书合成行情数据的唯一随机源）
// 约定：任何图表/回测数据不得使用 Math.random，必须经过这里，保证两次导出逐字节一致。

export const SEED = 42

/** mulberry32：32 位可复现伪随机数发生器，返回 [0, 1) */
export function mulberry32(seed: number = SEED): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller 正态近似，用于合成对数收益率 */
export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  const v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
