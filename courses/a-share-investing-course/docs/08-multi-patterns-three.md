---
title: 三根以上：晨星暮星、三兵三鸦与三法
---

# 三根以上：晨星暮星、三兵三鸦与三法

<script setup>
// 本章八张图的数据，全部来自实验场 export-docs 脚本对识别器 detectThreeCandle 的真实扫描。
import starOk from './assets/data/08-morning-star.json'
// 下跌段第 32 根：晨星，已确认。
import starWeak from './assets/data/08-morning-unconfirmed.json'
// 同一组价格，第三根缩量。
import esStar from './assets/data/08-evening-star.json'
// 上涨段第 32 根：暮星。
import soldiers from './assets/data/08-three-soldiers.json'
// 上涨段：三连推进。
import stalled from './assets/data/08-stalled.json'
// 三兵之后，第四根撞墙。
import crows from './assets/data/08-three-crows.json'
// 下跌段：鸦群推进。
import rise3 from './assets/data/08-rising-three.json'
// 上涨段：五幕中继。
import fall3 from './assets/data/08-falling-three.json'
// 下跌段：镜像中继。
</script>

六月初你复盘一只票，翻到四月下跌的尾巴：三根 K 线摆在那里，教科书级的晨星。事后一眼就认出了它——可你翻回当天的交易笔记，写的是「跌势未止，继续观望」。那天晚上你正盯到第二根：一根悬在半空的小实体，你吃不准它算不算星线。等第三根放量阳线走出来，形态是完成了，你又嫌「已经涨了一天，追高不划算」。**多根形态的事前与事后是两个人：事前数不出第三根，事后全认得。**这不是心态问题，是工作量问题——判据散在三根 K 线的开高低收和成交量上，十几个数字要同时记在脑子里，还得做除法。

第 7 章你已经把双根形态交给了代码。这一章把剩下的七种三根以上组合——晨星暮星、三兵三鸦、受阻与三法——也全部写成数值判据，装进新函数 `detectThreeCandle`。从此数多根形态也是 `npm test` 的事，不是眼睛的事。

## 三根 K 线才演得成一出戏

单根 K 线读「今天谁赢了」，双根读「今天怎么回应昨天」。到了三根，剧本才有头有尾：起、转、合。这一章的七个名字分三类，各自回答不同的问题：

- 反转剧（三幕）：早晨之星、黄昏之星——出现在一段趋势的尽头，回答「这段行情死没死」。
- 推进剧（三幕）：红三兵、黑三鸦——趋势自己的缩影，回答「推进得顺不顺」；红三兵受阻是它的第四幕警告。
- 中继剧（五幕）：上升三法、下降三法——趋势中段的喘气，回答「歇脚会不会变成折返」。

背景门从此分两档。反转与中继沿用第 5 章的老规矩：识别器用形态之前的窗口判背景，没有趋势就没有可反转或可中继的对象，flat 一律不命名。推进形态不设门：三根同向推进的 K 线就是自己的语境，横盘里走出来照样命名，背景只被如实报告。这个差别本身就是语义——同一组数字，晨星要问「之前跌够了吗」，红三兵不问。

## 早晨之星：把「次日确认」装进形态里

早晨之星（morning star——下跌末端「大阴线 + 悬在其实体之下的小实体 + 收复阳线」的三根组合）是一出三幕剧。第一幕：空头大胜，收出实体占比不低于 0.7 的大阴线，战场就此划定。第二幕：卖压突然断了——一根小实体悬在第一根实体之下，实体不超过第一根的三分之一。它悬在战场外面，说明昨天的胜方今天连追击都组织不起来。第三幕：买方放量收复，阳线收盘扎回第一根实体的腹地。

关键在第三幕的及格线，它直接从第 7 章搬来：**第一根实体的中点，就是刺透形态用过的那条战线。**第 6 章讲十字星时立过规矩——犹豫自己没有方向，方向要等次日的新证据，记分牌只有上半场。晨星做的事，是把「犹豫」（第二幕的星线）和「新证据」（第三幕的收复）打包进同一个名字。所以晨星天生自带确认，但只带了一半，确认有两条数值线：

- 收复幅度 =（第三根收盘 − 第一根实体底端）÷ 第一根实体，及格线 50%，也就是收盘必须严格越过第一根的中点。收不回中点的，只是下跌中继里的反抽——跌势里短暂的回升。
- 量能比 = 第三根成交量 ÷ 前两根中较大者的成交量，及格线 1.2。价格收复了、量能没跟上，第三幕只是半场戏。

第一条是硬判据，不达标连名字都不给；第二条决定状态——量能不足的晨星照样判出，但带上 `confirmed: false` 的标记，降级为「未确认」。

跟算下图（下跌段第 30 到 32 根）。第一根开 10.24、收 9.90，阴线实体 [9.90, 10.24]，长 0.34，占振幅 0.94，第一幕成立。第二根开 9.83、收 9.81，实体 [9.81, 9.83] 只有 0.02，不到 0.34 的三分之一，且实体顶 9.83 低于第一根实体底 9.90——悬空成立。第三根开 9.80、收 10.27，阳线；中点 =（10.24 + 9.90）÷ 2 = 10.07，收 10.27 越过。收复幅度 =（10.27 − 9.90）÷ 0.34 ≈ 109%。量能：前两根较大者 13 万，乘 1.2 得 15.6 万，第三根 20 万——过线。早晨之星，已确认。副图里第三根的量能柱肉眼可见地高过前两根，这就是量能线在图上的样子。

<KLineChart :candles="starOk.candles" :markers="starOk.markers" title="早晨之星（已确认）" />

图上只标了晨星一族。识别器在同一张图里还扫出 9 处黑三鸦——下跌段里满地乌鸦，晨星的第一幕往往正是鸦群的尾巴。全序列命中 10 处，摘要行如实报数。

下一张图是同一组价格，唯一的差别是第三根成交量从 20 万改成 10 万。10 万不到 15.6 万，量能线不过：形态照判，状态降级。

<KLineChart :candles="starWeak.candles" :markers="starWeak.markers" title="早晨之星（未确认）" />

**同价不同量，结论降一级。**未确认不是作废——价格结构已经把「卖压枯竭 + 买方接管」演完了，缺的只是观众。常见的应对：把它记为线索再等一天，次日量能补上且收盘站稳中点之上则升级；失效条件：次日收盘跌回星线最低价之下，晨星判读作废。

应对与失效（已确认的晨星）：出现在不少于 5% 的下跌之后、收复与量能双双过线时，常见的应对是把「底部接管」记为一条线索，等回踩星线区域不创新低再考虑介入，不当天追；失效条件：次日收盘跌回第一根阴线实体的中点之下，接管判读作废。

## 黄昏之星：同一出戏倒着放

黄昏之星（evening star——上涨末端「大阳线 + 悬空小实体 + 失守阴线」的三根组合）是晨星照镜子。第一幕大阳定战场；第二幕星线悬在第一根实体之上；第三幕阴线把收盘压回第一根实体中点之下。中点线、量能线原封不动，方向全部反过来。

跟算上图（上涨段第 30 到 32 根）。第一根开 9.62、收 9.87，阳线实体 [9.62, 9.87]；第二根实体 [9.92, 9.93] 悬在 9.87 之上；第三根收 9.60，中点 =（9.62 + 9.87）÷ 2 = 9.745，失守成立。量能 20 万 ≥ 15.6 万，已确认。

<KLineChart :candles="esStar.candles" :markers="esStar.markers" title="黄昏之星（已确认）" />

全图只此一处。上涨段里识别器还一路报了 16 处红三兵——暮星的第一幕，常常正是兵群的尾巴。

应对与失效：出现在一段上涨之后、收复与量能双双过线时，常见的应对是收紧止盈、停止追加，把「涨势熄火」记为线索；失效条件：次日收盘收复第一根阳线实体的中点，熄火判读作废。量能不足的暮星同样降级为未确认，等一天再定。

## 红三兵与黑三鸦：趋势自己的缩影

红三兵（three white soldiers——三根开盘嵌在前根实体内、收盘逐根抬高的饱满阳线）的剧本里没有反转，只有推进。每天小步高开、稳稳收高：开盘嵌在前一根实体内，说明没有跳空抢跑；实体占各自振幅不低于 0.5，说明每天都是实体饱满的胜利。黑三鸦（three black crows——同一骨架的镜像，三根饱满阴线收盘逐根压低）倒着放一遍。

**晨星回答「跌完了吗」，红三兵回答「涨得顺不顺」。**前者是反转形态，先要有跌势可反转；后者是推进形态，三根 K 线本身就是趋势的缩影——所以它不设背景门，横盘里走出来照样命名。

跟算红三兵图（第 30 到 32 根）。三根收盘 10.15、10.31、10.48，逐根抬高；开盘 10.06 嵌在第一根实体 [9.98, 10.15] 内，10.23 嵌在 [10.06, 10.31] 内；实体占比 0.90、0.93、0.93。三兵成立，量能 10 万、12 万、14 万逐根温和放大。

<KLineChart :candles="soldiers.candles" :markers="soldiers.markers" title="红三兵" />

图上另有三处三兵命中。识别器的窗口逐日滑动——稳定上涨里，几乎每个三日窗口都是兵。

黑三鸦是同一副骨架倒着放：三根饱满阴线，开盘逐根嵌在前根实体内，收盘逐根压低。

<KLineChart :candles="crows.candles" :markers="crows.markers" title="黑三鸦" />

三根收盘 10.06、9.88、9.69，逐根压低；开盘 10.24、10.15、9.97 逐根嵌在前根实体内，实体占比都在 0.9 上下。注意量能 10 万、12 万、14 万逐根放大——鸦群推进配的是放量，不是缩量。

应对与失效：红三兵出现在低位或涨势初期、三根量能逐根温和放大时，常见的应对是把「推进健康」记为线索、顺势持有或等回踩介入；失效条件：次日收盘跌破第三根兵的开盘价，推进判读作废。黑三鸦镜像：出现在高位或跌势中，常见的应对是回避抄底；失效条件：次日收盘越过第三根鸦的开盘价。

## 红三兵受阻：推进撞上了墙

红三兵受阻（stalled pattern——三兵之后紧跟的一根高位小实体或长上影 K 线）是三兵的第四幕警告。剧本：三根兵照常推进，第四根开盘还在往上冲——开盘不低于第三根的收盘，姿态没变。但身子缩了：实体占自身振幅不超过 0.3，或者冲高被打回，上影达到实体的两倍。姿态与战果脱节：还想冲，冲不动了。**墙不是反转，是阻力第一次现形。**

跟算下图（第 29 到 32 根）。前三根收盘 9.55、9.70、9.85，是标准三兵。第四根开 9.86，高于第三根收盘 9.85——姿态还在。实体 [9.86, 9.88] 只有 0.02，占振幅 0.07 的 0.29，量缩到 8 万——受阻成立。

<KLineChart :candles="stalled.candles" :markers="stalled.markers" title="红三兵受阻" />

三兵与受阻，同图并存。识别器在第 31 根报三兵、第 32 根报受阻。这张图的上涨段里一共报了 13 处红三兵：稳定上涨几乎每个三日窗口都是兵，窗口逐日滑动。图上只标三兵与受阻两族。

应对与失效：受阻出现、且次日收盘跌破第四根的低点时，常见的应对是暂停追加、把止损上移到第三根兵的收盘；失效条件：次日放量收阳越过第四根的高点，撞墙判读作废，按推进重启对待。

## 三法：歇脚不折返

上升三法（rising three methods——「大阳线 + 缩在其影线范围内回撤的三根小实体 + 收回新高的阳线」的五根中继组合）是五幕剧。第一幕大阳立框：实体占比不低于 0.7，最高最低划出边界。中间三幕歇脚：每根的最高价不越框顶、最低价不破框底，实体不超过第一根的三分之一，收盘全部低于第一根的收盘——回撤发生在第一根战果之内，不出界。第五幕再启程：大阳收盘越过第一根的收盘，回撤被全额收复。下降三法（falling three methods——同一骨架的镜像：大阴立框、框内三根小回升、大阴杀回新低）倒着放。

三法与受阻是两种「停下来」。受阻是撞墙——第四根还想冲、冲不动，是坏消息；三法是歇脚——中间三根压根没想冲，缩在框内消化，是好消息。**中继形态要的不是新方向，是旧方向的续命证明。**它也与晨星划清界限：晨星的背景是反向的（下跌后收复），三法的背景是同向的（上涨中回撤再上涨）——识别器里两者共用大实体与三分之一的口径，分家分在背景门和第五根的位置上。

跟算上升三法图（第 28 到 32 根）。第一根开 9.35、收 9.59，大阳实体 0.24，框 [9.34, 9.61]。中间三根最高 9.57、9.52、9.47，全部不越框顶 9.61；最低 9.44、9.39、9.36，全部不破框底 9.34。实体 0.05、0.05、0.04，都远小于 0.24 的三分之一；收盘 9.50、9.45、9.41，全部低于第一根收盘 9.59。第五根开 9.40、收 9.64，大阳收盘越过 9.59，量能从 4 万跳回 17 万。歇脚缩量、启程放量——中继剧的呼吸。

<KLineChart :candles="rise3.candles" :markers="rise3.markers" title="上升三法" />

五根组合，一图全貌。框内三根小实体不出界、不放量，第五根一举收回——这就是「歇脚不折返」在数字上的样子。

<KLineChart :candles="fall3.candles" :markers="fall3.markers" title="下降三法" />

框 [10.59, 10.94]，第一根收 10.60。第一根开 10.93，大阴实体 0.33 占振幅 0.94。中间三根收盘 10.74、10.81、10.86，全部高于 10.60，高点不出框。第五根收 10.54，低于第一根收盘，杀回新低。中间三根形状像小阳兵，但实体占各自振幅不足 0.5，识别器不误报红三兵——测试里专门盯了这一条。

应对与失效：上升三法完成、且次日收盘守住第五根实体中点之上时，常见的应对是把「回撤健康」记为线索、继续持有原趋势仓位；失效条件：次日收盘跌破第一根大阳的开盘价，歇脚判读作废、按折返重估。下降三法镜像：反弹缩在框内、第五根杀回新低时，回避接飞刀；失效条件：次日收盘越过第一根大阴的开盘价。

## 渐进实验：先让中点线与量能线见红

老规矩，先写测试看红。本章测试审四件事：七种形态各归各位；晨星第三根收复幅度与量能的数值标准；干扰序列不误报；背景门两档。最要紧的两条都是边界。收复幅度那条：第一根大阴实体 [16.0, 17.0]，中点 16.5，星线与第三根照剧本摆好，只动第三根的收盘价——

```ts
// tests/multi-patterns-three.test.ts · 第三根收复幅度的硬边界
  it('第三根收复幅度的硬边界：收 16.51 判、收 16.50（恰好压在中点上）与 16.49 都不判', () => {
    const mk = (close: number) => detectThreeCandle([...FALLING, MS_FIRST, MS_STAR, { ...MS_THIRD, close }])
    expect(mk(16.51)).toEqual([hit('morning-star', 10, 'bull', 'falling', true)])
    expect(mk(16.5)).toEqual([])
    expect(mk(16.49)).toEqual([])
  })
```

样本取半元，中点 16.5 在浮点数里精确，压线测试不怕电子误差。量能线那条用同一组价格只改成交量：

```ts
// tests/multi-patterns-three.test.ts · 晨星的确认降级
  it('同一组价格、第三根量能不足：形态照判，但降级为「未确认」', () => {
    const weak = { ...MS_THIRD, volume: 100000 } // 10 万 < 前两根较大者 13 万的 1.2 倍
    expect(detectThreeCandle([...FALLING, MS_FIRST, MS_STAR, weak])).toEqual([
      hit('morning-star', 10, 'bull', 'falling', false),
    ])
  })
```

见红后实现。新文件 `src/patterns/three.ts`，复用第 3 章解剖器读实体、第 5 章窗口判背景，只增不改旧。判据常量七条，与正文一一对应：

```ts
// src/patterns/three.ts · 判据常量
/** 晨星/暮星的第一幕与三法的首尾幕必须是大实体（复用第 5 章「大」的口径） */
const LEAD_BODY_RATIO = 0.7
/** 星线的收缩上限：实体不超过第一根实体的三分之一（与孕线同款） */
const STAR_SHRINK = 1 / 3
/** 三兵/三鸦每根实体的最低占比：推进要有身子，纺锤不算兵 */
const MARCH_BODY_RATIO = 0.5
/** 受阻的第四根小实体边界：实体占自身振幅不超过该比例 */
const STALLED_BODY_RATIO = 0.3
/** 受阻的长上影口径：上影达到实体的该倍数（与第 5 章长影同款） */
const STALLED_WICK_VS_BODY = 2
/** 三法中间三根的实体上限：不超过第一根实体的三分之一 */
const METHODS_SHRINK = 1 / 3
/** 晨星/暮星第三幕的量能确认：第三根成交量须达到前两根较大者的该倍数 */
const CONFIRM_VOL_MULT = 1.2
```

主函数 `detectThreeCandle` 全貌。四组判据按三幕反转、三连推进、受阻、五幕中继展开。推进形态共用骨架函数 `isMarch`，它判三根同向、饱满、开盘嵌套、收盘递进。受阻在它的完成日前一天复用同一骨架——受阻的前三根就是三兵。

```ts
// src/patterns/three.ts · detectThreeCandle 全貌
export function detectThreeCandle(candles: readonly Candle[], opts: ThreeCandleOpts = {}): ThreeCandlePattern[] {
  if (!Array.isArray(candles) || candles.length === 0) {
    throw new Error('detectThreeCandle：candles 不能为空')
  }
  const lookback = opts.lookback ?? 5
  const out: ThreeCandlePattern[] = []
  // 完成日 i 最早是 lookback+2：三根形态的第一根（i-2）前面要放得下一个完整背景窗口
  for (let i = lookback + 2; i < candles.length; i++) {
    const cur = candles[i]
    const ca = candleAnatomy(cur) // 完成日永远过一遍解剖：非数字价格在这里被拦下
    const ctx = trendContext(candles, i - 2, { lookback, threshold: opts.threshold }) // 背景在形态之前结束

    // —— 三幕剧：晨星与暮星。第一幕大实体定战场，第二幕小实体星线悬在战场之外（脱离了才叫犹豫），
    // 第三幕收复（失守）第一根实体的中点——第 7 章的战线原封不动搬过来，当第三幕的及格线。 ——
    const first = candles[i - 2]
    const star = candles[i - 1]
    const fa = candleAnatomy(first)
    const sa = candleAnatomy(star)
    const firstTop = Math.max(first.open, first.close)
    const firstBottom = Math.min(first.open, first.close)
    const midpoint = (first.open + first.close) / 2 // 第一根实体的中点：第三幕收复幅度的刻度
    const starSmall = sa.body <= fa.body * STAR_SHRINK
    const confirmed = cur.volume >= CONFIRM_VOL_MULT * Math.max(first.volume, star.volume)

    if (
      ctx.position === 'falling' &&
      fa.direction === 'yin' &&
      fa.bodyRatio >= LEAD_BODY_RATIO &&
      starSmall &&
      Math.max(star.open, star.close) < firstBottom && // 星线悬在第一根实体之下
      ca.direction === 'yang' &&
      cur.close > midpoint // 收复过半：收不回中点的只是下跌中继里的反抽
    ) {
      out.push({ id: 'morning-star', index: i, direction: 'bull', position: ctx.position, confirmed })
    }
    if (
      ctx.position === 'rising' &&
      fa.direction === 'yang' &&
      fa.bodyRatio >= LEAD_BODY_RATIO &&
      starSmall &&
      Math.min(star.open, star.close) > firstTop && // 星线悬在第一根实体之上
      ca.direction === 'yin' &&
      cur.close < midpoint // 失守中点：跌不破中点的只是上涨途中的回调
    ) {
      out.push({ id: 'evening-star', index: i, direction: 'bear', position: ctx.position, confirmed })
    }

    // —— 三连推进：红三兵与黑三鸦。不设背景门——三根同向推进的 K 线就是自己的语境 ——
    if (isMarch(candles, i, 'yang')) {
      out.push({ id: 'three-white-soldiers', index: i, direction: 'bull', position: ctx.position })
    }
    if (isMarch(candles, i, 'yin')) {
      out.push({ id: 'three-black-crows', index: i, direction: 'bear', position: ctx.position })
    }

    // —— 受阻：三兵的第四幕警告。姿态还在冲（开盘不低于第三根收盘），身子却缩了（小实体）
    // 或被打回来了（长上影）——推进撞上了墙。四根一组，背景窗口得再往前挪一天，
    // 不能让三兵自己的第一根混进背景里。完成日最早 lookback+3。 ——
    if (i >= lookback + 3 && isMarch(candles, i - 1, 'yang')) {
      const third = candles[i - 1]
      const sCtx = trendContext(candles, i - 3, { lookback, threshold: opts.threshold })
      if (
        cur.open >= third.close &&
        (ca.bodyRatio <= STALLED_BODY_RATIO || ca.upperWick >= STALLED_WICK_VS_BODY * ca.body)
      ) {
        out.push({ id: 'stalled-pattern', index: i, direction: 'bear', position: sCtx.position })
      }
    }

    // —— 五幕剧：上升/下降三法。第一根大实体立框，中间三根小实体缩在框内回撤（歇脚），
    // 第五根大实体收回框外（再启程）——歇脚不折返。完成日最早 lookback+4。 ——
    if (i >= lookback + 4) {
      const lead = candles[i - 4]
      const la = candleAnatomy(lead)
      const mCtx = trendContext(candles, i - 4, { lookback, threshold: opts.threshold }) // 中继要有可中继的趋势
      const middles = [candles[i - 3], candles[i - 2], candles[i - 1]]
      const boxed = (m: Candle, away: 'below' | 'above'): boolean =>
        m.high <= lead.high &&
        m.low >= lead.low &&
        candleAnatomy(m).body <= la.body * METHODS_SHRINK &&
        (away === 'below' ? m.close < lead.close : m.close > lead.close)
      if (
        mCtx.position === 'rising' &&
        la.direction === 'yang' &&
        la.bodyRatio >= LEAD_BODY_RATIO &&
        middles.every((m) => boxed(m, 'below')) &&
        ca.direction === 'yang' &&
        ca.bodyRatio >= LEAD_BODY_RATIO &&
        cur.close > lead.close // 收回第一根的收盘之上：回撤被全额收复
      ) {
        out.push({ id: 'rising-three-methods', index: i, direction: 'bull', position: mCtx.position })
      }
      if (
        mCtx.position === 'falling' &&
        la.direction === 'yin' &&
        la.bodyRatio >= LEAD_BODY_RATIO &&
        middles.every((m) => boxed(m, 'above')) &&
        ca.direction === 'yin' &&
        ca.bodyRatio >= LEAD_BODY_RATIO &&
        cur.close < lead.close
      ) {
        out.push({ id: 'falling-three-methods', index: i, direction: 'bear', position: mCtx.position })
      }
    }
  }
  return out
}
```

受阻分支里那行「背景窗口得再往前挪一天」不是注释装饰。测试先抓住了这个 bug：四根一组若沿用三根的背景窗，三兵的第一根会混进背景里，把横盘背景顶成「上涨」。写「红」测试的价值就在这——它替你看着你没想到的地方。

图表数据照旧出自 `export-docs` 脚本。多根样本整段植入：第一根定锚（形态前一晚收盘）与尺（形态之前五根的平均振幅），后续每根按剧本推进。样本工厂 `morningShapes(b, r)` 按锚与尺量产三根——大阴 13 万量、星线 9 万、收复阳线 20 万，判据余量全部相对 r 留足。晨星对照样本刻意让两张图共用同一组价格，只差第三根的量：

```ts
// companion/scripts/export-docs-data.ts · 晨星对照的两张图
// 晨星对照：两张图的三根价格逐字一致，只有第三根的量不同——收复照旧、量能掉链子
const morningBase = plantShape(ch8(801, -0.02), AT8 - 2, morningShapes)
const morningSeries = morningBase
const morningWeakSeries = morningBase.map((c, i) => (i === AT8 ? { ...c, volume: 100000 } : c))
```

简化之处照实声明。反转剧的阈值——首根大实体 0.7、星线收缩三分之一、收复过中点、量能 1.2 倍——是本课程的操作化选择。推进与中继的阈值——三兵实体 0.5、受阻小实体 0.3 或上影两倍、三法中间三分之一、回看五根、背景 5%——同样。晨星与暮星不要求真正的向下跳空缺口，用「星线实体脱离第一根实体」的实体版代替，因为 A 股日内缺口少。三兵与三鸦不设背景门，教科书多强调出现在底部或顶部。受阻只认「高开于第三根收盘之上」一种姿态。三法的中间三根只框高低不框实体，方向不限阴阳。量能只进晨星与暮星的确认层，其余形态不查量。全部差异登记在附录差异清单。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：113 项全绿，其中 26 项是本章新增。覆盖面：七种形态的判定，含方向与背景。晨星收复幅度的中点边界（压线不判）与量能降级。三兵的开盘嵌套与实体饱满边界。受阻的小实体与长上影两条路，低开与放量长阳两种干扰。三法的出框与收不回两种干扰，框内小阴阳不冒充鸦兵。背景门两档。随机序列扫描与非法输入报错。

再开机一次。

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加四行：晨星对照两张图的第 32 根同一组价格，20 万判「已确认」、10 万降级「早晨之星·未确认」，量能线是前两根较大者 13 万的 1.2 倍。暮星、三兵、三鸦各就各位。受阻图第 31、32 根三兵与受阻并存。三法在第 32 根完成五根组合。`docs/assets/data/` 下多出八个 `08-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体：打开行情软件，找一段你疑心是晨星的下跌，抄下三根 K 线的数字，算两笔账。第一笔收复幅度：（第三根收盘 − 第一根实体底端）÷ 第一根实体长度，过没过 50%。第二笔量能比：第三根成交量 ÷ 前两根中较大者，过没过 1.2。再补一眼背景：形态之前五根收盘的跌幅够不够 5%。三笔算完，这个「晨星」是真晨星、未确认、还是下跌中继里的反抽，纸上就有答案。

## 小结

- 三根以上才演得成完整的戏：晨星暮星是三幕反转剧，三兵三鸦是三连推进，受阻是三兵的第四幕警告，三法是五幕中继剧。
- 晨星把第 6 章的「次日确认」装进了形态内部：第二幕是犹豫，第三幕是新证据。确认有两条数值线——收复过第一根实体中点（硬判据，压线不判）、量能达到前两根较大者的 1.2 倍（不足则降级为未确认）。
- 反转与推进的分家在背景门：晨星要「之前跌过」，三兵不要背景——它自己就是趋势的缩影。
- 受阻与三法是两种「停下来」：撞墙是坏消息，歇脚是好消息；三法与晨星共用大实体与三分之一的口径，分家分在背景方向与第五根的位置。
- 七条应对句式全部是条件句并带失效条件；这些线索到底多可靠，第 9 章用统计逐一验货。

读完本章，你应该能回答：

1. 第一根大阴实体 [9.90, 10.24]、星线悬空合格，第三根收 10.07——晨星判不判？收 10.06 呢？先算中点。
2. 同一组晨星价格，第三根量 10 万、前两根较大者 13 万——形态判不判？确认状态是什么？
3. 红三兵的第二根开盘跳到第一根实体之下，为什么不算？这条判据挡的是什么走法？
4. 上升三法中间的三根小阴线，形状像一小队乌鸦——识别器为什么不报黑三鸦？差在哪个数上？

去向一句话：第 9 章停下扩张形态字典，用胜率、样本量与随机对照，给前四章攒下的三十种形态逐一验货。
