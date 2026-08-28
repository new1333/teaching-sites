// 货币基金口径：万份收益与七日年化（单利折算）
export const sevenDayAnnualized = ({ dailyReturns, yearDays = 365 }) => {
  const avg = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
  const rate = (avg * yearDays) / 10000
  return { rate, pct: rate * 100 }
}
export const oneDayIncome = ({ amount, per10k }) => (amount / 10000) * per10k
export const applyRate = ({ amount, rate }) => amount * rate
