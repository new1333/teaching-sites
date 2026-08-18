---
title: 成交量：价格是舟，量是水
---

# 成交量：价格是舟，量是水

<script setup>
// 本章三张图的数据，全部来自实验场 export-docs 脚本对 src/volume/features.ts 的真实计算。
import vol from './assets/data/12-volume-labels.json'
// 60 根横盘行情铺量能阶梯，四种标签由 volumeFeatures 扫出。
import div from './assets/data/12-divergence.json'
// 70 根单边上行，两段缩量新高长出顶背离，放量上涨段零背离。
import turn from './assets/data/12-turnover.json'
// 量能阶梯除以流通股本 4 亿股，得到逐日换手率。
</script>

四月中旬你清仓了那只票。理由只有一句：价涨量缩，要反转。那天收盘 13.10 元，比前一日又涨了一点，成交量（当天实际成交的股数）却比前五日的平均小三成。群里都说量跟不上、主力在拉高出货，你越想越怕，尾盘全卖了。之后三周它没回头：13.1 → 14.2 → 15.6，最后收在 18 元上方——主升浪（一波行情里最陡、最连贯的中段拉升）你只坐了前半程。复盘时你想给自己找个说法，才发现问题根本不在卖错：你依据的是一句口诀，不是判据。量「跟不上」——跟谁比？缩到几成才算缩？价格的「新高」又是哪个窗口里的高？口诀一个都没答。

本章把这半句口诀补成可计算的判据。先讲成交量是什么——为什么说它天生「有人卖还得有人买」；再给量配刻度：放量、缩量、天量、地量怎么数值化；然后给量配分母——除以流通股本，量才在股票之间可比；最后回到开章的问题——那句口诀里的量价背离到底在警告什么，以及它为什么不该变成一句「清仓」。

## 成交量是什么：每一笔成交都有两张面孔

第 2 章讲过撮合：买单和卖单排成两队，价格优先、时间优先地配对，配对成功才叫成交。成交量（volume——一段时间内撮合成功的股数总和，行情软件常以手显示，1 手 = 100 股）就是这个配对的计数。关键在「配对」二字：一笔成交必须同时有一个买方和一个卖方，谁都不能缺席——有人挂单卖，还得有人肯买，这笔股数才计得进来。挂着没人接的卖单，永远进不了成交量。

所以量从来不衡量「谁赢了」。它衡量换手：一手交钱、一手交货，多空双方各取所需。**量衡量的不是方向，是分歧的量级**——每一股成交背后都站着一对意见相反的人：一个看多掏钱，一个看空离场。量越大，当天交换意见的人越多；量萎缩到极致，就是连吵架的兴致都没了。

方向由谁主动决定，规模由量记账。买方急着成交，就往上吃卖单，价格涨；卖方急着走，就往下砸买单，价格跌。**价格是最后一笔成交的读数，量是全部成交的合计**——这个不对称就是「量在价先」的全部机制，两条推论：

- 推进要燃料。价格创出新高的每一步，都得有人按更高的价真金白银地买走股票，买盘的规模记在量上。量先萎缩，新高就先断燃料——这是背离警告的来源。
- 底部先换手。行情启动前常先见量：想卖的在低位把货出干净，第一批买家进场接走。量先起来，价格还在原地磨，之后才突破。不是神秘感应，是记录时序：合计先动，读数后动。

把「量在价先」当口诀背，它永远是玄学；拆成这两条，它是撮合结构的推论。价格是舟，量是水：舟能自己漂一段，漂多远，看水。

## 量的刻度：放量、缩量、天量、地量

裸看成交量没有意义：400 万股对一只票是热闹，对另一只只是零头。实验场一律相对近段量来量：当根量除以前五根的平均量，得到倍数。放量（倍数达到 1.5——今天的热闹是近段的 1.5 倍以上）；缩量（倍数不高于 0.7——近段的七成及以下）。两个极端再加码：天量（climax volume——20 根极值窗内严格最大、且相对近段仍是放量的那天，分歧爆炸、筹码大搬家）；地量（drought volume——20 根内严格最小、且仍是缩量的那天，卖压枯竭的标记）。同一根只记最高档：天量本身就是放量的极端，地量本身就是缩量的极端。

下面的行情是 60 根横盘 K 线。量的路径铺成手工设计的阶梯，副图就是成交量，标记全部由 `volumeFeatures` 扫出，一枚不手标。

<KLineChart :candles="vol.candles" :markers="vol.markers" title="量能标签全景：放量、缩量、天量、地量" />

先看副图。第 6 到 9 根，量从 400 万股台阶式落到 150 万股，倍数 0.4、0.4、0.5、0.6，连记四枚缩量——台阶落地要等参照窗吞下新台阶，第五根就自动停了。第 11 到 13 根量回到 450 万股，连记三枚放量，倍数 3.0、2.1、1.7 逐根衰减，理由同上：参照量正在抬高。**标签记的是量的变化，不是量的高低**——450 万股站稳之后不再是「放量」，150 万股站稳之后也不再是「缩量」。

第 26 根 1200 万股，对近五日均量 440 万股的 2.7 倍，且是 20 根内最大——天量。第 31 根 160 万股，对近五日均量（含天量日）592 万股只有 0.27 倍，且是 20 根内最小——地量。第 46 根是个精细样本：270 万股对 400 万股均量，0.675 倍记缩量；但它的 20 根极值窗里有 160 万股压着，不是地量——缩量只要求相对萎缩，不要求量的极值。

## 换手率：除以盘子，量才有可比性

相对近段解决了时间轴的比较，还剩一根轴：股票之间。同样成交 400 万股，放在流通股本（市场上可以自由交易的那部分股票总数）4 亿股的票上是一回事，放在 4000 万股的小盘上是另一回事。换手率（turnover rate——成交量除以流通股本，也就是今天有多少百分比的筹码换了主人）把两根轴都归一了。

跟着算一遍，用上图的天量日：

```text
换手率 = 成交量 ÷ 流通股本 = 12,000,000 股 ÷ 400,000,000 股 = 0.03 = 3%
```

那天 3% 的流通筹码换了主人。同一段阶梯里：常量日 400 万股 → 1%，缩量段 150 万股 → 0.375%，地量日 160 万股 → 0.4%。把整段阶梯逐日除下去，就是下面这条换手率曲线。

<LineChart :series="turn.series" :labels="turn.labels" :percent-y="true" title="换手率：量能阶梯 ÷ 流通股本" />

曲线与阶梯逐点对应。天量日一柱冲到 3%，缩量段贴近 0.4%。实务里常见的粗略读法：日换手 1% 上下算温和，5% 以上算高度活跃——但流通盘与板块差异很大，绝对刻度只作粗参；更稳的用法还是跟自己比，看今天的换手是近几日的几倍。换手率还是后续章节的原料：每天按换手把筹码从旧主人搬给新主人，累积起来就是第 14 章的筹码分布图。

## 量价背离：舟在走，水没跟上

刻度齐了，回到开章那句口诀。量价背离（price-volume divergence——价格创出新高、成交量却显著萎缩，推进的燃料跟不上舟的航速）在实验场里的判据只有两条。其一，收盘创近五根新高。其二，量缩到近五日均量的 0.7 倍以下。正常放量上涨——新高配 1.5 倍以上的量——一枚背离都不会有。

下面 70 根单边上行，收盘从 10.05 元走到 16.22 元。

<KLineChart :candles="div.candles" :markers="div.markers" title="量价背离：两段缩量新高" />

先看对照。第 16 根收盘 10.98 元创近五根新高，量 900 万股对 500 万股均量的 1.8 倍——放量上涨，零背离。第一次警告在第 51 到 53 根：价格 13.80、13.91、14.04 元逐日创新高，量却落到 280 万股——对 500 万、456 万、412 万的参照量是 0.56、0.61、0.68 倍，三枚顶背离。第 64 到 66 根第二段：15.56、15.74、15.79 元新高配 0.56 到 0.68 倍的量，又是三枚。

两个细节值得盯。其一，背离为什么三根就停：到第 54 根，参照窗已经吞下三根 280 万股，参照量掉到 368 万股，280 万股对它是 0.76 倍——不再算「萎缩」。判据是相对的，量能新台阶站稳后警示自动熄火。其二也最扎心：两段背离之后，价格都继续创新高——第一次背离后从 13.80 元涨到 15.46 元，第二段背离后收在 16.22 元。这张图就是开章故事的复刻：在第一段背离处清仓，错过的是后面 12% 起步的涨幅。

所以背离的正确读法：**它是燃料计量表，不是刹车**。量在警告「这波新高越来越省油」，没说「马上没油」。写成条件句：若持仓股价格创新高而量缩到近五日均量七成以下，常见的应对是收紧止损、或减掉部分仓位，而不是全清；离场的最终判据交给趋势结构（第 10 章的峰谷链）或均线。警示解除有两条路：量能重新放大到 1.5 倍以上且价格继续创新高；或参照窗吞下新台阶，量价重新同步。反过来，若峰谷链已经断裂（LH 与 LL 成对出现），离场不需要量能背书——那是趋势章的活。

## 量价关系矩阵：四格读法

把价与量各分两档，交叉出四格。每格的读法都是条件句，没有一格是开关：

| 组合 | 机制读法 | 常见语境 | 应对（条件句） |
| --- | --- | --- | --- |
| 价涨量增 | 推进有燃料，新高是真金白银买出来的 | 主升段、放量突破 | 趋势内持有；峰谷链断裂再撤 |
| 价涨量缩 | 无人反对的推进：卖方退场也能推价，承接变薄 | 底部启动初期的惜售（卖方舍不得卖），或高位背离前兆 | 看位置：启动初期常见且无害；高位连续缩量新高才升级为警示，按上节条件句处理 |
| 价跌量增 | 恐慌或派发（大资金趁有人肯接时慢慢卖出）：急着卖的撞上肯接的 | 放量破位、放量下跌 | 不接飞刀；等量能衰竭再谈企稳 |
| 价跌量缩 | 卖压枯竭：想卖的卖得差不多了 | 阴跌尾段、地量区 | 地量不是买点，是变盘临近的观察窗；右侧确认再进场（等价格真正转头、走出回升结构再动手，不抢在转折前） |

开章那句「价涨量缩就清仓」错在哪，现在能说清了：它把第二格当开关，又无视位置——第二格在启动初期是常态，高位连续出现才是警示；即使是警示，动作也是收紧，不是清仓。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审五件事：放量缩量的倍数与手算一致；天量地量是极值、不让位于普通放量；背离判据（新高配量缩）与不误报（新高配放量）；背离逐根独立记账；换手率一笔账可手算。挑四条贴出来。第一条，天量的极值要求：

```ts
// tests/volume-analysis.test.ts · 天量是极值且仍是放量
  it('二十根 1000 股后一根 3000 股：窗口最大且 3 倍均量，记 climax 而非 surge', () => {
    const r = volumeFeatures(mk(flat(21), [...Array(20).fill(1000), 3000]))
    expect(r.labels).toHaveLength(1)
    expect(r.labels[0]).toMatchObject({ index: 20, kind: 'climax' })
  })
```

第 21 根才凑得满 20 根极值窗——凑不满的头部只走倍数线，不冒充极值。第二条，顶背离判据：

```ts
// tests/volume-analysis.test.ts · 顶背离判据
  it('顶背离：收盘创近五根新高、量缩到 0.6 倍，记 top', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5]
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 600]))
    expect(r.divergences).toHaveLength(1)
    expect(r.divergences[0]).toMatchObject({ index: 5, kind: 'top' })
    expect(r.divergences[0]!.ratio).toBeCloseTo(0.6, 10)
    expect(r.divergences[0]!.priceMargin).toBeGreaterThan(0)
  })
```

第三条，不误报——同样创新高，量放到 1.8 倍就零背离，正是 `12-divergence.json` 第 16 根的形状：

```ts
// tests/volume-analysis.test.ts · 正常放量上涨不误报
  it('正常放量上涨不误报：同样新高但量放到 1.8 倍，零背离', () => {
    const closes = [10, 10.1, 10.2, 10.3, 10.4, 10.5]
    const r = volumeFeatures(mk(closes, [...Array(5).fill(1000), 1800]))
    expect(r.divergences).toEqual([])
  })
```

第四条，换手率的手算：

```ts
// tests/volume-analysis.test.ts · 换手率一笔账
  it('成交 800 万股、流通 4 亿股：换手率 0.02（2%）', () => {
    const r = turnoverRate(mk([10], [8_000_000]), 400_000_000)
    expect(r).toHaveLength(1)
    expect(r[0]).toBeCloseTo(0.02, 10)
  })
```

见红后实现。新模块 `src/volume/features.ts` 先立字据，类型与字段的口径都写在注释里。

```ts
// src/volume/features.ts · 量能特征的类型
/** 量能标签：surge=放量、shrink=缩量、climax=天量、drought=地量 */
export type VolumeLabelKind = 'surge' | 'shrink' | 'climax' | 'drought'

/** 一枚量能标签：记在量的「变化」上——台阶站稳后高量不再是放量、低量不再是缩量 */
export type VolumeLabel = {
  /** 打标签的 K 线下标 */
  index: number
  kind: VolumeLabelKind
  /** 当根量 ÷ 前 lookback 根平均量——倍数本身是读数，2 即两倍于近段 */
  ratio: number
}

/** 量价背离点：价格创窗口新高/新低，量却缩到线下——燃料与舟唱反调 */
export type VolumeDivergence = {
  /** 背离成立的 K 线下标（逐根独立判定，不合并区间） */
  index: number
  /** top=价创新高量缩（顶背离）；bottom=价创新低量缩（底背离） */
  kind: 'top' | 'bottom'
  /** 当根量 ÷ 前 lookback 根平均量 */
  ratio: number
  /** 价格创新的幅度：top 为收盘对前窗最高收盘的超出比例，bottom 为对前窗最低收盘的跌出比例 */
  priceMargin: number
}

export type VolumeFeaturesOpts = {
  /** 量能参照窗：当根量与「前 lookback 根平均量」比，价格的新高/新低也在同一窗口里判，默认 5 */
  lookback?: number
  /** 放量线：当根量 ≥ 参照量的这个倍数记放量，默认 1.5 */
  surgeRatio?: number
  /** 缩量线：当根量 ≤ 参照量的这个倍数记缩量（也是背离的量萎缩线），默认 0.7 */
  shrinkRatio?: number
  /** 极值窗：天量/地量在这个根数（含当根）里取严格最大/最小，默认 20 */
  extremeWindow?: number
}

/** 一份量能体检报告：标签与背离点都按时间旧→新 */
export type VolumeReport = {
  labels: VolumeLabel[]
  divergences: VolumeDivergence[]
}
```

`volumeFeatures` 全貌如下。一次一根、只向后看。

```ts
// src/volume/features.ts · volumeFeatures 全貌
/** 量能特征扫描：对每根凑得满参照窗的 K 线独立判定，返回全部标签与背离点。
 *  判据全部向后看（只看当根与之前），没有未来函数：
 *  - 放量/缩量看当根量对前 lookback 根平均量的倍数；
 *  - 天量/地量再要求当根量是极值窗（含当根共 extremeWindow 根）内的严格最大/最小——
 *    同根只记最高档：天量本身就是放量的极端、地量本身就是缩量的极端；
 *  - 量价背离=价格在同一窗口里创严格新高/新低、量却缩到 shrinkRatio 线下。 */
export function volumeFeatures(candles: readonly Candle[], opts: VolumeFeaturesOpts = {}): VolumeReport {
  assertVolumeArgs(candles, 'volumeFeatures')
  const lookback = opts.lookback ?? DEFAULT_OPTS.lookback
  const surgeRatio = opts.surgeRatio ?? DEFAULT_OPTS.surgeRatio
  const shrinkRatio = opts.shrinkRatio ?? DEFAULT_OPTS.shrinkRatio
  const extremeWindow = opts.extremeWindow ?? DEFAULT_OPTS.extremeWindow
  if (!Number.isInteger(lookback) || lookback < 1) {
    throw new Error(`volumeFeatures：lookback 必须是正整数，收到的是 ${lookback}`)
  }
  if (!Number.isInteger(extremeWindow) || extremeWindow < 1) {
    throw new Error(`volumeFeatures：extremeWindow 必须是正整数，收到的是 ${extremeWindow}`)
  }
  if (!(surgeRatio > 0) || !Number.isFinite(surgeRatio)) {
    throw new Error(`volumeFeatures：surgeRatio 必须是正数，收到的是 ${surgeRatio}`)
  }
  if (!(shrinkRatio > 0) || !Number.isFinite(shrinkRatio)) {
    throw new Error(`volumeFeatures：shrinkRatio 必须是正数，收到的是 ${shrinkRatio}`)
  }
  if (surgeRatio <= shrinkRatio) {
    throw new Error(`volumeFeatures：surgeRatio 必须大于 shrinkRatio（收到 ${surgeRatio} 对 ${shrinkRatio}）——放量线压不过缩量线，倍数就没了方向`)
  }
  const labels: VolumeLabel[] = []
  const divergences: VolumeDivergence[] = []
  // 主循环从 lookback 起：i 之前必须凑得满一整个参照窗，凑不满的头部不判（不猜）
  for (let i = lookback; i < candles.length; i++) {
    let volSum = 0
    let closeMax = -Infinity
    let closeMin = Infinity
    for (let j = i - lookback; j < i; j++) {
      volSum += candles[j].volume
      if (candles[j].close > closeMax) closeMax = candles[j].close
      if (candles[j].close < closeMin) closeMin = candles[j].close
    }
    const ref = volSum / lookback
    if (ref <= 0) continue // 前段全是零量：没有尺子，这根不量
    const ratio = candles[i].volume / ref
    // 极值窗（含当根）：凑得满一整个窗才参与极值判定，头部不足窗的只走倍数线
    let isExtremeMax = i >= extremeWindow - 1
    let isExtremeMin = i >= extremeWindow - 1
    if (isExtremeMax) {
      for (let j = i - extremeWindow + 1; j < i; j++) {
        if (candles[j].volume >= candles[i].volume) isExtremeMax = false
        if (candles[j].volume <= candles[i].volume) isExtremeMin = false
      }
    }
    const kind: VolumeLabelKind | null =
      ratio >= surgeRatio && isExtremeMax
        ? 'climax'
        : ratio <= shrinkRatio && isExtremeMin
          ? 'drought'
          : ratio >= surgeRatio
            ? 'surge'
            : ratio <= shrinkRatio
              ? 'shrink'
              : null
    if (kind) labels.push({ index: i, kind, ratio })
    // 量价背离：同一窗口里价格创严格新高/新低，量却萎缩——燃料不足而舟独行
    if (ratio <= shrinkRatio) {
      const close = candles[i].close
      if (close > closeMax) {
        divergences.push({ index: i, kind: 'top', ratio, priceMargin: close / closeMax - 1 })
      } else if (close < closeMin) {
        divergences.push({ index: i, kind: 'bottom', ratio, priceMargin: 1 - close / closeMin })
      }
    }
  }
  return { labels, divergences }
}
```

`turnoverRate` 是一行除法。

```ts
// src/volume/features.ts · turnoverRate 全貌
/** 换手率序列：每根 = 成交量 ÷ 流通股本，0.02 即 2%——今天有多少百分比的筹码换了主人。
 *  同样的成交量，流通盘越小换手越凶：量要除以盘子才有可比性。 */
export function turnoverRate(candles: readonly Candle[], floatShares: number): number[] {
  assertVolumeArgs(candles, 'turnoverRate')
  if (!(floatShares > 0) || !Number.isFinite(floatShares)) {
    throw new Error(`turnoverRate：floatShares 必须是正数（流通股本），收到的是 ${floatShares}`)
  }
  return candles.map((c) => c.volume / floatShares)
}
```

图表数据照旧出自 export-docs 脚本。`12-divergence.json` 的六枚顶背离标记是真实扫描，第 16 根的放量对照标记按该根真实读数手放、守门核验过倍数。

```ts
// companion/scripts/export-docs-data.ts · 背离点由 volumeFeatures 扫出，放量对照一并上图
  markers: [
    { index: 15, label: `放量 1.8×`, kind: 'bull' },
    ...report2.divergences.map((d): Marker => ({ index: d.index, label: '顶背离', kind: 'bear' })),
  ],
```

守门同样内置在脚本里。标签全景图必须四类标签各就各位、且零背离——横盘里的量缩新高是噪声级信号，不配当主角，脚本已把那些 K 线的收盘价钉进前五根区间的正中。背离图的前 50 根量价同步段必须零背离。两段缩量各须扫出至少一枚背离。任一守门失手，整段导出失败。简化之处照实声明：1.5 与 0.7 的倍数线、5 根参照窗、20 根极值窗都是课程操作化选择；背离用「当根量对近五日均量」的口径，教科书常见的「峰对峰量能对比」需要枢轴识别器，本课程不提前实现；行情与量能阶梯均为固定种子合成数据。全部登记在附录差异清单。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：189 项全绿，其中 30 项是本章新增。覆盖面：倍数手算（2 倍记放量、0.5 倍记缩量）；常量序列零标签；阶梯升量不打天量；天量地量的极值判定与让位规则；背离六案——顶、底、放量不误报、量缩不创新高不误报、连续三根逐根记账、整段量价同步零背离；换手率三笔账——等长对齐、分母翻倍减半；十三种非法输入全部抛中文错误。

再开机一次：

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 12 章一段：标签全景记标签 16 枚（放量 6、缩量 8、天量 1、地量 1）、零背离；背离图两段缩量各扫出顶背离 3 处、第 16 根 1.8 倍放量无背离；换手率曲线天量日 3%。`docs/assets/data/` 下多出三个 `12-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体：打开行情 App 任选一只股票，调出日线与成交量副图，再查 F10 里的流通股本。找最近一次明显放量的日子，抄下当日成交量与流通股本，笔算换手率，与软件换手率列的读数对一对。再找一段缩量创新高的日子，抄下它前五日的成交量算均量，算出当日倍数——到没到 0.7 以下？到了再看那之后价格走了哪边。两笔账算完，量对你就是透明的柱子，不是背景噪声。

## 小结

- 成交量是撮合成功的计数：一笔成交必须买卖双方同时到场，量衡量分歧的量级，不衡量方向。
- 量在价先是记录时序的推论：价格是最后一笔成交的读数，量是全部成交的合计——合计先缩，读数的后劲先泄；底部先换手，价格后突破。
- 放量缩量相对近五日均量取倍数，天量地量再加极值窗要求；标签记变化不记水平，台阶站稳后自动熄火。
- 换手率 = 成交量 ÷ 流通股本，让量跨股票可比，也是筹码分布的原料。
- 量价背离是燃料计量表不是刹车：新高配量缩记警示，动作是收紧止损或减仓；量能回升或峰谷链断裂，才改变动作级别。

读完本章，你应该能回答：

1. 同样成交 600 万股，流通股本 3 亿与 30 亿的两只票换手率各是多少？哪只更热闹？
2. 近五日均量 500 万股，今天 320 万股且收盘创近五日新高——记什么？它是清仓指令吗？为什么？
3. 量能从 500 万股台阶落到 300 万股后站稳，为什么第五根起不再记缩量？
4. 天量日你该做的第一件事是什么？不该做的是什么？

去向一句话：量能堆积与枯竭的位置，正是下一章支撑与阻力生长的地方——人多的路口，价格会堵车；而「背离」这个词还会在第 16 章的 MACD 里第二次登场，届时你已经有量价版打底。
