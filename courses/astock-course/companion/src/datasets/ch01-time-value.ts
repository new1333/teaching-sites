// companion/src/datasets/ch01-time-value.ts · 第 1 章数据集：存款缩水与复利曲线 + worksheet 承重数字
// 全部数字由 src/finance.ts 纯函数计算，无随机源——确定性输出，连续导出逐字节一致。
// 正文（docs/01-time-value.md）的一切承重数字取自本模块的导出产物 compound-vs-inflation.json。

import { annualizedReturn, futureValue, priceFactor, realPurchasingPower, roundRate4, simpleFutureValue } from '../finance'
import { round2 } from '../round'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

const HORIZON = 30
const PRINCIPAL = 100000
const DEPOSIT_RATE = 0.0095 // 2025-05-20 六大行一年期挂牌利率（权威记录值）
const INVEST_RATE = 0.06 // 教学示意收益率
const INFLATION = 0.02 // 教学示意通胀率

export function buildCh01(): Dataset {
  const years: number[] = []
  const depositNominal: number[] = []
  const depositReal: number[] = []
  const compoundNominal: number[] = []
  const compoundReal: number[] = []
  for (let y = 0; y <= HORIZON; y += 1) {
    years.push(y)
    depositNominal.push(futureValue(PRINCIPAL, DEPOSIT_RATE, y))
    depositReal.push(realPurchasingPower(PRINCIPAL, DEPOSIT_RATE, INFLATION, y))
    compoundNominal.push(futureValue(PRINCIPAL, INVEST_RATE, y))
    compoundReal.push(realPurchasingPower(PRINCIPAL, INVEST_RATE, INFLATION, y))
  }

  const milestone = (y: number) => ({
    year: y,
    deposit_nominal: futureValue(PRINCIPAL, DEPOSIT_RATE, y),
    deposit_real: realPurchasingPower(PRINCIPAL, DEPOSIT_RATE, INFLATION, y),
    compound_nominal: futureValue(PRINCIPAL, INVEST_RATE, y),
    compound_real: realPurchasingPower(PRINCIPAL, INVEST_RATE, INFLATION, y),
  })

  return {
    file: 'compound-vs-inflation.json',
    data: {
      as_of: '2026-09',
      labeling: '教学示意（课程自产演算数据）：利率与通胀率为课程示意假设，非任何真实产品的收益承诺',
      rate_anchor: {
        deposit_1y: DEPOSIT_RATE,
        as_of: '2025-05-20',
        source: '六大行一年期整存整取挂牌利率 0.95%（人民网 2025-05-20 报道）',
      },
      scenario: {
        principal: PRINCIPAL,
        deposit_rate: DEPOSIT_RATE,
        invest_rate: INVEST_RATE,
        annual_inflation: INFLATION,
        years: HORIZON,
      },
      chart: {
        title: '存款缩水与复利曲线（本金 10 万元）',
        years,
        deposit_nominal: depositNominal,
        deposit_real: depositReal,
        compound_nominal: compoundNominal,
        compound_real: compoundReal,
      },
      milestones: [milestone(0), milestone(10), milestone(20), milestone(30)],
      hook_2004_2024: {
        principal: 100000,
        annual_rate: 0.0225,
        years: 20,
        annual_inflation: 0.03,
        future_value: futureValue(100000, 0.0225, 20),
        real_purchasing_power: realPurchasingPower(100000, 0.0225, 0.03, 20),
        nominal_gain_pct: round2((futureValue(100000, 0.0225, 20) / 100000 - 1) * 100),
        real_change_pct: round2(
          (realPurchasingPower(100000, 0.0225, 0.03, 20) / 100000 - 1) * 100,
        ),
        price_factor_20y: round2(priceFactor(0.03, 20) * 1000000) / 1000000,
      },
      worksheet: {
        deposit_1y: {
          principal: 10000,
          annual_rate: DEPOSIT_RATE,
          years: 1,
          annual_inflation: INFLATION,
          future_value: futureValue(10000, DEPOSIT_RATE, 1),
          real_purchasing_power: realPurchasingPower(10000, DEPOSIT_RATE, INFLATION, 1),
        },
        A: {
          principal: 10000,
          annual_rate: 0.03,
          years: 10,
          annual_inflation: INFLATION,
          growth_factor: Math.round(Math.pow(1.03, 10) * 1e7) / 1e7,
          price_factor: Math.round(priceFactor(INFLATION, 10) * 1e7) / 1e7,
          future_value: futureValue(10000, 0.03, 10),
          real_purchasing_power: realPurchasingPower(10000, 0.03, INFLATION, 10),
          simple_future_value: simpleFutureValue(10000, 0.03, 10),
        },
        A_inflation_zero: {
          annual_inflation: 0,
          real_purchasing_power: realPurchasingPower(10000, 0.03, 0, 10),
        },
        B: {
          principal: 50000,
          annual_rate: 0.02,
          years: 30,
          annual_inflation: 0.025,
          growth_factor: Math.round(Math.pow(1.02, 30) * 1e7) / 1e7,
          price_factor: Math.round(priceFactor(0.025, 30) * 1e7) / 1e7,
          future_value: futureValue(50000, 0.02, 30),
          real_purchasing_power: realPurchasingPower(50000, 0.02, 0.025, 30),
        },
        C: {
          principal: 100000,
          annual_rate: 0.06,
          years: 20,
          annual_inflation: INFLATION,
          growth_factor: Math.round(Math.pow(1.06, 20) * 1e7) / 1e7,
          price_factor: Math.round(priceFactor(INFLATION, 20) * 1e7) / 1e7,
          future_value: futureValue(100000, 0.06, 20),
          real_purchasing_power: realPurchasingPower(100000, 0.06, INFLATION, 20),
        },
        no_compound_30y: {
          principal: 100000,
          annual_rate: 0.06,
          years: 30,
          compound_future_value: futureValue(100000, 0.06, 30),
          simple_future_value: simpleFutureValue(100000, 0.06, 30),
          difference: round2(futureValue(100000, 0.06, 30) - simpleFutureValue(100000, 0.06, 30)),
        },
      },
      annualization: {
        jia: { total_return: 0.3, years: 3, annualized: roundRate4(annualizedReturn(1.3, 3)) },
        yi: { total_return: 0.1, years: 1, annualized: roundRate4(annualizedReturn(1.1, 1)) },
        bing: { total_return: 0.6, years: 5, annualized: roundRate4(annualizedReturn(1.6, 5)) },
      },
    },
  }
}
