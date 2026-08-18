---
title: 双根形态：吞没、乌云盖顶、孕线与平顶平底
---

# 双根形态：吞没、乌云盖顶、孕线与平顶平底

<script setup>
// 本章九张图的数据，全部来自实验场 export-docs 脚本对识别器 detectTwoCandle 的真实扫描。
import engulfBull from './assets/data/07-engulf-bull.json'
// 下跌段第 31 根：看涨吞没。
import engulfBear from './assets/data/07-engulf-bear.json'
// 上涨段第 31 根：看跌吞没。
import darkCloud from './assets/data/07-dark-cloud.json'
// 上涨段第 31 根：乌云盖顶。
import piercing from './assets/data/07-piercing.json'
// 下跌段第 31 根：刺透形态——低开后的反击阳线。
import haramiBull from './assets/data/07-harami-bull.json'
// 下跌段第 31 根：看涨孕线。
import haramiBear from './assets/data/07-harami-bear.json'
// 上涨段第 31 根：看跌孕线。
import haramiDoji from './assets/data/07-harami-doji.json'
// 上涨段第 31 根：十字孕线。
import tweezerTop from './assets/data/07-tweezer-top.json'
// 上涨段第 31 根：平顶。
import tweezerBottom from './assets/data/07-tweezer-bottom.json'
// 下跌段第 31 根：平底。
</script>

五月底你决定做一次认真的复盘：把自选股里上个月出现过「看涨吞没」的票挨个找出来，看看它们后来的走势。一百多只股票，一只只翻日 K 线。翻到第三十几只，眼睛开始发花：这根算不算包住？那根开盘算高开还是平开？乌云盖顶和看跌吞没在图上只差几毛钱的纵深，你放大、缩小、再放大，一晚上下来数错三处、漏掉一处。周二夜里接着数，周四彻底放弃——手工数形态这件事，你坚持了不到三天。

问题不在毅力。逐根核对九种双根形态，本来就不是眼睛擅长的工作：**眼睛擅长发现「大概像」，不擅长核对「差一分钱算不算」。**第 4 章你见过纵轴缩放怎么把同一根 K 线变脸；双根形态又多一层麻烦——判据落在两根 K 线的相对位置上，肉眼要同时记住四个价格，再做算术。这一章把九种双根形态全部写成数值判据，交给识别器去数：一百只还是一千只，差别只是多跑几圈循环。复盘从此是 `npm test` 的事，不是眼睛的事。

## 两根 K 线多出来的维度：回应

第 5、6 章的单根形态，读的都是同一个问题：今天谁赢了，赢得悬殊不悬殊。但一根 K 线回答不了另一件事：今天的胜负，是延续昨天，还是回应昨天？昨天大阴线收官，今天收一根小阳线——是买方开始还手，还是下跌途中歇口气？答案不在任何一根 K 线自己身上，在两根的相对关系里。**双根形态读的不是今天的胜负，是今天对昨天的回应。**

回应有四种基本姿势，九个名字都挂在上面：

- 扩张——今天不但赢，还把昨天的战果连本带利圈进来：看涨吞没、看跌吞没。
- 攻进腹地——今天先顺着昨天的方向跳空开盘，再反手打进昨天实体的深处：乌云盖顶、刺透形态。
- 收缩——今天突然收力，整个缩回昨天的领地：看涨孕线、看跌孕线、十字孕线。
- 重复测试——今天在昨天碰过的同一价位再碰一次、再被挡一次：平顶、平底。

每个名字都是一出两日连播剧：昨天谁赢（第一根的方向与实体）、今天怎么回应（第二根相对第一根的位置）、回应说明什么（盘面含义）。判据只看开高低收四个数字，剧本不同，算式不同。

背景要求沿用第 5 章的老规矩：反转形态先得有可反转的趋势。识别器用同一个回看窗口判背景（只用形态之前的数据），背景 flat 一律不命名。完成日最早是序列的第 7 根——它前面那根还得放得下一整个背景窗口。

## 吞没形态：连本带利的回应

吞没形态（engulfing——今天的实体把昨天实体整个包住的两根组合）的剧本两句话讲完。昨天：一方拿下当天，收出有实体的阴线或阳线。今天：对手不但夺回今天的战场，还把昨天的实体整个圈进自己的实体里——昨天的战果连本带利收了回去。

数值判据三条：昨天实体占振幅须超过 5%——开收打平的十字（第 6 章的地盘）没有战果可吞；今天实体的顶不低于昨天实体顶、底不高于昨天实体底，且至少一头严格越过——两根实体一模一样的不算，那叫原地踏步，不叫回应。方向由今天定：今天阳线且背景下跌，看涨吞没；今天阴线且背景上涨，看跌吞没。

跟算第一张图（下跌段第 31 根）：昨天开 9.75、收 9.42，阴线实体 [9.42, 9.75]；今天开 9.39、收 9.78，阳线实体 [9.39, 9.78]。底 9.39 低于 9.42，顶 9.78 高过 9.75，两头都严格越过——看涨吞没成立。再看量能：从 13 万放到 20 万，扩张配上放量，回应才有分量（量能判据不进识别器，第 12 章单讲）。

<KLineChart :candles="engulfBull.candles" :markers="engulfBull.markers" title="下跌段的看涨吞没" />

标记是识别器扫的。它还在第 32 根顺手判了一处平底：那根的低点 9.34 与吞没日的低点 9.33 几乎重合。双根形态共享 K 线，一个交易日可以同时是一对组合的今天、另一对的昨天——这正是肉眼追踪容易乱套、代码不会乱套的原因。

<KLineChart :candles="engulfBear.candles" :markers="engulfBear.markers" title="上涨段的看跌吞没" />

第二张图跟算。昨天阳线实体 [9.85, 10.08]；今天开 10.10、收 9.83，阴线实体 [9.83, 10.10]，同样两头严格越过。第 32 根的高点 10.16 与今天的高点 10.14 几乎相同，识别器判了平顶。

应对与失效：看涨吞没出现在一段不少于 5% 的下跌之后、且当天量能明显放大时，常见的应对是把「买方接管」记为一条线索，等次日回踩不创新低再考虑介入；失效条件：次日收盘跌回今天阳线实体的中点之下，接管判读作废。看跌吞没镜像：上涨后放量阴线包住昨天，常见的应对是收紧止盈、停止追加；失效条件：次日收盘收复今天阴线实体的中点。

## 乌云盖顶与刺透：同一条中点线上的镜像

乌云盖顶（dark cloud cover——上涨后高开、却收进昨天阳线实体中点之下的阴线）的剧本：昨天多方大胜收阳；今天乘势高开，开盘价高于昨天收盘，这是最后的乐观；随后卖压把价格一路压回，收盘不但回吐今天的跳空，还扎进昨天实体的腹地，落在中点之下。高开是乐观的尾巴，收不过中点是反转的正文。

刺透形态（piercing——下跌后低开、却收过昨天阴线实体中点的阳线）是它照镜子：昨天大阴，今天恐慌低开，开盘价低于昨天收盘；随后买方把价格顶回来，收盘扎进昨天实体腹地、越过中点。恐慌盘在低位交出的筹码，被正面买了回去。

两个形态共用同一条数值边界：昨天实体的中点 =（昨开 + 昨收）÷ 2。**中点不是几何装饰，是多空重新开战的战线。**昨天的实体是昨天的战场，今天的开盘跳在战场之外，真正的较量是今天收盘能打回战场多深——收不过中点，昨天的胜方仍守住半壁江山；收过了，反击方才算立足。

跟算图里的乌云盖顶（上涨段第 31 根）：昨天开 10.04、收 10.26，阳线实体 [10.04, 10.26]，中点 =（10.04 + 10.26）÷ 2 = 10.15。今天开 10.28，高于昨收 10.26，高开成立；收 10.10，低于中点 10.15，战线失守；但 10.10 仍高于昨开 10.04，收在昨天实体之内。三个条件同时成立，乌云盖顶。

<KLineChart :candles="darkCloud.candles" :markers="darkCloud.markers" title="上涨段的乌云盖顶" />

全图只命中这一处。注意第三个条件的用意：若今天收盘压到 10.04 之下，那不是乌云盖顶，是看跌吞没的地盘——攻进腹地与整体吞没是两种回应，判据上要划清界限。

边界的较真是本章测试盯得最紧的一条：收盘恰好压在 10.15 这一分不差的位置上算不算？判据写的是严格低于——压线不算乌云盖顶。差一分钱，性质两判；手工数形态数错的，多半就是这种地方。

<KLineChart :candles="piercing.candles" :markers="piercing.markers" title="下跌段的刺透形态" />

跟算刺透，全图只此一处。昨天开 9.85、收 9.48，阴线实体 [9.48, 9.85]，中点 =（9.85 + 9.48）÷ 2 = 9.665。今天开 9.45，低于昨收 9.48，低开成立；收 9.76，越过中点，且低于昨开 9.85、收在实体之内。再算一笔纵深：今天收盘在昨天实体内的位置 =（9.76 − 9.48）÷（9.85 − 9.48）≈ 76%——从底部量起打回去四分之三，过半，立足。

应对与失效：出现乌云盖顶、且次日收盘收在乌云阴线最低价之下时，常见的应对是减仓防守——反转可以等确认，防守不必等；失效条件：次日放量收阳、收复昨天阳线实体的中点，乌云判读作废。出现刺透、且次日收盘高于刺透阳线最高价时，常见的应对是把「下方有承接」记为线索、等回踩再考虑介入，不当天追；失效条件：次日收盘跌破昨天阴线的最低价，反击判读作废。

## 孕线与十字孕线：扩张的对偶是收缩

吞没是今天把昨天包住，孕线（harami——今天的小实体整个缩在昨天大实体之内的组合，日语原义「怀孕」）正好反过来：今天缩在昨天里面。**扩张与收缩是一对对偶：一个说战果被连本收回，一个说攻势突然刹车。**两者互斥于同一个判据——两根实体的相对位置，一头在外面是吞没，两头都在里面是孕线。

看涨孕线的剧本：昨天大阴线，空头看似气势如虹；今天开在昨天实体之内，全天小幅拉锯，收一根小阳线，实体完全没伸出昨天的领地。回应说明什么？卖压没有延续——昨天赢的一方今天没有乘胜追击，而买方小规模还手且全身而退。这是犹豫，不是反转成立；但出现在下跌之后，它是「跌不动了」的第一份证据。

判据三条：昨天实体占昨天振幅的比例不低于 0.7（第 5 章「大实体」的口径）；今天实体两头都严格缩在昨天实体之内；今天实体不超过昨天实体的三分之一——收缩要明显，只缩一点的不给名字。今天若是十字（实体占比不超过 5%，第 6 章的地盘），单独命名为十字孕线（doji harami——昨天大实体、今天十字星缩在其内的组合）：犹豫到极致，常是变盘前夜。十字孕线自己没有方向，倾向只能来自背景（下跌后偏多、上涨后偏空），并且按第 6 章的道理要等次日确认——它是待确认的倾向，不是信号。

<KLineChart :candles="haramiBull.candles" :markers="haramiBull.markers" title="下跌段的看涨孕线" />

全图只此一处。昨天开 9.73、收 9.39，实体 0.34，振幅 0.37，占比 0.92，是大实体；今天开 9.49、收 9.57，实体 0.08，不超过 0.34 ÷ 3 ≈ 0.11；实体 [9.49, 9.57] 缩在 [9.39, 9.73] 之内。看涨孕线成立。量能从 13 万缩到 8 万——收缩配上缩量，刹车更像刹车。

<KLineChart :candles="haramiBear.candles" :markers="haramiBear.markers" title="上涨段的看跌孕线" />

镜像跟算。昨天大阳实体 [10.08, 10.39]；今天开 10.22、收 10.14，小阴实体 [10.14, 10.22] 缩在内。看跌孕线成立，全图同样只此一处。

<KLineChart :candles="haramiDoji.candles" :markers="haramiDoji.markers" title="上涨段的十字孕线" />

今天是根十字。开 = 收 9.99，悬在昨天大阳实体 [9.84, 10.14] 的正中，实体占比 0。十字孕线，倾向偏空（背景上涨）、待次日确认——第 6 章「记分牌只有上半场」的道理，原封不动搬过来。

应对与失效：看涨孕线出现在下跌之后时，常见的应对是把「卖压收缩」记为线索、观察次日；失效条件：次日收盘跌破昨天大阴线的最低价，刹车判读作废。看跌孕线镜像：上涨后小阴缩进大阳，常见的应对是收紧止盈；失效条件：次日收盘越过昨天大阳线的最高价。出现十字孕线时，常见的应对是只观察不动手；确认与失效同第 6 章：次日收出实体饱满的方向 K 线并越过十字的高点或低点，倾向才升级为线索，反向越过则作废。

## 平顶与平底：第二次测试同一个价位

平顶的剧本：上涨途中，昨天冲到 9.98 被打了回来；今天再冲，最高又是 9.98，又被打了回来。同一个价位，两天两次把买方挡在外面——上面有人守。平底镜像：下跌途中两根 K 线的低点落在同一价位，下面有人接。**一个价位有没有人守，一次不算数，两次才是初步证据——这就是平顶与平底（tweezer top / bottom——两根 K 线的高点或低点几乎落在同一价位的组合）的全部内容。**

判据的难处在「几乎」：差几分钱算同一个价位？写死一个分数不行——0.02 元的差距在 3 元的股票上巨大，在 300 元的股票上微小。把第 6 章的参照尺搬过来：形态之前五根的平均振幅；两根高点（低点）的差距不超过参照振幅的一成，判「同一价位」。

<KLineChart :candles="tweezerTop.candles" :markers="tweezerTop.markers" title="上涨段的平顶" />

图里的样本最干净。两根高点分毫不差，都是 9.98。

<KLineChart :candles="tweezerBottom.candles" :markers="tweezerBottom.markers" title="下跌段的平底" />

平底同样分毫不差。两根低点都是 8.92。真实行情里更多见的是差一两分钱的「几乎相同」，容差就是为它们设的。

应对与失效：平顶出现在上涨之后、且两根中第二根收阴时，常见的应对是把「上方有守军」记为线索、停止追加；失效条件：次日收盘越过两根的共同高点，守军判读作废，按突破重估——也要当心专门收割追单的假突破，支撑与阻力一章单讲。平底镜像：下跌后两根低点几乎相同，常见的应对是把「下方有承接」记为线索；失效条件：次日收盘跌破共同低点。

## 渐进实验：先让中点边界见红

老规矩，先写测试看红。本章测试审三件事：九种形态各归各位；中点是硬边界；干扰序列不误报。中点这条最要紧。乌云盖顶要求严格收在中点之下，恰好压线不算：

```ts
// tests/multi-patterns-two.test.ts · 乌云盖顶的中点边界
  it('乌云盖顶的中点边界：收 6.01（中点之上）与收 6.00（恰好压在中点上）都不判，收 5.99 才判', () => {
    const above = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.95, 6.01)])
    expect(above).toEqual([])
    const exact = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.9, 6.0)])
    expect(exact).toEqual([])
    const below = detectTwoCandle([...RISING, YANG_QUARTER, c(6.5, 6.55, 5.9, 5.99)])
    expect(below).toEqual([hit('dark-cloud-cover', 9, 'bear', 'rising')])
  })
```

样本 YANG_QUARTER 的实体是 [5.75, 6.25]——特意取四分之一元，中点（5.75 + 6.25）÷ 2 = 6.00 在浮点数里精确，边界测试不怕电子误差。干扰那组同样见红后转绿：高开阴线收不过中点、两根实体一模一样、孕线一头露在外面、高点差一截，全部要求零命中。代表一条：

```ts
// tests/multi-patterns-two.test.ts · 干扰不误报
  it('两根实体一模一样（没有任何一头严格越过）：不算吞没', () => {
    const prev = c(5.7, 6.95, 5.65, 6.9)
    const cur = c(6.9, 7.0, 5.65, 5.7) // 实体仍为 [5.7, 6.9]，只是换了个方向
    expect(detectTwoCandle([...RISING, prev, cur])).toEqual([])
  })
```

实现是一个新文件 `src/patterns/two.ts`：复用第 3 章的解剖器读实体、第 5 章的窗口判背景，只新增不改旧。判据常量五条，与正文一一对应：

```ts
// src/patterns/two.ts · 判据常量
/** 吞没的前一天必须有像样实体：昨天开收打平（十字族地盘 ≤5%）就没有「战果」可吞 */
const ENGULF_PREV_BODY = 0.05
/** 孕线的昨天必须是大实体（复用第 5 章「大」的口径）：昨天不够大，谈不上「缩在内」 */
const HARAMI_PREV_BODY = 0.7
/** 孕线的收缩要明显：今天实体不超过昨天实体的三分之一 */
const HARAMI_SHRINK = 1 / 3
/** 十字孕线的边界：今天实体占振幅不超过该比例归十字族（与第 6 章家族边界一致） */
const DOJI_BODY_RATIO = 0.05
/** 平顶/平底的「同一价位」容差：两根高点（低点）的差距不超过参照振幅的一成 */
const TWEEZER_TOL = 0.1
```

主函数 `detectTwoCandle` 全貌。四组判据按扩张、攻进腹地、收缩、重复测试的顺序展开；同一完成日可以命中多个形态（比如乌云盖顶与平顶同日并存），返回的是列表不是单选：

```ts
// src/patterns/two.ts · detectTwoCandle 全貌
export function detectTwoCandle(candles: readonly Candle[], opts: TwoCandleOpts = {}): TwoCandlePattern[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectTwoCandle：candles 不能为空')
  }
  const lookback = opts.lookback ?? 5
  const out: TwoCandlePattern[] = []
  // 完成日 i 最早是 lookback+1：它的前一天（形态第一根）要放得下一个完整背景窗口
  for (let i = lookback + 1; i < candles.length; i++) {
    const prev = candles[i - 1] // 昨天：形态的第一根
    const cur = candles[i] // 今天：回应发生、形态完成的一根
    const pa = candleAnatomy(prev)
    const ca = candleAnatomy(cur)
    const ctx = trendContext(candles, i - 1, { lookback, threshold: opts.threshold }) // 背景在形态之前结束

    const prevTop = Math.max(prev.open, prev.close)
    const prevBottom = Math.min(prev.open, prev.close)
    const curTop = Math.max(cur.open, cur.close)
    const curBottom = Math.min(cur.open, cur.close)
    const midpoint = (prev.open + prev.close) / 2 // 昨天实体的中点：乌云盖顶与刺透共用的战线

    // —— 吞没：今天的实体把昨天的实体整个包住。至少一头严格越过——两根一模一样的实体没有「回应」 ——
    const engulf =
      pa.bodyRatio > ENGULF_PREV_BODY &&
      curTop >= prevTop &&
      curBottom <= prevBottom &&
      (curTop > prevTop || curBottom < prevBottom)
    if (engulf && ca.direction === 'yang' && ctx.position === 'falling') {
      out.push({ id: 'bullish-engulfing', index: i, direction: 'bull', position: ctx.position })
    }
    if (engulf && ca.direction === 'yin' && ctx.position === 'rising') {
      out.push({ id: 'bearish-engulfing', index: i, direction: 'bear', position: ctx.position })
    }

    // —— 乌云盖顶与刺透：高开/低开之后攻进昨天实体的腹地，但收在那儿、没有整个吞掉 ——
    // 镜像关系：同一条中点线，乌云盖顶要收在它之下（但仍在昨天实体内），刺透要收在它之上（同理）。
    if (
      ctx.position === 'rising' &&
      pa.direction === 'yang' &&
      ca.direction === 'yin' &&
      cur.open > prev.close && // 高开：最后的乐观
      cur.close < midpoint && // 收不过昨天实体的中点：战线丢了
      cur.close > prev.open // 仍收在昨天实体之内——整个吞掉是吞没的地盘
    ) {
      out.push({ id: 'dark-cloud-cover', index: i, direction: 'bear', position: ctx.position })
    }
    if (
      ctx.position === 'falling' &&
      pa.direction === 'yin' &&
      ca.direction === 'yang' &&
      cur.open < prev.close && // 低开：最后的恐慌
      cur.close > midpoint && // 收回昨天实体的中点之上：买方正面顶回来了
      cur.close < prev.open // 收在昨天实体之内，与吞没分界
    ) {
      out.push({ id: 'piercing', index: i, direction: 'bull', position: ctx.position })
    }

    // —— 孕线：昨天大实体，今天整个缩在其内——扩张的对偶是收缩。判据先问骨架（昨天够大），
    // 再问位置（严格缩在内），最后问今天的身份：十字归十字孕线，小实体看收缩幅度。 ——
    const prevBig = pa.bodyRatio >= HARAMI_PREV_BODY
    const inside = curTop < prevTop && curBottom > prevBottom
    if (prevBig && inside) {
      if (ca.bodyRatio <= DOJI_BODY_RATIO) {
        // 十字孕线：今天连方向都没给出，倾向只能来自背景，且要等次日确认（第 6 章的道理）
        if (ctx.position === 'falling') {
          out.push({ id: 'doji-harami', index: i, direction: 'bull', position: ctx.position })
        } else if (ctx.position === 'rising') {
          out.push({ id: 'doji-harami', index: i, direction: 'bear', position: ctx.position })
        }
      } else if (ca.body <= pa.body * HARAMI_SHRINK) {
        if (ca.direction === 'yang' && ctx.position === 'falling') {
          out.push({ id: 'bullish-harami', index: i, direction: 'bull', position: ctx.position })
        }
        if (ca.direction === 'yin' && ctx.position === 'rising') {
          out.push({ id: 'bearish-harami', index: i, direction: 'bear', position: ctx.position })
        }
      }
    }

    // —— 平顶/平底：两根的高点（低点）落在同一价位。多近算「同一」？拿形态之前 lookback 根的
    // 平均振幅当尺（第 6 章的参照尺）：差距在噪声尺度的一成以内，才算两次碰到同一个价位。 ——
    let sum = 0
    for (let j = i - 1 - lookback; j <= i - 2; j++) sum += candles[j].high - candles[j].low
    const tol = TWEEZER_TOL * (sum / lookback)
    if (ctx.position === 'rising' && Math.abs(prev.high - cur.high) <= tol) {
      out.push({ id: 'tweezer-top', index: i, direction: 'bear', position: ctx.position })
    }
    if (ctx.position === 'falling' && Math.abs(prev.low - cur.low) <= tol) {
      out.push({ id: 'tweezer-bottom', index: i, direction: 'bull', position: ctx.position })
    }
  }
  return out
}
```

图表数据照旧出自 `export-docs` 脚本。双根样本要成对植入：昨天那根定锚（前一晚的收盘价）与尺（形态之前五根的平均振幅，与识别器同款窗口），今天那根在同一组数字上做回应；守门 `expectTwoAt` 同时核对背景方向与识别结果，任何一条不满足就整段导出失败。平顶样本是最干净的极端——两根高点取同一个四舍五入后的数：

```ts
// companion/scripts/export-docs-data.ts · 成对植入的平顶与平底样本
const tweezerTopSeries = plantPair(ch7(708, 0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 1.2 * r), low: round2(b - 0.05 * r), close: round2(b + 0.8 * r), volume: 130000 }, // 阳线，高点 b+1.2r
  { date: '', open: round2(b + 0.7 * r), high: round2(b + 1.2 * r), low: round2(b + 0.25 * r), close: round2(b + 0.3 * r), volume: 150000 }, // 阴线，高点分毫不差
])
const tweezerBottomSeries = plantPair(ch7(709, -0.02), AT7, (b, r) => [
  { date: '', open: b, high: round2(b + 0.05 * r), low: round2(b - 1.2 * r), close: round2(b - 0.8 * r), volume: 130000 }, // 阴线，低点 b−1.2r
  { date: '', open: round2(b - 0.7 * r), high: round2(b - 0.25 * r), low: round2(b - 1.2 * r), close: round2(b - 0.3 * r), volume: 150000 }, // 阳线，低点分毫不差
])
```

简化之处照实声明：全部阈值（昨天大实体 0.7、收缩三分之一、十字边界 5%、容差一成、回看五根、背景 5%）是本课程的操作化选择；乌云盖顶与刺透取「收在昨天实体之内」的严格版本，用它与吞没划清边界；孕线只比实体不比影线（有的教科书版本要求整根缩在内）；平顶与平底不限定两根的颜色组合。全部差异登记在附录差异清单。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：87 项全绿，其中 23 项是本章新增。新增的覆盖面：九种形态的判定（含方向与背景）；乌云盖顶与刺透的中点边界（压线不算）；吞没的严格越过；孕线的收缩幅度边界；十字孕线的背景换向；四种干扰序列零误报；flat 不命名；非法输入报错。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加一行：九张图的第 31 根分别判看涨吞没、看跌吞没、乌云盖顶、刺透形态、看涨孕线、看跌孕线、十字孕线、平顶、平底。另给出全序列命中数——七张图各 1 处，两张吞没图各 2 处；次日的低点或高点与吞没那根几乎重合，识别器顺手判了平底或平顶。`docs/assets/data/` 下多出九个 `07-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体：打开行情软件，任找一对你当初当成信号的 K 线，抄下两根的开高低收，算四笔账。第一笔：昨天实体与中点，（昨开 + 昨收）÷ 2；第二笔：今天的开盘在昨天收盘的哪一侧，高开还是低开；第三笔：纵深，（今收 − 昨天实体底端）÷ 昨天实体，今天的收盘扎进昨天战场多深，过半没有；第四笔（若疑是吞没）：两头的实体边界是否都严格越过。四笔算完，这对 K 线属于哪个名字、还是哪个都不属于，纸上就有答案。

## 小结

- 双根形态读的是「今天对昨天的回应」：扩张（吞没）、攻进腹地（乌云盖顶、刺透）、收缩（孕线、十字孕线）、重复测试（平顶、平底）四种姿势，九个名字，每个都是一出两日连播剧。
- 中点是多空重新开战的战线：乌云盖顶要收在昨天阳线实体中点之下、刺透要收过昨天阴线实体中点，恰好压线都不判；两者都以「收在昨天实体之内」与吞没分界。
- 孕线与吞没互为对偶：一个把昨天包住，一个缩进昨天；十字孕线的方向来自背景，是待确认的倾向。
- 平顶与平底的「同一价位」用参照振幅的一成做容差；一次不算数，两次才是「有人守」的初步证据。
- 九条应对句式全部是条件句并带失效条件；这些线索到底多可靠，第 9 章用统计逐一验货。

读完本章，你应该能回答：

1. 昨天阴线开 9.85、收 9.48，今天开 9.45、收 9.62——刺透成立吗？差在哪个数上？
2. 同一组「小实体缩在大实体之内」的数字，什么条件下叫看涨孕线、什么条件下叫十字孕线？
3. 乌云盖顶与看跌吞没都是上涨后收阴，判据在哪一条上分家？
4. 两根高点差 0.03 元，形态之前五根的平均振幅 0.5 元——平顶成立吗？写出核对算式。

去向一句话：第 8 章把两根拉到三根以上——晨星暮星、三兵三鸦与三法：回应之后，还要看确认的第三幕。
