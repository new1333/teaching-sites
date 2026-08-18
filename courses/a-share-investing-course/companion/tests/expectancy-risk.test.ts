import { describe, expect, it } from 'vitest'
import { compoundCurve, expectancy, type EdgeStats } from '../src/risk/expectancy'
import { kellyFraction } from '../src/risk/kelly'
import { equityPaths, monteCarloRuin } from '../src/risk/ruin'

/**
 * 期望值与仓位的行为断言：只喂策略三参数（胜率、平均盈利、平均亏损）与下注比例，
 * 只看返回读数（期望值、凯利分数、破产概率曲线、资金路径）。全章核心命题在这里受审：
 * 1. 期望值与凯利公式可手算——固定参数，读数与纸面四则运算一致（含负期望的负凯利）；
 * 2. 负期望策略（胜率六成、小赚大亏）全仓下注，破产概率随交易次数单调上升——
 *    亏钱不靠运气，靠算式；
 * 3. 同一正期望策略下，全仓 > 凯利仓位 > 半凯利的破产概率排序——重仓把优势做成灾难；
 * 4. 固定种子的蒙特卡洛可复现；资金路径是「赢乘 1+f·W、输乘 1−f·L」的乘法序列；
 * 5. 结构性非法输入抛中文错误。
 */

/** 痛点策略：胜率六成、平均赢 4%、平均亏 12%（盈亏比 1:3）——期望值为负 */
const PAIN: EdgeStats = { winRate: 0.6, avgWin: 0.04, avgLoss: 0.12 }
/** 镜像策略：胜率四成、平均赢 12%、平均亏 4%（盈亏比 3:1）——期望值翻正，幅度相同 */
const MIRROR: EdgeStats = { winRate: 0.4, avgWin: 0.12, avgLoss: 0.04 }
/** 趋势跟踪画像：胜率 35%、盈亏比 2——期望值微正，凯利风险 2.5%、对应仓位 50% */
const TREND: EdgeStats = { winRate: 0.35, avgWin: 0.1, avgLoss: 0.05 }

describe('expectancy：读数可手算', () => {
  it('胜率六成、赢 4% 亏 12%：0.6×0.04 − 0.4×0.12 = −0.024，每注亏 2.4%', () => {
    expect(expectancy(PAIN)).toBeCloseTo(-0.024, 12)
  })

  it('镜像参数：0.4×0.12 − 0.6×0.04 = +0.024——胜率降两成，期望值翻正', () => {
    expect(expectancy(MIRROR)).toBeCloseTo(0.024, 12)
  })

  it('胜率与盈亏比恰好互补的两个策略：期望值绝对值相等、符号相反', () => {
    expect(expectancy(MIRROR)).toBeCloseTo(-expectancy(PAIN), 12)
  })

  it('五五开且盈亏同幅：期望值为 0——不下注的资金曲线是直线', () => {
    expect(expectancy({ winRate: 0.5, avgWin: 0.08, avgLoss: 0.08 })).toBeCloseTo(0, 12)
  })

  it('趋势画像：0.35×0.10 − 0.65×0.05 = +0.0025，每注只赚千分之 2.5', () => {
    expect(expectancy(TREND)).toBeCloseTo(0.0025, 12)
  })
})

describe('kellyFraction：凯利公式可手算', () => {
  it('经典硬币局：胜率 0.6、盈亏比 1 → f = 0.6 − 0.4/1 = 0.2', () => {
    expect(kellyFraction({ winRate: 0.6, avgWin: 1, avgLoss: 1 })).toBeCloseTo(0.2, 12)
  })

  it('趋势画像：0.35 − 0.65×(0.05/0.10) = 0.025，每注只押 2.5% 的资金风险', () => {
    expect(kellyFraction(TREND)).toBeCloseTo(0.025, 12)
  })

  it('凯利风险换算成仓位：2.5% ÷ 5% 止损 = 半仓', () => {
    expect(kellyFraction(TREND) / TREND.avgLoss).toBeCloseTo(0.5, 12)
  })

  it('负期望策略给出负分数：0.6 − 0.4×3 = −0.6——数学在说这局别坐上桌', () => {
    expect(kellyFraction(PAIN)).toBeCloseTo(-0.6, 12)
  })

  it('盈亏比越大、胜率越高，凯利分数越大——分数跟着优势走，不跟胆量走', () => {
    const thin = kellyFraction({ winRate: 0.4, avgWin: 0.08, avgLoss: 0.04 })
    const fat = kellyFraction({ winRate: 0.4, avgWin: 0.12, avgLoss: 0.04 })
    const higherWin = kellyFraction({ winRate: 0.5, avgWin: 0.12, avgLoss: 0.04 })
    expect(fat).toBeGreaterThan(thin)
    expect(higherWin).toBeGreaterThan(fat)
  })
})

describe('monteCarloRuin：负期望策略破产概率随交易次数单调上升', () => {
  const r = monteCarloRuin(PAIN, 200, 3000, 1.0, { seed: 20 })

  it('破产概率逐段爬升：第 10/25/50/100 注逐级抬高，200 注打满后 ≥ 95%', () => {
    expect(r.ruinCurve[9]).toBeGreaterThanOrEqual(0.02)
    expect(r.ruinCurve[24]).toBeGreaterThanOrEqual(r.ruinCurve[9] + 0.1)
    expect(r.ruinCurve[49]).toBeGreaterThanOrEqual(r.ruinCurve[24] + 0.1)
    expect(r.ruinCurve[99]).toBeGreaterThanOrEqual(r.ruinCurve[49] + 0.01)
    expect(r.ruinCurve[199]).toBeGreaterThanOrEqual(0.95)
  })

  it('破产是吸收态：累计曲线全程单调不降；末项就是打满注数的破产概率', () => {
    for (let k = 1; k < r.ruinCurve.length; k++) {
      expect(r.ruinCurve[k]).toBeGreaterThanOrEqual(r.ruinCurve[k - 1])
    }
    expect(r.ruinProbability).toBe(r.ruinCurve[r.ruinCurve.length - 1])
  })

  it('报告如实上报参数：注数、轮数、仓位、破产线（默认亏掉一半）', () => {
    expect(r.bets).toBe(200)
    expect(r.trials).toBe(3000)
    expect(r.fraction).toBe(1.0)
    expect(r.ruinLine).toBe(0.5)
    expect(r.seed).toBe(20)
  })
})

describe('monteCarloRuin：同一正期望策略，全仓 > 凯利仓位 > 半凯利', () => {
  const kellyPos = kellyFraction(TREND) / TREND.avgLoss // 0.5：凯利风险 ÷ 止损幅度
  const full = monteCarloRuin(TREND, 200, 4000, 1.0, { seed: 2001 })
  const kelly = monteCarloRuin(TREND, 200, 4000, kellyPos, { seed: 2002 })
  const half = monteCarloRuin(TREND, 200, 4000, kellyPos / 2, { seed: 2003 })

  it('正期望也救不了全仓：破产概率 ≥ 30%', () => {
    expect(full.ruinProbability).toBeGreaterThanOrEqual(0.3)
  })

  it('凯利仓位比全仓低至少 8 个百分点，半凯利再低至少 8 个百分点', () => {
    expect(kelly.ruinProbability).toBeLessThanOrEqual(full.ruinProbability - 0.08)
    expect(half.ruinProbability).toBeLessThanOrEqual(kelly.ruinProbability - 0.08)
  })

  it('半凯利把破产概率压到 10% 以下——用一点增长速度换大幅回撤下降', () => {
    expect(half.ruinProbability).toBeLessThanOrEqual(0.1)
  })
})

describe('蒙特卡洛的可复现与读数边界', () => {
  it('同一种子跑两遍：报告逐项一致', () => {
    const a = monteCarloRuin(TREND, 100, 500, 0.5, { seed: 42 })
    const b = monteCarloRuin(TREND, 100, 500, 0.5, { seed: 42 })
    expect(a).toEqual(b)
  })

  it('换一颗种子：读数不再是同一串（平行宇宙换了批）', () => {
    const a = monteCarloRuin(TREND, 100, 500, 0.5, { seed: 42 })
    const c = monteCarloRuin(TREND, 100, 500, 0.5, { seed: 43 })
    expect(a.ruinCurve).not.toEqual(c.ruinCurve)
  })

  it('几乎稳赢的策略无破产路径：概率 0、平均破产注数记 null', () => {
    const safe = monteCarloRuin({ winRate: 0.9, avgWin: 0.02, avgLoss: 0.01 }, 50, 200, 0.05, { seed: 7 })
    expect(safe.ruinProbability).toBe(0)
    expect(safe.meanRuinBet).toBeNull()
  })
})

describe('equityPaths：资金路径是乘法序列', () => {
  const paths = equityPaths(PAIN, 120, 24, 1.0, { seed: 2020 })

  it('24 条路径、每条 121 个读数、起点都是 1（初始资金归一）', () => {
    expect(paths).toHaveLength(24)
    for (const p of paths) {
      expect(p).toHaveLength(121)
      expect(p[0]).toBe(1)
    }
  })

  it('每一步的资金变化只有两个可能：×(1+仓位×平均盈利) 或 ×(1−仓位×平均亏损)', () => {
    const up = 1 + 1.0 * PAIN.avgWin
    const down = 1 - 1.0 * PAIN.avgLoss
    for (const p of paths) {
      for (let k = 1; k < p.length; k++) {
        const ratio = p[k] / p[k - 1]
        const isUp = Math.abs(ratio - up) < 1e-9
        const isDown = Math.abs(ratio - down) < 1e-9
        expect(isUp || isDown).toBe(true)
      }
    }
  })

  it('胜率六成的负期望策略全仓跑 120 注：至少 16/24 条路径终点已亏掉一半', () => {
    const dead = paths.filter((p) => p[p.length - 1] <= 0.5).length
    expect(dead).toBeGreaterThanOrEqual(16)
  })

  it('同一种子跑两遍：路径逐条一致', () => {
    expect(equityPaths(PAIN, 60, 5, 0.5, { seed: 9 })).toEqual(equityPaths(PAIN, 60, 5, 0.5, { seed: 9 }))
  })
})

describe('结构性非法输入：抛中文错误', () => {
  const ok: EdgeStats = { winRate: 0.5, avgWin: 0.1, avgLoss: 0.05 }
  it.each([
    ['胜率大于 1', () => expectancy({ winRate: 1.2, avgWin: 0.1, avgLoss: 0.05 })],
    ['胜率为负', () => expectancy({ winRate: -0.1, avgWin: 0.1, avgLoss: 0.05 })],
    ['胜率 NaN', () => expectancy({ winRate: NaN, avgWin: 0.1, avgLoss: 0.05 })],
    ['平均盈利为 0', () => expectancy({ winRate: 0.5, avgWin: 0, avgLoss: 0.05 })],
    ['平均亏损为 0', () => kellyFraction({ winRate: 0.5, avgWin: 0.1, avgLoss: 0 })],
    ['平均盈利 NaN', () => kellyFraction({ winRate: 0.5, avgWin: NaN, avgLoss: 0.05 })],
    ['注数为 0', () => monteCarloRuin(ok, 0, 100, 0.5)],
    ['轮数非整数', () => monteCarloRuin(ok, 100, 1.5, 0.5)],
    ['仓位为 0', () => monteCarloRuin(ok, 100, 100, 0)],
    ['仓位大于 1', () => monteCarloRuin(ok, 100, 100, 1.5)],
    ['仓位为负', () => monteCarloRuin(ok, 100, 100, -0.5)],
    ['破产线为 0', () => monteCarloRuin(ok, 100, 100, 0.5, { ruinLine: 0 })],
    ['破产线大于 1', () => monteCarloRuin(ok, 100, 100, 0.5, { ruinLine: 1.2 })],
    ['种子非整数', () => monteCarloRuin(ok, 100, 100, 0.5, { seed: 1.5 })],
    ['非法 stats 传入模拟器', () => monteCarloRuin({ winRate: 2, avgWin: 0.1, avgLoss: 0.05 }, 100, 100, 0.5)],
    ['路径条数为 0', () => equityPaths(ok, 100, 0, 0.5)],
    ['路径种子非整数', () => equityPaths(ok, 100, 5, 0.5, { seed: 2.5 })],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})

describe('compoundCurve：期望值复利曲线（第 22 章处置效应演算）', () => {
  /** 处置画像：胜率 60%、赢 2% 亏 20%——期望值每笔 −6.8%（正文示意参数） */
  const DISPOSAL: EdgeStats = { winRate: 0.6, avgWin: 0.02, avgLoss: 0.2 }
  /** 修正版：止损压亏到 8%、离场放盈到 12%，胜率不动——期望值每笔 +4.0% */
  const REVISED: EdgeStats = { winRate: 0.6, avgWin: 0.12, avgLoss: 0.08 }

  it('处置画像每笔 −6.8%：十笔 0.932 的 10 次方 ≈ 0.495，跌破本金', () => {
    expect(expectancy(DISPOSAL)).toBeCloseTo(-0.068, 10)
    const curve = compoundCurve(DISPOSAL, 10)
    expect(curve).toHaveLength(10)
    expect(curve[0]).toBeCloseTo(0.932, 10)
    expect(curve[9]).toBeCloseTo(0.494492, 5)
    expect(curve[9]).toBeLessThan(1)
  })

  it('修正版每笔 +4.0%：十笔 1.04 的 10 次方 ≈ 1.480，终值向上', () => {
    expect(expectancy(REVISED)).toBeCloseTo(0.04, 10)
    const curve = compoundCurve(REVISED, 10)
    expect(curve[0]).toBeCloseTo(1.04, 10)
    expect(curve[9]).toBeCloseTo(1.480244, 5)
    expect(curve[9]).toBeGreaterThan(1)
  })

  it('两条曲线同一套胜率，方向在第一笔就分岔', () => {
    const a = compoundCurve(DISPOSAL, 10)
    const b = compoundCurve(REVISED, 10)
    expect(a[0]).toBeLessThan(1)
    expect(b[0]).toBeGreaterThan(1)
    for (let k = 1; k < 10; k++) {
      expect(a[k]).toBeLessThan(a[k - 1]!)
      expect(b[k]).toBeGreaterThan(b[k - 1]!)
    }
  })

  it.each([
    ['步数为 0', () => compoundCurve(ok, 0)],
    ['步数非整数', () => compoundCurve(ok, 3.5)],
    ['非法 stats', () => compoundCurve({ winRate: 1.5, avgWin: 0.1, avgLoss: 0.05 }, 10)],
  ])('%s', (_name, fn) => {
    expect(fn).toThrow()
  })
})
