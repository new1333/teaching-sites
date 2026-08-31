---
title: 内联格式保留：译文里的加粗和链接
---

# 内联格式保留：译文里的加粗和链接

## 上章留下的问题

第 4 章结束时，`createEngine().run(root)` 一键整页双语，链路全通。可 demo:engine 的输出里趴着两处坑，当时记了账没还：`significant speedups` 的译文里 strong 没了；`mount()` 这个行内代码从译文里整个消失。还记得第 2 章末尾那笔更老的账吗——行内 code 的文本从段落直接文本里剪掉了，留了个空隙，说好后面用记号填回来。这一章三笔账一起算：译文里的加粗、链接、行内代码，都得活回来。

## 一根纯文本绳子

真实项目里这个问题长这样：段落原文是 `Use <strong>strict mode</strong> in <a>production</a>`，翻译回来的是——`Use strict mode in production.` 一根纯文本绳子。加粗消失，链接变裸文字，点不动了；格式在这次翻译往返里被碾平。而「格式被碾平」这件事，我们自己的引擎正在量产：第 4 章 demo 的整页输出里，strong 段的译文是 `<p data-duo="1">【译】Early users report significant speedups…</p>`——里面一个元素节点都没有。这不是翻译服务偷懒，是我们送出去的东西本身就没有结构。

## 绳子是谁织的：格式死在出门之前

先做一个公允的复述。你大概想：把段落的 innerHTML 原样发给翻译 API，它认得 HTML，会把标签原样还回来——确实有服务这么承诺，DeepL 就有 tag_handling 参数。但通用机翻接口以纯文本为主：HTML 支持各家参差，而且易碎——改转义、剥属性、吞未知标签，都是家常便饭。指望「API 自己保格式」，等于把宝押在别人的实现细节上。

更根本的证据在我们这边。回看第 4 章的管线：送翻的是 `block.text`——`extractBlocks` 抽出来的**直接文本**，一根折叠过空白的字符串。字符串里没有 strong，没有 a，没有 code；送出去的是绳子，回来的当然也是绳子。**格式能不能活下来，是调用方的责任**——服务只承诺「字符串进、字符串出」，结构信息要么根本不出门，要么就得想办法随身带回来。我们选后者。

（顺带补一句诚实声明：本章全程用假翻译器，它逐字回显、什么都不会吞。所以本章的测试证明的是「引擎的拼装逻辑对不对」，证明不了真实服务也这么客气——这份不确定性怎么对冲，见下面「记号的语法与保费」。）

## 两条活路：内联切分与占位标记

格式要随身带，工程上有两条主流的路。

**内联切分**——按内联边界把一个段落拆成片段、分别送翻，再按原文的片段顺序把结构拼回去。拿 strong 段演算一遍：三个片段 `Early users report`、`significant speedups`、`in tree-heavy workloads…`，一起发给翻译器，回来三段译文，按「文本→strong→文本」的次序织回节点。

- 它的优点是不用发明任何记号：翻译器见到的永远是纯文本片段，不用信任、不用解析，最坏情况也只是译文生硬。
- 它的代价在翻译质量上。整句被切开后，每个片段都不知道别的片段在说什么——机翻对碎片的译文质量明显差，「报告了」和「显著的提速」拼起来未必成句。更要命的是语序被锁死：译文只能按原文的片段顺序拼回，目标语言的语序跟原文不一样时（修饰语前移、结论前置），拼出来的句子是错的。这段加粗在中文里该挪到哪，切分方案永远答不上来。

**占位标记**——用翻译过程不会破坏的记号，暂代内联标签随文本一起送翻；译文回来后，按记号把真实节点替换回去。整句上下文完整，语序随便挪，结构跟着记号走。

```text
原文（可译块的子节点）                 翻译单元（送翻的一根字符串）
───────────────────────────          ─────────────────────────────────────────
"Early users report "                Early users report ⟦0⟧significant
<strong>significant speedups</strong>      speedups⟦/0⟧ in tree-heavy workloads…
" in tree-heavy workloads, …"
                                      code 段：… and call ⟦0⟧ on any element.
        weave：边界上立记号                ⟦0⟧ 整枚占位——mount() 根本不出门
```

记号分两种。**成对记号**（⟦0⟧…⟦/0⟧）给可翻译的内联：strong、em、b、i、a——内容夹在记号中间随整句送翻，回来重建时换上新元素。**独立记号**（单枚 ⟦0⟧）给不可译的内联：code——内容根本不送翻，记号只占住位置，回来时把原文逐字拼回。第 2 章剪掉 `mount()` 留下的空隙，正好由它填上。

选哪条？双语对照产品的体验主轴是译文读起来自然，格式保留是增强、不是生死要件（第 4 章降级哲学的同一条延伸）。所以选**占位标记**：整句上下文换最好的翻译质量，语序自由换自然的中文，code 不送翻顺手兑现第 2 章的承诺——代价是必须信任「记号能活着回来」，用验证加兜底去对冲。锚点一句话：密文里留口信的暗号——信使（翻译服务）看不懂内容，但约定好的记号他能一字不差地带到。

## 记号的语法与保费

记号为什么长成 ⟦0⟧ 这样？逐条做反事实。用 HTML 标签（`<b0>`）：服务会当真标签去解析，tag_handling 关着就被剥掉。用方括号（`[0]`）：正文里的数组下标、引用编号会被误认成记号。用裸数字：跟正文完全没有区分度。⟦⟧ 这对字符罕见到正文里撞不上，中间夹编号，对分词器——翻译服务内部先把文本切成词块（token）再逐块处理的那道工序——是一枚完整的词块，拆不开。编号本身是认亲的钥匙：一段里有两个 strong、译文又把它们的次序换了，靠 ⟦0⟧⟦1⟧ 的索引才认得出谁是谁——按位置配对必错。

保费是什么？「记号活着回来」没有天然保证。真实服务可能吞记号、拆记号、在记号里插空格。所以重建端必须验证：编号对得上号、成对记号配得上对，任何一处对不上就降级——剥掉残记号按纯文本渲染，格式丢、译文留，整页照跑。这笔「真实服务的记号存活无承诺」的账，登记进书末差异清单。

## 演练：从红到结构逐节点对位

靶子 13 条测试。第 1 步照例先红——此刻 `src/inline.ts` 还不存在：

```text
// companion · npm test 的真实输出（节选）
Error: Failed to resolve import "../src/inline" from "tests/inline-format.test.ts"
```

头一枪钉最难的事：译文里的结构跟原文逐节点对位，且文字确实来自假翻译器——dict 把译文钉死，断言只看结构，这正是第 4 章埋好的武器：

```ts
// tests/inline-format.test.ts · strong 逐节点对位
  it('strong 逐节点对位：译文里文本→strong(译文)→文本，文字来自 dict、原文一字未动', async () => {
    const dict = {
      [STRONG_UNIT]: '早期用户报告了⟦0⟧显著的提速⟦/0⟧——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。',
    }
    const block = pageBlock('significant speedups')
    const [translated] = await createFakeTranslator(dict).translate(splitSegments(block))
    const node = renderSegments(block, [translated])
    expect(block.element.nextElementSibling).toBe(node) // 插在原文正后方
    expect(isOwnNode(node)).toBe(true)
    expect(node.tagName).toBe('P')
    expect(node.childNodes.length).toBe(3) // 文本 → strong → 文本
    const [before, strong, after] = node.childNodes
    expect(before.textContent).toBe('早期用户报告了')
    expect((strong as Element).tagName).toBe('STRONG')
    expect(strong.textContent).toBe('显著的提速') // 加粗里的文字是被翻过的，不是原文搬运
    expect(after.textContent).toBe('——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。')
    expect(block.element.querySelector('strong')!.textContent).toBe('significant speedups') // 原文的 strong 原地未动
  })
```

第 2 步实现 `src/inline.ts`。先立清单与记号语法：

```ts
// src/inline.ts · 标签清单与记号（文件头部，import 从略）
/** 成对记号包裹的可翻译内联：内容随整句送翻，结构按记号重建；a 的 href 靠浅克隆活下来。 */
const WRAP_TAGS: ReadonlySet<string> = new Set(['strong', 'em', 'b', 'i', 'a'])

/** 不可译内联（行内 code）：一枚独立记号暂代，内容不送翻、原文逐字拼回——第 2 章的账在这还。 */
const KEEP_TAGS: ReadonlySet<string> = new Set(['code'])

/** 跳过族的其余成员（button 等）：文本不进翻译单元——与第 2 章 collectDirectText 同一条边界。 */
const SKIP_INLINE: ReadonlySet<string> = new Set(DEFAULT_SKIP_TAGS.filter((t) => t !== 'code'))

/** 内联槽位：solo＝独立记号暂代、原样拼回；pair＝成对记号包裹、内容送翻后重建。 */
interface Slot {
  kind: 'solo' | 'pair'
  el: Element
}

/** 记号语法：⟦0⟧ 开、⟦/0⟧ 闭——罕见字符＋数字编号，正文撞不上、分词器拆不开。 */
function markOpen(i: number): string {
  return `⟦${i}⟧`
}
function markClose(i: number): string {
  return `⟦/${i}⟧`
}
const MARKER_RE = /⟦(\/?)(\d+)⟧/g
const MARKER_ANY_RE = /⟦[^⟧]*⟧/g
```

再织翻译单元。第 2 章的世界观在这里直接复用：可译块是直接持有文本的块级元素，strong、a、code 这些内联元素就住在它的直接子级；weave 这趟树遍历，走的正是 DOM 树的这一小段。它与第 2 章的 collectDirectText 同构——同一棵树、同一条账本边界，差别只在边界上立了记号：块级子代留给它自己记账，跳过规则照样生效。

```ts
// src/inline.ts · weave 与 splitSegments
/**
 * 织出带记号的翻译单元：文本照走（空白最后统一折叠），code 换成独立记号，
 * strong/a 换成成对记号夹着它的摊平文本；块级子代跳过——它的账它自己记。
 * 这趟走法与第 2 章的 collectDirectText 同构：同一棵树、同一条边界，只是边界上立了记号。
 */
function weave(el: Element, slots: Slot[]): string {
  let out = ''
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* Node.TEXT_NODE */) {
      out += child.textContent ?? ''
      continue
    }
    if (child.nodeType !== 1 /* Node.ELEMENT_NODE */) continue
    const tag = (child as Element).tagName.toLowerCase()
    if (KEEP_TAGS.has(tag)) {
      out += markOpen(slots.length) // 独立记号：整枚占位，代码不出门
      slots.push({ kind: 'solo', el: child as Element })
    } else if (WRAP_TAGS.has(tag)) {
      const i = slots.length
      slots.push({ kind: 'pair', el: child as Element })
      out += markOpen(i) + normalize((child as Element).textContent ?? '') + markClose(i)
    } else if (SKIP_INLINE.has(tag) || BLOCK_TAGS.has(tag)) {
      continue // 跳过族与块级子代：与第 2 章同一条账本边界
    } else {
      out += weave(child as Element, slots) // 其他内联：往里走，里层的 strong/code 照样立记号
    }
  }
  return out
}

/**
 * 切出一个块的翻译单元（占位标记方案：一块一个单元，整句上下文完整）。
 * 返回 string[] 是与 Translator 的批量形状对齐——第 7 章把多块打进一单时，这里的形状不用改。
 */
export function splitSegments(block: TranslatableBlock): string[] {
  return [normalize(weave(block.element, []))]
}
```

无内联的块织出来就是纯文本——与第 2 章的直接文本逐字相同，有一条测试专门钉住这个不变式：普通块的账，记号方案一个字都不动。

第 3 步是重建端。出生流程照抄 renderBilingual：兄弟节点插入、标记属性、先认后插的幂等。重建的分寸落在两行克隆上——闭记号合拢成浅克隆的包裹元素，href 活下来；独立记号拼回深克隆的原文，code 一个字符没出过门：

```ts
// src/inline.ts · insertFresh 与 rebuild
/** 造一个带标记属性的空译文节点，插到原文正后方——与 renderBilingual 同一条出生流程。 */
function insertFresh(block: TranslatableBlock): Element {
  const node = block.element.ownerDocument.createElement('p')
  node.setAttribute(OWN_ATTR, '1') // 先打记号再上树：从挂上那一刻起它就是「自己人」
  block.element.insertAdjacentElement('afterend', node)
  return node
}

/**
 * 把译文按记号重建进译文节点：文本落文本节点，闭记号合拢成包裹元素，独立记号拼回原文。
 * 记号对不上号（被吞、被拆、编号陌生）就降级：剥掉残记号按纯文本渲染——格式丢、译文留。
 */
function rebuild(target: Element, translated: string, slots: Slot[]): void {
  const doc = target.ownerDocument
  target.textContent = '' // 幂等刷新路径：清掉旧内容原地重建
  let openFrag: DocumentFragment | null = null // 成对记号不嵌套：同时最多开一对（fragment＝离体收纳袋：挂进树时整体倒出内容、自己不占节点）
  let openIndex: number | null = null
  const appendText = (raw: string): void => {
    if (raw === '') return
    ;(openFrag ?? target).appendChild(doc.createTextNode(raw))
  }
  let failed = false
  let last = 0
  for (const m of translated.matchAll(MARKER_RE)) {
    const at = m.index ?? 0
    appendText(translated.slice(last, at))
    const slot = slots[Number(m[2])]
    if (slot === undefined) {
      failed = true // 陌生编号：译文里的记号与槽位对不上号
      break
    }
    if (m[1] === '/') {
      if (openFrag === null || openIndex !== Number(m[2])) {
        failed = true // 闭记号没有配对的开记号
        break
      }
      const wrap = slot.el.cloneNode(false) as Element // 浅克隆：标签＋属性原样（href 在这活下来），内容重填
      wrap.appendChild(openFrag)
      target.appendChild(wrap)
      openFrag = null
      openIndex = null
    } else if (slot.kind === 'solo') {
      target.appendChild(slot.el.cloneNode(true)) // 深克隆：code 原文逐字拼回，一个字符没出门
    } else {
      if (openFrag !== null) {
        failed = true // 成对记号里又开记号：嵌套不在本章方案内
        break
      }
      openFrag = doc.createDocumentFragment()
      openIndex = Number(m[2])
    }
    last = at + m[0].length
  }
  if (!failed && openFrag === null) {
    appendText(translated.slice(last)) // 收尾文本
  } else {
    // 降级：结构放弃，译文保留——第 4 章「翻译是增强不是生死要件」的同一条纪律
    target.textContent = translated.replace(MARKER_ANY_RE, '')
  }
}
```

```ts
// src/inline.ts · renderSegments
/**
 * 把带记号的译文渲染成块的正后方译文节点，返回它；幂等（先认后插，同块刷新不重建节点）。
 *
 * 正确性前提藏在第 3 章的纪律里：原文一个字不动——renderSegments 在原文上再走一遍
 * weave 重新登记槽位，两次走出的一一对应，靠的就是这棵树没变过。
 */
export function renderSegments(block: TranslatableBlock, translations: string[]): Element {
  const translated = translations[0] ?? ''
  const existing = block.element.nextElementSibling
  const node = existing !== null && isOwnNode(existing) ? existing : insertFresh(block)
  const slots: Slot[] = []
  weave(block.element, slots)
  rebuild(node, translated, slots)
  return node
}
```

值得抬眼看的那行注释：renderSegments 在原文上「再走一遍 weave」。splitSegments 送翻前走过一次、登记了槽位；渲染时原文还在（第 3 章「只插不改」的纪律），再走一次得到同一份登记——两次走同一棵没变过的树，账才对得上。第 3 章立下的纪律，在这里从「职业道德」变成了正确性前提。

第 4 步接线。管线组装加一个分支，默认关，第 4 章的行为一寸不变：

```ts
// src/pipeline.ts · runBlocks 的循环体（终态；第 8 章起循环体住进块级入口 runBlocks）
      requests++ // 先记账再发车：失败的请求也是真实开销
      if (preserveInline) {
        // 第 5 章接线：整块织成一个带占位记号的翻译单元，渲染端按索引重建内联结构
        renderSegments(block, await translator.translate(splitSegments(block)))
      } else {
        const [translated] = await translator.translate([block.text]) // 一块一单
        renderBilingual(block, translated)
      }
      rendered++
```

```ts
// src/engine.ts · createEngine 的 run（终态）
      // 第 5、6、7 章接线：preserveInline 保内联格式、mainContentOnly 只翻正文区、
      // concurrency 与 useCache 切换批量档（默认：前两个开关关、后两个不传＝串行朴素档）
      return runPipeline(root, translator, opts.preserveInline, opts.mainContentOnly, opts.concurrency, cache)
```

这次接线动了 pipeline.ts 与 engine.ts 各一处：加参数、加分支，不改旧函数形态。`EngineOptions.preserveInline`——第 4 章在依赖注入的装配层立好的选项字段——本章正式吃进行为。第 4 章正文引用的两段代码已同步成终态，这是验证物演进后的回写义务（run 那行末尾多出的 `opts.mainContentOnly` 是第 6 章接上的线、`opts.concurrency` 与 `cache` 是第 7 章接上的，正文各见其章）。

第 5 步转绿：13 新加 24 旧，37 条全绿。demo 三幕上柜台（打印语句有删节，输出是真实的）：

```text
// companion · npm run demo:inline 的真实输出（节选）
=== 第一幕：createEngine({ translator: createFakeTranslator(dict), preserveInline: true }).run(doc.body) ===
成绩单：14 块渲染 / 14 次请求 / 0 次缓存命中

【strong块】原文  <p>Early users report <strong>significant speedups</strong> in tree-heavy workloads, ...</p>
            译文  <p data-duo="1">早期用户报告了<strong>显著的提速</strong>——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。</p>

【code块】原文  <p>To try it, add one script tag to your page and call <code>mount()</code> on any element.</p>
            译文  <p data-duo="1">试试看：往页面加一个 script 标签，然后对任意元素调用 <code>mount()</code> 即可。</p>

【a块】原文  <li><a href="/css">CSS tricks you forgot</a></li>
            译文  <p data-duo="1"><a href="/css">你早就忘光的 CSS 技巧</a></p>

=== 第二幕：译文把加粗短语排到句首 ===
译文  <p data-duo="1"><strong>显著的提速</strong>——早期用户在树操作密集的工作负载中报告了这一点。</p>

=== 第三幕：闭记号被服务吞掉 ===
成绩单：14 块渲染 / 14 次请求（整页照跑，没炸）
译文  <p data-duo="1">早期用户报告了显著的提速——不过在树操作密集的工作负载里，也有人想念更简单的旧 API。</p>
```

三处抬眼。第一幕成绩单还是 14 块 14 单——占位标记不改变请求形状：一块还是一个翻译单元，只是单元里多了记号（计数包装器的账本里能看到 ⟦0⟧ 真的出了门）。第二幕是这套方案的独门本事：译文把加粗短语排到了句首，strong 认的是索引不是位置，语序怎么挪结构都跟得上——内联切分在这就答不上来了。第三幕闭记号丢了：那块降级成纯文本，整页 14 请求照跑，格式丢、译文留。

## 验证：先猜，再开机

1. 亲手开机：`cd companion` 后跑 `npm run demo:inline`。跑之前先猜三件事：strong 段译文的第一个子节点，是文本节点还是元素节点？`mount()` 在 code 段的译文里出现几次？第三幕成绩单的请求数是多少？
   应看到：文本节点（「早期用户报告了」在最前，strong 是第二个）；一次（`<code>mount()</code>` 原样在译文里，原文里也还是一次——没送翻就没被碰）；14 次请求——降级发生在渲染端，请求照发。
2. 指认好的小破坏：打开 `src/inline.ts`，把降级行 `target.textContent = translated.replace(MARKER_ANY_RE, '')` 改成 `target.textContent = translated`——残记号直接漏进页面。先猜红几条，再跑 `npm test`。
   应看到：红两条——「记号被吞就降级」与「陌生记号就降级」，两条的期望值都是剥过记号的纯文本；其余 35 条照绿，结构路径不经过这行。改回去恢复全绿。
3. 再来一个小破坏：把 rebuild 里的 `slot.el.cloneNode(true)` 改成 `slot.el.cloneNode(false)`——code 变成空元素。先猜红几条，再跑。
   应看到：红两条——「code 原样拼回」（`mount()` 没了）与「preserveInline: true 整页」（codeZh 的断言落空）。深浅克隆的区别，这一改就看清楚了。
4. 控制台自包含：记号的识别与剥离，两个正则就是全部家当。任意 Node 或浏览器控制台贴这三行：
   ```js
   // 用法示例——自包含，不依赖伴生仓
   const re = /⟦(\/?)(\d+)⟧/g
   ;[...'调用 ⟦0⟧ 即可，参见 ⟦1⟧。'.matchAll(re)].map((m) => m[0]) // → ['⟦0⟧', '⟦1⟧']
   '⟦0⟧残记号⟦/0⟧'.replace(/⟦[^⟧]*⟧/g, '') // → '残记号'
   ```
   应看到：`['⟦0⟧', '⟦1⟧']` 与 `'残记号'`——识别拿编号，剥离扫残骸，引擎里干的正是这两件事。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，37 个测试全绿（第 2 章 9 个、第 3 章 7 个、第 4 章 8 个、本章 13 个——旧章测试持续全绿，公共 API 没破）。

## 小结：绳子是怎么编回结构的

回头看开篇那根绳子。现在你能亲口解释它为什么是绳子——送出去的 `block.text` 本来就只是字符串，碾平发生在出门之前，跟服务守不守规矩无关；也知道怎么把绳子编回结构——占位记号替内联标签出差，译文回来按索引认亲，浅克隆重填内容、深克隆逐字拼回。开篇的三个现象都有了着落：加粗消失？strong 立成对记号随整句送翻、按索引重建；链接变裸文字？a 浅克隆带上 href，指路的功能原样；`mount()` 消失？独立记号占位，代码一个字符没出过门——第 2 章那笔「空隙」的账，至此清了。

留白也照例记账。嵌套内联（a 里套 strong、隔层包裹）按纯文本摊平送翻、不保结构——简化声明，进差异清单；真实服务对记号存活无承诺、被吞即降级——这份保费的账，也在差异清单。一块一个单元的请求形状没变，但一块一单的省钱空间还攥在手里，第 7 章细算。插译文引发的重排账、14 变 28 的引信，都还是老账，各自的章在读。

### 自查三问

先自己答，再展开对照。

::: details 1. 预测：preserveInline 开着、dict 没命中，code 段的译文节点里，`mount()` 的内容是什么？【译】前缀出现在哪？
`mount()` 原样——code 内容根本不送翻，前缀加不到它头上。前缀出现在翻译单元的字符串头上，也就是译文节点的第一个文本节点里：「【译】To try it, …call 」是文本，`<code>mount()</code>` 紧随其后。回查「演练」里 code 段的 demo 输出。
:::

::: details 2. 把记号里的编号去掉（全部用 ⟦⟧…⟦/⟧），翻译一段 em 与 strong 混排的句子，译文把 em 挪到了 strong 前面。重建后哪块内容会被装错？为什么编号能救？
按出现次序配对：译文中第一对记号里的文字，会被装进收集顺序的第一个槽位元素。原文的收集顺序是 strong 先、em 后，而译文中排在前面的已经是 em 的文字——em 的译文会被装进 strong 里，样式张冠李戴。编号是认亲钥匙：⟦0⟧ 永远指回第 0 号槽位，与它在译文中出现的位置无关。回查「记号的语法与保费」与「语序重排」那条测试。
:::

::: details 3. 动手：code 用深克隆整枚拼回、strong 用浅克隆重填内容——反过来会怎样？
code 浅克隆：拼回一个空的 `<code></code>`，代码内容丢了（验证槽第 3 条的小破坏就是这个）。strong 深克隆：原文的英文整段搬进译文，「显著的提速」永远出不来——包裹元素的要点是壳留下、内容换新。回查 rebuild 里两行克隆注释。
:::

### 接下来去哪

| 章 | 接过引擎做什么 |
|---|---|
| 06 | 链接密度与文字密度启发式认主内容区：额度不再花在导航侧栏上 |
| 07 | 批量、并发上限与内容寻址缓存：一块一单元的账，重新算 |
| 08 | MutationObserver 增量翻译：标记属性上第二战场，拆掉译文生译文的「自触发循环」引信 |
| 09 | content script 与 manifest：引擎连本带接线装进 Chrome，真页面上核验格式存活 |
