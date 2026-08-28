// 净值记账：单位净值、累计净值、份额折算
export const unitNav = ({ assets, liabilities, shares }) => (assets - liabilities) / shares
export const cumNav = ({ unit, dividends }) => unit + dividends.reduce((a, b) => a + b, 0)
export const sharesFor = ({ amount, nav }) => amount / nav
export const splitTo = ({ shares, nav, target }) => ({ newShares: (shares * nav) / target, newNav: target })
export const diff = ({ a, b }) => a - b
export const mul = ({ a, b }) => a * b
export const sum = ({ items }) => items.reduce((a, b) => a + b, 0)
