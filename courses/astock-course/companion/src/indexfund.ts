// companion/src/indexfund.ts · 指数基金与 ETF（第 13 章 worksheet 的唯一实现）
//
// 约定：
// - 费率吞噬用第 1 章复利（src/finance.ts growthFactor）直接算：净收益率 = 毛收益率 − 费率，
//   不另设第二套复利公式；赌局年化用第 1 章 annualizedReturn，最深坑用第 9 章 maxDrawdown / recoveryGain。
// - 定投回测不在此文件重复实现：直接调用第 11 章 src/position.ts 的 dcaSchedule（一行未改），
//   只换上本章的合成指数基金净值序列——这是「旧积木 + 新行情」的组装点。
// - 合成净值：固定种子（src/rng.ts mulberry32 + gaussian）逐月生成对数正态式月涨跌，
//   净值 round4 保留 4 位小数，起点 1.0000；数据为课程自产合成教学数据，与任何真实指数、真实基金无关。
// - ETF 折溢价按「市价 ÷ 净值 − 1」的课程简化口径；交易费用沿用第 3 章股票口径（由 dcaSchedule 内部取用），
//   实际 ETF 买卖免印花税——课程口径偏保守，差异登记附录「简化与差异清单」。

import { growthFactor } from './finance'
import { gaussian, mulberry32 } from './rng'
import { round2 } from './round'

/** 费率吞噬对照：同一笔本金、同一档毛收益，两档费率各自滚 n 年后的终值与差额 */
export interface FeeDragResult {
  /** 低费率档的净收益率（小数）= 毛收益率 − 低费率 */
  netLowRate: number
  /** 高费率档的净收益率（小数）= 毛收益率 − 高费率 */
  netHighRate: number
  /** 低费率档终值（元） */
  lowEnd: number
  /** 高费率档终值（元） */
  highEnd: number
  /** 终值差（元）= 低费率终值 − 高费率终值，费率差在复利里滚出来的部分 */
  gap: number
  /** 终值差占本金（%） */
  gapPctOfPrincipal: number
}

/**
 * 费率吞噬：毛收益相同、只有费率不同的两份钱，n 年后差多少。
 * 费率不是从本金里另扣一笔钱，而是每年从收益率里削掉一角，再一起进复利——
 * 所以用「毛收益率 − 费率」做净收益率、交回第 1 章的增值因子滚 n 年，而不是做减法。
 */
export function feeDrag(
  principal: number,
  grossRate: number,
  lowFee: number,
  highFee: number,
  years: number,
): FeeDragResult {
  if (principal <= 0) throw new Error('feeDrag: 本金需为正数')
  if (grossRate < 0) throw new Error('feeDrag: 毛收益率不能为负')
  if (lowFee < 0 || highFee < 0) throw new Error('feeDrag: 费率不能为负')
  if (lowFee > highFee) throw new Error('feeDrag: 低费率档需不高于高费率档')
  if (years <= 0) throw new Error('feeDrag: 年数需为正数')
  const netLowRate = grossRate - lowFee
  const netHighRate = grossRate - highFee
  const lowEnd = round2(principal * growthFactor(netLowRate, years))
  const highEnd = round2(principal * growthFactor(netHighRate, years))
  const gap = round2(lowEnd - highEnd)
  return { netLowRate, netHighRate, lowEnd, highEnd, gap, gapPctOfPrincipal: round2((gap / principal) * 100) }
}

/** ETF 折溢价对照：按市价在场内买，与按净值申购（场外口径）各付多少 */
export interface PremiumResult {
  /** 溢价率（%）= 市价 ÷ 净值 − 1，负数即折价 */
  premiumPct: number
  /** 按市价买入 units 份的付出（元） */
  payAtMarket: number
  /** 按净值申购 units 份的付出（元，课程简化：不计申购费） */
  payAtNav: number
  /** 溢价多付（元，负数 = 折价少付） */
  extraPaid: number
}

/**
 * ETF 折溢价：场内价格由买卖双方出价决定，净值由基金持有的一篮子证券值多少钱决定，
 * 两者通常不相等。溢价买入 = 为同一篮子证券多付钱。
 */
export function premiumCost(nav: number, marketPrice: number, units: number): PremiumResult {
  if (nav <= 0 || marketPrice <= 0 || units <= 0) {
    throw new Error('premiumCost: 净值、市价与份额都需为正数')
  }
  const premiumPct = round2((marketPrice / nav - 1) * 100)
  const payAtMarket = round2(marketPrice * units)
  const payAtNav = round2(nav * units)
  return { premiumPct, payAtMarket, payAtNav, extraPaid: round2(payAtMarket - payAtNav) }
}

/**
 * 合成宽基指数基金的月度净值序列（课程自产合成教学数据）：
 * 起点 1.0000，逐月按「基均涨幅 + 波动 × 种子噪声」滚动，净值保留 4 位小数。
 * 固定种子保证同一参数永远生成同一条路径——图表与 fixtures 的每个数都可复现。
 */
export function syntheticFundNav(
  months: number,
  meanMonthly: number,
  sigmaMonthly: number,
  seed: number,
): number[] {
  if (months <= 0) throw new Error('syntheticFundNav: 月数需为正数')
  const rng = mulberry32(seed)
  const prices: number[] = []
  let nav = 1
  for (let i = 0; i < months; i += 1) {
    nav *= 1 + meanMonthly + sigmaMonthly * gaussian(rng)
    prices.push(Math.round(nav * 10000) / 10000)
  }
  return prices
}
