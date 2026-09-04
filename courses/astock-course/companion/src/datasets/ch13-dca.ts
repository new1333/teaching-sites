// companion/src/datasets/ch13-dca.ts · 第 13 章数据集：合成宽基指数 240 个月定投回测 → dca-vs-lump.json
// 全部数据为固定种子合成的教学剧情（教学示意·课程自产合成数据，与任何真实指数、真实基金无关）：
// - 合成宽基指数基金净值：种子 63，月均涨幅 0.75%、月波动 4.5%（沪深300式大盘宽基特征），起点 1.0000，
//   240 个月中途走出一段 39.32% 的深坑（M66 峰 → M103 谷），随后约 11 年修复；
// - 定投：每月 1000 元投 240 期，直接调用第 11 章 src/position.ts 的 dcaSchedule（一行未改）——
//   换一段合成指数行情进来旧函数照常运转，这是本章的组装证据；
// - 一次性对照：240,000 元按第 1 期净值一次买入，路径由第 10 章 portfolio.sleeveValues 生成（不计交易费用，课程简化）；
// - 两档费率终值：indexfund.feeDrag（内部调用第 1 章 finance.growthFactor），0.2% 对 1.5%，20 年。
// 回撤、回本涨幅、年化一律调用 src/finance.ts，无平行第二套算法；
// 正文（docs/13-index-etf.md）与 DcaChart 组件的一切承重数字取自本模块的导出产物。

import { annualizedReturn, maxDrawdown, recoveryGain } from '../finance'
import { sleeveValues } from '../portfolio'
import { dcaSchedule } from '../position'
import { round2 } from '../round'
import { feeDrag, syntheticFundNav } from '../indexfund'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

export const CH13_SEED = 63
const MONTHS = 240
const MONTHLY_AMOUNT = 1000
const LUMP_AMOUNT = 240000
const FEE_PRINCIPAL = 100000
const FEE_GROSS = 0.08
const FEE_LOW = 0.002
const FEE_HIGH = 0.015
const FEE_YEARS = 20

export interface Ch13Data {
  labeling: string
  meta: {
    seed: number
    months: number
    monthly_amount: number
    invested_total: number
    generator: string
    seed_note: string
    nav_note: string
    fee_note: string
    lump_note: string
  }
  months_labels: string[]
  nav: {
    prices: number[]
    final_nav: number
    total_return_pct: number
    annualized_pct: number
    max_drawdown: {
      peak_month: string
      trough_month: string
      peak_nav: number
      trough_nav: number
      drawdown_pct: number
      recovery_gain_pct: number
    }
  }
  dca: {
    total_amount: number
    total_fees: number
    total_paid: number
    total_shares: number
    avg_cost: number
    avg_cost_ex_fee: number
    end_nav: number
    end_value: number
    pl_pct: number
    net_pl_pct: number
    avg_cost_series: number[]
    mark_series: number[]
    cum_paid_series: number[]
    deepest_underwater: { month: number; mark: number; cum_amount: number; underwater_pct: number }
  }
  lump: {
    start_amount: number
    buy_nav: number
    end_value: number
    total_return_pct: number
    values: number[]
  }
  fee_tiers: {
    principal: number
    gross_rate_pct: number
    low_fee_pct: number
    high_fee_pct: number
    years: number
    low_end: number
    high_end: number
    gap: number
    gap_pct_of_principal: number
  }
}

export function buildCh13(): Dataset {
  const prices = syntheticFundNav(MONTHS, 0.0075, 0.045, CH13_SEED)
  const dca = dcaSchedule(MONTHLY_AMOUNT, prices)

  // 一次性对照：按第 1 期净值一次买入，路径沿用第 10 章 sleeveValues（买入持有的金额放大器）
  const buyNav = prices[0] as number
  const normalized = prices.map((p) => p / buyNav)
  const lumpValues = sleeveValues(LUMP_AMOUNT, normalized).map(round2)

  const mdd = maxDrawdown(prices)
  const finalNav = prices[prices.length - 1] as number

  // 定投逐月盯市：市值、累计付出、平均成本三条序列 + 最深浮亏的一个月
  const avgCostSeries: number[] = []
  const markSeries: number[] = []
  const cumPaidSeries: number[] = []
  let worst = { month: 0, mark: 0, cumAmount: 0, underwaterPct: 0 }
  for (const p of dca.periods) {
    avgCostSeries.push(p.avgCost)
    cumPaidSeries.push(p.cumPaid)
    const mark = round2(p.cumShares * p.price)
    markSeries.push(mark)
    const u = round2(((mark - p.cumAmount) / p.cumAmount) * 100)
    if (u < worst.underwaterPct) worst = { month: p.month, mark, cumAmount: p.cumAmount, underwaterPct: u }
  }

  const fee = feeDrag(FEE_PRINCIPAL, FEE_GROSS, FEE_LOW, FEE_HIGH, FEE_YEARS)

  const data: Ch13Data = {
    labeling:
      '教学示意·课程自产合成数据：净值路径由固定种子（63）合成，具有沪深300式大盘宽基的形状特征，但与任何真实指数、真实基金的历史与未来无关；定投按第 3 章股票费用口径计费（实际 ETF 免印花税，课程口径偏保守）；不构成任何投资建议',
    meta: {
      seed: CH13_SEED,
      months: MONTHS,
      monthly_amount: MONTHLY_AMOUNT,
      invested_total: LUMP_AMOUNT,
      generator:
        'companion/src/datasets/ch13-dca.ts · indexfund.syntheticFundNav（rng.mulberry32+gaussian，种子 63，月均 0.75%、月波动 4.5%）+ position.dcaSchedule（第 11 章原函数，一行未改）+ portfolio.sleeveValues（第 10 章原函数）+ finance.maxDrawdown / recoveryGain / annualizedReturn + indexfund.feeDrag（内部调 finance.growthFactor）',
      seed_note: `种子 ${CH13_SEED}：月均涨幅 0.75%、月波动 4.5%，240 个月中途走出一段深坑（M${mdd.peakIndex + 1} 峰 → M${mdd.troughIndex + 1} 谷）后修复；同一参数永远生成同一路径，全部读数可复现`,
      nav_note: '净值起点 1.0000、保留 4 位小数；月度净值即每月定投的买入价',
      fee_note:
        '定投买卖费用按第 3 章股票口径计：佣金万 2.5（单笔下限 5 元，每期都触底）+ 过户费万 0.1 双向 + 卖出印花税万 5 单边；实际 ETF 买卖免印花税——课程口径把费用算多了一点，差异登记附录「简化与差异清单」',
      lump_note: '一次性买入对照不计佣金与印花税（合计约万分之 5，占 0.05% 量级，不影响结论方向）——课程简化，差异登记附录',
    },
    months_labels: Array.from({ length: MONTHS }, (_, i) => `M${i + 1}`),
    nav: {
      prices,
      final_nav: finalNav,
      total_return_pct: round2((finalNav - 1) * 100),
      annualized_pct: round2(annualizedReturn(finalNav, MONTHS / 12) * 100),
      max_drawdown: {
        peak_month: `M${mdd.peakIndex + 1}`,
        trough_month: `M${mdd.troughIndex + 1}`,
        peak_nav: prices[mdd.peakIndex] as number,
        trough_nav: prices[mdd.troughIndex] as number,
        drawdown_pct: round2(mdd.drawdown * 100),
        recovery_gain_pct: round2(recoveryGain(mdd.drawdown) * 100),
      },
    },
    dca: {
      total_amount: dca.summary.totalAmount,
      total_fees: dca.summary.totalFees,
      total_paid: dca.summary.totalPaid,
      total_shares: dca.summary.totalShares,
      avg_cost: dca.summary.avgCost,
      avg_cost_ex_fee: dca.summary.avgCostExFee,
      end_nav: dca.summary.endPrice,
      end_value: dca.summary.endValue,
      pl_pct: dca.summary.plPct,
      net_pl_pct: dca.summary.netPlPct,
      avg_cost_series: avgCostSeries,
      mark_series: markSeries,
      cum_paid_series: cumPaidSeries,
      deepest_underwater: {
        month: worst.month,
        mark: worst.mark,
        cum_amount: worst.cumAmount,
        underwater_pct: worst.underwaterPct,
      },
    },
    lump: {
      start_amount: LUMP_AMOUNT,
      buy_nav: buyNav,
      end_value: lumpValues[lumpValues.length - 1] as number,
      total_return_pct: round2((finalNav / buyNav - 1) * 100),
      values: lumpValues,
    },
    fee_tiers: {
      principal: FEE_PRINCIPAL,
      gross_rate_pct: round2(FEE_GROSS * 100),
      low_fee_pct: round2(FEE_LOW * 100),
      high_fee_pct: round2(FEE_HIGH * 100),
      years: FEE_YEARS,
      low_end: fee.lowEnd,
      high_end: fee.highEnd,
      gap: fee.gap,
      gap_pct_of_principal: fee.gapPctOfPrincipal,
    },
  }

  return { file: 'dca-vs-lump.json', data }
}
