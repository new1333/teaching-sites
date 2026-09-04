// companion/src/datasets/ch10-mix.ts · 第 10 章数据集：相关性实验台、伪分散例与 60/40 漂移-再平衡 → portfolio-mix.json
// 全部数据为固定种子合成的教学剧情（教学示意·课程自产合成数据，与任何真实资产或市场无关）：
// - 钩子甲、乙为人工剧本月收益率（无随机项），形状服务「各自深坑错位、组合抵消」的教学目标；
// - 相关性实验台：固定甲，用正交化构造生成五个「伙伴」乙，样本相关系数精确等于 −0.8/−0.4/0/+0.4/+0.8，
//   且每个乙的平均月涨幅与独自颠簸程度（样本标准差）都和甲相同——唯一变量是同步性；
// - 伪分散例：两只相关系数 0.95 的同板块股票（丙为人工剧本，丁由正交化构造与丙锁在 0.95）；
// - 漂移对照：36 个月的股票路径（种子 67）与低波动路径（种子 53，示意「债券」角色，差异登记附录）。
// 回撤、回本涨幅、波动率一律调用 src/finance.ts，组合/相关性/再平衡一律调用 src/portfolio.ts，无平行第二套算法；
// 正文（docs/10-diversification.md）与组件的一切承重数字取自本模块的导出产物。

import { annualizedVolatility, maxDrawdown, periodReturns, recoveryGain } from '../finance'
import { correlation, mixReturns, periodicRebalancePath, rebalanceTo, sleeveValues, sleeveWeights } from '../portfolio'
import { gaussian, mulberry32 } from '../rng'
import { round2 } from '../round'

/** 与 export-docs.ts 的 Dataset 结构一致（该类型未导出，此处按结构声明） */
type Dataset = { file: string; data: unknown }

const roundRate = (x: number): number => round2(x * 100)
/** 净值与月收益率统一舍入到 4 位小数（与第 9 章口径一致），保证导出为唯一样本 */
const round4 = (x: number): number => Math.round(x * 10000) / 10000

export interface Ch10Drawdown {
  peak_index: number
  trough_index: number
  peak_month: string
  trough_month: string
  peak_value: number
  trough_value: number
  drawdown_pct: number
  recovery_gain_pct: number
}

export interface Ch10Path {
  id: string
  name: string
  story: string
  values: number[]
  volatility_annual_pct: number
  max_drawdown: Ch10Drawdown
}

export interface Ch10Variant {
  level: number
  sample_correlation: number
  partner_monthly_returns_pct: number[]
  partner_values: number[]
  partner_volatility_annual_pct: number
  combo: {
    values: number[]
    volatility_annual_pct: number
    max_drawdown: Ch10Drawdown
    final_return_pct: number
  }
}

export interface Ch10Data {
  labeling: string
  meta: {
    seed: number
    seed_note: string
    generator: string
    months24: string[]
    months36: string[]
    vol_note: string
    mix_note: string
  }
  hook: {
    note: string
    asset_a: Ch10Path
    asset_b: Ch10Path
    correlation: number
    combo: Ch10Path
  }
  correlation_lab: {
    note: string
    levels: number[]
    base_asset: { id: string; name: string; monthly_returns_pct: number[]; values: number[]; volatility_annual_pct: number }
    variants: Ch10Variant[]
  }
  pseudo: {
    note: string
    correlation: number
    stock_c: Ch10Path
    stock_d: Ch10Path
    combo: Ch10Path
  }
  drift: {
    note: string
    start_amount: number
    start_stock_amount: number
    start_bond_amount: number
    stock_path: number[]
    bond_path: number[]
    stock_sleeve_values: number[]
    bond_sleeve_values: number[]
    total_values: number[]
    annual_rebalance_total_values: number[]
    annual_rebalance_difference: number
    stock_total_return_pct: number
    bond_total_return_pct: number
    end: {
      stock_amount: number
      bond_amount: number
      total: number
      stock_weight_pct: number
      bond_weight_pct: number
    }
    rebalance: {
      target_stock_weight: number
      trade_stock_amount: number
      trade_bond_amount: number
      after_stock_amount: number
      after_bond_amount: number
    }
  }
}

/** 钩子甲·大起大落：七个月冲高、七个月连跌四成、随后十个月修复（24 个月剧本，百分数） */
const A_RET = [4, 5, -3, 6, 4, -2, 3, -10, -10, -9, -7, -6, -5, -4, 6, 6, 6, 6, 6, 4, 4, 4, 4, 4]
/** 钩子乙·反向跷跷板：涨跌与甲错位——甲的坑里它在爬升，它的坑里甲在修复（24 个月剧本，百分数） */
const B_RET = [2, -4, 6, -3, 5, -2, 4, 5, 6, 5, 4, 5, 3, -7, -10, -10, -8, -7, -5, -4, 5, 6, 5, 4]

/** 伪分散例·丙·同板块一：小步冲高、九个月深跌近半、随后修复但仍低于起点（24 个月剧本，百分数） */
const C_RET = [2, 4, -2, 4, 2, -2, -6, -8, -5, -9, -8, -6, -5, -8, -4, 4, 4, 4, 4, 4, 4, 4, 4, 4]

const LAB_LEVELS = [-0.8, -0.4, 0, 0.4, 0.8]

/** 逐月收益率（百分数）→ 净值路径：起点 1，逐月复利，净值舍入到 4 位小数 */
function valuePath(retsPct: number[]): number[] {
  const values = [1]
  let v = 1
  for (const r of retsPct) {
    v *= 1 + r / 100
    values.push(Math.round(v * 10000) / 10000)
  }
  return values
}

/** 固定种子的合成资产月收益率（百分数）：基值 + sigma × 种子噪声 */
function genReturnsPct(meanPct: number, sigmaPct: number, months: number, seed: number): number[] {
  const rng = mulberry32(seed)
  return Array.from({ length: months }, () => round4(meanPct + sigmaPct * gaussian(rng)))
}

/**
 * 构造与 basePct 样本相关系数恰好等于 level 的伙伴收益率序列（百分数）：
 * 把 base 标准化后，与一条独立噪声做 Gram–Schmidt 正交、再标准化，按
 * level·x + √(1−level²)·z 合成——伙伴的平均月涨幅与样本标准差都和 base 相同，唯一变量是同步性。
 */
function partnerReturns(basePct: number[], level: number, seed: number): number[] {
  const n = basePct.length
  const mean = basePct.reduce((s, x) => s + x, 0) / n
  const std = Math.sqrt(basePct.reduce((s, x) => s + (x - mean) ** 2, 0) / n)
  const x = basePct.map((v) => (v - mean) / std)
  const rng = mulberry32(seed)
  const zRaw = Array.from({ length: n }, () => gaussian(rng))
  const meanZ = zRaw.reduce((s, v) => s + v, 0) / n
  const zc = zRaw.map((v) => v - meanZ)
  const covXZ = x.reduce((s, xi, i) => s + xi * (zc[i] as number), 0) / n
  const zOrtho = zc.map((v, i) => v - covXZ * (x[i] as number))
  const meanO = zOrtho.reduce((s, v) => s + v, 0) / n
  const stdO = Math.sqrt(zOrtho.reduce((s, v) => s + (v - meanO) ** 2, 0) / n)
  const z = zOrtho.map((v) => (v - meanO) / stdO)
  const s = Math.sqrt(1 - level * level)
  return x.map((xi, i) => round4(mean + std * (level * xi + s * (z[i] as number))))
}

function monthLabel(index: number): string {
  return `M${index}`
}

/** 给一条净值路径配齐三把尺（波动率/最大回撤/回本涨幅），全部调用实现重算 */
function describePath(id: string, name: string, story: string, values: number[]): Ch10Path {
  const mdd = maxDrawdown(values)
  return {
    id,
    name,
    story,
    values,
    volatility_annual_pct: roundRate(annualizedVolatility(periodReturns(values))),
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

/** 各半组合（每月末拨回 50/50 口径）：由两条月收益率序列混合出净值路径 */
function comboPath(retsAPct: number[], retsBPct: number[]): number[] {
  const mixed = mixReturns(
    0.5,
    retsAPct.map((r) => r / 100),
    retsBPct.map((r) => r / 100),
  )
  return valuePath(mixed.map((r) => r * 100))
}

export function buildCh10(): Dataset {
  const months24 = Array.from({ length: 25 }, (_, i) => monthLabel(i))
  const months36 = Array.from({ length: 37 }, (_, i) => monthLabel(i))

  // —— 钩子：甲乙各自深坑、各半组合抵消 ——
  const aPath = valuePath(A_RET)
  const bPath = valuePath(B_RET)
  const hookComboPath = comboPath(A_RET, B_RET)
  const hookCorr = round4(correlation(A_RET.map((r) => r / 100), B_RET.map((r) => r / 100)))

  // —— 相关性实验台：固定甲，五个精确相关水平的伙伴乙 ——
  const variants: Ch10Variant[] = LAB_LEVELS.map((level, i) => {
    const partnerPct = partnerReturns(A_RET, level, 45 + i)
    const partnerValues = valuePath(partnerPct)
    const combo = comboPath(partnerPct, A_RET)
    return {
      level,
      sample_correlation: round4(correlation(A_RET.map((r) => r / 100), partnerPct.map((r) => r / 100))),
      partner_monthly_returns_pct: partnerPct,
      partner_values: partnerValues,
      partner_volatility_annual_pct: roundRate(annualizedVolatility(periodReturns(partnerValues))),
      combo: {
        values: combo,
        volatility_annual_pct: roundRate(annualizedVolatility(periodReturns(combo))),
        max_drawdown: describePath('lab-combo', '组合', '', combo).max_drawdown,
        final_return_pct: round2((combo[combo.length - 1]! - 1) * 100),
      },
    }
  })

  // —— 伪分散例：两只高相关（ρ=0.95）的同板块股票——丙为剧本，丁由正交化构造与丙锁在 0.95 ——
  const dPct = partnerReturns(C_RET, 0.95, 51)
  const cPath = valuePath(C_RET)
  const dPath = valuePath(dPct)
  const pseudoCombo = comboPath(C_RET, dPct)

  // —— 60/40 漂移与再平衡：36 个月，股票合成牛市（种子 67）+ 低波动资产（示意「债券」角色）——
  const stockPct = genReturnsPct(1.877, 4.5, 36, 67)
  const bondPct = genReturnsPct(0.165, 0.35, 36, 53)
  const stockPath = valuePath(stockPct)
  const bondPath = valuePath(bondPct)
  const stockSleeve = sleeveValues(60000, stockPath).map(round2)
  const bondSleeve = sleeveValues(40000, bondPath).map(round2)
  const totalValues = stockSleeve.map((v, i) => round2(v + (bondSleeve[i] as number)))
  const annualRebalance = periodicRebalancePath(stockPath, bondPath, 0.6, 100000, 12).map(round2)
  const endWeights = sleeveWeights(stockSleeve[36] as number, bondSleeve[36] as number)
  const reb = rebalanceTo(stockSleeve[36] as number, bondSleeve[36] as number, 0.6)

  const data: Ch10Data = {
    labeling:
      '教学示意·课程自产合成数据：甲乙剧本、实验台伙伴资产、伪分散股票与漂移对照路径均为固定种子合成的教学剧情，与任何真实资产、真实市场无关；「债券」以低波动合成资产代替真实债券指数；不构成任何投资建议',
    meta: {
      seed: 45,
      seed_note: '实验台伙伴资产用种子 45–49（按 −0.8→+0.8 逐档），伪分散的丁用 51，漂移对照用 67–53；钩子甲乙与伪分散的丙为人工剧本、无随机项',
      generator:
        'companion/src/datasets/ch10-mix.ts · valuePath / genReturnsPct / partnerReturns（正交化构造）+ finance.maxDrawdown / recoveryGain / annualizedVolatility + portfolio.correlation / mixReturns / sleeveValues / rebalanceTo / periodicRebalancePath',
      months24,
      months36,
      vol_note:
        '年化波动率按月收益率标准差 ×√12 的课程简化口径计算（母体标准差），与第 9 章一致；未采用日频 ×√252 等实务口径——差异登记附录「简化与差异清单」',
      mix_note:
        '组合月收益率 = 权重 × 甲月收益率 +（1−权重）× 乙月收益率，即每月末把比例拨回目标的口径；漂移对照区的买入持有与逐年再平衡路径由 portfolio.sleeveValues / periodicRebalancePath 计算',
    },
    hook: {
      note: '两只各自上蹿下跳、最深坑都超过四成的资产，各买一半后组合的最深坑与波动都明显变浅——变化来自两条路径的坑没有踩在同几个月',
      asset_a: describePath('jia', '甲·大起大落', '七个月冲高，随后七个月连跌去四成，再花十个月缓慢修复', aPath),
      asset_b: describePath('yi', '乙·反向跷跷板', '涨跌与甲错位：甲的坑里它在爬升，它的坑里甲在修复', bPath),
      correlation: hookCorr,
      combo: describePath('combo', '各半组合', '甲乙各买一半、每月末把比例拨回各半', hookComboPath),
    },
    correlation_lab: {
      note: '固定甲不变，配上五个相关性不同的伙伴乙：每个乙的平均月涨幅与独自颠簸程度都和甲相同，唯一变量是与甲的同步程度。相关性越低，组合波动越小',
      levels: LAB_LEVELS,
      base_asset: {
        id: 'jia',
        name: '甲',
        monthly_returns_pct: A_RET,
        values: aPath,
        volatility_annual_pct: roundRate(annualizedVolatility(periodReturns(aPath))),
      },
      variants,
    },
    pseudo: {
      note: '两只相关系数 0.95 的同板块股票：买几只不重要，同步才重要——各买一半后波动几乎没降、深坑几乎照旧',
      correlation: round4(correlation(C_RET.map((r) => r / 100), dPct.map((r) => r / 100))),
      stock_c: describePath('bing', '丙·同板块一', '小步冲高后九个月深跌近半，随后修复但仍低于起点', cPath),
      stock_d: describePath('ding', '丁·同板块二', '与丙的相关系数锁在 0.95：独自颠簸程度与丙相同，涨跌几乎同步', dPath),
      combo: describePath('pseudo-combo', '丙丁各半', '丙丁各买一半、每月末拨回各半', pseudoCombo),
    },
    drift: {
      note: '60/40 配置放着不动：股票走出一轮三年牛市，低波动资产缓慢爬坡，没人做任何决定，股票占比却自己越走越高——风险悄悄变重',
      start_amount: 100000,
      start_stock_amount: 60000,
      start_bond_amount: 40000,
      stock_path: stockPath,
      bond_path: bondPath,
      stock_sleeve_values: stockSleeve,
      bond_sleeve_values: bondSleeve,
      total_values: totalValues,
      annual_rebalance_total_values: annualRebalance,
      annual_rebalance_difference: round2((totalValues[36] as number) - (annualRebalance[36] as number)),
      stock_total_return_pct: round2((stockPath[36]! - 1) * 100),
      bond_total_return_pct: round2((bondPath[36]! - 1) * 100),
      end: {
        stock_amount: stockSleeve[36] as number,
        bond_amount: bondSleeve[36] as number,
        total: totalValues[36] as number,
        stock_weight_pct: round2(endWeights.weightA * 100),
        bond_weight_pct: round2(endWeights.weightB * 100),
      },
      rebalance: {
        target_stock_weight: 0.6,
        trade_stock_amount: round2(reb.tradeA),
        trade_bond_amount: round2(reb.tradeB),
        after_stock_amount: round2(reb.afterA),
        after_bond_amount: round2(reb.afterB),
      },
    },
  }

  return { file: 'portfolio-mix.json', data }
}
