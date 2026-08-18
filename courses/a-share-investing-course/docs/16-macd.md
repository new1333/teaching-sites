---
title: MACD：两条均线的差值能告诉你什么
---

# MACD：两条均线的差值能告诉你什么

<script setup>
// 图一：动量回合主图，读数出自 `macd()`。
import round from './assets/data/16-macd-round.json'
// 图二：同段的 MACD 副图。
import panel from './assets/data/16-macd-panel.json'
// 图三：顶背离构造段，标记由 `detectDivergence` 扫出。
import div from './assets/data/16-divergence.json'
// 图四：同段的 DIF 与 DEA。
import divDif from './assets/data/16-divergence-dif.json'
</script>

去年春天你在一只 9 元的票上赚过四成。你拿到 13 元，回调到 11.4 元没走，随后它一路慢爬，重新冲上 13.5 元——新高。你扫了两眼副图：红柱还在，金叉没破，趋势健康，加了一成仓。一个月后它阴跌回 11 元，利润吐掉大半，你才把副图拉回去逐根对比：第二次冲顶那几天，红柱比第一波矮了一大截，DIF（快慢两条均线的差值，本章主角）也只爬到第一峰的七成。这就是背离（divergence——价格创新高，指标拒绝跟随：推着价格走的那股劲没有一起来）。它当时就写在你天天看的图上，只是柱还是红的——肉眼盯颜色，看不出高度在说谎；等矮一截发展成肉眼可见的跌势，这段行情已经走完。这一章把「看高度」变成减法题：差值算出来的数，新高就是新高，没跟上就是没跟上，可算、可查、可在当下给出读数。

三件事：搭清 MACD 的三层积木，每层跟一笔手算；把背离按成因到锚点教透，写成可复算的函数；用一段构造行情验证「价格新高而 DIF 未新高」能被机器标出来、同步新高不误报。

## 三层积木：差值，差值的差值

MACD（指数平滑异同均线——用两条 EMA 的差值度量动量的指标）不发明新零件，只把第 11 章的 EMA 当积木搭三层。英文全称 Moving Average Convergence Divergence，直译「均线的收敛与发散」。先复习一句：EMA 给越新的价格越大权重，按 α = 2/(n+1) 递推，首窗用 SMA 作种子。动量（momentum）取它的本义：推动价格的那股劲、价格变化的速度。

第一层，DIF（difference，差离值）＝ EMA(快) − EMA(慢)，默认 12 与 26。价格加速上涨，快线甩开慢线，DIF 变大；价格走平，两条线靠拢，DIF 缩回零。**DIF 量的不是价格，是价格变化的速度**。为了能手推，下面把窗口换成 3 和 5（signal 同换 3），公式与 12/26 一字不差。收盘价取 [10, 10, 10, 13, 14, 14, 12, 12]：

```text
根序      1     2     3      4      5      6       7       8
收盘      10    10    10     13     14     14      12      12
EMA3      —     —     10.00  11.50  12.75  13.375  12.688  12.344
EMA5      —     —     —      —      11.40  12.267  12.178  12.119
DIF       —     —     —      —      1.35   1.108   0.510   0.225
```

跟着算两步。EMA3 第 3 根起步：前三根收盘均值 10；第 4 根 10 + 0.5×(13−10) = 11.5，一路推到第 8 根 12.344。EMA5 晚两根成形：首窗均值 11.4。DIF 第 5 根才有第一个值：12.75 − 11.4 = 1.35。注意后三根：价格还停在 12，DIF 却从 1.35 一路缩到 0.23——**价格没掉头，速度差先掉了**。

第二层，DEA（signal，信号线）＝ 对 DIF 再作一次 EMA(9)。把 DIF 当成一条新的「收盘价」序列，同一套递推再跑一遍：前三个 DIF 值 1.35、1.108、0.510 的均值 0.989，是 DEA 第 7 根的起步值；第 8 根 0.989 + 0.5×(0.225−0.989) = 0.607。DEA 是动量自己的均线：DIF 站在它上方，动量还在加速。

第三层，柱 ＝ DIF − DEA。第 7 根 0.510 − 0.989 ≈ −0.480（全精度 −0.4796），第 8 根 0.225 − 0.607 = −0.382。第 7 根最值得盯：DIF 还是正的（快线仍压着慢线，趋势没掉头），柱却已翻负。**柱的正负说的是动量在加速还是减速，不直接说价格要涨还是要跌**。柱翻负的那一刻，就是 MACD 里的死叉：DIF 下穿它自己的均线 DEA；镜像地，柱翻正＝金叉。第 11 章的金叉死叉比的是两条价格均线（MA5 上穿 MA20），这里比的是动量与动量的均线，判据同款——前一根不高于/不低于、当根严格穿过。DIF 穿过零的那条水平线叫零轴，也就是快慢均线相交之处，它是柱状图的基准线。

参数 12/26/9 的来历一句话：发明人 Gerald Appel 上世纪七十年代末按美股日线节拍试出来的经验值，无人证明过最优，但全行业沿用四十多年。

行情软件把 MACD 放在主图下方的副图：两条线加一排围绕零轴伸缩的柱。下面两张图就是同一段行情的主图与副图——72 根 K 线，前 36 根特意排平作暖机（暖机——指标头 26 根还没成形，排平免得成形前的噪声冒出假拐角、假交叉），之后陡升、缓升、回落。读数全部出自实验场 `macd()` 的真实计算，金叉死叉标记是导出段按上述判据扫出的教学件（不进 src）。

<KLineChart :candles="round.candles" :markers="round.markers" title="动量的一整个回合（主图）" />

主图先认四个标记。

<LineChart :series="panel.series" :labels="panel.labels" title="同一段行情的 MACD 副图" />

副图与主图同一根数、同一日期轴。四个刻度逐一对表。

| 刻度 | 第几根 | 读数 |
| --- | --- | --- |
| 金叉（柱翻正） | 37 | 暖机结束第一根 |
| 柱峰 | 44 | 0.154 |
| 山顶 | 52 | 高 12.00 元 |
| 死叉（柱翻负） | 55 | 比山顶迟到 3 根 |

三句话读图。柱峰比山顶早 8 根：价格还在爬最后一段时，动量先见顶——缓升段的斜率撑不起陡升段拉开的差值。死叉只比山顶晚 3 根，比第 11 章的均线死叉麻利得多：DIF−DEA 是差值的差值，对减速天生敏感。金叉落在暖机后第一根，是合成行情把 DEA 钉在零上的边界效应，真实行情里从深水区爬回零轴的那次金叉才有分量——图是固定种子合成行情，这两点如实声明。

## 背离：动量衰减的数学表达

背离是本章的新名词，按四步走。

成因。一段上涨要持续，需要新的买力不断追加。价格创新高只需要「今天比昨天高」；动量创新高需要新一轮的涨速把还背着上一轮高价的慢线甩开——后者难得多——后者难得多。涨速跟不上、价格却靠惯性上行，就是燃料在烧最后一段。背离把「燃料与价格脱节」写成能比大小的算术：同是两个峰，价格比价格，DIF 比 DIF。

载体。两个峰、两把尺，画成结构图：

```text
价格峰    峰1 高 13.03 ─╮  回撤谷                    ╭─ 峰2 高 13.52（价格新高 +3.8%）
                        ╰──────── 低 11.4 ─────────╯
DIF 峰    峰1 0.680 ──╮                             ╭─ 峰2 0.468（DIF 未新高，只剩 69%）
                      ╰───────── 贴着零轴 ─────────╯
价格峰上了台阶，DIF 峰下了台阶——顶背离
```

演算。拿构造段的真实读数算：峰 1 第 46 根，高 13.03 元，DIF 0.680；峰 2 第 75 根，高 13.52 元，DIF 0.468。两句算术：13.52 > 13.03，价格创新高；0.468 < 0.680，DIF 拒绝新高。构造段的第二波每天约涨 0.1 元，只有第一波 0.3 元的三分之一——EMA12 与 EMA26 拉不开上一轮那么大的差，DIF 自然只到半山腰。价格高出去 3.8%，动量矮掉三成，这就是「背离」两个字的全部数学。镜像情形是底背离：价格创新低、DIF 的坑反而更浅，下砸的劲在衰减。

锚点一句：领唱和伴唱——价格是领唱，DIF 是伴唱；领唱拔高了嗓门，伴唱没跟上，这场合唱就要出事。

下面两张图就是上面这组数字：主图标出两个峰与回撤谷，副图把 DIF 画出来。标记全部由 `detectDivergence` 对全序列扫描得出，不手标；全序列恰好这一处背离。

<KLineChart :candles="div.candles" :markers="div.markers" title="顶背离构造段（主图）" />

主图先认两个峰与中间的回撤谷。

<LineChart :series="divDif.series" :labels="divDif.labels" title="同一段行情的 DIF 与 DEA" />

副图 DIF 第二峰矮一截，数字对上了。两个诚实声明。其一，峰 2 的拐角按第 13 章枢轴口径要等右侧 3 根凑满才确认——第 75 根的峰，第 78 根才敢落标注；**背离是回顾性判据，不是实时报警器**。时效上桌面对比：柱翻色当根收盘就能读到，背离要再等 3 根才敢认——交叉快而噪，背离迟而硬。其二，DIF 自第 26 根才成形（默认 26 窗口），之前的峰对没有读数，不比、不猜。

写成条件句：若你持仓且第二次冲顶被标为顶背离，常见的应对不是立刻清仓，而是把止盈线收紧到最近一个回撤谷下方（图中 11.4 元一线），收盘跌破执行；失效条件是 DIF 重新创出新高（背离消失，按趋势延续处理），或价格带着第 12 章的放量刻度继续上行。背离说的是推力不足，不是立刻下跌——它可以钝化很久才兑现。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审四件事：小样本三层读数与手算逐格一致；默认参数下 DIF 自第 26 根、DEA 与柱自第 34 根成形；柱翻负时 DIF 仍可在零轴上方；顶背离与底背离的构造序列被标出、同步新高不误报、DIF 未成形的峰对不比。挑三条贴出来（`midBars` 是测试文件头部的对称 K 线工厂：给它一串中轴价，返回 high=中轴+0.5、low=中轴−0.5 的序列）。

```ts
// tests/macd.test.ts · 小样本逐格复算
  it('小样本逐格复算：DIF/DEA/柱与手算一致，头部未成形处是 null', () => {
    const r = macd(midBars([10, 10, 10, 13, 14, 14, 12, 12]), { fast: 3, slow: 5, signal: 3 })
    expect(r.dif).toHaveLength(8)
    expect(r.dif.slice(0, 4)).toEqual([null, null, null, null]) // EMA5 未成形，DIF 无从谈起
    expect(r.dif[4]).toBeCloseTo(1.35, 6)
    expect(r.dif[5]).toBeCloseTo(1.1083333, 6)
    expect(r.dif[6]).toBeCloseTo(0.5097222, 6)
    expect(r.dif[7]).toBeCloseTo(0.2252315, 6)
    expect(r.dea.slice(0, 6)).toEqual([null, null, null, null, null, null]) // DIF 成形后还要攒够 3 个，DEA 才起步
    expect(r.dea[6]).toBeCloseTo(0.9893519, 6)
    expect(r.dea[7]).toBeCloseTo(0.6072917, 6)
    expect(r.hist.slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(r.hist[6]).toBeCloseTo(-0.4796296, 6)
    expect(r.hist[7]).toBeCloseTo(-0.3820602, 6)
  })
```

```ts
// tests/macd.test.ts · 顶背离的判据
  it('价格创新高而 DIF 未新高：标为顶背离，两处读数一并返回', () => {
    const cs = midBars(TOP_MIDS)
    const out = detectDivergence(cs, macd353(cs))
    expect(out).toHaveLength(1)
    const d = out[0]!
    expect(d.kind).toBe('top')
    expect(d.index).toBe(14) // 背离记在第二个峰上
    expect(d.prevIndex).toBe(6)
    expect(d.price).toBe(13.6)
    expect(d.prevPrice).toBe(13.5)
    expect(d.prevDif).toBeCloseTo(0.7958333, 6)
    expect(d.dif).toBeCloseTo(0.4896437, 6)
    expect(d.dif).toBeLessThan(d.prevDif) // 价格与动量唱了反调
  })
```

```ts
// tests/macd.test.ts · 同步新高不误报
  it('同步新高：价格与 DIF 一起创新高，不误报', () => {
    const cs = midBars(SYNC_MIDS)
    expect(detectDivergence(cs, macd353(cs))).toEqual([])
  })
```

见红后实现。新模块 `src/indicators/macd.ts`，复用第 11 章的 `ema` 与第 13 章的 `pivots`，只增不改。全链路函数：

```ts
// src/indicators/macd.ts · macd 全貌
/** MACD 全链路：先复用第 11 章的 ema 算快慢两条线，差出 DIF；再把 DIF 当作
 *  一条「收盘价序列」喂给同一个 ema 得到 DEA；柱 = DIF − DEA。
 *  三条序列都与入参 K 线等长：DIF 自慢线成形那根起有值（默认第 26 根），
 *  DEA 与柱还要等 DIF 攒够 signal 个值（默认第 34 根），之前的格子是 null，不猜。 */
export function macd(candles: readonly Candle[], opts: MacdOpts = {}): MacdSeries {
  const fast = opts.fast ?? DEFAULT_MACD.fast
  const slow = opts.slow ?? DEFAULT_MACD.slow
  const signal = opts.signal ?? DEFAULT_MACD.signal
  for (const [name, n] of [
    ['fast', fast],
    ['slow', slow],
    ['signal', signal],
  ] as const) {
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`macd：${name} 窗口必须是正整数，收到的是 ${n}`)
    }
  }
  if (fast >= slow) {
    throw new Error(`macd：fast 窗口必须短于 slow（收到 fast=${fast}、slow=${slow}）——快慢差比的是谁窗口短`)
  }
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('macd：candles 不能为空')
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`macd：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }

  // 第一层：快慢两条 EMA 直接复用第 11 章——首窗 SMA 种子、α=2/(n+1) 递推，一字不改
  const fastE = ema(candles, fast)
  const slowE = ema(candles, slow)
  const dif: MacdLine = candles.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? fastE[i]! - slowE[i]! : null,
  )

  // 第二层：DEA 是对 DIF 的成形段再作一次 EMA——把每个 DIF 当作那根的「收盘价」，
  // 喂给与第一层同一个 ema。动量自己也被平均一遍，得到动量的均线
  const first = dif.findIndex((v) => v != null)
  const dea: MacdLine = new Array<number | null>(candles.length).fill(null)
  if (first >= 0 && candles.length - first >= signal) {
    const segCandles: Candle[] = dif.slice(first).map((v, i) => ({
      date: candles[first + i]!.date,
      open: v!,
      high: v!,
      low: v!,
      close: v!, // ema 只看 close：把 DIF 伪装成一条只有收盘价的行情
      volume: 0,
    }))
    const segEma = ema(segCandles, signal)
    for (let i = 0; i < segEma.length; i++) dea[first + i] = segEma[i]
  }

  // 第三层：柱 = DIF − DEA。正号 = DIF 站上自己的均线（动量还在加速），负号 = 被追近（在减速）
  const hist: MacdLine = dif.map((d, i) => (d != null && dea[i] != null ? d - dea[i]! : null))
  return { dif, dea, hist }
}
```

读两个承重点。其一，DEA 没有另写一套递推：把 DIF 的成形段伪装成一条只有收盘价的行情，原样喂给第 11 章的 `ema`——同一把尺量两次，教学上少一个公式，代码上少一处漂移。其二，三条序列头部是 null 不是零：均线没成形就是没成形，猜一个值出来比空着更危险。

背离检测复用第 13 章的 `pivots` 把行情切成拐角，峰对峰比两个数：

```ts
// src/indicators/macd.ts · detectDivergence 全貌
/** 背离检测：峰对峰（谷对谷）比两个数——价格创新高/新低，DIF 拒绝跟随，记一笔背离。
 *  拐角复用第 13 章的 pivots（默认左右各 3 根的严格局部极值）；pivots 峰谷交替，
 *  所以隔一个就是同侧前驱。DIF 尚未成形的峰对直接跳过：不比，不猜。 */
export function detectDivergence(
  candles: readonly Candle[],
  indicator: MacdSeries,
  opts: DivergenceOpts = {},
): Divergence[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectDivergence：candles 不能为空')
  }
  if (indicator.dif.length !== candles.length) {
    throw new Error(
      `detectDivergence：indicator.dif 长度 ${indicator.dif.length} 与 K 线根数 ${candles.length} 不一致——两条序列必须逐根对齐`,
    )
  }
  const ps = pivots(candles, opts.k ?? DEFAULT_PIVOT_WINDOW)
  const out: Divergence[] = []
  for (let w = 2; w < ps.length; w++) {
    const cur = ps[w]
    const prev = ps[w - 2] // 峰谷交替，隔一个必是同侧
    const dNow = indicator.dif[cur.index]
    const dPrev = indicator.dif[prev.index]
    if (dNow == null || dPrev == null) continue
    if (cur.side === 'high') {
      // 顶背离：价格更高的高点，DIF 却更低——推力没跟上价格
      if (cur.price > prev.price && dNow < dPrev) {
        out.push({ kind: 'top', index: cur.index, prevIndex: prev.index, price: cur.price, prevPrice: prev.price, dif: dNow, prevDif: dPrev })
      }
    } else if (cur.price < prev.price && dNow > dPrev) {
      // 底背离：价格更低的低点，DIF 的坑却更浅——下砸的劲在衰减
      out.push({ kind: 'bottom', index: cur.index, prevIndex: prev.index, price: cur.price, prevPrice: prev.price, dif: dNow, prevDif: dPrev })
    }
  }
  return out
}
```

返回的每件背离自带两个峰的下标与两组读数，图上可回核。每件背离长这样：

```ts
// src/indicators/macd.ts · Divergence 类型
/** 一处背离：两个同侧枢轴的读数全部带上，图上可回核 */
export type Divergence = {
  kind: DivergenceKind
  /** 背离成立的 K 线下标——第二个峰（谷）那一根；枢轴判据要等右侧 k 根凑满才确认 */
  index: number
  /** 参与比较的前一个同侧枢轴（峰对峰、谷对谷）下标 */
  prevIndex: number
  /** 两处枢轴价：峰取高点、谷取低点 */
  price: number
  prevPrice: number
  /** 两处 DIF 读数——背离的证据本身 */
  dif: number
  prevDif: number
}
```

图上的数据照旧出自 export-docs 脚本第 16 章导出段，守门内置。回合段必须恰好金叉、死叉各一次，柱峰先于山顶、死叉晚于山顶、结尾 DIF 跌回零轴之下，次序乱一处整段失败。背离段必须恰好检出一处顶背离，且 DIF 第二峰不得高于第一峰的七成五，「半山腰」的图面才成立。行情用第 13 章的路径合成器生成，暖机段手工排平。

简化之处照实声明并登记附录差异清单：柱取 DIF−DEA 差值本身，A 股软件常画 2 倍（方向与零点一致，只差比例尺）；EMA 种子沿用第 11 章首窗 SMA 口径（部分软件自首日收盘起步，前段读数有差异）；背离只比相邻同侧枢轴对，不设幅度门槛、不要求经典附加条件（如顶背离须发生在零轴上方）、只认 DIF 不认柱；枢轴延迟确认带来的滞后已如实写进正文；两段行情为固定种子合成。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：268 项全绿，其中 14 项是本章新增。覆盖面：小样本三层读数逐格核对；默认参数的成形根序与常数序列归零；柱翻负而 DIF 为正的减速样本；顶背离、底背离两案的下标与读数；同步新高不误报、DIF 未成形不比不炸；非法输入七案全部抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 16 章一段：回合图 72 根，金叉第 37 根、柱峰第 44 根（0.1536）、山顶第 52 根（高 12.00）、死叉第 55 根——柱峰领先山顶 8 根，死叉迟到 3 根；副图 DIF 自第 26 根成形、DIF 峰 0.4774、结尾 −0.2319；背离段 81 根，峰 1 第 46 根高 13.03（DIF 0.680）、峰 2 第 75 根高 13.52（DIF 0.468），价格高 3.8%、DIF 只剩 69%。`docs/assets/data/` 下多出四个 `16-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体。打开行情 App，挑一只近一年走出「双峰」的票，开前复权，副图调到 MACD（默认 12/26/9）。抄下两个峰的日期、价格与 DIF 读数，笔算两问：价格新高了吗？DIF 新高了吗？两问一答，有没有背离你自己说了算——不用信任何人的图。

## 小结

- MACD 三层积木：DIF = 快慢 EMA 的差（速度），DEA = DIF 的 EMA（动量的均线），柱 = DIF − DEA（加速还是减速）；柱翻正翻负就是 MACD 里的金叉死叉。
- 柱峰先于价峰、死叉快于均线死叉：差值的差值对减速天生敏感。
- 背离 = 峰对峰比两个数：价格创新高而 DIF 拒绝新高，是动量衰减的数学表达；枢轴延迟 3 根确认，它是回顾性判据。
- 全部判据进了实验场：`macd` 复用 `ema`，`detectDivergence` 复用 `pivots`，只增不改。

读完本章，你应该能回答：

1. 收盘价 [10, 10, 10, 13, 14, 14, 12, 12]，窗口 3/5/3——第 5 根的 DIF 是多少？
2. 某根 DIF = 0.8、DEA = 0.5——柱是正是负？此刻动量在加速还是减速？价格在涨还是跌能确定吗？
3. 价格峰 14.2 对 13.9，DIF 峰 0.5 对 0.7——顶背离成立吗？换算成应对动作是什么？
4. `detectDivergence` 为什么把「DIF 未成形的峰对」直接跳过，而不是拿零去比？

去向一句话：本章的 DIF 用「差值」量动量，第 17 章的 RSI 与 KDJ 换一把尺——把收盘价在近期高低区间的位置变成百分比，从「位置」量同一件事。
