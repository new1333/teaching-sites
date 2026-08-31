---
title: 动态内容：别让译文生译文
---

# 动态内容：别让译文生译文

## 上章留下的问题

第 7 章清完了账：批量接口、去重、内容寻址缓存、并发上限四道工序上线，37 块的页面 3 单、二次渲染零请求。但引擎至今只会「开机一次」——`run()` 那一刻树长什么样，它翻什么；信息流页面往下滚动，新内容上树，它毫无知觉。更深的一颗雷从第 3 章埋到现在：渲染后再抽取，14 块变 28 块——译文会被当成新原文。这两件事其实是同一件事：页面是活的，引擎只认识开机那一刻的它。

## 一场安静的雪崩

把这台双语对照引擎挂到一个信息流页面上。向下滚动，新推文自动翻译了，效果正好。几秒后你觉出不对：翻译变慢了，页面开始卡，最后点不动、滚不动。打开 DevTools 看 DOM——一条推文下面叠着两层、三层、四层译文。引擎把自己刚插入的中文当成了新段落，翻出了译文的译文；译文的译文又是新段落。**译文生译文，层数指数增长**。每长一层，就是一轮新的翻译请求加一次新的重排（第 1 章记过这笔账）。无限循环，页面卡死——压死它的是它自己产出的节点。这不是翻译服务的 bug，也不是浏览器的 bug——是「监听页面变化」这件事，天生长着一张吃自己尾巴的嘴。这一章先看清这张嘴，再学会不被它咬到。

## DOM 变了，谁来告诉你

你大概会先想：DOM 变了给我发个事件不就行了？`addEventListener` 认识的 click、input、scroll，都是「用户或浏览器做了什么」的广播。DOM 变化的广播其实存在过——`DOMNodeInserted` 这类「Mutation Events」，但它同步、逐条、随每次改动内联触发，页面挂上监听后整页 DOM 操作慢好几倍，已被规范废弃、各家正在下线。MutationObserver 就是它的替代品：不再逐条喊话，而是攒成一本账、在微任务时机一次交清（时机的细节马上讲）。朴素的替代是轮询：`setInterval` 每秒把树序列化一遍、对比快照。能跑，但费电（每秒全树序列化）、滞后（最坏等一个周期）、还会漏（两次变化互相抵消，快照根本看不见）。

所以浏览器给了一条专用通道：**MutationObserver——浏览器提供的「DOM 变了就通知我」的监听接口**。你告诉它盯住哪棵子树，它把每次变更记成一条记录（MutationRecord），攒着，在合适的时机一批交给你的回调。为什么攒着成批交：一轮同步代码可能改十几次 DOM，逐条通知等于把你的回调硬塞进别人的代码路径十几次；攒成一本账，一次交清。

### 载体：这本账长什么样

```text
observer.observe(root, { childList: true, subtree: true })
  childList ：盯「子节点列表的增删」——谁上树、谁下树。本章只要这个
  subtree   ：不只 root 的直接子节点，整棵子树都盯（懒加载的内容埋得深）
  （另有 attributes / characterData 等开关，本章不开——边界见小结）

一条记录 MutationRecord（本章用到的字段）：
  target      ：变更发生在哪个节点上（谁家的孩子列表动了）
  addedNodes  ：新上树的节点列表（一次变更可以带上多个）
  removedNodes：下树的节点列表（本章不消费——删除不产生翻译需求）
```

### 演算：三个段落，一次交账

拿真实数字跟一遍（下面的时序在测试与浏览器里都可复现）。页面脚本在一轮同步代码里连追加三个段落：

```text
同步代码：article.append(p1) → 记录 r1（addedNodes=[p1]）
         article.append(p2) → 记录 r2（addedNodes=[p2]）
         article.append(p3) → 记录 r3（addedNodes=[p3]）
此刻同步代码还没跑完——回调一次都没发生（账已记下，还没交）
—— 同步代码结束，微任务检查点：交账 ——
回调 #1 收到 records = [r1, r2, r3]     ← 1 次回调，3 条记录
```

引擎随即翻这 3 块、插 3 个译文。这三笔插入的账，会在后续的检查点分批交来（每笔渲染之间隔着 `await`，各自成批）——收到几批不重要，重要的是每一批都要过同一道过滤。这道过滤是本章的正题，马上到。

### 锚点

你已经会 `addEventListener` 了：注册回调、等通知、在回调里拿事件对象做事。MutationObserver 换掉的只是信号源——不是「用户点了什么」，而是「这棵树长出了新枝」。其余的直觉全部平移过来用。

## 回调什么时候来：微任务

这是本章最容易踩的坑，如实交代。回调不是同步触发的：`append` 之后立刻去数，回调次数还是 0——账记下了，没交。也不是定时器：不用等一帧、更不用等一秒。它排在**微任务**里：当前这轮同步代码一结束、渲染之前，就交账。这个时机是规范定死的（DOM 标准的「mutation observer 微任务」；MDN 的微任务专题也讲同一件事）。「微任务检查点」说人话：本轮同步代码跑完、清空微任务队列的那个时刻。

这个时机有两个后果，本章全程都在吃它的红利、防它的暗礁。红利：测试不用 sleep——`await Promise.resolve()` 跑几轮微任务，回调必然已经交完，全程零定时器。暗礁：回调里改 DOM 不会同步重入——你插译文，这笔新账记到下一个检查点再交。正因如此，自触发循环滚得起来（每轮都「下轮再算」，不爆栈，但也不停）；也正因如此，**过滤必须每一轮交账都做，不是开机做一次**。

## 「监听到了，就能安全地增量翻译」——错在哪

有了通知，直觉的方案顺理成章：回调里跑一遍抽取，翻新出现的块——信号有了，抽取有了，渲染还有幂等兜底。这个直觉错在默认一件不成立的事：通知只报新内容。通知通道不分敌我。页面脚本追加的段落会触发回调；你自己插入的译文，同样触发回调——对 MutationObserver 来说都是「子树里上来了新节点」。数字摆在这：开机整页渲染插 14 个译文，就是 14 条记录、14 次「有新内容」的喊声。

而第 3 章的 demo 早就实证过静态抽取的盲区：渲染后再抽取，14 块变 28 块——译文是 p、有直接文本，抽得出来。观察者给了「新」一个时间定义（只有新上树的才算），但「新上树的」里混着你自己插的那批。不把自己摘出去，账就是这样滚的：第 1 轮 14 块原文 → 插 14 条译文；第 2 轮静态视角 28 块、全部送翻 → 插 28 条；第 3 轮 56……每轮翻倍，几轮就到开篇那场雪崩。**增量翻译的安全性不来自「监听到了」，来自「监听到之后，认得出哪些是自己人」**。

## 设计：增量抽取，两道摘法

三个决定，逐个说理由。

**第一个决定：给引擎开一个「带着现成的块进场」的入口。** 观察者手里的是块（从记录里捡出来的），不是树；而 `engine.run(root)` 会把整棵树重抽一遍——正好撞上引信。所以管线组装做一次小手术。`runPipeline` 抽完块就交给新的块级入口 `runBlocks`，串行循环与第 7 章的档位分支原样搬进去，一个字没改。

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

引擎侧对应开一个方法，下面这三行就是它。一个如实的边界：`mainContentOnly` 只约束开机整页那一趟，增量入口不收窄——观察者眼里「新上树的块」就是新闻，不看它住在哪个区（边界清单第五条，登记进差异清单）。

```ts
// src/engine.ts · createEngine 的增量入口（终态）
    runBlocks(blocks: TranslatableBlock[]): Promise<EngineStats> {
      // 第 8 章接线：增量入口——选项同 run 一套，只是块已由观察者备好，不再整树重抽
      return runBlocks(blocks, translator, opts.preserveInline, opts.concurrency, cache)
    },
```

选项不打折的含义：依赖注入进来的翻译器（demo 与测试里就是那个假翻译器）、`preserveInline`、第 7 章的批量档，全都能从增量入口进场。`preserveInline` 就是第 5 章在占位标记与内联切分两个方案里选定的那个——增量进场的块，照样走占位记号的织出与重建。

**第二个决定：增量抽取——只抽「新上树的子树」，且复用整页那套抽取。** 自定义「增量」最自然的想法，是给观察者写个轻量的「只看这个节点」的遍历——不写。做法：在每个新节点落地的地方（它的父元素）重跑一遍第 2 章的树遍历 `extractBlocks`，只捡落在新子树里的可译块。为什么在父元素重跑：`contains()` 连节点自己也算，裸的块级元素（一段 p）上树、整个容器上树，两种形态一次覆盖。老块不在新子树里，天然不重翻——同一块不重复翻译。跳过规则、长度门槛、直接文本的口径全部免费复用，因为跑的就是第 2 章那份代码。内联元素的上树进不了这本账——它不独立成块，往已有段落里新塞的行内内容要等它的块重新上树才算数（边界见小结）。

**第三个决定：自己人摘两道。** 第一道在记录层：`addedNodes` 里那个节点本身带标记属性，直接跳过——这是最常见的回声（自己刚插的译文上树）。第二道在块层：重抽出来的块若带标记属性，也跳过——这是搬家的场景（页面脚本把一个连译文一起的子树挪了地方）。单独看，第一道就挡住了绝大多数回声；两道都在，才敢说「每一轮交账都成立」。

## 演练：从红到 66 绿

靶子 9 条测试。第 1 步照例先红，此刻 `src/observe.ts` 不存在：

```text
// companion · npm test 的真实输出（节选）
Error: Failed to resolve import "../src/observe" from "tests/dynamic-observer.test.ts"
```

写测试先解决一个本章特有的问题：怎么等回调？答案是上文那个时机语义——回调在微任务里交账，那就用微任务冲刷，不碰定时器。

```ts
// tests/dynamic-observer.test.ts · 微任务冲刷
async function flush(rounds = 60): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve()
}
```

核心的一条测试钉的就是引信——树上 28 块与账上 14 单同屏对质。

```ts
// tests/dynamic-observer.test.ts · 引信拆除
  it('引信拆除：译文上树再入账也不送翻——静态视角树上 28 块，账上恒 14 单', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const counting = createCountingTranslator(createFakeTranslator())
    observeDynamic(doc.body, createEngine({ translator: counting.translator }))
    await flush()
    await flush() // 再冲刷一轮：给「译文生译文」留足发生的时间——它没有发生
    // 静态视角：渲染后再抽取，14 → 28——第 3 章埋的引信还挂在树上（译文是 p、有直接文本，抽得出来）
    expect(extractBlocks(doc.body).length).toBe(28)
    expect(counting.batches.length).toBe(14) // 动态视角：观察者一分钱没多花
    expect(counting.batches.flat().every((t) => !t.startsWith('【译】'))).toBe(true) // 送翻的没有一句是译文
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14) // 译文下没有再长出译文
  })
```

四条断言四层保险：静态账 28（引信真的挂在树上，不是没有引信）、动态账 14（观察者没为译文花钱）、送翻文本无一以「【译】」开头（翻的没有译文）、译文节点恒 14（树上没有叠层）。其余八条各钉一角（开机那 14 单的账，demo 第一幕现场对质）：

- 追加单段 +1 单；追加整容器（div 套两段）+2 单——只翻新来的。
- p2 入场不带走 p1——同一块不重复翻译。
- hr、空 div、注释上树零打扰；pre>code 与过短文本照旧被跳过规则拦下。
- 断开之后零翻译；批量档从增量入口进场（初始 5 单、新增 3 块装 1 单——第 7 章的账在观察者身上照算）。

第 2 步实现。观察者本体全文如下，三条设计线都在注释里：

```ts
// src/observe.ts · observeDynamic（终态全文）
export function observeDynamic(root: ParentNode, engine: Engine): { disconnect(): void } {
  // observer 从树自己的 window 拿（出生证原则，同第 3 章 ownerDocument）：
  // jsdom 的树配 jsdom 的 MutationObserver，浏览器里就是页面的 window——
  // 纯 Node 全局没有这个构造器，不依赖它
  const view =
    root.nodeType === 9 /* Node.DOCUMENT_NODE */
      ? (root as Document).defaultView
      : (root as Element).ownerDocument?.defaultView
  const Observer = (view ?? globalThis).MutationObserver
  if (typeof Observer !== 'function') {
    // 环境真没有 MutationObserver：不监听也不炸——静态引擎照跑，动态适配静默缺席
    return { disconnect: () => {} }
  }
  const observer = new Observer((records) => {
    // 观察者侧的错误不向上抛（引擎错误处理的全书约定）；翻译失败逐块降级发生在引擎里
    void collectFresh(records).then((blocks) => (blocks.length > 0 ? engine.runBlocks(blocks) : undefined)).catch(() => {})
  })
  observer.observe(root, { childList: true, subtree: true }) // 盯整棵子树的「谁上树了」
  void engine.run(root).catch(() => {}) // 开机即整页——先盯住再开机：开机自己插的译文，就是过滤器的第一场考试
  return { disconnect: () => observer.disconnect() } // 断开＝不再交账；已翻的译文原地保留
}
```

两处细节值得停一停。第一处，构造器从树自己的 window 解析——与第 3 章「出生证找 ownerDocument」同一条纪律。demo 跑在纯 Node 里，全局没有 MutationObserver；但 jsdom 文档的 `defaultView` 上有，到浏览器里就是页面的 window，一行不改。第二处，那行「先盯住再开机」：先 `observe` 后 `run`，开机插入的 14 个译文必然入账、必然过过滤。过滤器上岗第一天就考这道题，考不过测试当场红。

收账的纯函数，两道摘法都在：

```ts
// src/observe.ts · collectFresh（终态全文）
function collectFresh(records: MutationRecord[]): Promise<TranslatableBlock[]> {
  const fresh = new Map<Element, TranslatableBlock>() // 键是元素本体：同一块一批里只进一次
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType !== 1 /* Node.ELEMENT_NODE */) continue // 注释、文本节点不独立上账
      const el = node as Element
      if (isOwnNode(el)) continue // 自己人：译文上树不是新闻——引信的第一道拆法
      const parent = el.parentElement // 它落地的地方：在那里重跑抽取，块级判定与整页一份逻辑
      if (parent === null) continue
      for (const block of extractBlocks(parent)) {
        // contains 连自己也算：新节点自己是块（裸 p 上树）或子树里有块（容器上树）都收
        if (!el.contains(block.element)) continue // 老块不在新子树里——不带走，同一块不重复翻译
        if (isOwnNode(block.element)) continue // 搬家搬来的子树里混着译文：同样摘掉——第二道拆法
        fresh.set(block.element, block)
      }
    }
  }
  return Promise.resolve([...fresh.values()])
}
```

第 3 步转绿：9 新加 57 旧，66 条全绿——第 2 章到第 7 章的测试一条没动，`runBlocks` 重构后的串行档与批量档行为被旧章哨兵原地验证。demo 三幕上柜台（输出是真实的）：

```text
// companion · npm run demo:observe 的真实输出（节选）
=== 第一幕：开机即整页（先上岗、后开机） ===
计数器：14 单 | 译文节点：14 个
静态重抽：14 → 28 块（多出来的 14 个全是刚插的译文——第 3 章的引信就挂在树上）
账上送翻的没有一句是译文：true

=== 第二幕：模拟滚动加载（一次性追加 3 个新段落） ===
计数器：14 → 17 单 | 译文节点：14 → 17 个
这一轮真正出门的只有：
  · Reporters confirmed the library now ships weekly builds.
  · Community maintainers published a migration guide.
  · A follow-up post explained the versioning strategy.
新段落与它的译文（原文在外，译文紧跟其后）：
  <p>A follow-up post explained the versioning strategy.</p>
  <p data-duo="1">【译】A follow-up post explained the versioning strategy.</p>

=== 第三幕：稳态与断开 ===
再冲刷两轮：计数器纹丝不动（17 单）——译文上树没有引燃任何新翻译
disconnect 后再追加一段：计数器仍 17 单、译文仍 17 个——观察者下班，页面静默
```

三处抬眼。第一幕的两行对质就是本章的论点：静态视角 28 块（引信挂在树上，谁抽谁知道），账上 14 单（观察者眼里那 14 个译文不是新闻）。第二幕的账单只多了 3 单，出门的三句话就是新上树的三段——一条不多。第三幕冲刷两轮 17 单不动，是「过滤每一轮都做」的直接证据；disconnect 之后页面静默，断开语义干净；想再上岗也不用新造观察者——对同一个 observer 再调一次 observe 即恢复通知（本课程不演示重连，知道门在哪就行）。

## 验证：先猜，再开机

1. 亲手开机：`cd companion` 后跑 `npm run demo:observe`。跑之前先猜四个数：开机几单、静态重抽几块、追加 3 段后计数器到几、disconnect 后再追加一段计数器到几。
   应看到：14 单；28 块；17；仍是 17。
2. 指认好的小破坏：打开 `src/observe.ts`，把 `if (!el.contains(block.element)) continue` 这一行删掉——「只认新子树」的闸没了。老块会随父容器的重抽全部重新入账。先猜红几条、demo 第二幕计数器变成几，再跑 `npm test` 与 `npm run demo:observe`。
   应看到：红 6 条——追加单段、整容器、同一块不重复、中性节点、跳过规则、批量档合流，六条全在数「只有新来的块花钱」。只管「自己人不翻」的引信那条照绿（第一道摘法还兜着）。demo 第二幕计数器 14 → 27：10 个老块被重新带走，加上 3 个新块。改回去恢复 66 绿。
3. 再猜一个：把两道摘法里的第二道（`if (isOwnNode(block.element)) continue`）删掉，只留第一道。先猜 demo 还雪崩吗？
   应看到：demo 照常跑完、66 绿不变——最常见的回声（译文自己上树）第一道就拦住了，第二道防的是「搬家」这种少见场景。双保险的意义不是冗余，是「每一轮都成立」不靠运气。再把第一道也删掉跑一遍，雪崩当场复燃。开机计数器 91 单、滚动加载后 217、收尾 479——每一轮微任务都还在为刚长出来的译文下新单。第一幕那行「送翻的没有一句是译文」翻成 false。改回来恢复 66 绿。
4. 控制台自包含：微任务时机不依赖伴生仓。在浏览器控制台贴这段：
   ```js
   // 用法示例——自包含，不依赖伴生仓
   const feed = [] // 自己的账本：记每次回调带了几条记录
   const obs = new MutationObserver((records) => feed.push(records.length))
   obs.observe(document.body, { childList: true, subtree: true })
   document.body.append(document.createElement('p')) // 同步连上树三个节点
   document.body.append(document.createElement('p'))
   document.body.append(document.createElement('p'))
   feed.length // ← 同步代码没跑完：0——账记了，没交
   Promise.resolve().then(() => feed.length) // ← 1——一次回调；feed[0] 是 3，三条记录一批交来
   ```
   应看到：先 0，后 1，且 `feed[0]` 是 3——回调在微任务里来，一轮同步代码的多次变更攒成一批。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，66 个测试全绿（第 2 章 9、第 3 章 7、第 4 章 8、第 5 章 13、第 6 章 10、第 7 章 10、本章 9）。

## 小结：引信拆除

开篇那场雪崩，现在你能亲口讲完它的因果链。监听通道不分敌我——自己插的译文同样入账；译文是 p、有直接文本——静态抽取抽得出来。于是不摘自己人的每一轮翻译，都在为下一轮制造原料：层数翻倍，重排与请求把页面压死。拆法也已经亲手验证：两道摘法把译文从「新内容」里摘出去，第三幕冲刷两轮 17 单纹丝不动。

第 3 章 demo 里那句「14 → 28，多出来的全是刚插的译文」也该收账了。静态抽取没有时间概念，树上有什么抽什么——28 是它的诚实账目。观察者给「新」下了定义（新上树的子树），标记属性在自己的第二战场把译文摘出去——14 是动态的诚实账目。两个数都对，分清视角就不再吓人。这条从第 3 章、第 4 章两次预告的引信，本章亲手拆掉：树上 28 块、账上 14 单，同屏对质。

边界照例如实登记，五条进书末差异清单：

- 已翻译的子树被页面脚本整体搬走，会重发一单——幂等渲染兜底，不产生重复节点；缓存档则白送。
- 观察只盯 childList：原地改文本、改属性不触发增量。
- 往已有段落里新塞内联内容也不重翻——增量以「块上树」为记账单位。
- 环境没有 MutationObserver 时，observeDynamic 静默退化：不监听，也不报错。
- mainContentOnly 只约束开机整页那一趟：动态追加进侧栏等「非正文区」的块照样翻译——观察者眼里新上树的块就是新闻，不看住在哪个区。

### 自查三问

先自己答，再展开对照。

::: details 1. 预测：观察者在岗，页面脚本把一段已翻译的 p（连着它的译文）整个搬到另一个容器——花几单？译文节点会多出第二份吗？
花一单：搬来的 p 在新容器入账，它是原文、不在自己人名单，重新送翻。但不会多出第二份译文——renderBilingual 的兄弟节点插入加幂等兜底，紧邻兄弟还是原来那条译文时就地刷新。开着 useCache 的话这一单也白送（缓存命中）。回查「设计」一节的第二道摘法与第 3 章的幂等。
:::

::: details 2. 设计取舍：为什么在「新节点的父元素」重跑整页那套抽取，而不给观察者写一个只看新节点的轻量遍历？
一份抽取逻辑一份规则：裸 p 与整容器两种上树形态、跳过规则、长度门槛、直接文本口径全部免费复用；自写轻量版就是第二套规则，第 2 章立的口径迟早漂移。代价是父容器里无关的老块也被抽一遍再丢弃——教学规模下不心疼。回查「设计」一节第二个决定。
:::

::: details 3. 动手：把 `src/observe.ts` 里 `observe` 那一行的 `subtree: true` 去掉，先猜 demo 哪一幕坏、测试红几条，再跑。
追加的段落挂在 article——body 的孙辈，不再入账。demo 第二幕 3 个新段落零翻译，计数器停在 14；第三幕本来就没等新翻译，照旧。开机那 14 单不受影响——开机走 engine.run，不经过观察者。测试红 4 条：追加单段、整容器、同一块不重复、批量档合流，全是要等新内容的。改回去恢复 66 绿。
:::

### 接下来去哪

| 章 | 接过引擎做什么 |
|---|---|
| 09 | content script 与 manifest：引擎连同这一章的观察者一起装进 Chrome，在真实页面上看它干活、收束全书 |
