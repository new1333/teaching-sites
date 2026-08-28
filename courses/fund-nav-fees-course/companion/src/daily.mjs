// 管理费/托管费日计提：H = E × 年费率 / 当年天数（E 为前一日资产净值）
export const dailyAccrual = ({ assets, annualRate, yearDays = 365 }) => (assets * annualRate) / yearDays
export const yearAccrual = ({ assets, annualRate, yearDays = 365 }) => assets * annualRate
