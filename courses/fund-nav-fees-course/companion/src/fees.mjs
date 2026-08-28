// 申赎费用：外扣法申购、赎回费与持有期阶梯
export const purchase = ({ amount, feeRate, nav }) => {
  const net = amount / (1 + feeRate) // 外扣法：净申购金额 = 申购金额 / (1 + 费率)
  const fee = amount - net
  return { net, fee, shares: net / nav }
}
export const costNavInclFee = ({ amount, feeRate, nav }) => {
  const { shares } = purchase({ amount, feeRate, nav })
  return amount / shares
}
export const redemption = ({ shares, nav, feeRate }) => {
  const amount = shares * nav
  const fee = amount * feeRate
  return { amount, fee, net: amount - fee }
}
// tiers: [[持有天数上限(不含), 费率], ...] 最后档上限用 null 表示「及以上」
export const redemptionRate = ({ holdDays, tiers }) =>
  (tiers.find(([maxDays]) => maxDays === null || holdDays < maxDays) ?? [null, 0])[1]
