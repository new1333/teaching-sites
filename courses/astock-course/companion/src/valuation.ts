// companion/src/valuation.ts · 估值倍数演算（第 7 章 worksheet 的唯一实现）
//
// 约定：
// - 价格、每股盈利、每股净资产、每股分红单位为元；总量路线的净利润与所有者权益单位为亿元，
//   总股本单位为亿股。比率以小数存储，呈现时转百分数保留 2 位（0.10 = 10.00%），
//   对应 bible verification_conventions.rounding 与 fixtures/valuation.json conventions。
// - 倍数一律用原始输入一步算完再舍入（round1 = 保留 1 位小数）；盈利收益率与股息率按
//   分子 ÷ 分母一步算完再舍入（roundRatio 复用 src/statements.ts 同一实现），
//   不从舍入后的倍数取倒数——两条口径会差零点几个百分点，以一步口径为准。
// - 市盈率两条路线（股价 ÷ 每股盈利、市值 ÷ 净利润）恒等于同一倍数：总股本在两式相除中约掉。
// - 无风险利率锚：一年期定期存款挂牌利率 0.95%（2025-05-20 工农中建交五大行挂牌；邮储 0.98%；人民网当日报道口径）。
//   挂牌利率会调整，正文提示读者以银行最新挂牌为准；记录见 fixtures/valuation.json risk_free_anchor。
// - 期望答案锁定在 fixtures/valuation.json，由 tests/valuation.test.ts 断言一致。
// - 股票 A、B 与公司丁、戊、己、庚、辛、壬均为合成教学标的，与任何真实上市公司无关（差异附录登记）。

import { round1, round2 } from './round'
import { roundRatio } from './statements'

/** 无风险利率锚：一年期定期存款挂牌利率（2025-05-20 五大行挂牌 0.95%、邮储 0.98%；会调整，以最新挂牌为准） */
export const RISK_FREE_DEPOSIT_1Y = 0.0095

/** 每股盈利：净利润 ÷ 总股本——价签背后每年每股的赚头（元/股） */
export function earningsPerShare(netProfitYi: number, totalSharesYi: number): number {
  return round2(netProfitYi / totalSharesYi)
}

/** 市盈率（每股路线）：股价 ÷ 每股盈利——按当前盈利多少年回本的静态倍数 */
export function peRatio(price: number, earningsPerShareValue: number): number {
  return round1(price / earningsPerShareValue)
}

/** 市盈率（总量路线）：市值 ÷ 净利润——与每股路线同一倍数（总股本在两式相除中约掉） */
export function peFromMarketCap(marketCapYi: number, netProfitYi: number): number {
  return round1(marketCapYi / netProfitYi)
}

/** 盈利收益率：每股盈利 ÷ 股价 = 1 ÷ 市盈率（未舍入口径）——每一元股价每年赚回多少利润 */
export function earningsYield(earningsPerShareValue: number, price: number): number {
  return roundRatio(earningsPerShareValue / price)
}

/** 每股净资产：所有者权益 ÷ 总股本——还清一切欠款后归股东的家底折到每股（元/股） */
export function bookValuePerShare(equityYi: number, totalSharesYi: number): number {
  return round2(equityYi / totalSharesYi)
}

/** 市净率：股价 ÷ 每股净资产——价格相对账面家底的倍数 */
export function pbRatio(price: number, bookValuePerShareValue: number): number {
  return round1(price / bookValuePerShareValue)
}

/** 股息率：每股分红 ÷ 股价——持有股票的年度现金回报率 */
export function dividendYield(dividendPerShare: number, price: number): number {
  return roundRatio(dividendPerShare / price)
}

/** 主业每股盈利：报表每股盈利 − 一次性收益每股——判定一律用可持续的主业口径（元/股） */
export function coreEarningsPerShare(reportedEps: number, oneOffPerShare: number): number {
  return round2(reportedEps - oneOffPerShare)
}

/** 市净率适用边界：家底大体上账、账面接近可变现价值的行业（银行、重资产）才有称重意义 */
export type BookQuality = 'asset-heavy' | 'asset-light'

/** 轻资产行业核心家底（品牌、用户、代码）不进资产负债表，市净率参考意义弱 */
export function pbMeaningful(kind: BookQuality): boolean {
  return kind === 'asset-heavy'
}

/** 存款锚判定：盈利收益率 ≥ 一年期存款挂牌利率 → 「不输存款」（便宜侧）；< → 「贵得危险」（贵侧）。课程粗筛口径，不是买入建议 */
export function depositAnchorVerdict(
  earningsYieldRatio: number,
  riskFreeRate: number = RISK_FREE_DEPOSIT_1Y,
): '不输存款' | '贵得危险' {
  return earningsYieldRatio >= riskFreeRate ? '不输存款' : '贵得危险'
}
