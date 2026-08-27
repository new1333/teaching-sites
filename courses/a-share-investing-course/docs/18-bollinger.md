---
title: 布林带与波动率：把概率装进指标
---

# 布林带与波动率：把概率装进指标

<script setup>
// 图一：K 线与布林带三线叠加，标记含收口点、首根收盘破下轨、开口极值、反抽中轨。
import bb from './assets/data/18-bands.json'
// 图二：同一行情的带宽序列（LineChart），灰线为收口当天的水位。
import bw from './assets/data/18-bandwidth.json'
// 图三：肥尾实验——正态与尖峰肥尾两列的累计带外占比（LineChart）。
import ft from './assets/data/18-fat-tails.json'
</script>

那只票在 10 元附近横了一个月。副图上的布林带（Bollinger bands——行情软件里那三条把价格包住的线：中轨是均线，上下轨随波动自己伸缩）越挤越窄，上下轨之间只剩五分钱。第 51 天，收盘 9.92 元，跌破了下轨的 9.98 元。你按口诀办事：「跌到下轨就是超卖，抄底。」接回来。此后十六个交易日，收盘全贴在下轨之下——不是下轨托住了价格，是价格拖着下轨一路往下走，股价最低探到 7.29 元。你抄底抄在了半山腰，被套近三成。这笔亏损的根源不是运气：把「会动的轨道」当成了「不动的地板」。带子不是地板，是速度表。

先看挨打现场。下图是 92 根固定种子合成行情（前 50 根横盘），三条带子与四个标记全部出自实验场 `bollinger()` 的真实计算，收口点由 `squeezes()` 扫出，不手标。

<KLineChart :candles="bb.candles" :overlays="bb.overlays" :markers="bb.markers" title="收口、破轨、开口、反抽" />

带子全程在动。

先对表。收口点在第 41 根，带宽 0.55%——此时 σ 约 1 分 4 厘，上下轨离中轨各约 2 分 8 厘（半宽是 2σ，别把 σ 当成半宽）。第 51 根收盘 9.92 元首次跌破下轨 9.98 元，横盘期那根约 0.9% 的阴线就把它踩破了。此后连续 16 根收盘压在下轨之下，价格最低第 68 根（7.29 元），带宽却在第 71 根才冲到开口极值 41.98%——是收口水位的 76 倍。结尾第 81 根收盘反抽回中轨。数字先摆在这，原理后面逐个拆。

三件事：把标准差手算到能复现；讲清「±2σ 大约覆盖 95%」这句口诀的来历与适用边界；用带宽的收口与开口读行情——顺便还上第 11 章欠的账（乖离怎么量）。

## 标准差：每个数离平均数平均有多远

平均数会骗人。两列五日收盘，一列是 9.9、10.0、10.1、10.0、10.0，一列是 8、12、9、13、8——平均都是 10 元，「多少钱」这个维度完全一样，颠簸却是两个世界。均线把颠簸抹掉是为了看方向；可「最近颠不颠」本身就是一条重要信息，需要一个数把它量出来。

直接平均「每个数离平均数多远」行不通：高于平均的离差加低于平均的离差，永远互相抵消，总和恒为零。办法是先平方——平方把负离差变成正数，谁也抵消不了谁；最后再开一次方，把被平方放大的量纲还原回来。这一套算下来得到的数，就是**标准差（standard deviation——每个数离平均数平均有多远的「平均距离」，价格序列的颠簸幅度）**。成因（不抵消、量还原）、算式都有了，跟着算一遍，五天收盘 [9, 11, 10, 12, 8]：

```text
根序        1      2      3      4      5
收盘        9      11     10     12     8
平均        10     （50 ÷ 5）
离差        −1     +1      0     +2     −2
离差平方     1      1      0      4      4
```

四步：平均 50÷5 = 10；离差逐个减平均；平方求和 1+1+0+4+4 = 10；方差 = 平方和 ÷ 个数 = 10÷5 = 2，标准差 = √2 ≈ 1.41 元。锚点收一句：它就是「离平均数的平均距离」，1.41 元的意思是这五天收盘离 10 元平均每一站平均差 1.41 元。统计课的样本标准差（除以 n−1 而不是 n）会稍大一点，行情软件的布林带通行除以 n 的总体口径，实验场随行就市，差异登记在附录清单。

## 正态直觉：±2σ ≈ 95% 是条件句，不是定律

有了 σ，就能给「偏离多少算离谱」定刻度——前提是颠簸的形状已知。最常被借用的形状是正态分布（normal distribution——中间高、两头低、左右对称的钟形曲线，大量微小噪声叠加的常见结果）。如果收盘价的颠簸服从正态分布，偏离落在各区间内的比例是数学上定死的：

```text
区间           覆盖比例
平均 ± 1σ      约 68%
平均 ± 2σ      约 95%（精确 95.45%）
平均 ± 3σ      约 99.7%
```

这就是「±2σ 之外大约 5%」的出处。它常被压缩成口诀，但口诀漏掉了前半句：**整个表格只在「颠簸服从正态分布」这个条件下成立**。真实行情的日收益公认是尖峰肥尾的形状——中间更尖（大多数日子比正态更平静）、尾巴更厚（极端日比正态预言的多得多、狠得多）。肥尾有多伤刻度，本章末尾的实验亲手量。另一条边界是波动聚集：真实行情的颠簸大小不是天天独立抽签，平静与风暴成段出现——带宽序列本身就是这件事的记录仪。

## 布林带：均线 ± k 倍标准差的弹性通道

布林带把上面两件东西组装起来：中轨取第 11 章的均线（默认 MA20），上下轨 = 中轨 ± k 倍标准差（默认 k=2，发明人 Bollinger 的经典参数）。它和第 13 章的支撑阻力是两种哲学：支撑位是固定价位——人多的路口不会自己挪；布林带是弹性通道——最近 20 根收盘颠得凶，带子就宽；走得温，带子就窄，通道自己会呼吸。

带子的宽窄有一个单独的读数：带宽 =（上轨 − 下轨）÷ 中轨 × 100，单位是百分比。把图一那 92 根行情的三条带子压成一条带宽线，就是下图（灰线是收口当天的水位）。

<LineChart :series="bw.series" :labels="bw.labels" title="同一行情的带宽：收口到开口再到收口" />

一条线讲完三幕。

第一幕收口：横盘一个月，带宽缩到 0.55%——平静积累。第二幕开口：下跌加速，带宽冲到 41.98%——风暴落地。带宽的峰值不在价格最低的第 68 根，而在第 71 根：窗口被最颠的几根填满，带子最宽的时刻比价格最低的时刻晚到一步。第三幕再收口：企稳反弹后，带宽在第 81 到 85 根重新创出新低（9.08%），结尾收回峰值的一半以下。收口与开口的循环，就是波动聚集在图上的长相。收口本身不指方向，它只说「风暴前的安静」——方向要等开口那一下自己交代。

现在能复盘开章的亏损了。破下轨那天你看到的是「价格到地板了」；带子的算法看到的是另一件事：下跌在加速，σ 在变大，中轨也在跟着下移——下轨 = 中轨 − 2σ，两个加数都朝下跌的方向走，地板每天都在下沉。你按当天地板价买入，地板第二天就沉到你脚下。**带子是速度表，不是地板天花板**：它量的是「偏离中轨多少个当前 σ」，不是「价格贵不贵」。速度表口径顺带还上第 11 章的账——那章说「价格偏离均线多远」叫乖离，量化留到本章：乖离率 =（收盘 − 均线）÷ 均线，布林带的口径 =（收盘 − 中轨）÷ σ。同一个 0.3 元的偏离，收口段（σ 才 1 分 4）是 20σ 开外的巨响，开口顶上（σ 约 9 毛）连半个 σ 都不算。乖离问「偏了多远」，带宽问「以现在的颠簸算不算远」——两把尺合起来才是完整读数。

## 肥尾实验：95% 在什么条件下成立

口诀的适用边界不能靠嘴说，做个实验。造两列各 1500 个读数，都绕 10 元均值震荡（把「分布形状」从「趋势」里剥出来，是实验设计，不是真实行情）：一列正态噪声，日 σ = 0.15；另一列尖峰肥尾——88% 的日子只有 0.1σ 的小波动，12% 的日子来一记大跳，跳幅由「总标准差恰好仍是 0.15」反解出来（约 2.87σ）。两列总颠簸相同，只有形状不同，这是公平对照的前提，实验场测试逐项断言。对两列各跑 `outsideStats()`（n=20、k=2），累计带外占比画成曲线：

<LineChart :series="ft.series" :labels="ft.labels" :percent-y="true" title="正态对肥尾：累计带外占比" />

两条线在 5% 参考线两侧分家。

读数：正态列带外 56/1481 = 3.78%（上 28、下 28，恰好评均），肥尾列 106/1481 = 7.16%——**同样的总 σ，带外事件多出将近一倍（1.89 倍）**。正态列为什么不到 5%：一半正是下文「枷锁」的口径使然——σ 由含当根的 20 根窗口估出，越大的偏离自己把带子撑宽了，实验守门也因此把放行区间定在 3% 到 6.5%。更扎眼的是极端日：正态列 1500 天里最大的单日读数 0.61 元，4.1σ；肥尾列最大单日（向下）1.30 元，8.67σ。正态假设下 8σ 之外的事件概率小到宇宙年龄里也等不来一次；肥尾列里，它只是 12% 跳变日的一次普通发挥。A 股没有夸张到这个构造，但连续一字跌停的股票、单日振幅超过正态「许可」的日子，每个老股民都见过——肥尾不是数学构造物，是行情的常态形状。

结论写成条件句：若把 ±2σ ≈ 95% 当概率使用，前提是「颠簸近似正态」，而真实日收益公认尖峰肥尾——同样的 σ 下，带外事件更多、极端日更狠；5% 这类数字引用之前，先问一句分布形状。第 9 章的功课在这里同样适用：两列读数都是 1481 个样本起步的统计，曲线头部抖、样本长大才稳。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审五件事：标准差小样本手算四步一致；布林带小样本逐格与手算一致、中轨与第 11 章 `sma` 逐格相等、k 是带宽的放大器；带宽序列与收口检测（振幅收窄段逐格创新低、风暴段无新低）；带外占比（正态约 5%、肥尾显著更高、两列总 σ 相同）；非法输入。挑三段贴出来。

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/bollinger.test.ts · 标准差手算四步
  it('小样本 [9,11,10,12,8]：平均 10 → 离差 −1/+1/0/+2/−2 → 平方和 10 → 方差 2 → σ=√2', () => {
    expect(stdev([9, 11, 10, 12, 8])).toBeCloseTo(Math.sqrt(2), 10)
  })
```

</details>

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/bollinger.test.ts · 收口检测落在收口段，最深一处紧贴风暴起点
  it('收口检测全部落在收口段（下标 < 65），最深的一处紧贴风暴起点（第 65 根）', () => {
    expect(sq.length).toBeGreaterThanOrEqual(10)
    for (const s of sq) expect(s.index).toBeLessThan(65)
    expect(sq[sq.length - 1]!.index).toBe(64)
    expect(sq[sq.length - 1]!.bandwidth).toBeCloseTo(bb.bandwidth[64]!, 8)
  })
```

</details>

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/bollinger.test.ts · 同 σ 的肥尾列显著更高
  it('同 σ 的尖峰肥尾序列显著更高：至少多 2 个百分点、1.6 倍以上', () => {
    expect(rf.ratio).toBeGreaterThanOrEqual(rn.ratio + 0.02)
    expect(rf.ratio).toBeGreaterThanOrEqual(1.6 * rn.ratio)
  })
```

</details>

还有一段值得单说：窗口含当根的枷锁。`bollinger` 算第 i 根的带子用的是「最近 n 根含第 i 根自己」的窗口——离群的那根自己也进了 σ 的分母。数学后果：n=5 时，一根离群收盘最多把自己的偏离顶到 √(n−1) = 2 个 σ，恰好压在 k=2 的轨上，永远越不出去。测试里窗口 [10,10,10,10,100] 的上轨恰为 100，收盘 100 压线，带外为零——这不是巧合，是算式的硬约束。

见红后实现。两个新模块 `src/stats/stdev.ts` 与 `src/indicators/bollinger.ts`，只增不改。先是标准差全貌：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/stats/stdev.ts · stdev 全貌
export function stdev(values: readonly number[]): number {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('stdev：values 不能为空')
  }
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`stdev：第 ${i} 个值必须是有限数字，收到的是 ${values[i]}`)
    }
    sum += values[i]
  }
  const mean = sum / values.length
  let squares = 0
  for (let i = 0; i < values.length; i++) {
    squares += (values[i] - mean) * (values[i] - mean)
  }
  return Math.sqrt(squares / values.length)
}
```

</details>

肥尾实验的样本生产线（`normalDraws` 是 Box–Muller 变换的直白包装，把均匀随机源折成钟形；两列读数共用同一个正态源）：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/stats/stdev.ts · leptokurticDraws 全貌
export function leptokurticDraws(
  rng: () => number,
  count: number,
  sigma = 1,
  spikeChance = 0.12,
  quietShare = 0.1,
): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`leptokurticDraws：count 必须是正整数，收到的是 ${count}`)
  }
  if (!Number.isFinite(sigma) || sigma < 0) {
    throw new Error(`leptokurticDraws：sigma 必须是非负有限数，收到的是 ${sigma}`)
  }
  if (!Number.isFinite(spikeChance) || spikeChance <= 0 || spikeChance >= 1) {
    throw new Error(`leptokurticDraws：spikeChance 必须是 (0,1) 内的数，收到的是 ${spikeChance}`)
  }
  if (!Number.isFinite(quietShare) || quietShare < 0 || quietShare >= 1) {
    throw new Error(`leptokurticDraws：quietShare 必须是 [0,1) 内的数，收到的是 ${quietShare}`)
  }
  const L = Math.sqrt((1 - (1 - spikeChance) * quietShare * quietShare) / spikeChance)
  const next = normalNext(rng)
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    out.push((rng() < spikeChance ? next() * L : next() * quietShare) * sigma)
  }
  return out
}
```

</details>

再是布林带主体。中轨直接复用第 11 章的 `sma`——同一条线换了个名字：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/indicators/bollinger.ts · bollinger 全貌
export function bollinger(candles: readonly Candle[], n: number = DEFAULT_BB_N, k: number = DEFAULT_BB_K): BollingerSeries {
  assertBollingerArgs(candles, n, k, 'bollinger')
  const mid = sma(candles, n)
  const upper: BandLine = new Array(candles.length).fill(null)
  const lower: BandLine = new Array(candles.length).fill(null)
  const bandwidth: BandLine = new Array(candles.length).fill(null)
  const window: number[] = []
  for (let i = 0; i < candles.length; i++) {
    window.push(candles[i].close)
    if (window.length > n) window.shift() // 滑窗：进一根新的，退一根最老的
    if (i < n - 1) continue
    const sd = stdev(window) // 最近 n 根收盘价的颠簸幅度——带子宽窄的唯一来源
    const m = mid[i]!
    upper[i] = m + k * sd
    lower[i] = m - k * sd
    bandwidth[i] = ((upper[i]! - lower[i]!) / m) * 100
  }
  return { mid, upper, lower, bandwidth }
}
```

</details>

收口检测与带外占比，两个纯读数的伴生入口：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/indicators/bollinger.ts · squeezes 全貌
export function squeezes(
  candles: readonly Candle[],
  opts: { n?: number; k?: number; lookback?: number } = {},
): BollingerSqueeze[] {
  const n = opts.n ?? DEFAULT_BB_N
  const k = opts.k ?? DEFAULT_BB_K
  const lookback = opts.lookback ?? DEFAULT_SQUEEZE_LOOKBACK
  assertBollingerArgs(candles, n, k, 'squeezes')
  if (!Number.isInteger(lookback) || lookback < 2) {
    throw new Error(`squeezes：lookback 必须是不小于 2 的整数，收到的是 ${lookback}`)
  }
  const { bandwidth } = bollinger(candles, n, k)
  const out: BollingerSqueeze[] = []
  // 从 n−1+lookback−1 起：当根带宽已成形，且前面凑得满 lookback−1 个成形带宽
  for (let i = n - 1 + lookback - 1; i < candles.length; i++) {
    const cur = bandwidth[i]!
    let isNewLow = true
    for (let j = i - lookback + 1; j < i; j++) {
      if (bandwidth[j]! <= cur) {
        isNewLow = false
        break
      }
    }
    if (isNewLow) out.push({ index: i, bandwidth: cur })
  }
  return out
}
```

</details>

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/indicators/bollinger.ts · outsideStats 全貌
export function outsideStats(
  candles: readonly Candle[],
  n: number = DEFAULT_BB_N,
  k: number = DEFAULT_BB_K,
): BollingerOutside {
  assertBollingerArgs(candles, n, k, 'outsideStats')
  if (candles.length < n) {
    throw new Error(`outsideStats：序列至少要 ${n} 根K线才凑得出第一条带，收到的是 ${candles.length} 根`)
  }
  const { upper, lower } = bollinger(candles, n, k)
  let formed = 0
  let above = 0
  let below = 0
  for (let i = n - 1; i < candles.length; i++) {
    formed++
    if (candles[i].close > upper[i]!) above++
    else if (candles[i].close < lower[i]!) below++
  }
  const outside = above + below
  return { formed, outside, above, below, ratio: outside / formed }
}
```

</details>

读两个承重点。其一，`squeezes` 的判据是「带宽创最近 lookback 根（默认 20）的严格新低」，连续下行的带宽会连出多个收口点——「收口进行中」本来就是一段日子，不是一根 K 线；回看窗默认 20 根是课程操作化选择，可传参改。其二，`outsideStats` 只记严格越出（恰好压在轨上算带内），测试里那根恰好压线的一百元收盘就是这条口径的活样本。

图上的数据照旧出自 export-docs 脚本第 18 章导出段，守门内置：收口点必须落在横盘段后部；下跌段必须有收盘破下轨且不少于两根（「下轨一路下沉」的图面）；开口极值至少是收口水位的 3 倍；反弹必须反抽回中轨；企稳后必须再收口；肥尾列带外占比必须比正态列多 2 个百分点且 1.6 倍以上、两列总标准差相差不超过一成。次序乱一处，整段失败换种子重来。

简化之处照实声明并登记附录差异清单：σ 取总体口径（÷n）；默认 20 日与 k=2 为 Bollinger 经典参数、收口回看窗 20 根与「严格新低」判据为课程操作化选择；带宽为百分比口径；肥尾实验的 88%/12% 混合比例与平稳构造为教学设计（跳变换算成单日涨跌会越过第 2 章的涨跌停边界，实验管形状不管交易规则）；两段行情为固定种子合成。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：317 项全绿，其中 28 项是本章新增。覆盖面：σ 手算与平移不变；小样本布林带逐格核对（含第 6 根窗口的 σ=√2.96）、中轨与 `sma` 逐格相等、k=3 带宽恰为 k=2 的 1.5 倍、默认参数 20/2；收口样本 95 根（振幅收窄到两成后换 8 倍风暴）——收口点全部落在收口段、最深一处紧贴风暴起点、更短回看窗更易判新低；肥尾实验——两列总 σ 相差不超过一成、正态列占比 3%~6.5%、肥尾列至少多 2 个百分点且 1.6 倍以上；枷锁样本（[10,10,10,10,100] 上轨恰为 100、带外为零）；非法输入十三案全部抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 18 章一段。收口点第 41 根，带宽 0.55%；首根收盘破下轨第 51 根，收 9.92 元、下轨 9.98 元；全程收盘在下轨之下 16 根。开口极值第 71 根，41.98%，是收口水位的 76.2 倍；反抽中轨第 81 根。带宽先收口到 0.55%，再开口到 41.98%，企稳后收回 9.08%，结尾 16.15%。肥尾实验构造总 σ 同为 0.15（样本实测 0.15 对 0.16，相差一成内），正态列带外 3.78%（上 28 下 28），肥尾列 7.16%，为其 1.89 倍；最大单日读数 4.1σ 对 8.67σ。`docs/assets/data/` 下多出三个 `18-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体。打开行情 App，任选一只票，开前复权，抄下最近 20 个交易日收盘价，纸笔四步：平均、离差、平方和÷20、开方——算出 σ，再写出上下轨，和软件的布林带对一对（多数软件默认 20 日 2 倍，口径相同）。再翻它近两年的 K 线：找带宽最窄的那一段，看它之后 20 根 K 线走出了什么。三只票做下来，你对「收口是风暴前的安静」就有自己的样本了。

用法收三条，全部条件句。其一，若带宽收口至近月低水位后收盘带量突破上轨，且收盘站上第 11 章口径的 MA20，常见的应对是轻仓试探、止损设在收口段下沿；失效条件是三根内收盘跌回带内——按第 13 章的假突破处理，离场。其二，若收盘跌破下轨而带宽仍在开口（下跌在加速），下轨不构成买点——地板在下沉；若带宽开口转平、收盘收回带内且不再创新低，下轨反抽才进入候选；失效条件是收盘再创新低。其三，超买超卖读数（第 17 章的 RSI/KDJ）与带外读数混用时，先看带宽：收口段里两条轨道贴着中轨，碰到轨道不算事件，开口段的带外才有速度含义。

## 小结

- 标准差 = 离差平方的平均再开方——每个数离平均数平均有多远；布林带 = 中轨（MA20）± k·σ（默认 k=2），带宽 =（上轨 − 下轨）÷ 中轨 × 100。
- ±2σ ≈ 95% 只在颠簸近似正态时成立；真实日收益尖峰肥尾——实验里同样的总 σ，带外占比 3.78% 对 7.16%，最大单日 4.1σ 对 8.67σ。
- 带宽收口是风暴前的安静（不指方向），开口是颠簸上路；下轨 = 中轨 − 2σ，加速下跌里两个加数同向向下——地板每天在沉。
- 带子是速度表不是地板：乖离问「偏了多远」，÷σ 之后问「以当前颠簸算不算远」——第 11 章的欠账还清。
- 全部判据进了实验场：`bollinger`/`squeezes`/`outsideStats` 与 `stdev`/`normalDraws`/`leptokurticDraws` 只增不改。

读完本章，你应该能回答：

1. 五天收盘 [9, 11, 10, 12, 8] 的 σ 是多少？写出四步。
2. 带宽 0.55% 的收口段与 41.98% 的开口段，同样偏离中轨 0.3 元，各合多少个 σ？哪一段更值得当成事件？
3. 收盘跌破下轨，哪两种盘面下不构成买点？各用带子的算式说原因。
4. 「±2σ 之外大约 5%」这句话要补充哪半句才不误导？肥尾实验里 1.89 倍这个数是怎么控制变量得到的？

去向一句话：带子把概率装进了指标，但「概率多大」要配「赔率多大」才算得清账——第 19 章先转去下单前的基本面排雷，期望值与仓位的算术在后面等你。
