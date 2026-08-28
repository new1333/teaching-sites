// 全链路申赎对账：申购费 → 持有 → 赎回费，一笔算到底
import { purchase, redemption, redemptionRate } from './fees.mjs'
export const fullRoundTrip = ({ amount, feeRate, navIn, navOut, holdDays, tiers }) => {
  const { net: netAmount, fee: purchaseFee, shares } = purchase({ amount, feeRate, nav: navIn })
  const rate = redemptionRate({ holdDays, tiers })
  const { amount: grossOut, fee: redemptionFee, net: netOut } = redemption({ shares, nav: navOut, feeRate: rate })
  const profit = netOut - amount
  return { netAmount, purchaseFee, shares, grossOut, redemptionRate: rate, redemptionFee, netOut, profit, returnPct: (profit / amount) * 100 }
}
