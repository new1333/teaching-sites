/**
 * 斐波那契回调：fibLevels。
 * 在一段已走完的行程（from→to）上，按固定比例往回量出几档价位：
 * 0.236 / 0.382 / 0.5 / 0.618。数出自斐波那契数列相邻项的比值，
 * 但行情软件里它的用法只是一句话：price = to − (to − from) × 比例。
 * 为什么有人信、什么时候失效，是正文要回答的问题；这里先把刻度算准。
 */

/** 四档回调比例：升序固定，0.5 不是斐波那契比值、是交易界硬加进来的半分位 */
export const FIB_RATIOS = [0.236, 0.382, 0.5, 0.618] as const

/** 一档回调刻度 */
export type FibLevel = {
  /** 回调比例：0.382 即从 to 往 from 方向回撤行程的 38.2% */
  ratio: number
  /** 刻度价位：to − (to − from) × ratio */
  price: number
}

/** 回调刻度：给定行程两端 from 与 to（涨跌皆可），返回四档刻度（按比例升序）。
 *  涨幅段（from 低 to 高）量的是回撤支撑候选；跌幅段（from 高 to 低）量的是反弹阻力候选——
 *  同一条算式，方向由两端的相对位置自带。两端相等是零段行程，没有回调可言，拒绝计算。 */
export function fibLevels(from: number, to: number): FibLevel[] {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    throw new Error(`fibLevels：from 与 to 必须是有限数字，收到的是 ${from}/${to}`)
  }
  if (from === to) {
    throw new Error('fibLevels：from 与 to 不能相等——零段行程没有回调刻度可言')
  }
  return FIB_RATIOS.map((ratio) => ({ ratio, price: to - (to - from) * ratio }))
}
