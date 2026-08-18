---
title: 单根K线（下）：十字星家族与「不讲道理」的一字线
---

# 单根K线（下）：十字星家族与「不讲道理」的一字线

<script setup>
// 本章七张图的数据，全部来自实验场 export-docs 脚本对识别器 classifyDoji 的真实扫描。
import doji from './assets/data/06-doji.json'
// 横盘段第 31 根植入的普通十字星。
import longLegged from './assets/data/06-long-legged.json'
// 上涨段第 31 根的长腿十字。
import dragonfly from './assets/data/06-dragonfly.json'
// 下跌段第 31 根的蜻蜓线。
import gravestone from './assets/data/06-gravestone.json'
// 上涨段第 31 根的墓碑线。
import spinning from './assets/data/06-spinning.json'
// 横盘段第 31 根的纺锤线。
import fourPrice from './assets/data/06-four-price.json'
// 阴跌末段连续两个一字跌停。
import confirm from './assets/data/06-confirm.json'
// 第 30 根十字星、第 31 根大阳线：次日确认的最小样本。
</script>

四月中，你持仓的票从 14 块一路阴跌到 11 块。某个收盘，图上走出一根十字星（doji——开盘价与收盘价几乎重合、只剩上下影线的 K 线，因形似「十」字得名）。群里立刻有人喊：「经典变盘信号！多空决出胜负就在明天，大反弹。」你把留着补仓的钱一次性满仓压了进去，赌的就是这个反转。第二天开盘跳低，尾盘直接阴线破位——当天你盯着跌势想认输砍仓，T+1 说这批股票今天还不归你卖，连挂单的资格都要等到明天。

复盘时两件事同时成立。那根确实是教科书级的十字星：开 11.02、收 11.00，实体占振幅不到 3%，判据一条不差；亏钱的下单也确实是你亲手点的。**形状没有骗人，骗人的是把「犹豫」读成了「路标」。**第 5 章的坑是量错了形状，这一章的坑更深一层：形状量对了，含义读反了。这一章给十字星全家写出数值判据，再把每种的剧本、犹豫程度和带失效条件的应对句式讲清楚。核心只有一句话：十字星记录的是一场平局，而平局里没有下一场的结果。

## 平局也是一种结局：这个家族在量什么

先回到第 3 章的读数：实体是开盘到收盘的距离，当天的净战果。大阳线是净战果为正且悬殊，大阴线镜像。那净战果约等于零呢？多空打了一整天，收盘时谁也没压倒谁——这就是十字星家族的地盘。第 5 章把实体占振幅 5% 以上的形状分给了影线族，本章接管剩下的一切：实体占比不超过 5%，归这里；超过 5%，归锤子与射击之星们。两章互补，中间不留缝。

这个家族的每个成员都是「犹豫」的一种具体形状。三问可以拆开看：谁在犹豫——买卖双方都在场，谁也压不倒谁；为什么算犹豫——实体是净战果，实体趋零说明全天攻防互相抵消；影线方向透露什么——战场偏向哪一侧、哪一侧被实测过：长下影说明下方砸下去又被买回，长上影说明上方冲上去又被砸回。六名成员先混个脸熟：

- 普通十字星——开收打平、两条腿均分全天战场的标准平局。
- 长腿十字——上下影都特别长的十字星：巨大的分歧，两边各被推翻过一次。
- 蜻蜓线——开收贴着最高点的长下影十字：全天砸下去又被全额买回。
- 墓碑线——开收贴着最低点的长上影十字：冲高的买盘全军覆没。
- 纺锤线——实体影线都小的 K 线：多空都无意恋战，市场在打盹。
- 一字线——开、高、低、收四个价格合成一个价格的 K 线：想买买不到、想卖卖不掉。

识别器给每个成员附一份犹豫程度分级：纺锤线是「打盹」，普通十字、蜻蜓线、墓碑线是「打平」，长腿十字是「撕裂」。一字线特殊——它根本不在犹豫刻度上，后面单讲。

## 普通十字星：净战果为零的那一天

剧本：开盘哨响，多方推一段，空头压一段，来回拉锯。盘中也许冲出过高点、也砸出过低点，但收盘价落回开盘价附近。全天不是没有战斗——影线就是战斗的痕迹——而是战斗的净效果归零。

数值判据：实体占振幅不超过 5%，整根 K 线的个头不温不火（通常两腿大致均分战场，但均分不是判据——排除掉后面五种特殊形状之后剩下的都是它，它是这个家族的兜底类）。看本章第一张图：横盘行情第 31 根。跟着算一遍：开 9.74、收 9.74（实体为 0），高 9.83、低 9.65，上影 0.09、下影 0.09，各占振幅 0.18 元的 50%。再看个头：它之前五根 K 线的平均振幅约 0.23 元，这根占 0.78 倍——既没缩水到一半以下，也没追过 1.2 倍。普通十字星，犹豫程度「打平」。

<KLineChart :candles="doji.candles" :markers="doji.markers" title="横盘段的普通十字星" />

全图只命中这一处，标记是识别器算的。应对与失效：出现普通十字星、且它落在一段已有趋势之中时，常见的应对是把仓位和止损原样留到明天。这根 K 线不构成任何新动作的理由。失效条件：次日收出实体饱满的方向 K 线，观望状态结束，按新证据重新评估。开章那笔满仓，错不在认出十字星，错在把「不构成理由」读成了「构成反向理由」。

## 长腿十字：「长」不在图上，在比较里

剧本：这是普通十字的激烈版。多方先冲出一段新高，被打回；空头再砸出一段新低，又被买回。两边各被推翻一次，收盘回到起点。分歧大到什么程度？大到双方都亮过底牌，还是没分出胜负。

数值判据里藏着本章的第一个新道理：**「长腿」的「长」没法在这根 K 线自己身上定义。**第 4 章证明过纵轴缩放会骗眼睛；同理，振幅 0.42 元在低价股上巨大、在高价股上微小。唯一的公平尺子是近邻：形态之前五根 K 线的平均振幅（实验场里叫 avgRange，参照振幅）。判据：振幅不低于参照尺的 1.2 倍，且两条腿各占振幅三成以上——缺一条腿的只是单向试探，不叫分歧。

跟算图里的样本：开 10.07、收 10.07，高 10.28、低 9.86，振幅 0.42 元，两腿各 0.21 元、各占 50%。参照尺：之前五根平均振幅 0.26 元。0.42 ÷ 0.26 ≈ 1.6 倍，追过了 1.2 倍的门槛，长腿十字成立，犹豫程度「撕裂」。

<KLineChart :candles="longLegged.candles" :markers="longLegged.markers" title="上涨段的长腿十字" />

全图只此一处。应对与失效：出现长腿十字、且此前是一段不少于 5% 的单边行情时，常见的应对是只减不加。防守位收到长腿十字的中心价附近——分歧已被实测，不站在任何一边。失效条件：次日收盘越过长腿十字的最高价或最低价，分歧判读作废，按突破方向重估。

## 蜻蜓线与墓碑线：贴边的平局，影线指认战场

蜻蜓线的剧本：开盘后价格一路走低，最深时砸出一个大坑；尾盘买方发力，不但收复失地，还把收盘价顶回开盘价——而开盘价恰好就是全天最高点。开、收、高三价合一，全天只剩一条向下的长影。这条影线透露的东西很具体：**下方那个价位今天被真实地测试过——有人砸到那里，也有人把砸下来的全部接走。**它是承接的实弹记录，不是承诺。

墓碑线是蜻蜓的镜子：开盘即全天最低点，价格冲高一段，收盘又跌回开盘价——冲上去的买盘全军覆没，只剩一条向上的长影立在头顶。它透露的同样具体：上方那个价位今天被真实地测试过，抛压把冲锋全额打了回来。

数值判据：开收贴边一侧的影线占振幅不超过 5%，另一侧的主导影线撑起八成以上。跟算蜻蜓样本：开 10.10、收 10.10、高 10.10，低 9.74——上影为 0，下影 0.36 元占振幅的 100%。墓碑样本镜像：开 10.31、收 10.31、低 10.31，高 10.67，上影占 100%。两根的犹豫程度都是「打平」——注意，不是偏多偏空：收盘时依然是平局，影线只指认战场在哪一侧。

<KLineChart :candles="dragonfly.candles" :markers="dragonfly.markers" title="下跌段的蜻蜓线" />

下跌段第 31 根。

<KLineChart :candles="gravestone.candles" :markers="gravestone.markers" title="上涨段的墓碑线" />

上涨段第 31 根。

应对与失效：蜻蜓线出现在一段不少于 5% 的下跌之后、且次日收盘高于蜻蜓线最高价时，常见的应对是把「下方有承接」记为一条线索，等回踩再考虑介入，不当天追；失效条件：次日收盘跌破蜻蜓线最低价，承接判读作废。墓碑线出现在一段不少于 5% 的上涨之后、且次日收盘收在墓碑线的开收盘价之下时，常见的应对是收紧止盈、停止追加；失效条件：次日放量收阳、收复整条上影，抛压判读作废。

## 纺锤线：连犹豫都懒得犹豫

剧本：开盘、收盘几乎同价，但全天高低点也挤在一点点区间里。不是打成平局，是压根没怎么打——买卖双方都无意恋战，成交清淡，市场在打盹。它常出现在趋势中途：歇脚，不改方向。

数值判据回到参照尺：整根振幅缩到之前五根平均振幅的一半以下。跟算：样本开 9.69、收 9.69，高 9.73、低 9.65，振幅 0.08 元；参照尺 0.20 元，0.08 ÷ 0.20 = 0.4 倍，缩水过半，纺锤线成立，犹豫程度「打盹」。

<KLineChart :candles="spinning.candles" :markers="spinning.markers" title="横盘段的纺锤线" />

全图同样只命中这一处。应对与失效：出现纺锤线时，常见的应对是什么都不做——它不含方向信息，硬读就是赌。失效条件：次日走出放量的方向 K 线，「无信息」状态结束，按新 K 线评估。把纺锤线当十字星去赌变盘，等于把打盹的人当成了正在拔剑的人。

## 一字线：家族里「不讲道理」的成员

第 2 章那个早晨你还记得：持仓股晚间暴雷，第二天一字跌停——开盘就封死在跌停价，全天没有打开。把那天的四个价格抄下来：开 = 高 = 低 = 收。这就是一字线，四价合一，图上只剩一横。

它为什么「不讲道理」？因为其他五种十字好歹记录了一场战斗，而一字线记录的是战斗没有发生。想买的排队买不到，想卖的排队卖不掉——价格锁死，成交稀少。**它不是犹豫的极致，它是犹豫刻度的出局者。**所以识别器给它单独的标记：犹豫程度记「锁死」，另附一份涨跌停语境的核对——四价合一最常见的原因是涨跌停，但代码不该假设，要用昨收算一遍。

核对算式（交易所口径：昨收 ×（1 ± 涨跌幅），四舍五入到分）：图里第 30 根收盘 9.84 元，9.84 × 0.9 = 8.856，四舍五入到分是 8.86——第 31 根恰好四价合一在 8.86，贴着跌停价，判「一字跌停」。第二天再来一根：8.86 × 0.9 = 7.974，四舍五入 7.97，第 32 根又封在 7.97。连续两个一字跌停，正是第 2 章排队故事的图形版。这套核对在实验场里就是 `verdictAtLimit` 的全部实现：

```ts
// src/patterns/doji.ts · 一字线的涨跌停核对
/** 交易所口径的边界价：昨收 ×（1±涨跌幅），四舍五入到分 */
const limitPrice = (prevClose: number, ratio: number, sign: 1 | -1): number =>
  Math.round(prevClose * (1 + sign * ratio) * 100) / 100

/** 一字线的涨跌停核对：四价合一的那个价格是否恰好贴在边界价上 */
function verdictAtLimit(price: number, prevClose: number, ratio: number): LimitVerdict {
  if (price === limitPrice(prevClose, ratio, 1)) return 'limit-up'
  if (price === limitPrice(prevClose, ratio, -1)) return 'limit-down'
  return 'none'
}
```

<KLineChart :candles="fourPrice.candles" :markers="fourPrice.markers" title="阴跌末段的连续一字跌停" />

标记皆非手标。应对与失效：持仓里出现一字跌停时，常见的应对是按跌停价挂单排队，并接受可能卖不掉的现实。同时回头检讨仓位——单笔仓位应压到「连续三个一字跌停也伤不了根本」，这是第 2 章立下的法则。失效条件：盘中封单打开、成交放大，锁死解除，按正常盘面重新评估。反向的一字涨停同理：追涨停排队的买单同样可能全天不成交，那不是犹豫，是在赌次日惯性。

## 为什么十字星要等次日确认：一次推演

教科书都写「十字星需要次日确认」。把它当口诀背，和把它推演出来，是两种理解。推演从定义出发：十字星的净战果为零——今天收盘时，多空谁也没赢。那么「变盘」往哪边变？这个问题今天的 K 线在原理上就无法回答：答案发生在明天，由明天的买卖力量写。

再看趋势这边的逻辑：趋势的燃料是一方持续控盘。十字星说明这股燃料今天中断了。中断之后有两种走向——换挡（反向）或歇脚（原方向继续）。区分两者的第一个可观察证据就是次日：次日收出实体饱满、方向明确的 K 线并越过十字星的高点或低点，说明一方接管了；次日还是小实体，说明犹豫仍在继续。所以「需要确认」不是玄学规定，是推理的必然：**十字星是一张只有上半场的记分牌，下半场在明天。**

看最后一张图：第 30 根十字星（开 10.76、收 10.76、高 10.85、低 10.67），第 31 根收出大阳线——开 10.76、收 10.96，收盘越过十字星最高价 10.85。两个识别器同图各标各的：十字星归本章，大阳线归第 5 章。第 33 根又出现一根纺锤线，识别器照实标记——确认之后市场照样会歇脚，识别器不编故事。

<KLineChart :candles="confirm.candles" :markers="confirm.markers" title="十字星与次日的大阳线确认" />

下半场这才开赛。应对句式由此成形：出现十字星、且次日收盘越过高点收阳时，常见的应对是把「多方接管」记为线索，等回踩考虑介入。失效条件：随后收盘跌回十字星最低价之下，接管判读作废。反向镜像同理。若次日仍是无方向的小实体，那就继续等——等待也是应对的一种。这些两根 K 线的组合读法，第 7 章按吞没、孕线等剧本逐一展开。

## 渐进实验：把「比较」写进判定

老规矩，先写测试看红。本章测试要审三个命题：六种样本各归各位；「长」与「缩」必须在比较里；一字线的涨跌停语境用昨收核对。第一个命题里最要紧的一条——同一形状，参照尺换，名字换：

```ts
// tests/single-patterns-doji.test.ts · 「长」在比较里
  it('同一组 0.50/0.50 双腿数字：参照尺 1.5 时是普通十字，参照尺 0.5 时是长腿十字', () => {
    expect(classifyDoji(sameShape, dctx(1.5))?.kind).toBe('doji')
    expect(classifyDoji(sameShape, dctx(0.5))?.kind).toBe('long-legged')
  })
```

第三个命题的直白版——昨收一换，语境就换：

```ts
// tests/single-patterns-doji.test.ts · 一字线的涨跌停语境
  it('昨收 10 元、边界 10%：9.00 的一字是跌停，11.00 的一字是涨停', () => {
    expect(classifyDoji(c(9.0, 9.0, 9.0, 9.0), dctx(1.0, 'flat', 10.0))?.limit).toBe('limit-down')
    expect(classifyDoji(c(11.0, 11.0, 11.0, 11.0), dctx(1.0, 'flat', 10.0))?.limit).toBe('limit-up')
  })
```

实现分两步。第一步把参照尺量出来：`dojiContext` 在第 5 章 `trendContext` 的同一窗口上多算一个平均振幅、多取一个昨收。涨跌幅边界按圣经纪律不硬编码成「真理」，作为参数传入（默认取写作时的主板口径）。

```ts
// src/patterns/doji.ts · dojiContext：窗口复用第 5 章，另量参照振幅与昨收
export function dojiContext(candles: readonly Candle[], index: number, opts: DojiContextOpts = {}): DojiContext {
  const lookback = opts.lookback ?? 5
  const limitRatio = opts.limitRatio ?? 0.1
  if (!Number.isFinite(limitRatio) || !(limitRatio > 0) || !(limitRatio < 1)) {
    throw new Error(`dojiContext：limitRatio 必须是 0 与 1 之间的比例（主板 0.1、创业板 0.2），收到的是 ${limitRatio}`)
  }
  const base = trendContext(candles, index, { lookback, threshold: opts.threshold }) // 窗口与守门全部复用第 5 章
  let sum = 0
  for (let i = index - lookback; i < index; i++) sum += candles[i].high - candles[i].low
  const prevClose = candles[index - 1].close
  if (!Number.isFinite(prevClose) || !(prevClose > 0)) {
    throw new Error(`dojiContext：前一根K线的收盘价必须是正的有限数字，收到的是 ${prevClose}`)
  }
  return { ...base, avgRange: sum / lookback, prevClose, limitRatio }
}
```

第二步是本章主函数。六条判据先写成常量，判据与叙述一一对应：

```ts
// src/patterns/doji.ts · 六条数值判据
/** 家族边界：实体占振幅不超过该比例归十字星家族（第 5 章影线族取 >5%，两章互补） */
const DOJI_BODY_RATIO = 0.05
/** 蜻蜓/墓碑「贴边」的容差：贴边一侧的影线占振幅不超过该比例 */
const EDGE_WICK_RATIO = 0.05
/** 蜻蜓/墓碑的主导影线占振幅下限：另一侧的腿至少撑起八成战场 */
const LEG_WICK_RATIO = 0.8
/** 长腿十字的两条腿各占振幅下限：缺一条腿的只是单向试探 */
const LONG_LEG_SHARE = 0.3
/** 长腿十字的振幅相对参照尺的倍数下限：追平不算长，要明显长过日常 */
const LONG_RANGE_MULT = 1.2
/** 纺锤线的振幅相对参照尺的倍数上限：缩到日常一半以下才算打盹 */
const SHRINK_RANGE_MULT = 0.5
```

`classifyDoji` 全貌。判定次序就是教学次序：先认四价合一，再认贴边形状，再量大小，剩下的才是普通十字——形状优先于大小，大小必须参照近邻。不属于本家族（实体占比超过 5%）返回 null，交回调用方去找第 5 章的家族：

```ts
// src/patterns/doji.ts · classifyDoji 全貌
export function classifyDoji(c: Candle, context: DojiContext): DojiResult | null {
  if (!context || !POSITIONS.includes(context.position)) {
    throw new Error(`classifyDoji：context.position 必须是 falling/rising/flat 之一，收到的是 ${context?.position}`)
  }
  if (!Number.isFinite(context.avgRange) || context.avgRange < 0) {
    throw new Error(`classifyDoji：avgRange（参照振幅）必须是不为负的有限数字，收到的是 ${context.avgRange}`)
  }
  if (!Number.isFinite(context.limitRatio) || !(context.limitRatio > 0) || !(context.limitRatio < 1)) {
    throw new Error(`classifyDoji：limitRatio 必须是 0 与 1 之间的比例，收到的是 ${context.limitRatio}`)
  }
  const a = candleAnatomy(c) // 四价守门与实体/影线读数复用第 3 章的解剖器

  // —— 一字线：四价合一，振幅为零。它不是犹豫的极致，是犹豫刻度的出局者——
  // 全天只在一个价位成交，多空根本没交上手；最常见的成因是一字涨停/跌停（排队锁死），
  // 但是否贴着边界要用昨收核对，代码不假设。
  if (a.range === 0) {
    return {
      kind: 'four-price',
      hesitation: 'locked',
      limit: verdictAtLimit(c.close, context.prevClose, context.limitRatio),
    }
  }
  if (a.bodyRatio > DOJI_BODY_RATIO) return null // 有身子的K线归第 5 章影线族

  // —— 贴边的两个形状：开收贴着当天的一端，另一端的影线撑起八成以上战场 ——
  if (a.upperWickRatio <= EDGE_WICK_RATIO && a.lowerWickRatio >= LEG_WICK_RATIO) {
    return { kind: 'dragonfly', hesitation: 'tied' }
  }
  if (a.lowerWickRatio <= EDGE_WICK_RATIO && a.upperWickRatio >= LEG_WICK_RATIO) {
    return { kind: 'gravestone', hesitation: 'tied' }
  }

  // —— 大小两档：与之前五根的平均振幅比。同一形状，参照尺换，名字换 ——
  if (a.range >= LONG_RANGE_MULT * context.avgRange && a.upperWickRatio >= LONG_LEG_SHARE && a.lowerWickRatio >= LONG_LEG_SHARE) {
    return { kind: 'long-legged', hesitation: 'torn' }
  }
  if (a.range <= SHRINK_RANGE_MULT * context.avgRange) {
    return { kind: 'spinning-top', hesitation: 'dozing' }
  }
  return { kind: 'doji', hesitation: 'tied' }
}
```

次序有没有承担实质判定？有测试盯着：巨大的单向长影仍判蜻蜓，不会被「振幅大」抢成长腿十字。

```ts
// tests/single-patterns-doji.test.ts · 形状先于大小
  it('形状先于大小：巨大的单向长影仍判蜻蜓，不会被「振幅大」抢成长腿十字', () => {
    const hugeDragonfly = c(10.0, 10.0, 8.2, 10.0) // 振幅 1.80，全部在下影
    expect(classifyDoji(hugeDragonfly, dctx(0.5))?.kind).toBe('dragonfly')
  })
```

与第 5 章的分界用一对边界测试钉死——实体恰占振幅 5% 归本章、影线族不给名字；占到 6% 就换回锤子：

```ts
// tests/single-patterns-doji.test.ts · 与第 5 章的分界
  it('实体恰占振幅 5%：归十字星家族（普通十字），影线族不给名字', () => {
    const edge = c(9.9, 10.4, 9.4, 9.95) // 实体 0.05、振幅 1.00，占比恰 5%
    expect(classifyDoji(edge, dctx(1.5))?.kind).toBe('doji')
    expect(classifyWicks(edge, { position: 'falling', change: -0.06, bars: 5 })).toEqual([])
  })

  it('实体占 6%：归第 5 章（下跌背景判锤子），十字星家族退回 null', () => {
    const edge = c(10.0, 10.1, 9.5, 10.06) // 实体 0.06、振幅 0.60、下影 0.50
    expect(classifyDoji(edge, dctx(1.0))).toBeNull()
    expect(classifyWicks(edge, { position: 'falling', change: -0.06, bars: 5 })).toEqual(['hammer'])
  })
```

图表数据照旧出自 `export-docs` 脚本：五张形态图的样本全部以前一根收盘为锚、以植入处的参照振幅为尺构造（普通 0.4 倍、长腿 0.8 倍、贴边 1.5 倍、纺锤 0.2 倍），保证判据余量。一字跌停那张最讲究——跌停价按交易所口径算出来，连续封两天：

```ts
// companion/scripts/export-docs-data.ts · 连续两个一字跌停的构造（拼版：构造行与守门行来自脚本不同段，中间是确认图的构造与 expectDojiAt 守门）
const fallingF = driftSeries(createRng(606), { days: 32, startPrice: 18.4, drift: -0.02, vol: 0.009 })
const fpSeries = plantAt(plantAt(fallingF, 30, mkLimitDown(fallingF, 30)), 31, mkLimitDown(plantAt(fallingF, 30, mkLimitDown(fallingF, 30)), 31))

for (const i of [30, 31]) {
  const r = classifyDoji(fpSeries[i], dojiContext(fpSeries, i))
  if (r?.limit !== 'limit-down') {
    throw new Error(`第 ${i + 1} 根一字的涨跌停语境是 ${r?.limit}（期望 limit-down）——核对昨收与边界价`)
  }
}
```

简化之处照实声明：全部阈值（家族边界 5%、贴边容差 5%、主导腿八成、双腿三成、1.2 倍与 0.5 倍、回看五根）是本课程的操作化选择；一字线语境默认主板 10% 口径，创业板、科创板、北交所要显式传参；不检查教科书常提的「十字星次日跳空高开低开」的细分支。全部差异登记在附录差异清单。

## 验证：两道门槛与亲手开机

`cd companion` 后跑 `npm run typecheck`：无输出即通过。再跑 `npm test`：64 项全绿，其中 19 项是本章新增——覆盖六种形态的判定、「长」在比较里、犹豫程度的排序、一字线语境的核对（含四舍五入到分的边界案例）、与第 5 章分界的边界测试。

再开机一次：

```bash
cd companion
npm run export-docs
```

终端在旧摘要之后追加三行：五张形态图的第 31 根各自判定与全序列命中数（每图恰好 1 处，就是植入样本）；一字图第 31、32 根的连续跌停判定；确认图两识别器的分工。`docs/assets/data/` 下多出七个 `06-*.json`。再跑一遍，一个字节都不变。

不进实验仓也有载体：打开行情软件，找一根你当过「变盘信号」的十字星，抄下四价和之前五根的高低点，算四笔账。第一笔：实体 ÷ 振幅，超过 5% 不归这个家族；第二笔：两条影线的分配，一侧贴边且另一侧撑起八成以上，是蜻蜓或墓碑；第三笔：振幅 ÷ 前五根平均振幅，低于一半是纺锤、追过 1.2 倍是长腿；第四笔（若是一字线）：昨收 × 0.9 与 × 1.1 各四舍五入到分，对上哪个数才叫贴边。四笔算完，「变盘信号」四个字就不见了，剩下的是一根有具体形状与犹豫程度的平局。

## 小结

- 十字星家族的地盘是实体占比 ≤5%，与第 5 章影线族互补不留缝；六种名字是犹豫的六种具体形状，谁犹豫、为什么算犹豫、影线往哪边，每根都答得出来。
- 「长」与「缩」不在 K 线自己身上，在与前五根平均振幅的比较里——同一形状，参照尺换，名字换。
- 犹豫程度三级：打盹（纺锤）＜ 打平（普通、蜻蜓、墓碑）＜ 撕裂（长腿）；一字线不在刻度上——四价合一是锁死，语境要用昨收按交易所口径核对。
- 十字星是只有上半场的记分牌，方向写在次日的 K 线上——「需要确认」是推演，不是口诀。每条应对都是条件句并带失效条件；这些线索到底多可靠，第 9 章用统计逐一验货。

读完本章，你应该能回答：

1. 开 11.02、高 11.30、低 10.70、收 11.00，之前五根平均振幅 0.55 元——这根 K 线叫什么名字、犹豫程度几级？
2. 同一组双腿均分的数字，什么条件下判长腿十字、什么条件下判普通十字？判据的哪一部分不在 K 线自己身上？
3. 昨收 9.84 元、主板 10% 边界，一根四价合一在 8.86 元的 K 线贴的是什么？写出核对算式。
4. 「十字星需要次日确认」为什么可以从定义推出来，而不必当成教科书的规定？

去向一句话：第 7 章把镜头从单根拉到两根——吞没、乌云盖顶、刺透、孕线与十字孕线：平局之后的故事，要用组合才能讲全。
