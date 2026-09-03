// companion/src/round.ts · 舍入约定（唯一实现，对应 bible.verification_conventions.rounding）
// 金额（元）2 位小数；估值倍数 1 位小数；比率以小数形式存储、呈现时再转百分数。

export const round2 = (x: number): number => Math.round(x * 100) / 100
export const round1 = (x: number): number => Math.round(x * 10) / 10

/** 涨跌停价专用：四舍五入到 0.01 元，避免浮点尾巴（如 10.999999998） */
export const roundTick = (x: number): number => Math.round(x * 100) / 100
