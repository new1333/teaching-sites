---
title: 期望值与仓位：胜率六成也可能亏钱的数学
---

# 期望值与仓位：胜率六成也可能亏钱的数学

<script setup>
// 图一：同一正期望策略在全仓 / 凯利仓位 / 半凯利三种仓位下的累计破产概率（LineChart）。
import rc from './assets/data/20-ruin-compare.json'
// 图二：痛点策略全仓下注的八条资金路径（LineChart 扇形）。
import fan from './assets/data/20-equity-fan.json'
</script>

十月底你拉出交割单数了一遍：最近二十笔，赢十二笔，胜率六成。可账户从 8 万掉到了 6 万 4，越亏越多。赢的单子平均赚三四个点就跑；亏的单子平均亏十几个点还扛着。最后一笔最狠：套了 15 个点，你加倍买入想摊低成本、一把回本，它又跌了一成。你把这归咎于运气和心态。这一章要证明的是：这跟运气无关，是算术——账单上除了「赢的次数」，还有两个更大的数字在等你。止损与仓位这两句口号，本章全部换成了算式。

## 期望值：胜率只数次数，幅度没进账单

第 9 章给形态验货时用过胜率：赢的次数除以总次数。它有个天生的盲区——只数次数，不管每次赢多大、输多大。你这套六成胜率的交易，输一单的痛是赢一单的三倍，胜率的算式里根本装不下这件事。补上它的数叫期望值（expectancy）——长期平均每一注的期望盈亏：赢的概率乘赢的幅度，减去输的概率乘输的幅度。

跟着算一遍你的二十笔。先把每笔盈亏折成百分比，简化成一张十笔的表：

```text
笔     1    2    3    4    5    6    7    8    9   10
盈亏  +4% −12%  +4%  +4% −12%  +4% −12%  +4%  +4% −12%
```

三步：赢的合计 6 × 4% = 24%；输的合计 4 × 12% = 48%；每注平均（24% − 48%）÷ 10 = −2.4%。写成公式就是：

```text
期望值 = 胜率 × 平均盈利 − 败率 × 平均亏损
       = 0.6 × 0.04 − 0.4 × 0.12
       = 0.024 − 0.048 = −0.024
```

胜率六成，期望值 −2.4%：做得越多，亏得越稳。这笔账还有个更短的算法：期望值 =（总盈利 − 总亏损）÷ 总笔数——你那二十笔，盈利合计约 7000 元，亏损合计约 25000 元，平均每笔 −900 元。数学不需要看你的胜率，它只看每注平均。

配方里另一个数要单独认识：盈亏比（payoff ratio）——平均每笔盈利除以平均每笔亏损的比值。你的盈亏比是 4% ÷ 12% = 1:3，赢三把才够输一把。现在做镜像实验，只动两个幅度、不动任何「功力」：胜率降到四成，盈利放大到 12%，亏损压到 4%（盈亏比 3:1）。期望值 = 0.4 × 0.12 − 0.6 × 0.04 = +0.024。同样的绝对值，符号翻正。**胜率六成和胜率四成谁赚钱，期望值说了算**。还有一层复利的不对称在暗处加码：亏 12% 要涨 13.6% 才回本（1 ÷ 0.88 ≈ 1.136），输的幅度在复利世界里天然更贵。

## 止损：把「亏多大」从市场手里拿回来

期望值的三个参数里，胜率最难改，平均盈利半靠行情，唯有平均亏损，是你进场前就能写死的。这个动作叫止损（stop loss）——进场前就定好的认输价位，单次亏损的硬上限。设在哪有现成的参照：第 13 章的支撑位外侧一档，或第 18 章的下轨之外——判据前面都教过，本章只补一句算术账。

没有止损，平均亏损是市场随机发的：今天 −8%，明天情绪坏了 −25%。有了止损，它被钉在你写下的那个数。**止损是把「亏多大」从市场手里拿回来的那只旋钮**——同样判断错一次，亏 5% 的错误是学费，亏 30% 的错误是灾难。它还让期望值从事后统计变成事前设计：三个参数都定了，进场之前就知道每注期望多少、错一次付多少。

止损的失效方式也要先说清：第 13 章讲过假突破专门收割止损盘，止损位贴着人人都看的位置，就等于把认输价挂牌公示。应对在第 13 章给过——放到结构位外侧一档，破位收回按假突破处理。止损不是免死牌，是错误的定价器。

## 凯利公式：优势多大，注押多大

期望值为正，下一个问题立刻来了：每一注押多少？这就是仓位（position sizing）——一笔交易投入的资金比例，决定错了多痛、对了多赚的旋钮。答案有个著名的样子，叫凯利公式（Kelly criterion）——按优势大小算出最优下注比例的公式。按四步拆开。

成因。1956 年贝尔实验室的 John Kelly 借信息论（研究信息怎么量化、怎么传的数学分支）回答了赌桌问题：当你确有优势，注押太小赚不动，押太大迟早一次归零。而存在唯一一个让长期资金增长最快的比例，押过头增长率直接转负。数学根源就在本章开头那道复利不对称：亏 12% 要涨 13.6% 才回本——输赢幅度在乘法世界里不对称，仓位越重，这个不对称被放得越大。几何增长（复利）才是资金的真实增长方式，而仓位是波动的放大器。

载体。公式的形状只有一行，配一个 A 股换算：

```text
f*（凯利分数，风险口径）= 胜率 − 败率 ÷ 盈亏比
仓位（A 股口径）        = f* ÷ 止损距离（每注亏损幅度）
```

注意口径：f* 算的是「一注愿意亏掉的资金比例」——公式出生的赌桌上，一注输光就输那么多。A 股买股票输的不是全部本金、是止损那段距离，所以换算成仓位要再除一次止损幅度。

演算。三笔手算，每笔一步出结果。经典硬币局：胜率 0.6、盈亏比 1:1，f* = 0.6 − 0.4 ÷ 1 = 0.2——六成胜率的硬币局只押两成，这是公式最著名的一次亮相。趋势画像：胜率 0.35、盈亏比 2:1（止损 5%），f* = 0.35 − 0.65 ÷ 2 = 0.025，仓位 = 0.025 ÷ 0.05 = 0.5——半仓。你的痛点策略：f* = 0.6 − 0.4 ÷ (1/3) = −0.6，负数——**数学在说：负期望的局，别坐上桌**，跟本金多少无关。

锚点。锚点：回到那道复利不对称——仓位是把亏损的乘法放大器，凯利算的就是放大到多少时长期复利最快。

最后半句必须讲透：实战没人押满凯利，普遍只取一半甚至四分之一。原因有两条，都硬。其一，参数是估计值：胜率和盈亏比来自历史样本，第 9 章亲手验过——裸形态在随机行情里验不出优势，小样本的胜率抖起来 ±10 个百分点很平常。增长曲线在凯利点是个圆顶、过了顶是悬崖，参数估高一点，你以为押在顶上，实际已经掉进负增长区。其二，满凯利只管长期增速、不管路上有多颠——下一节的实验马上给你数字。半凯利牺牲一点速度，把路上的深渊填掉大半。

## 破产概率：仓位管生死

破产风险（risk of ruin）——连续亏损把本金打到无法继续（或心态崩溃）的概率。它和期望值是两个维度：期望值管方向，仓位管生死。直接做实验。蒙特卡洛（Monte Carlo）——用固定种子的随机数给同一套参数跑几千条平行宇宙、把概率数出来的模拟方法。规则：每注用当前资金的一个比例下注，赢就乘 (1 + 仓位 × 平均盈利)，输就乘 (1 − 仓位 × 平均亏损)；资金跌破初始的一半记「破产」并停手（亏损乘法的资金永不归零，只会缩到没法看，破产必须先定义成一条线——这是课程的操作化选择）。

先看仓位这一维有多狠。用趋势画像（胜率 0.35、盈亏比 2、期望值 +0.25%/注——正期望）做实验，三种仓位各跑 4000 条平行宇宙、打满 200 注。

<LineChart :series="rc.series" :labels="rc.labels" :percent-y="true" title="同一正期望策略：全仓 / 凯利仓位 / 半凯利的累计破产概率" />

三条线，一个判决。

读数：全仓 200 注破产概率 46.1%；凯利仓位（半仓）10.4%；半凯利（25% 仓位）4000 条里只死 1 条，0.025%。第 50 注时三者 13.2%、0.15%（图例取整显示 0.2%）、0；第 100 注 29.8%、2.8%、0。注意第一个数字——**期望值为正的策略，全仓照样有一半概率亏掉一半**。优势再真，也扛不住仓位失控；这正是「实战取分数」第二条原因的数字版。

再看你的痛点策略（期望值 −2.4%/注）全仓下注，破产概率逐注爬升：第 10 注 6.3%，第 25 注 54.8%，第 50 注 92.3%，第 100 注 99.6%，第 200 注 100%——破产的路径平均活到第 27 注。把它换成看得见的资金曲线，八条平行宇宙各打 120 注。

<LineChart :series="fan.series" :labels="fan.labels" title="胜率六成的策略全仓下注：八条平行宇宙的资金曲线" />

八条线挤向零。

最好的一个宇宙也只剩初始资金的 32.0%，最差的剩 1.1%——10 万本金变 1130 元。没有一条黑天鹅，没有一次「意外」，六成胜率从头到尾都在，账还是这么算的。期望值管方向、仓位管生死，两句一起成立。

## 马丁格尔：加倍回本是数学死路

亏了加倍下注、赢一把回本——这套注码法叫马丁格尔（martingale），三百年前的赌桌就有了。纸笔推一遍就知道它死在哪。10 万本金，第一注 1000 元，输了就加倍：1000、2000、4000、8000、16000、32000、64000。连亏 6 注已亏 6.3 万，剩 3.7 万押不起第 7 注的 6.4 万——加倍表在第七格断掉。而连亏 7 注在你这套六成胜率的策略里概率是 0.4 的 7 次方 ≈ 0.16%，两百笔里撞上一次约 27%。每赢一局只赚回第一注的 1000 元，撞上一次连亏就归零——小赚攒成必然到账的巨亏。

更根本的一条：**注码改变不了期望的符号**。总期望等于每一注金额乘它的单位期望再求和，单位期望 −2.4% 是负的，注码怎么排，总和都是负。马丁格尔不创造优势，只重排亏损的时间表。A 股版叫「跌了加仓摊成本」——慢动作的马丁格尔，还叠加了 T+1（今天买了明天才能卖，加完仓跑不掉）和跌停时想跑跑不掉的流动性风险。分批建仓和它唯一的区别：前者的每一笔加仓是进场前预算好的计划，后者是被浮亏推着走的回本情绪。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审五组：期望值与凯利可手算；负期望策略破产概率随注数单调上升；同一正期望策略全仓、凯利仓位、半凯利排序；固定种子可复现、资金路径是乘法序列；非法输入。挑三段贴出来。

```ts
// tests/expectancy-risk.test.ts · 期望值手算（痛点策略与镜像）
  it('胜率六成、赢 4% 亏 12%：0.6×0.04 − 0.4×0.12 = −0.024，每注亏 2.4%', () => {
    expect(expectancy(PAIN)).toBeCloseTo(-0.024, 12)
  })

  it('镜像参数：0.4×0.12 − 0.6×0.04 = +0.024——胜率降两成，期望值翻正', () => {
    expect(expectancy(MIRROR)).toBeCloseTo(0.024, 12)
  })
```

```ts
// tests/expectancy-risk.test.ts · 负期望策略：破产概率随交易次数单调上升
  it('破产概率逐段爬升：第 10/25/50/100 注逐级抬高，200 注打满后 ≥ 95%', () => {
    expect(r.ruinCurve[9]).toBeGreaterThanOrEqual(0.02)
    expect(r.ruinCurve[24]).toBeGreaterThanOrEqual(r.ruinCurve[9] + 0.1)
    expect(r.ruinCurve[49]).toBeGreaterThanOrEqual(r.ruinCurve[24] + 0.1)
    expect(r.ruinCurve[99]).toBeGreaterThanOrEqual(r.ruinCurve[49] + 0.01)
    expect(r.ruinCurve[199]).toBeGreaterThanOrEqual(0.95)
  })
```

```ts
// tests/expectancy-risk.test.ts · 同一正期望策略，全仓 > 凯利仓位 > 半凯利
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
```

见红后实现。新模块 `src/risk/`，三个文件，只增不改。先是期望值与三参数的共用校验：

```ts
// src/risk/expectancy.ts · expectancy 与 assertEdgeStats 全貌
/** 一套策略的三个血参数（全部比例口径，不带单位「元」） */
export type EdgeStats = {
  /** 胜率：盈利交易占全部交易的比例，[0,1] */
  winRate: number
  /** 平均盈利：每次盈利交易平均赚到下注额的多少（0.04 = 一赢赚下注额的 4%） */
  avgWin: number
  /** 平均亏损：每次亏损交易平均亏掉下注额的多少（0.12 = 一输亏下注额的 12%），记正数 */
  avgLoss: number
}

/** 三参数的结构校验：胜率在 [0,1]、平均盈利与平均亏损是正的有限数——本章三个函数共用一道门 */
export function assertEdgeStats(stats: EdgeStats, label: string): void {
  if (typeof stats !== 'object' || stats === null) {
    throw new Error(`${label}：stats 必须是对象，收到的是 ${String(stats)}`)
  }
  if (!Number.isFinite(stats.winRate) || stats.winRate < 0 || stats.winRate > 1) {
    throw new Error(`${label}：winRate 必须在 [0,1] 内，收到的是 ${stats.winRate}`)
  }
  if (!Number.isFinite(stats.avgWin) || stats.avgWin <= 0) {
    throw new Error(`${label}：avgWin 必须是正数（赚多大幅度），收到的是 ${stats.avgWin}`)
  }
  if (!Number.isFinite(stats.avgLoss) || stats.avgLoss <= 0) {
    throw new Error(`${label}：avgLoss 必须是正数（亏多大幅度，记正数），收到的是 ${stats.avgLoss}`)
  }
}

/** 期望值 = 胜率 × 平均盈利 − 败率 × 平均亏损：长期平均每一注的盈亏（以下注额为 1 的比例）。
 *  读法：+0.025 是每注平均赚下注额的 2.5%；−0.024 是每注平均亏 2.4%——负数不是「做得差」，
 *  是「做多少次都是亏」，注码和心态都救不了它，只有换策略。 */
export function expectancy(stats: EdgeStats): number {
  assertEdgeStats(stats, 'expectancy')
  const q = 1 - stats.winRate
  return stats.winRate * stats.avgWin - q * stats.avgLoss
}
```

凯利一行公式，负数原样返回——「别上桌」也是读数：

```ts
// src/risk/kelly.ts · kellyFraction 全貌
/** 凯利分数：最优下注比例（风险口径）。负数 = 负期望，数学在说「这局别坐上桌」，读数取 0。 */
export function kellyFraction(stats: EdgeStats): number {
  assertEdgeStats(stats, 'kellyFraction')
  const q = 1 - stats.winRate
  const payoff = stats.avgWin / stats.avgLoss // 盈亏比：平均盈利 ÷ 平均亏损
  return stats.winRate - q / payoff
}
```

破产实验室先立契约——返回的不只是一个数，是整条「第几注时已死多少条」的曲线：

```ts
// src/risk/ruin.ts · 报告与选项类型
export type RuinOpts = {
  /** 固定种子（createRng 的入参），默认 42：同一种子跑两遍，读数逐项一致 */
  seed?: number
  /** 破产线：资金跌到初始资金的该比例即记破产，默认 0.5（亏掉一半算报废）。分数下注的乘法资金永不归零，只会缩到没法看——破产必须操作化成一条线 */
  ruinLine?: number
}

export type RuinReport = {
  /** 累计破产概率曲线：第 k 项 = 前 k+1 注之内触到破产线的路径占比（吸收口径，单调不降） */
  ruinCurve: number[]
  /** 打满 bets 注后的破产概率 = ruinCurve 末项 */
  ruinProbability: number
  /** 破产路径平均在第几注触线（从 1 数起）；一条都没死记 null */
  meanRuinBet: number | null
  bets: number
  trials: number
  /** 下注用的资金比例（仓位口径：1 = 每注全仓进出） */
  fraction: number
  ruinLine: number
  seed: number
}
```

主体两块。蒙特卡洛模拟：

```ts
// src/risk/ruin.ts · monteCarloRuin 全貌
export function monteCarloRuin(
  stats: EdgeStats,
  bets: number,
  trials: number,
  fraction: number,
  opts: RuinOpts = {},
): RuinReport {
  assertEdgeStats(stats, 'monteCarloRuin')
  const ruinLine = assertRuinArgs(bets, trials, fraction, opts, 'monteCarloRuin')
  const rng = createRng(opts.seed ?? 42)
  const winMul = 1 + fraction * stats.avgWin
  const lossMul = 1 - fraction * stats.avgLoss

  const hits = new Array<number>(bets).fill(0) // 每一注的累计死亡数
  const ruinBets: number[] = []
  for (let t = 0; t < trials; t++) {
    let equity = 1
    let ruinedAt = -1
    for (let k = 0; k < bets; k++) {
      equity *= rng() < stats.winRate ? winMul : lossMul
      if (equity <= ruinLine) {
        ruinedAt = k
        break // 破产是吸收态：破了产的钱不再翻本，后面的注不打了
      }
    }
    if (ruinedAt < 0) continue
    ruinBets.push(ruinedAt + 1)
    for (let k = ruinedAt; k < bets; k++) hits[k]++ // 从触线那注起，之后每一格都算「已破产」
  }

  const ruinCurve = hits.map((h) => h / trials)
  const meanRuinBet =
    ruinBets.length === 0
      ? null
      : ruinBets.reduce((a, b) => a + b, 0) / ruinBets.length
  return {
    ruinCurve,
    ruinProbability: ruinCurve[ruinCurve.length - 1],
    meanRuinBet,
    bets,
    trials,
    fraction,
    ruinLine,
    seed: opts.seed ?? 42,
  }
}
```

资金路径——扇形图的原料，纯乘法、不截断：

```ts
// src/risk/ruin.ts · equityPaths 全貌
export function equityPaths(
  stats: EdgeStats,
  bets: number,
  paths: number,
  fraction: number,
  opts: { seed?: number } = {},
): number[][] {
  assertEdgeStats(stats, 'equityPaths')
  if (!Number.isInteger(bets) || bets < 1) {
    throw new Error(`equityPaths：bets 必须是正整数，收到的是 ${bets}`)
  }
  if (!Number.isInteger(paths) || paths < 1) {
    throw new Error(`equityPaths：paths 必须是正整数，收到的是 ${paths}`)
  }
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error(`equityPaths：fraction 必须在 (0,1] 内，收到的是 ${fraction}`)
  }
  const seed = opts.seed ?? 42
  if (!Number.isInteger(seed)) {
    throw new Error(`equityPaths：seed 必须是整数，收到的是 ${seed}`)
  }
  const rng = createRng(seed)
  const winMul = 1 + fraction * stats.avgWin
  const lossMul = 1 - fraction * stats.avgLoss

  const out: number[][] = []
  for (let t = 0; t < paths; t++) {
    const path: number[] = [1]
    let equity = 1
    for (let k = 0; k < bets; k++) {
      equity *= rng() < stats.winRate ? winMul : lossMul
      path.push(equity)
    }
    out.push(path)
  }
  return out
}
```

读两个承重点。其一，`monteCarloRuin` 里破产是吸收态：触线即 break，之后的所有注不再模拟，但 `hits` 从触线那注起逐格累加——曲线「单调不降」不是碰巧，是记账方式保证的。其二，`equityPaths` 不设破产线截断：乘法资金永不归零，扇形图里那些贴着横轴的线其实都还大于零——「缩到没法看」和「归零」的区别，正是破产线必须操作化的原因。参数门 `assertRuinArgs`（注数、轮数、仓位 (0,1]、破产线、种子五道校验）与两函数同文件，测试十七案逐项验过。

图上的数据照旧出自 export-docs 脚本第 20 章导出段，守门内置：痛点与趋势画像的期望值、凯利分数逐个与手算值比对；凯利仓位由 `kellyFraction` 现场算出再除以止损距离，不手写；三条破产曲线必须单调不降、排序差距至少 5 个百分点、半凯利不得高于 5%；扇形图每条路径 120 注后必须低于初始一半。次序乱一处，整段失败换种子重来。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：357 项全绿，其中 40 项是本章新增。覆盖面：期望值五案（含零期望边界与镜像互补）；凯利六案（硬币局 0.2、趋势画像 0.025、负期望 −0.6、仓位换算 0.5、盈亏比与胜率单调性）；负期望破产曲线逐段爬升（第 10/25/50/100/200 注 6.3%/54.8%/92.3%/99.6%/100% 那组读数的来源）与吸收单调；三仓位排序（全仓、凯利仓位、半凯利两两差至少 8 个百分点）；同种子逐项一致、换种子读数不同、无破产路径时 meanRuinBet 记 null；资金路径每步比值只可能是赢乘数或输乘数；非法输入十七案全部抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 20 章一段。趋势画像凯利风险 2.5%、仓位 50%；200 注破产概率全仓 0.461、凯利仓位 0.104、半凯利 0（4000 条中 1 条）；第 50 注 0.132/0.002/0，第 100 注 0.298/0.028/0。扇形图八条路径终点最高 32%、最低 1.1%。痛点策略破产曲线 0.063 → 0.548 → 0.923 → 0.996 → 1，破产路径平均活到第 27 注。`docs/assets/data/` 下多出两个 `20-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体，而且这次是对着自己开刀。打开交割单，抄最近二十笔的盈亏金额，跑一遍：

```ts
// 用法示例：把自己的交割单算成期望值（node 直接可跑）
const wins = [420, 380, 510, 260]   // 每笔盈利（元）
const losses = [1900, 2300, 1700]   // 每笔亏损（元）
const winRate = wins.length / (wins.length + losses.length)
const avgWin = wins.reduce((a, b) => a + b, 0) / wins.length
const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length
console.log(winRate * avgWin - (1 - winRate) * avgLoss) // ≈ −619：每笔平均亏 619 元
```

读数是负的，答案就一个字：停。是正的，再算两步：盈亏比 = avgWin ÷ avgLoss；凯利风险 = 胜率 − 败率 ÷ 盈亏比，仓位 = 风险 ÷ 你的止损距离，然后取一半。顺手再查一件事：那笔最大的亏损，是不是加过仓。

## 用法收三条，全部条件句

其一，若你的历史交易期望值为正、样本几十笔起步且过了第 9 章的随机对照（优势不是抖出来的），常见的应对是仓位取「凯利风险 ÷ 止损距离」的一半以下；失效条件：参数来自小样本或贴合历史，或期望值近期转负——减仓直至停手。其二，若持仓触及进场前写好的止损位，常见的应对是按计划离场，而不是加仓摊成本；唯一例外：入场理由仍然成立、且这笔加仓本来就在分批预算之内；失效条件：加仓让这笔交易的总风险越过预算。其三，若账户从高点回撤逼近破产线（比如一半），常见的应对是把仓位降到半凯利以下，等期望值重新为正再恢复；失效条件：任何「加倍回本」的念头——马丁格尔判死，不复审。

简化之处照实声明。每笔盈亏被压成两个固定乘数，真实盈亏是分布——第 18 章刚教过肥尾，用平均幅度会抹掉尾部；模拟不含费用、滑点与跳空跌停——「止损=单次亏损硬上限」在跳空/一字跌停时不成立（第 2、15 章都见过），破产线 0.5 为课程操作化选择。这些全部登记在附录差异清单。

## 小结

- 期望值 = 胜率 × 平均盈利 − 败率 × 平均亏损，等价于（总盈利 − 总亏损）÷ 总笔数；胜率必须配盈亏比同场读。
- 止损把平均亏损从事后随机变成事前设计；仓位 = 每注风险 ÷ 止损距离。
- 凯利公式 f* = 胜率 − 败率 ÷ 盈亏比（风险口径）；实战取分数：参数是估计值、满凯利路上回撤深——4000 条宇宙里 200 注破产概率全仓 46.1%、凯利仓位 10.4%、半凯利 0.025%。
- 马丁格尔改变不了期望的符号：负期望加任何注码设计都是加速亏损；10 万本金撑不过连亏 7 注的加倍表。
- 实验场新增 `src/risk/`：`expectancy` / `kellyFraction` / `monteCarloRuin` / `equityPaths`，只增不改。

读完本章，你应该能回答：

1. 胜率 0.55、平均盈利 6%、平均亏损 8% 的策略，每注期望多少？盈亏比多少？凯利风险多少？
2. 同一正期望策略，全仓与半凯利的 200 注破产概率差多少？差出来的原因写在哪一条算式里？
3. 为什么实战只取凯利分数的一半甚至更少？两条原因各举一个数字证据。
4. 「亏了加倍下注」为什么救不了负期望策略？用期望值的求和式说一遍。

去向一句话：本章的胜率、盈亏比都是你口头报的参数——第 21 章的回测引擎会把整套规则放进历史行情彩排，含费用与 T+1，把这三个参数换成跑出来的成绩单。
