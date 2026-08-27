---
title: RSI 与 KDJ：超买超卖的双胞胎
---

# RSI 与 KDJ：超买超卖的双胞胎

<script setup>
// 图一：强势股全程主图，标记含 RSI 80 清仓点与山顶。
import rally from './assets/data/17-strong-rally.json'
// 图二/图三：同一段行情的 RSI 与 KDJ 交互副图（主副图联动 + 十字光标）。
import ind from './assets/data/17-indicators-ind.json'
// 图四：钝化窗口的行情（切片视图）。
import stallK from './assets/data/17-stall-kline.json'
// 图五：同窗口的 RSI 与 K、D 对照。
import stallI from './assets/data/17-stall-indicators.json'
</script>

那只票 10 元起步，你 10 元出头追进。拿到 10.34 元那天，你瞄了一眼副图：RSI 冲过了 80。RSI（relative strength index，相对强弱指标——最近一段上涨幅度占全部波动的百分比，量的是买方力量的持久度）过了 80。网上的口诀说这叫超买——涨到口诀党喊「买过头了」的读数区——要回落。你清仓落袋。它没有回落：RSI 顶着 95、99 走了一个月，股价踩着你的卖出价一路涨到 13.57——强势股在超买区里过日子，你踏空了三成（踏空——本该持有却提前离场，眼看着它涨上去；图一里那枚「清仓点」标记，就钉在首上 80 的那一根）。换一把尺再来：KDJ（国内行情软件副图的默认住户——收盘价在近期高低区间的位置百分比，再平滑两次）金叉那天买回，两根 K 线之后死叉，割在半山腰；再金叉，再死叉。两个月挨了三顿打，两口锅都扣在「超买超卖」头上：把刻度当开关用，把摆动指标（oscillator——在固定区间内来回摆、量「劲头」的指标，RSI 与 KDJ 都是）当趋势指标（量「方向」的指标，如均线）用。

先看挨打现场。下图是 62 根固定种子合成行情（前 20 根排平暖机——让指标带着一段历史进入拉升段（K/D 的种子是 50，暖机的小抖动仍会让读数在 50 附近晃）），读数全部出自实验场 `rsi()` 的真实计算，标记由导出段扫描标出。

<KLineChart :candles="rally.candles" :markers="rally.markers" title="强势股全程：80 清仓点对山顶" />

先对表。RSI 首上 80 在第 23 根（收盘 10.34 元），山顶在第 48 根（13.57 元）。清仓之后股价又涨了 31.2%。RSI 连续不低于 80 总共 28 根（第 23～50 根），区间里还夹着两次超买区死叉。数值后面逐个拆。

三件事：把 RSI 和 KDJ 各自的算式拆到能手推；讲透钝化（读数在超买区钉住不动）的成因与对策；用同一根急跌 K 线量出两把尺的响应速度差。

## RSI：涨幅占全部波动的百分比

均线看方向，RSI 看劲头。第 11 章的 MA 把价格平均成一条线，回答「往哪走」；RSI 把每天的涨跌差拆开，回答「最近的走势里买方占了多大份额」。算法分四步：

1. 每天的收盘价减昨收，得到一列涨跌差；
2. 涨跌差再拆两列：涨的部分进「涨幅」列，跌的部分（取正数）进「跌幅」列；
3. 两列各取平均——平均用 Wilder 平滑：首个值是前 n 个涨跌差的算术平均，此后每根递推「新平均 =（旧平均 ×(n−1) + 当日新值）÷ n」；
4. 占比换算：RSI = 100 × 平均涨幅 ÷（平均涨幅 + 平均跌幅）。

Wilder 平滑你见过近亲：它就是第 11 章 EMA 的递推式，只是 α 从 2/(n+1) 换成 1/n。默认窗口 14 是发明人 Wilder 上世纪七十年代定的原版值；A 股软件常配 6/12/24 三条线，口径相同、窗口不同。**RSI 量的不是价格贵不贵，是买方力量占全部波动的份额**——份额大，说明最近的下跌都只是小回撤。

手算一遍。还是第 16 章那串收盘价，窗口换成 n=3：

```text
根序          1     2     3      4      5      6      7      8
收盘          10    10    10     13     14     14     12     12
当日涨幅      —     0     0      +3     +1     0      0      0
当日跌幅      —     0     0      0      0      0      2      0
平均涨幅                        1.000  1.000  0.667  0.444  0.296
平均跌幅                        0.000  0.000  0.000  0.667  0.444
RSI                            100    100    100    40.0   40.0
```

跟着算三步。第 4 根：前三根的涨幅列是 0、0、3，平均涨幅 1，平均跌幅 0，RSI = 100×1÷(1+0) = 100。第 5 根：旧平均扛 2/3、新值占 1/3，平均涨幅 =（1×2+1）÷3 = 1，平均跌幅仍为 0，还是 100。第 7 根：跌幅列进来一个 2，平均跌幅 =（0×2+2）÷3 = 0.667，同根平均涨幅缩到 0.444，RSI = 100×0.444÷(0.444+0.667) = 40.0。第 8 根没有新的涨跌进账，两列平均各自按 2/3 衰减、比值不变，RSI 还是 40.0——读数停摆，等下一根真正的涨跌来搬动它。注意第 4～6 根：三根读数一字不差全是 100——跌幅那列为零，分母只剩下分子，比值钉死。这不是巧合，是本章后半的主角。

三个边界约定如实声明。窗口内只涨不跌，RSI 恰为 100；只跌不涨，恰为 0；纹丝不动（分子分母同零），记 50——没涨没跌谈不上强弱，取不偏不倚的中间位。行情软件画在副图上的 70 与 30 两条水平线叫超买线与超卖线，80 与 20 是更严的强势档：它们是刻度的标注，不是信号的开关。

同一段拉升行情的 RSI 副图换成了可交互版：上格 K 线、下格 RSI，鼠标十字光标停在任何一天，两格同步亮出当天的 OHLC 与 RSI 读数，也能拖动底部滑块（或滚轮）缩放区间。下格里 70/30 两条虚线之间铺着浅色填色带，80 上方另有一条不带色的强势档参考线；读数全部出自实验场 `rsi()` 的真实计算，标记与主图同源。

<IndicatorChart
  :candles="ind.candles"
  :markers="ind.markers"
  :sub="{
    lines: [{ name: 'RSI', values: ind.rsi }],
    thresholds: [
      { value: ind.thresholds.rsiOverbought, label: '超买 70', band: true },
      { value: ind.thresholds.rsiOversold, label: '超卖 30', band: true },
      { value: ind.thresholds.rsiStrong, label: '强势 80' },
    ],
  }"
  sub-label="RSI"
  title="同一段行情的 RSI 副图（70/30 刻度带）"
/>

怎么读色带：填色带是 30～70 之间的「正常区」，RSI 冲出带顶（70 之上）才算进超买区，跌出带底（30 之下）才算进超卖区——价格涨进带外时指标怎么走，才是这张图要盯的事。图上 RSI 第 21 根就窜出带顶、第 23 根站上 80（主图那枚「清仓点」标记就钉在这一天），第 21～51 根共 31 根待在带外不回来，而主图价格一路涨到 13.57 元——指标泡在超买区只说明买方份额占满，不说明马上要跌。结尾是镜像：RSI 一路缩回带内，最后一根跌出带底（28.44，超卖区）。钝化区就在 80 上方。

## KDJ：位置百分比，平滑两次

KDJ 的祖先是 Lane 的随机指标（stochastic——拿收盘价在近期高低区间里的位置当读数），A 股软件里的 KDJ 是它的国内版，默认窗口 9 日。四层积木，一层比一层慢。

第一层，RSV（raw stochastic value，未加工的随机值）=（收盘 − 近 n 日最低）÷（近 n 日最高 − 近 n 日最低）× 100。也就是今天的收盘站在最近 9 天高低区间的百分之几：贴窗顶是 100，贴窗底是 0。这一步就是第 13 章支撑阻力思想的数字化：离窗顶近，说明买方把价格顶在区间上沿。

第二层，K = 2/3 × 昨K + 1/3 × RSV。RSV 每天从头算，抖得厉害；K 给它套上平滑，新值只占三分之一。第三层，D = 2/3 × 昨D + 1/3 × K，对 K 再平滑一次，更慢。K 与 D 的初值取 50（国内软件通行约定）：行情还没说话，先站中间。对比一下系数：9 日窗口的 EMA，α = 2/(9+1) = 0.2；KDJ 的新值权重是 1/3 ≈ 0.33，比同窗口的 EMA 更急一些。

第四层，J = 3K − 2D。这个怪式子的来历只是一步代数：3K − 2D = K + 2×(K−D)。K 减 D 是「快线偏离自己均线的程度」，J 把这个差放大两倍再叠回 K——一把放大镜线，也因此会冲出 0～100 的上下界。

手算一遍。窗口 n=3，把三日窗的最高最低钉死在 9～10 元，只动收盘价：收盘 9 元 RSV=0，收盘 10 元 RSV=100。

```text
根序      1     2     3       4       5       6       7       8
收盘      9     9     9       9       10      10      10      10
RSV       —     —     0.00    0.00    100.00  100.00  100.00  100.00
K         —     —     33.33   22.22   48.15   65.43   76.95   84.64
D         —     —     44.44   37.04   40.74   48.97   58.30   67.08
J         —     —     11.11   −7.41   62.96   98.35   114.27  119.75
```

跟着算第 5 根。RSV =（10−9）÷（10−9）×100 = 100；K = 2/3×22.22 + 1/3×100 = 48.15；D = 2/3×37.04 + 1/3×48.15 = 40.74；J = 3×48.15 − 2×40.74 = 62.96。再看第 7 根：K−D = 18.66，J = 76.95 + 2×18.66 = 114.27——收盘连贴四天窗顶，K 追着 100 爬，D 慢半拍，J 就冲出上界。镜像的样本（收盘连贴四天窗底）会把 J 打到负数，实验场测试里两边都验。

窗口内最高与最低重合（一字横盘）时分母为零，RSV 记 50——与走平的 RSI 同一个约定。下面是同一段行情的 KDJ 副图，同为可交互版：上格 K 线、下格 K/D/J 三线，十字光标停在任何一天，两格同步亮出当天 OHLC 与三条读数。K/D/J 三线与 80/20 刻度线全部由 `kdj()` 算出。

<IndicatorChart
  :candles="ind.candles"
  :markers="ind.markers"
  :sub="{
    lines: [
      { name: 'K', values: ind.k },
      { name: 'D', values: ind.d },
      { name: 'J', values: ind.j },
    ],
    thresholds: [
      { value: ind.thresholds.kdjOverbought, label: '超买 80', band: true },
      { value: ind.thresholds.kdjOversold, label: '超卖 20', band: true },
    ],
  }"
  sub-label="KDJ"
  title="同一段行情的 KDJ 副图（K/D/J，80/20 刻度带）"
/>

色带读法与 RSI 同款：填色带是 20～80 之间的「正常区」，K/D 走出带顶才算进超买区、跌出带底才算进超卖区。这段行情两头都出了格：拉升段三线贴着带顶（80 线）挤作一团甚至窜到带外（K 最低也有 77.59，J 一度冲到 108.42），结尾三线又沉到带底之下（K 收在 2.51）——价格单边走时指标贴着带外过日子，这正是后文「钝化」的预告。

三句话读图。拉升段 J 最高冲到 108.42；回落段 J 最低砸到 −28.02——放大镜两头都会出界。K 与 D 大多数时间贴在一起，分不出彼此；只在拐角处拉开。全段 K/D 金叉死叉共 6 次，其中第 43、44、46 根是「死叉、金叉、死叉」的三连——K 与 D 都在 98 附近挤着，交叉已经退化成噪声。这就是「金叉买完就死叉」的解剖图。

动手核那记三连：把十字光标依次停在第 43、44、46 根（主图上「超买区死叉」标记就钉在第 43 根），弹出的 K、D 读数都挤在 98 上下、相差不到 0.3——所谓交叉，只是两条贴在一起的线互相蹭了一下，悬停读数里看得清清楚楚。

## 同一把底稿，两副刻度

两个指标是双胞胎：底稿都是「把价格在近期区间里的相对位置（或涨跌占比）压成 0～100 的数」。RSV 与 RSI 的原料是近亲：都把近期相对强弱压成百分比——一个用影线区间、一个用涨跌列，一个不平滑、一个 Wilder 平滑。差异有三处，每处都能量化。

其一，平滑系数。RSI(14) 的 Wilder 递推，新值权重 1/14 ≈ 0.07；KDJ 是 1/3 ≈ 0.33。一个记 14 天的账，一个记 3 天的账。其二，原料不同。RSV 用最高价最低价——影线也进窗；RSI 只用收盘对收盘。其三，响应速度，做个体检：30 根 +1/−1 交替的横盘（两指标都在中位附近），第 31 根单日跌 3 元。同一根急跌 K 线，三把尺各自的位移：

| 尺 | 急跌前 | 急跌后 | 位移 |
| --- | --- | --- | --- |
| RSI(14) | 52.46 | 42.62 | 9.84 |
| K | 57.14 | 40.06 | 17.09 |
| J | 68.58 | 24.90 | 43.68 |

**K 的位移是 RSI 的 1.7 倍有余，J 又是 K 的两倍半**——KDJ 对新价格更敏感，代价是噪声也被同倍放大。这段演算不进图，但进了实验场测试，数字逐位可复算。

## 钝化：读数钉死的那段日子

回到开章的强势股。钝化（指标在单边行情里读数钉死、对强弱变化失去分辨力的现象）不是玄学，两条成因各有一个算术解释。

RSI 这边，是分母消失。单边上涨里跌幅列持续吃零，平均跌幅越滚越小，分母「涨幅+跌幅」越来越贴近分子「涨幅」。极限处：连续 14 天只涨不跌，平均跌幅恰为零，RSI = 100×分子÷分子，钉死在 100——手算表第 4～6 根已经演过这一幕。这时涨 0.5% 的日子和涨 3% 的日子读数完全一样：指标在如实报「只涨不跌」，但你对强弱已经失明。下图把镜头推近钝化区间：上面是行情，下面是同一窗口的 RSI 与 K、D（指标按全序列算好后切片，每个读数带着完整历史）。

<KLineChart :candles="stallK.candles" :markers="stallK.markers" title="钝化窗口的行情（切片）" />

价格一路上移。

<LineChart :series="stallI.series" :labels="stallI.labels" title="同一窗口的 RSI 与 K、D" />

两把尺钉在超买区。RSI 全程压在 80 上方，K 最低只探到 77.59。RSI 在 83～99 之间躺了 28 根（图上不是恰好 100，因为合成拉升里夹着小阴线；测试里那串纯粹连阳的构造序列才一字不差钉 100）。此后一路 83～98。

KDJ 这边，是平滑粘滞。收盘天天贴着窗顶，RSV 天天 100，K 就渐近 100：每根的位移只剩前一根缺口的三分之一，越走越慢；D 又慢 K 一步。**K 与 D 挤在 98 附近纹丝不动，金叉死叉退化成抖动**——超买区死叉的两次（第 43、46 根）读数都只差 0.3 上下。钝化对两个方向一视同仁：回落段结尾 K 钉在 2.51，单日跌 0.2 元的那根 K 只挪了 0.94——下坡末段的 K 同样失明。

对策三条，全部写成条件句。

其一，趋势过滤。若价格站在第 11 章的 MA20 之上且趋势向上（第 10 章的更高高点、更高低点还在续写），超买读数的常见用法不是卖出，而是「不追高、持有等回踩」；失效条件是收盘跌破均线——跌破之后超买才重新变回风险提醒。其二，看背离不看阈值。回连第 16 章：超买区里价格创新高而指标拒绝新高，才是动量衰减的证据；`detectDivergence` 的峰对峰判据对 RSI 同样适用（本课程实验场只对 MACD 实装，思路平移）。若持仓且超买区出现顶背离，常见的应对是把止盈线收到最近回撤谷下方，收盘跌破执行；失效条件是指标重新新高，背离消失按趋势延续处理。其三，**70/30 与 80/20 是刻度不是开关**。刻度读作「买方力量的水位」，不读作「反转倒计时」——图上这段行情在 80 上方停了 28 根，任何以 80 为触发线的动作都会在第 23 根就离场。

## 渐进实验：先让命题见红

老规矩，先写测试看红。本章测试审五件事：小样本 RSI 与手算逐格一致；小样本 KDJ 四层读数与分数手算一致；J 越上 100 与打破 0；单调上涨里两指标的钝化（高位粘滞）被断言检出；边界三态（全涨、全跌、走平）与非法输入。挑三段贴出来。先交代三个测试样本：`fixedBand` 是测试文件头部的工厂，把 n 日窗的高低钉死在 9～10 元、只动收盘价；`midBars` 把一列收盘价包成高低对称的 K 线；`rally` 是 40 根连阳样本（`r = rsi(rally, 14)`）。

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/rsi-kdj.test.ts · 小样本逐格复算
  it('小样本逐格复算：第 4~6 根钉 100（跌的一列消失），第 7~8 根恰好 40', () => {
    const r = rsi(midBars([10, 10, 10, 13, 14, 14, 12, 12]), 3)
    expect(r).toHaveLength(8)
    expect(r.slice(0, 3)).toEqual([null, null, null]) // 不足 n 个涨跌差，不猜
    expect(r[3]).toBeCloseTo(100, 10)
    expect(r[4]).toBeCloseTo(100, 10)
    expect(r[5]).toBeCloseTo(100, 10)
    expect(r[6]).toBeCloseTo(40, 6)
    expect(r[7]).toBeCloseTo(40, 6)
  })
```

</details>

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/rsi-kdj.test.ts · KDJ 四层与分数手算一致
  it('小样本逐格复算：RSV/K/D/J 与分数手算一致', () => {
    const r = kdj(fixedBand([9, 9, 9, 9, 10, 10, 10, 10]), 3)
    expect(r.rsv).toEqual([null, null, 0, 0, 100, 100, 100, 100])
    expect(r.k.slice(0, 2)).toEqual([null, null])
    expect(r.k[2]).toBeCloseTo(100 / 3, 6)
    expect(r.k[3]).toBeCloseTo(200 / 9, 6)
    expect(r.k[4]).toBeCloseTo(1300 / 27, 6)
    expect(r.k[5]).toBeCloseTo(5300 / 81, 6)
    expect(r.k[6]).toBeCloseTo(18700 / 243, 6)
    expect(r.k[7]).toBeCloseTo(61700 / 729, 6)
    expect(r.d[2]).toBeCloseTo(400 / 9, 6)
    expect(r.d[3]).toBeCloseTo(1000 / 27, 6)
    expect(r.d[4]).toBeCloseTo(3300 / 81, 6)
    expect(r.d[5]).toBeCloseTo(11900 / 243, 6)
    expect(r.d[6]).toBeCloseTo(42500 / 729, 6)
    expect(r.d[7]).toBeCloseTo(146700 / 2187, 6)
    expect(r.j[7]).toBeCloseTo(261900 / 2187, 6)
  })
```

</details>

<details>
<summary>🔧 测试代码 · 点击展开</summary>

```ts
// tests/rsi-kdj.test.ts · 钝化的机械断言
  it('RSI 自成形起全程钉 100：末段 20 根读数一模一样——涨 0.5% 与涨 3% 的日子分不出', () => {
    for (let i = 14; i < 40; i++) {
      expect(rally[i].close).toBeGreaterThan(rally[i - 1].close) // 样本自检：确实天天新高
      expect(r[i]).toBeCloseTo(100, 10) // 平均跌幅一列全程为零，比值钉死
    }
    expect(new Set(r.slice(20).filter((v): v is number => v != null)).size).toBe(1)
  })
```

</details>

第三段值得多说一句：钝化样本是 40 根连阳，日涨幅按 0.5%、2%、1%、3% 轮换——强弱差 6 倍，RSI 末段 20 根读数一字不差。粘滞不是画图时挑的样，是断言逼出来的事实。

见红后实现。两个新模块 `src/indicators/rsi.ts` 与 `src/indicators/kdj.ts`，只增不改。先是 RSI 全貌：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/indicators/rsi.ts · rsi 全貌
/** RSI：分子是平均涨幅、分母是全部波动。两个边界约定如实声明：
 *  平均跌幅为零（窗口内只涨不跌）→ 100；分子分母同零（窗口内纹丝不动）→ 50，
 *  没涨没跌谈不上强弱，读数取不偏不倚的 50，不猜方向。 */
export function rsi(candles: readonly Candle[], n: number = DEFAULT_RSI): RsiSeries {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('rsi：candles 不能为空')
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`rsi：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(candles[i].close)) {
      throw new Error(`rsi：第 ${i} 根的收盘价必须是有限数字，收到的是 ${candles[i].close}`)
    }
  }
  const out: RsiSeries = new Array(candles.length).fill(null)
  if (candles.length <= n) return out // 攒不出 n 个涨跌差：整条 null，不猜

  // 第一格：前 n 个涨跌差各拆成涨/跌两列，取算术平均——RSI 的种子
  let avgGain = 0
  let avgLoss = 0
  for (let i = 1; i <= n; i++) {
    const change = candles[i].close - candles[i - 1].close
    if (change > 0) avgGain += change
    else avgLoss -= change
  }
  avgGain /= n
  avgLoss /= n
  out[n] = rsiValue(avgGain, avgLoss)

  // 此后每根：Wilder 递推——旧平均扛 (n−1)/n 的权重，新值只占 1/n，记忆长、反应缓
  for (let i = n + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close
    avgGain = (avgGain * (n - 1) + (change > 0 ? change : 0)) / n
    avgLoss = (avgLoss * (n - 1) + (change < 0 ? -change : 0)) / n
    out[i] = rsiValue(avgGain, avgLoss)
  }
  return out
}

/** 比例尺换算：涨的那列占全部波动的百分比。两列同零记 50（不偏不倚），只涨不跌记 100。
 *  先算比值再乘 100：平均跌幅为零时比值恰为 1，读数钉在 100 一字不差——
 *  「钉死」是本章要断言的行为，不能让浮点误差在末位晃动。 */
function rsiValue(avgGain: number, avgLoss: number): number {
  const total = avgGain + avgLoss
  if (total === 0) return 50
  return 100 * (avgGain / total)
}
```

</details>

再是 KDJ 全貌：

<details>
<summary>🔧 实现代码 · 点击展开</summary>

```ts
// src/indicators/kdj.ts · kdj 全貌
/** KDJ 三层积木：RSV 自第 n 根起可算（窗口含当根，凑满 n 根），K/D 自同一根起步
 *  （种子 50），J = 3K − 2D 与 K/D 同格成形。之前的格子是 null，不猜。
 *  窗口内最高=最低（一字横盘）时分母为零：RSV 记 50，与走平的 RSI 同一个约定。 */
export function kdj(candles: readonly Candle[], n: number = DEFAULT_KDJ): KdjSeries {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('kdj：candles 不能为空')
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`kdj：窗口 n 必须是正整数，收到的是 ${n}`)
  }
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]
    if (!Number.isFinite(c.high) || !Number.isFinite(c.low) || !Number.isFinite(c.close)) {
      throw new Error(`kdj：第 ${i} 根的最高/最低/收盘价必须是有限数字，收到 high=${c.high}、low=${c.low}、close=${c.close}`)
    }
    if (c.high < c.low) {
      throw new Error(`kdj：第 ${i} 根的最高价不能低于最低价（high=${c.high} < low=${c.low}）`)
    }
    if (c.close > c.high || c.close < c.low) {
      throw new Error(`kdj：第 ${i} 根的收盘价必须落在最高与最低之间（close=${c.close}、high=${c.high}、low=${c.low}）`)
    }
  }

  const rsv: KdjLine = new Array(candles.length).fill(null)
  const k: KdjLine = new Array(candles.length).fill(null)
  const d: KdjLine = new Array(candles.length).fill(null)
  const j: KdjLine = new Array(candles.length).fill(null)

  // 朴素滑窗：每根全窗扫描（窗口最大 9 根，可读性优先；增量优化的数据契约见差异清单）
  let prevK: number | null = KDJ_SEED
  let prevD: number | null = KDJ_SEED
  for (let i = 0; i < candles.length; i++) {
    if (i < n - 1) continue // 窗口未满：RSV 无从谈起，K/D 没有新原料
    let hh = -Infinity
    let ll = Infinity
    for (let w = i - n + 1; w <= i; w++) {
      if (candles[w].high > hh) hh = candles[w].high
      if (candles[w].low < ll) ll = candles[w].low
    }
    const span = hh - ll
    rsv[i] = span === 0 ? KDJ_SEED : ((candles[i].close - ll) / span) * 100 // 分母为零：贴不了顶也探不了底，记 50

    // K = 2/3·昨K + 1/3·RSV；D 对 K 同款再来一次——两层平滑，一层比一层慢
    prevK = prevK! * (1 - KDJ_ALPHA) + rsv[i]! * KDJ_ALPHA
    prevD = prevD! * (1 - KDJ_ALPHA) + prevK * KDJ_ALPHA
    k[i] = prevK
    d[i] = prevD
    // J = 3K − 2D = K + 2×(K−D)：K 与 D 的差距放大两倍再叠回 K——差距一小段，J 冲一大截
    j[i] = 3 * prevK - 2 * prevD
  }
  return { rsv, k, d, j }
}
```

</details>

读三个承重点。其一，kdj 返回的不只 K/D/J，还带 rsv 原料列——正文手算表能和图对上，靠的就是它。其二，滑窗注释写「只做增量」，实现里仍是朴素内圈循环——窗口最大 9 根，可读性优先，这是本课程的操作化选择（差异已登记附录清单）。其三，kdj 对 K 线做了结构校验：最高低于最低、收盘价越出高低带，当场抛中文错误——RSV 的分母和位置全靠这三件事成立。

图上的数据照旧出自 export-docs 脚本第 17 章导出段，守门内置。RSI 首上 80 必须落在拉升段内，且清仓点之后涨幅不得低于 10%——踏空故事才立得住。RSI 连续不低于 80 不得少于 15 根（钝化区间要够长），区间内 K 不得低于 70。超买区至少一次死叉；结尾 RSI 必须跌回 45 之下（钝化只在单边的对照组）；J 必须一头冲上 100、一头打破 0。次序乱一处，整段失败换种子重来。

简化之处照实声明并登记附录差异清单：K/D 初值取 50、两个「分母为零记 50」均为通行约定而非标准条文（各软件处理不一）；RSI 用 Wilder 平滑（α=1/n），国内软件有按简单平均口径计算的，前段读数有差异；KDJ 默认 9 日、J 线为国内软件通行加法（Lane 原版只有 %K/%D）；K/D 金叉死叉扫描与钝化区间标记为导出段教学件，不进 src；两段行情为固定种子路径合成。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：289 项全绿，其中 21 项是本章新增。覆盖面：RSI 小样本逐格核对与默认参数成形根序；KDJ 四层分数手算；镜像对偶（K′=100−K、J′=100−J）；40 根连阳的钝化断言（RSI 钉 100、K 末段不低于 99.8 且逐格位移小于 0.05）；全涨、全跌、走平三态；同一急跌上 |ΔJ| 大于 |ΔK| 大于 |ΔRSI| 的响应速度排序；非法输入九案全部抛中文错误。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加第 17 章一段。全程图 62 根：RSI 首上 80 第 23 根（收 10.34 元），山顶第 48 根（高 13.57 元）——清仓后再涨 31.2%。RSI 连续不低于 80 共 28 根，区间内 K 最低 77.59，结尾 RSI 28.44。副图 K/D 交叉共 6 次，超买区死叉 2 次，J 最高 108.42、最低 −28.02。钝化切片 43 根，第 56 根 RSI 跌破 50。响应速度一行：最狠一根急跌当日 RSI 移动 3.66、K 移动 0.94、J 移动 1.57（低位粘滞的镜像）。`docs/assets/data/` 下多出六个 `17-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体。打开行情 App，挑一只近一年走出翻倍行情的强势股，开前复权，副图调出 RSI（默认参数即可）。两件事：数一数 RSI 在 80 上方连续停了多少天（很可能远超你的直觉）；再抄下首上 80 那天的收盘价与之后的最高价，算一下「80 就清仓」会错过百分之几。两只票各做一遍，你对「刻度不是开关」就有自己的样本了。

## 小结

- RSI = 100 × 平均涨幅 ÷ 全部波动，Wilder 平滑（α = 1/n）；KDJ = RSV 的两层 1/3 平滑再加 J = 3K − 2D。
- 两指标同源（位置/占比压成 0～100），差异在平滑系数与原料：K 的新值权重 1/3 对 RSI 的 1/14，同一根急跌位移 17.09 对 9.84。
- 钝化两条成因：RSI 的分母消失（跌幅列趋零，比值钉 100）、KDJ 的平滑粘滞（RSV 钉 100，K 渐近、K 与 D 挤死，交叉退化成噪声）。
- 对策三条全是条件句：趋势在则超买不卖、看背离不看阈值、70/30 与 80/20 是刻度不是开关。
- 全部判据进了实验场：`rsi` 与 `kdj` 只增不改，钝化由测试断言、由守门保证上图。

读完本章，你应该能回答：

1. 收盘价 [10, 10, 10, 13, 14, 14, 12, 12]、窗口 3——第 6 根的 RSI 是多少？为什么？
2. 某根 K = 84.64、D = 67.08——J 是多少？这个数超出 0～100 了吗，为什么 J 天生会出界？
3. 一只票 RSI 在 85 上方停了三周、股价还在创新高——「超买要跌」这句话此刻该怎么用？
4. 同一根急跌 K 线上，为什么 K 的位移比 RSI 大、J 又比 K 大？各自的平滑系数是答案的哪一半？

去向一句话：本章的两把尺都拿价格自身当参照，第 18 章的布林带换一个参照系——拿波动率画通道，超买超卖从此有了会呼吸的边界。
