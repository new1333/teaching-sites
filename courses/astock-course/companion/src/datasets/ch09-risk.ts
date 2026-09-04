// companion/src/datasets/ch09-risk.ts · 第 9 章数据集：三条回撤路径与回本涨幅对照曲线 drawdown-paths.json
// 路径为固定种子（42/43/44）合成的教学剧情（教学示意·课程自产合成数据，与任何真实账户或市场无关）：
// 逐月收益率 = 教学剧本基值 + 小幅种子噪声，形状服务于三种典型跌法（浅回撤/深腰斩/慢磨阴跌）。
// 回撤、回本涨幅、波动率一律调用 src/finance.ts 的实现计算，无平行第二套算法；
// 正文（docs/09-risk-math.md）与组件的一切承重数字取自本模块的导出产物。

import { annualizedVolatility, maxDrawdown, periodReturns, recoveryGain } from '../finance'
import { gaussian, mulberry32 } from '../rng'
import { round2 } from '../round'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

export interface Ch09Drawdown {
  peak_index: number
  trough_index: number
  peak_month: string
  trough_month: string
  peak_value: number
  trough_value: number
  drawdown_pct: number
  recovery_gain_pct: number
}

export interface Ch09Path {
  id: string
  name: string
  story: string
  values: number[]
  volatility_annual_pct: number
  max_drawdown: Ch09Drawdown
}

export interface Ch09Data {
  labeling: string
  meta: {
    seed: number
    generator: string
    start_value: number
    months: string[]
    vol_note: string
  }
  paths: Ch09Path[]
  recovery_curve: {
    note: string
    loss_step_pct: number
    highlights: number[]
    curve: Array<{ loss_pct: number; recovery_pct: number }>
  }
}

/** 24 个月的教学剧本基值（百分数）：甲·浅回撤——稳步上行、一次两位数回调、随后修复并创新高 */
const SHALLOW_BASE = [...Array(8).fill(2.0), -5.0, -6.0, -5.0, ...Array(13).fill(1.5)]
/** 乙·深腰斩——半年冲高、七个月连跌腰斩、此后连涨一年仍未回本 */
const HALVED_BASE = [...Array(6).fill(3.0), -9.0, -12.0, -15.0, -12.0, -10.0, -6.0, -4.0, ...Array(11).fill(4.0)]
/** 丙·慢磨阴跌——没有单月大跌，月月小输小赢，两年磨掉四分之一 */
const GRINDER_BASE = [
  ...Array(4).fill(1.0),
  -2.0, 0.5, -2.5, -1.5, -1.0, -2.0, -2.0, 0.5, -1.5, -1.0, -2.5, 0.5, -1.5, -2.0, -1.5, -1.0, -2.0, -1.5, -1.0, -1.5,
]

const MONTHS = 24
const START = 1

/** 按剧本生成一条净值路径：逐月收益率 = 基值 + sigma × 种子噪声，净值舍入到 4 位小数后为唯一样本 */
function makePath(baseReturnsPct: number[], sigma: number, seed: number): number[] {
  const rng = mulberry32(seed)
  const values = [START]
  let v = START
  for (const base of baseReturnsPct) {
    v = v * (1 + base / 100 + sigma * gaussian(rng))
    values.push(Math.round(v * 10000) / 10000)
  }
  return values
}

function monthLabel(index: number): string {
  return `M${index}`
}

function buildPath(id: string, name: string, story: string, base: number[], sigma: number, seed: number): Ch09Path {
  const values = makePath(base, sigma, seed)
  const mdd = maxDrawdown(values)
  const vol = annualizedVolatility(periodReturns(values))
  return {
    id,
    name,
    story,
    values,
    volatility_annual_pct: round2(vol * 100),
    max_drawdown: {
      peak_index: mdd.peakIndex,
      trough_index: mdd.troughIndex,
      peak_month: monthLabel(mdd.peakIndex),
      trough_month: monthLabel(mdd.troughIndex),
      peak_value: values[mdd.peakIndex] as number,
      trough_value: values[mdd.troughIndex] as number,
      drawdown_pct: round2(mdd.drawdown * 100),
      recovery_gain_pct: round2(recoveryGain(mdd.drawdown) * 100),
    },
  }
}

export function buildCh09(): Dataset {
  const paths: Ch09Path[] = [
    buildPath(
      'shallow',
      '甲·浅回撤',
      '稳步上行八个多月，一次两位数回调，此后一年修复并创新高',
      SHALLOW_BASE,
      0.004,
      42,
    ),
    buildPath(
      'halved',
      '乙·深腰斩',
      '半年冲高，七个月连跌去了一半多，此后连涨一年仍未回到起点',
      HALVED_BASE,
      0.006,
      43,
    ),
    buildPath(
      'grinder',
      '丙·慢磨阴跌',
      '没有一个月称得上大跌，小输小赢磨两年，累计跌去两成多',
      GRINDER_BASE,
      0.003,
      44,
    ),
  ]

  const curve = Array.from({ length: 15 }, (_, i) => {
    const lossPct = i * 5
    return { loss_pct: lossPct, recovery_pct: round2(recoveryGain(lossPct / 100) * 100) }
  })

  const data: Ch09Data = {
    labeling:
      '教学示意·课程自产合成数据：三条净值路径与回本涨幅对照曲线为固定种子合成的教学剧情，与任何真实账户、真实市场无关；不构成任何投资建议',
    meta: {
      seed: 42,
      generator:
        'companion/src/datasets/ch09-risk.ts · makePath（剧本基值 + mulberry32 种子噪声）+ finance.maxDrawdown / recoveryGain / annualizedVolatility',
      start_value: START,
      months: Array.from({ length: MONTHS + 1 }, (_, i) => monthLabel(i)),
      vol_note:
        '年化波动率按月收益率标准差 ×√12 的课程简化口径计算（母体标准差、24 个月样本）；未采用日频 ×√252 等实务口径——差异登记附录「简化与差异清单」',
    },
    paths,
    recovery_curve: {
      note: '亏损幅度（峰值到谷值，或相对成本）与回本所需涨幅的对照：涨幅 = 亏损 ÷（1 − 亏损），由复利不变量 (1−亏损)×(1+涨幅)=1 解出',
      loss_step_pct: 5,
      highlights: [30, 50, 70],
      curve,
    },
  }

  return { file: 'drawdown-paths.json', data }
}
