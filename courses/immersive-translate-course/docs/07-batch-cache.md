---
title: 批量、去重与缓存：翻译的经济学
---

# 批量、去重与缓存：翻译的经济学

## 上章留下的问题

第 6 章收尾时，额度账清了一半：`mainContentOnly: true` 开着链接密度与文字密度这套启发式认正文，全页 14 个可译块收成 10 个，站点名和侧栏出局。可计数翻译器的账本上还趴着另一半——10 块 10 单，一块一单的形状一个字没动。还记得第 4 章管线组装立 Translator 接口时留的那句话吗？「接口收一批、引擎发一单」——这个落差的账，说好本章细算。还有 demo:engine 第二幕那行 `1 + 1 + 1 + …`，十四个 1 排成一排，也该有个说法了。

## 一份 429，一张 30 次的账单

引擎第一次跑在一个大页面上，两件事同时发生。页面有 200 个段落，管线串行一块一单：一单等一单的回包，渲染慢——页面十秒才见底。你顺手把循环改成全并发，服务端立刻回敬 429（HTTP 状态码，意思是「请求太频了，拒收」，限流的正式手段）。慢也不行、快也不行。第二件事更隐蔽：这是个商品列表页，30 张卡片写着同一句 Add to cart——重复请求发了 30 次，月底账单一看，同一句话重复付费 30 次。

这不是一个 bug，是三笔从来没算过的账。**往返的账**：一单只装一条，200 段就是 200 次网络往返，每次往返的固定开销全由一条文本独扛。**重复的账**：同一轮里相同的句子各发各的，谁也不认识谁。**跨轮的账**：翻过的页面再来一遍，从头再付。本章给三笔账各上一道工序——打包、去重、缓存，再加一道保险：并发上限。四道工序做完，双语对照页的账单重算。

## 同时最多 N 个：柜台叫号

先把第四道工序的原理讲透——它是四道里唯一一个「不做会出事」的：另外三道省的是钱，这道防的是 429。

你可能会想：这不就是 `Promise.all` 吗？把 200 个请求全交给它，一起发不就完了？恰恰是这一步踩雷。`Promise.all` 只承诺「等全部完成」，不承诺「同时几个在飞」——何况派发的动作根本不归它管：你把 200 个请求一口气全创建出来交给它（map 一执行，请求就都发车了），它只负责等齐，没有人替你数窗口。服务端看到的瞬间流量是 200 并发，限流器看到的就是一次攻击。反事实做完了：不限并发不行。反过来串行（一次一单）倒是永远安全，但一条往返的延迟乘 200，就是开篇那十秒。

所以要的东西很具体：**同时最多 N 个请求在飞，超出的排队等待**——这个容量闸门叫并发上限（concurrency limit）。你在银行办过业务就认识它：窗口就 N 个，进门先取号，叫到才办；一个窗口空出来，队头补位。取号的人不围着柜台挤，柜台也永远不空转。

它怎么用一本账和一支队实现？在飞数记一本账（active），等发车的动作排一支队（queue）：

```text
窗口 2，提交 t1..t6（「落定」＝成功或失败都算办完）：

时刻    动作             在飞      队伍
提交 t1  账 0<2 → 发车    [t1]      —
提交 t2  账 1<2 → 发车    [t1 t2]   —
提交 t3  账 2＝2 → 排队   [t1 t2]   [t3]
提交 t4  排队             [t1 t2]   [t3 t4]
提交 t5  排队             [t1 t2]   [t3 t4 t5]
提交 t6  排队             [t1 t2]   [t3 t4 t5 t6]
t1 落定  账 2→1，队头发车  [t3 t2]   [t4 t5 t6]
t2 落定  账 2→1，队头发车  [t3 t4]   [t5 t6]
……直至六个全部落定
```

跟着「在飞」那一列从上往下扫：从头到尾没超过 2——上限的全部含义就在这列里。三个细节值得指认。排队的是「发车动作」而不是任务结果：t3 在排队时还没开始执行，它的 Promise 由守门人先攥着。队头补位是先来先到：`queue.shift()`，不插队。落定不分成败：失败的任务也占过窗口，让位时一视同仁——否则一个 503 就把队伍冻死。

## 一单装一袋：批量接口与字符预算

第一道工序：把一单一条的吃法，改成一单装一袋。

为什么值得？每次网络往返都拖着一段固定开销：建连接、鉴权、服务端排队——这段开销不管你带一条文本还是二十条，都一样长。一单一条，开销全由独苗扛；一单一袋，开销摊给全袋。真翻译服务也确实是这么开门的：DeepL 的文本翻译端点允许一条请求携带多条待译文本、按输入顺序返回；Google 云翻译的批量端点同形——收发都按批。这类「一次调用带一批」的形状叫批量接口（batch API）。第 4 章把 Translator 定成 `translate(texts: string[])`，就是照这个形状开的插头；引擎当时用了最朴素的吃法，本章把批量真正吃进去。

一袋能装多少，得有个数：字符预算——一单最多带多少个字符，模拟真实服务的单请求上限。装袋的算法是贪心：按顺序往袋里装，装不下下一件就封袋开新袋。

```ts
// src/batch.ts · chunkByBudget（终态全文）
export function chunkByBudget(texts: string[], charBudget: number): string[][] {
  const chunks: string[][] = []
  let bag: string[] = []
  let used = 0
  for (const text of texts) {
    if (text.length > charBudget) {
      // 超大件：已装的先封袋，它自己一袋——不切件
      if (bag.length > 0) {
        chunks.push(bag)
        bag = []
        used = 0
      }
      chunks.push([text])
      continue
    }
    if (used + text.length > charBudget) {
      chunks.push(bag) // 这件装不下了：封袋，开新袋
      bag = []
      used = 0
    }
    bag.push(text)
    used += text.length
  }
  if (bag.length > 0) chunks.push(bag) // 最后一袋别忘封
  return chunks
}
```

唯一一个要停下来想的分支是超大件：某段文本自己就超过预算，怎么办？切开来分两单？不切。**段落一切，句子就没了上下文**——「it broke」单独出门，谁也不知道 it 指谁。超预算的段落自己独占一单，宁可这单超载，不牺牲翻译质量。

拿真实数字跟一遍。商品页的 fixture 干净得只剩货——没有导航没有页脚，第 2 章的跳过规则在这里闲不着；37 个可译块块块要翻，每块的 text 就是它的直接文本（第 2 章立的口径）。去重后 26 句、共 548 字，预算 200：第一件是页头 h1（25 字），接着卡片标题、描述、那句 Add to cart……装到第 9 件凑了 194 字，第 10 件（30 字）装不下，封袋；第二袋又装 9 件 199 字；第三袋收尾 8 件 155 字。26 句 → 3 单，每单 9 + 9 + 8 条——这就是 demo 第二幕账单上那三个数的来历。

## 去重与缓存：两本账要分开记

剩下两道工序最容易混成一锅粥，先把界碑立清楚：**去重省的是同轮请求，缓存省的是跨轮请求**。去重只在「这一轮」的时间轴上看：同样的句子，这一轮送一次就够。缓存把时间轴拉长：上一轮翻过的成果，这一轮直接拿走。

先做去重（dedup）：把每一块的送翻文本收进一个 Set，同样的句子自动合并成一句。12 张卡片的 Add to cart，进 Set 只剩一条——第一幕账单上「出门 12 次」的那句话，第二幕变成 1 次。去重的键是送翻文本，不是屏显文字——这两个词在第 5 章之后不再永远是同一个东西。默认档送的，就是第 2 章立的那本账：树遍历走 DOM 树认出块级元素，内联元素的文字摊平成它的直接文本。`preserveInline` 开着时不一样：第 5 章在内联切分与占位标记两个方案里选了后者，送出去的是带记号的织出文本——`Same <strong>words</strong> here` 织出来是 `Same ⟦0⟧words⟦/0⟧ here`，与朴素段的 `Same words here` 是两个不同的键，各翻各的。结构不同，译文本就可能不同，键跟着记号走是对的。

再做缓存。为什么值得单独一道工序？反事实先做：不要缓存行不行？翻过的成果只活一轮——用户重开页面、关掉双语再打开、往后的增量翻译，全都要从头再付一遍。页面被看第二次是常态，不是例外，这就是缓存的成因。它的载体是一张 Map：键是送翻文本，值是译文。这种「用内容本身当地址」的做法叫内容寻址缓存（content-addressed cache）——同一句原文永远命中同一条，不需要任何对账；工业版会把内容算成哈希再当键（防超长键、便于落盘共享），本书的规模直接拿原文当键，性质相同。跟着第二轮的账跟一遍：37 块去重成 26 句，逐句 `cache.get`——26 句句句命中（第一轮出门的每一句都回写过），todo 队列空，打包零袋，请求零单，`cached` 记 26。锚点一句话：把内容本身算成哈希，当字典的键。

为什么去重在缓存前、而且是独立的一道？直觉上缓存好像能顺带把重复解决——串行逐句出门、出门前查缓存，第二张卡片的 Add to cart 确实会命中第一张刚写进去的成果。但批量档里不成立：同一句被装进两袋同时出门，两个在飞的请求都查过缓存、都 miss、都付钱——竞态把「只翻一次」的承诺撕了。**先去重，把同类项合并到只剩一句，再查缓存**，竞态在源头就不存在。口径也跟着分干净：去重省下的不进成绩单，`cached` 只记从上一轮手里接下的——两本账混记，你就永远说不清省钱该归谁。

## 演练：从红到 57 绿

靶子 10 条测试，一个新的 fixture：shop-page——12 张商品卡片，页头 1 块加每卡 3 块（标题、描述、同一句 Add to cart），整页 37 块。第 1 步照例先红，此刻 `src/batch.ts` 与 `src/cache.ts` 都不存在：

```text
// companion · npm test 的真实输出（节选）
Error: Failed to resolve import "../src/batch" from "tests/batch-cache.test.ts"
```

头两枪钉工具的行为：预算装袋与超大件不切件。第三枪最讲究——并发峰值怎么测？假翻译器瞬时完成，快到看不见「同时在飞」。解法是闸门翻译器：每次调用先记在飞，然后停在测试手里，不放行不返回：

```ts
// tests/batch-cache.test.ts · 闸门翻译器（观察并发的观察孔）
function createGateTranslator(): { translator: Translator; open(): void; peak(): number; inFlight(): number } {
  let active = 0
  let peak = 0
  const gates: Array<() => void> = []
  const translator: Translator = {
    async translate(texts) {
      active++
      peak = Math.max(peak, active)
      await new Promise<void>((resolve) => gates.push(resolve))
      active--
      return texts.map((t) => `【译】${t}`)
    },
  }
  return { translator, open: () => gates.shift()!(), peak: () => peak, inFlight: () => active }
}
```

引擎级的三组验收断言全靠它：不放行时在飞恰好等于上限、放走一单队尾补位、全程峰值不超上限。去重那枪钉账单：

```ts
// tests/batch-cache.test.ts · 重复段落只请求一次
  it('重复段落只请求一次：37 块 26 句送出、Add to cart 十二张卡片只付一次钱，块块有译文', async () => {
    const doc = parseHTML(SHOP_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    const stats = await createEngine({ translator: counting.translator, concurrency: 2 }).run(doc.body)
    expect(stats.blocks).toBe(37) // 省请求不省渲染：37 块全部拿到译文
    expect(stats.requests).toBe(3) // 26 句按字符预算装成 3 单
    const sent = counting.batches.flat()
    expect(sent.length).toBe(26) // 送出去的只有互不相同的 26 句
    expect(sent.filter((t) => t === 'Add to cart').length).toBe(1) // 同一句话全场只送了一次
    for (const cta of doc.querySelectorAll('p.cta')) {
      expect(isOwnNode(cta.nextElementSibling!)).toBe(true) // 12 张卡片的译文一张不少
      expect(cta.nextElementSibling!.textContent).toBe('【译】Add to cart')
    }
  })
```

第 2 步实现两个新模块。并发上限队列就是「一本账一支队」的直译：

```ts
// src/batch.ts · createLimiter（终态全文）
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  const windows = Math.max(1, Math.floor(max)) // 上限钳到至少 1：0 个窗口等于永久罢工
  let active = 0
  const queue: Array<() => void> = [] // 排队的是「已领号、等叫号」的发车动作
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const depart = (): void => {
        active++
        task().then(
          (value) => {
            settle()
            resolve(value) // 结果原样透传：limiter 不改任务，只管时刻表
          },
          (err) => {
            settle()
            reject(err) // 异常也原样透传：接住它的是调用方（管线的降级 try/catch）
          },
        )
      }
      const settle = (): void => {
        active--
        queue.shift()?.() // 窗口空出一个，队头补位——先来的先上
      }
      if (active < windows) depart()
      else queue.push(depart)
    })
  }
}
```

缓存是全书中最小的模块——一张 Map，一个「地址＝内容」的约定：

```ts
// src/cache.ts · createTranslationCache（终态全文）
export function createTranslationCache(): TranslationCache {
  const store = new Map<string, string>()
  return {
    get: (text) => store.get(text),
    set: (text, translated) => {
      store.set(text, translated)
    },
    size: () => store.size,
  }
}
```

第 3 步接线。管线的串行朴素档一个字符不动——第 4 章以来的全部测试还盯着它。加的只在抽块之后一个档位分支（第 8 章起，这个分支连同循环体住进块级入口 runBlocks，runPipeline 抽完块就交给它）：

```ts
// src/pipeline.ts · runPipeline（终态）
export async function runPipeline(
  root: ParentNode,
  translator: Translator,
  preserveInline = false,
  mainContentOnly = false,
  concurrency?: number,
  cache?: TranslationCache,
): Promise<EngineStats> {
  // 第 6 章接线：把抽取范围从「整页」收窄到「正文区」（默认关，前两章行为一寸不变）；
  // 认不出正文（null）就照旧翻整页——启发式的失败模式是多花额度，不是罢工
  const scope = mainContentOnly ? (detectMainContent(root) ?? root) : root
  const blocks = extractBlocks(scope)
  return runBlocks(blocks, translator, preserveInline, concurrency, cache)
}
```

runPipeline 的身体只剩两件事：圈范围、交出去。接手的块级入口在文件更靠后的位置（中间隔着私有函数 runBatched），单独引出来看：

```ts
// src/pipeline.ts · runBlocks 的开头（终态；第 7 章的档位分支）
export async function runBlocks(
  blocks: TranslatableBlock[],
  translator: Translator,
  preserveInline = false,
  concurrency?: number,
  cache?: TranslationCache,
): Promise<EngineStats> {
  // 两条档位（第 7 章起）：concurrency 与 cache 都不传＝串行朴素档——第 4 章的起点
  // 原样保留（旧章测试持续全绿的哨兵就盯在这里）；任一传了＝批量档——
  // 去重 → 缓存 → 打包 → 限流，翻译的经济学在 runBatched 里细算。
  if (concurrency !== undefined || cache !== undefined) {
    return runBatched(blocks, translator, preserveInline, concurrency ?? 1, cache)
  }
```

批量档本体是四道工序的直译，顺序就是上文的顺序。

```ts
// src/pipeline.ts · runBatched（终态全文）
async function runBatched(
  blocks: ReturnType<typeof extractBlocks>,
  translator: Translator,
  preserveInline: boolean,
  concurrency: number,
  cache?: TranslationCache,
): Promise<EngineStats> {
  // 每块一个送翻单元：preserveInline 开着时是带占位记号的织出文本（键跟着记号走，
  // 屏显一样、结构不同的两段会各翻各的——去重与缓存的键都是「送翻文本」）
  const units = blocks.map((block) => (preserveInline ? splitSegments(block)[0] : block.text))
  // ① 去重：Set 按内容合并同类项，还保留首次出现的顺序
  const unique = [...new Set(units)]
  // ② 缓存过滤：命中的直接进译文本，没翻过的才排队出门
  const translated = new Map<string, string>()
  const todo: string[] = []
  let cached = 0
  for (const text of unique) {
    const hit = cache?.get(text)
    if (hit !== undefined) {
      translated.set(text, hit)
      cached++
    } else {
      todo.push(text)
    }
  }
  // ③ 打包 ＋ ④ 限流：袋袋过闸门，窗口 concurrency 个
  const limit = createLimiter(concurrency)
  const bags = chunkByBudget(todo, CHAR_BUDGET)
  await Promise.all(
    bags.map(async (bag) => {
      try {
        const out = await limit(() => translator.translate(bag)) // 一袋一单
        for (let i = 0; i < bag.length; i++) {
          translated.set(bag[i], out[i]) // 按对位协议还账
          cache?.set(bag[i], out[i]) // 回写缓存：这一轮的成果，留给下一轮
        }
      } catch {
        // 降级粒度从「块」变成了「单」：这一袋全体的块保留原文，其余袋照常，整页不倒
      }
    }),
  )
  // 渲染与对账：拿到译文的块插译文，没拿到的（所在袋失败）原文原样留着
  let rendered = 0
  blocks.forEach((block, i) => {
    const text = translated.get(units[i])
    if (text === undefined) return
    if (preserveInline) renderSegments(block, [text])
    else renderBilingual(block, text)
    rendered++
  })
  return {
    blocks: rendered,
    requests: bags.length, // 发出的单数（失败的单也发过，照记）
    cached,
  }
}
```

渲染端一个字没换：拿到译文的块还是走第 3 章的 `renderBilingual`——兄弟节点插入、标记属性、幂等，三条纪律在批量档里原样生效。译文还是插在原文正后方；同一块再跑一遍，还是只刷新不重建。省钱省在出门的那一半，上树的这一半不动。

第 4 章依赖注入立好的装配层，本章只往里填两行：缓存随引擎实例生（不传 useCache 就是 undefined，串行档照旧）。

```ts
// src/engine.ts · createEngine（终态全文）
export function createEngine(opts: EngineOptions = {}): Engine {
  const translator = opts.translator ?? createFakeTranslator() // 依赖从这里注入，不藏在引擎肚子里
  const cache = opts.useCache ? createTranslationCache() : undefined // 缓存随引擎生，不随页面生
  return {
    run(root: ParentNode): Promise<EngineStats> {
      // 第 5、6、7 章接线：preserveInline 保内联格式、mainContentOnly 只翻正文区、
      // concurrency 与 useCache 切换批量档（默认：前两个开关关、后两个不传＝串行朴素档）
      return runPipeline(root, translator, opts.preserveInline, opts.mainContentOnly, opts.concurrency, cache)
    },
    runBlocks(blocks: TranslatableBlock[]): Promise<EngineStats> {
      // 第 8 章接线：增量入口——选项同 run 一套，只是块已由观察者备好，不再整树重抽
      return runBlocks(blocks, translator, opts.preserveInline, opts.concurrency, cache)
    },
  }
}
```

第 4 章立的 `EngineOptions.concurrency` 与 `useCache` 两个字段本章正式吃进行为——接口一个没改，只在装配层填了线。第 4、5、6 章正文引用的管线与引擎代码已同步成终态，回写义务照旧履行（第 8 章又给引擎开了 `runBlocks` 增量入口、把档位分支搬进块级入口，本章这两段也随终态回写，正文见第 8 章）。转绿：10 新加 47 旧，57 条全绿。

demo 三幕上柜台（打印语句有删节，输出是真实的）：

```text
// companion · npm run demo:batch 的真实输出（节选）
商品列表页：37 个可译块（12 张卡片 × 3 块 + 页头 1 块，其中 12 张卡片写着同一句 Add to cart）

=== 第一幕：朴素档（不加任何选项） ===
成绩单：37 块渲染 / 37 次请求 / 0 次缓存命中
请求账单：37 单，每单条数：1 + 1 + 1 + …（共 37 个 1）
"Add to cart" 出门次数：12（12 张卡片，同一句话付了 12 次钱）

=== 第二幕：批量档（concurrency: 2） ===
成绩单：37 块渲染 / 3 次请求 / 0 次缓存命中
请求账单：37 块 → 26 句（去重） → 3 单（按字符预算装袋）
每单条数：9 + 9 + 8
"Add to cart" 出门次数：1（去重之后，12 张卡片只付一次钱）
在飞峰值：2 / 上限 2（单数再多，同时在飞的不超过窗口数）

=== 第三幕：缓存档（useCache: true，叠在批量档上），同一台引擎翻两页 ===
第一页：37 块渲染 / 3 次请求 / 0 次缓存命中
第二页：37 块渲染 / 0 次请求 / 26 次缓存命中
账本两轮合计 3 单（首轮 3 单，第二轮一单没发）——没有缓存，第二页要再花 3 单
```

三处抬眼。第一幕就是开篇事故的缩小版：37 段落 37 单、同一句话付 12 次钱，一个选项不加它就在那。第二幕的三个数各归各的工序：26 归去重、3 与 9+9+8 归打包、峰值 2 归限流。第三幕的「0 次请求」有凭据——不是引擎自报，是计数翻译器的账本两轮合计仍是 3 单。还有一处口径要看清：requests 数的是单（一单可带多条），cached 数的是句（去重后的句）——37 块的页面，第二轮 cached 是 26 不是 37，因为 12 张卡片共享同一句。顺带说清本章没省什么：渲染侧一个字没动，译文节点还是逐个插、浏览器还是逐次重排（第 1 章记过这笔账）——省的是翻译侧的钱，不是渲染侧的时间。

降级纪律在本章换了一层粒度，要如实交代：串行档失败一块伤一块；批量档失败一单，伤的是同单全体的块。测试里那条 503 用新闻页跑：14 句 600 字装 5 单，装着那段 161 字长段落的那单恰好只装它一件——注意它并没超预算，独占一袋纯属装袋巧合，503 落地只伤一块，13 块照常渲染；但巧合不是承诺；同单挤了三五块时，一单失败三五块一起降级。代价的成因是打包本身：单里的块共享一次出行的命运。

## 验证：先猜，再开机

1. 亲手开机：`cd companion` 后跑 `npm run demo:batch`。跑之前先猜四个数：朴素档几单？批量档去重后几句、装几单、每单几条？第二页几单？
   应看到：37 单；26 句 3 单（9 + 9 + 8）；0 单——`cached` 记 26。
2. 指认好的小破坏：打开 `src/pipeline.ts`，把 `const unique = [...new Set(units)]` 改成 `const unique = units`——去重拆了。先猜红几条、第二幕账单变什么样，再跑 `npm test` 与 `npm run demo:batch`。
   应看到：红 3 条——「重复段落只请求一次」当头红；「并发峰值不超上限」超时红（多出一袋，测试只放行三扇闸，第 4 袋永远等不到叫号）；「二次 run 零请求」红（袋数变了，钉死的账单对不上）。demo 第二幕变 4 单、Add to cart 出门 12 次。一条工序被拆，三条断言陪着红——账单是牵一发动全身的。
3. 再来一个小破坏：把 `cache?.set(bag[i], out[i])` 那行删掉——缓存只读不写。先猜红哪条，再跑。
   应看到：只红「二次 run 零请求」一条——第一轮照常翻、第二轮一单不减：成果没存，翻了个寂寞。改回去恢复 57 绿。
4. 控制台自包含：并发上限队列十行就是全部，不依赖伴生仓。在 Node 控制台贴这段：
   ```js
   // 用法示例——自包含，不依赖伴生仓
   function createLimiter(max) {
     let active = 0; const queue = []
     return (task) => new Promise((resolve, reject) => {
       const depart = () => { active++; task().then(
         (v) => { active--; queue.shift()?.(); resolve(v) },
         (e) => { active--; queue.shift()?.(); reject(e) }) }
       active < max ? depart() : queue.push(depart)
     })
   }
   let active = 0, peak = 0
   const tasks = Array.from({ length: 6 }, (_, i) => createLimiter(2)(async () => {
     active++; peak = Math.max(peak, active)
     await new Promise((r) => setTimeout(r, 100)); active--; return i
   }))
   Promise.all(tasks).then((rs) => console.log('结果', rs, '峰值', peak))
   ```
   应看到：`结果 [0, 1, 2, 3, 4, 5] 峰值 2`——六件任务两个窗口，约三百毫秒跑完（三批 × 100ms）；把 2 改成 3 再跑，峰值 3、约两百毫秒。柜台叫号，肉眼可见。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，57 个测试全绿（第 2 章 9、第 3 章 7、第 4 章 8、第 5 章 13、第 6 章 10、本章 10——旧章测试持续全绿，串行朴素档一寸没动）。

## 小结：账单重算

回头看开篇那两件事。429 为什么来：串行太慢逼你全并发——200 个请求一口气全创建出来，promise 一诞生请求就发车了，没有人替你数窗口，限流器看到的就是洪水；现在四道工序各管一段——打包把 200 次往返压成几单，去重把同轮的重复并成一句，柜台叫号把同时在飞的数量钉在上限内，快而不至于被拒。30 次付费为什么发生：同轮里 12 张卡片的同一句话谁也不认识谁；现在去重之后 12 张卡片只付一次（demo 第二幕：出门次数 1）。跨轮的账也清了：第二页 0 请求、26 句缓存命中——第一轮的成果，第二轮直接拿走。

口径最后对一遍：`blocks` 数渲染成功的块（37），`requests` 数发出的单（3），`cached` 数从上一轮手里接下的句（26）。三本账各记各的，混了就对不上 demo。

留白照例记账，四条全进书末差异清单：缓存没有过期也没有容量上限，真实产品要管 TTL 与配额；429 本章只防不治——真实引擎还要重试与退避，本书不实现；批量档的降级粒度是整单，一块失败同单连坐；CHAR_BUDGET＝200 是教学手感值，真实服务的单请求配额以它的文档为准。另一条边界顺手声明：缓存的键是送翻文本，词典版的假翻译器换掉之后，旧缓存里的译文不会跟着换——缓存认句不认翻译器，真换服务要清缓存。

### 自查三问

先自己答，再展开对照。

::: details 1. 预测：`concurrency: 1` 且 `useCache: true`，第一轮几单？第二轮几单、cached 多少？在飞峰值是多少？
第一轮 3 单——limiter(1) 是一个窗口的柜台，袋还是那 3 袋，串行发车；第二轮 0 单、cached 26（与并发无关，缓存只认键）。峰值 1。回查「一单装一袋」的演算与 demo 第三幕。
:::

::: details 2. 设计取舍：把缓存查询从现在的「去重后、打包前」挪到「袋内逐句出门前」，缓存还省得了钱吗？这个挪法比去重轻在哪、又缺了哪块？
还省得了一部分：跨轮的重复照样命中（第二页 0 请求照旧）。缺的是同轮这道闸：同一句被装进两袋同时出门时，两个请求都查了缓存、都 miss（回包还没落账），各付一次钱——这正是去重独立成一道工序、且排在缓存前的理由。挪法省的是代码行数，去重省的是真金白银。回查「去重与缓存」一节的竞态推演。
:::

::: details 3. 动手：把 `src/pipeline.ts` 的 CHAR_BUDGET 从 200 改成 60，先猜第二幕的账单，再跑 `npm run demo:batch`。
单数变多：26 句 548 字按 60 一袋，装出 12 单（每单条数变碎）；峰值仍是 2（窗口数与预算无关）；Add to cart 仍出门 1 次。预算越小省的往返越少——「打包」的收益跟着预算走。改回去恢复 3 单。
:::

### 接下来去哪

| 章 | 接过引擎做什么 |
|---|---|
| 08 | MutationObserver 增量翻译：新内容追加时只翻新增块，标记属性上第二战场——拆掉「译文生译文」的自触发循环引信 |
| 09 | content script 与 manifest：引擎装进 Chrome——批量缓存档跟着一起搬进真实页面 |
