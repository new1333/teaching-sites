// A/C 份额费用对比与盈亏平衡持有天数
export const breakEvenDays = ({ purchaseFeeRate, serviceRate, yearDays = 365 }) =>
  Math.ceil((purchaseFeeRate / serviceRate) * yearDays)
export const costA = ({ amount, feeRate }) => amount * feeRate
export const costC = ({ amount, serviceRate, days, yearDays = 365 }) => (amount * serviceRate * days) / yearDays
