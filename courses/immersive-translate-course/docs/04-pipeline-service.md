---
title: 翻译服务抽象：引擎不认识任何 API
---

# 翻译服务抽象：引擎不认识任何 API

## 上章留下的问题

第 3 章结束时你手里有什么？抽取、渲染两个部件，各自有测试背书，合起来能把一张 14 块的新闻页变成双语对照页。但那 14 段译文是怎么来的？demo 里 `renderBilingual(strongP, '早期用户报告……')`——引号里的中文，是你一个字一个字填进去的。还记不记得上章末的两笔账：译文从哪来？渲染后再抽取为什么 14 变 28？这一章还第一笔，第二笔继续攥着。

## 手填的译文，接不住真的 API

上一章你能抽块、能插译文了——但译文是手填的。你大概想：找一家翻译 API 接上不就完了？注册账号、领密钥、在引擎里写一个 fetch，三行代码的事。真正的麻烦从第四行开始：测试依赖网络与密钥——密钥不能进仓库，CI（持续集成：每次提交代码就自动跑一遍全部测试的流水线）得配环境变量；按字符计费的服务，跑测试花钱——CI 每次提交跑一遍测试，等于每次提交付一次翻译费。测试最怕的三样东西——不确定的网络、外部的密钥、真金白银的账单——一样不少，全涌了进来。

出路不在「更聪明的 mock 工具」，在引擎的构造：**让引擎从头到尾不认识任何具体翻译服务**。它只认一个接口；真真假假的翻译服务，都是插在这个接口上的插头。这一章做三件事：把这个接口立起来、给测试造一个确定性的假插头、把三道工序接成一键跑完的管线——全程零网络、零密钥、零账单。

## 依赖注入：把翻译服务从引擎肚子里搬出来

先做反事实检验：如果引擎认识具体服务，会怎样？设想管线里直接写 `await fetch('https://api.example.com/translate', …)`——服务被焊死在引擎肚子里。测它，要网、要密钥、要预算；换一家更便宜的服务，动的是引擎本体的代码；服务一挂，「抽取对不对、渲染对不对」也一起验不了——三道工序给一个外部服务陪葬。依赖的麻烦从来不在依赖本身，在它藏在哪儿。

反过来做：引擎不创造翻译能力，只声明「我需要一个会翻译的东西」。翻译服务从引擎内部搬出去，变成创建引擎时的一个参数——这就是**依赖注入：把「翻译服务」从引擎内部抽出来当参数传进去，引擎只认接口、不认具体服务**。这个词听着像什么框架的大词，其实它的最小形态你天天在写：函数参数。`fetchData(url)` 不自己定死 url、由调用方传入，就是一次依赖注入——区别只是注入的东西从字符串换成了一个「会翻译的对象」。

```text
调用方 ──传 translator──▶ createEngine ──▶ run(root)
                              │
                抽取（第 2 章）→ 翻译（这个参数）→ 渲染（第 3 章）

插头随便换，引擎零改动：
  createFakeTranslator()            离线假翻译器，零成本
  createFakeTranslator(dict)        词典版，译文钉死
  真服务的适配器（网络、密钥、计费只住在插头里）
```

可测性收益马上兑现：测试里插假翻译器，CI 不花钱；换实现、换词典，引擎一行不动——本章有一条测试专门钉这件事。

## 接口为什么长这样：一批进、一批出

```ts
// src/translate.ts · Translator 接口
/**
 * 翻译器接口：一批原文进、一批译文出，条数与顺序一一对应。
 * 为什么成批（string[]）而不是单条 string？真实翻译服务几乎都按批量收发——
 * 每次往返都有固定开销，接口照着真服务的形状开，假翻译器与真服务才是同一个插头，
 * 将来替换才不需要改引擎（依赖注入的落点，正文「接口为什么长这样」一节）。
 */
export interface Translator {
  /** texts：一批原文；返回同条数、同顺序的译文数组 */
  translate(texts: string[]): Promise<string[]>
}
```

三个形状决定，每个都有成因：

- **收发都是数组**。真翻译服务按批收发：一次网络往返的固定开销，摊到多条文本上才划算。接口照真服务的形状开，假翻译器与真服务才是同一个插头；将来把 14 条打进一单、按字符预算分单——真实管线里请求怎么打包、怎么省钱，第 7 章细算，全建立在这个形状上。
- **返回 Promise**。网络往返天然异步。今天的假翻译器同步就能算完，但接口形状照真服务的来——替换成真服务那天，引擎不用改一行。
- **条数与顺序一一对应**。第 i 条原文对第 i 条译文。这是引擎与服务之间的对位协议：引擎按序号把译文发还给各自的块，协议一乱，译文就会张冠李戴。

注意本章引擎的用法：一块一单，每单只装一条文本——接口支持批量，引擎先用最朴素的吃法。

## 假翻译器：同输入永远同输出

```ts
// src/translate.ts · createFakeTranslator
/**
 * 确定性假翻译器：同输入永远同输出，零网络、零密钥、零计费。
 * 默认行为是给原文贴【译】前缀——不真翻译，但保住了「输入完全决定输出」这条
 * 测试与后续章节最依赖的性质；传 dict 可精确指定部分原文的译文，
 * 第 5 章起的格式实验靠它把「译文文字」钉死，只看结构。
 */
export function createFakeTranslator(dict: Record<string, string> = {}): Translator {
  return {
    async translate(texts: string[]): Promise<string[]> {
      return texts.map((text) => dict[text] ?? `【译】${text}`)
    },
  }
}
```

**假翻译器——确定性的假翻译函数：输入固定，输出就固定，让全链路离线可测**。确定性是它全部的身价：翻译过程里没有随机、没有时间、没有网络——`translate(['Hello'])` 今天返回 `['【译】Hello']`，明天、一万次之后，还是它。有了这条性质，测试的期望值才敢写死；掺进任何随机，同一个测试今天绿明天红，红了你也分不清是引擎坏了还是翻译器掷了骰子。

为什么不直接在测试里 stub 一个函数完事？两个原因。其一，stub 只活在测试里，fake 是一个真能跑的实现——等引擎装进浏览器扩展做演示时（全书最后一程），用的还是它：离线、不要密钥、不产生账单。其二，它得长在 Translator 接口上：不满足接口的东西插不进 createEngine，「假得像真的」本身就是要求。锚点一句话：飞行模拟器——飞行员的前十个小时不在真飞机上烧油，模拟器复现全部操纵、复现不出坠机的代价，正因为是假的才敢随便练。

dict 参数是它的第二档：命中的原文给指定译文，没命中的走默认前缀。要验证「译文里的格式对不对」时，文字用词典钉死，眼睛只看结构——内联格式那章靠这招。

## 计数包装器：给引擎开一个观察孔

还有一个测试要回答的问题：「引擎到底发了几次请求？」这件事从外面看不见——translator 是引擎肚子里的事。但它恰恰是要紧行为：一段重复的文本有没有多付钱、二次渲染是不是零请求，批量、去重、缓存的验收全靠「数请求」。看不见，就验不了。

解法不动引擎一根毛：在翻译器外面裹一层，把每次调用的批原样记账，行为原样转发。

```ts
// src/translate.ts · createCountingTranslator
/**
 * 计数包装器：包住任意翻译器，把每次调用的批原样记进 batches，行为原样转发。
 * 它不改翻译结果，只开一个观察孔——引擎内部发请求外面看不见，包一层就看得见了。
 * 测试与 demo 靠它数「到底发了几次、每次带了什么」；批量、去重、缓存的验收
 * 全由它背书（重复段落只请求一次？二次渲染零请求？账单说了算）。
 */
export function createCountingTranslator(inner: Translator): { translator: Translator; batches: string[][] } {
  const batches: string[][] = []
  return {
    batches,
    translator: {
      async translate(texts: string[]): Promise<string[]> {
        batches.push([...texts]) // 记副本：账本不随调用方改数组而变
        return inner.translate(texts)
      },
    },
  }
}
```

观察孔一开，测试从「看结果」升级到「看过程」：结果对不对看译文，过程省不省看账单。注意它自己也满足 Translator 接口——所以它能插进 createEngine，套在任何引擎外面数数。

## 管线组装：三道工序接成一条流水线

三件部件各自都有测试了，可到现在每次用它们，你都在手写胶水：demo 里那个 for 循环——抽块、填译文、逐块渲染。胶水写三遍就该抽成函数，何况这段胶水还背着纪律：失败怎么办、账怎么记。**管线组装——把抽取、翻译、渲染三道工序接成一条流水线，一次调用跑完全程，返回一张成绩单**。锚点就是工厂流水线本身：工件从上一道工序传到下一道，每道只干自己的活。

```ts
// src/pipeline.ts · runPipeline（终态；第 8 章起，抽完块就交给块级入口 runBlocks）
/**
 * 整页入口：抽块，然后交给块级入口。
 *
 * 两条全书纪律不变（在 runBlocks 的循环里）：
 * ① 逐块降级——单块翻译失败（网络抖动、服务限流）不炸整页：保留原文、跳过该块，
 *    异常吃在本块内，绝不向上抛（引擎错误处理的全书约定）；
 * ② 失败也记账——发出过的请求就算数（requests 先加再调），成绩单反映真实开销。
 */
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

流水线的身体在下一个函数里——本章立的串行循环原样住到全书最后：

```ts
// src/pipeline.ts · runBlocks（终态；本章的循环体一个字没变，第 8 章只是给它开了个门）
/**
 * 块级入口（第 8 章立）：抽取之后的身体全在这——整页 run 与观察者的增量从这里合流，
 * 走同一条档位分支、同一套降级纪律。观察者带着「新上树的块」直接进场，
 * 不必为几个新段落把整棵树重抽一遍。
 */
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
  let rendered = 0
  let requests = 0
  for (const block of blocks) {
    try {
      requests++ // 先记账再发车：失败的请求也是真实开销
      if (preserveInline) {
        // 第 5 章接线：整块织成一个带占位记号的翻译单元，渲染端按索引重建内联结构
        renderSegments(block, await translator.translate(splitSegments(block)))
      } else {
        const [translated] = await translator.translate([block.text]) // 一块一单
        renderBilingual(block, translated)
      }
      rendered++
    } catch {
      // 逐块降级：这块没译文，原文原样留在页面上，其余块照常
    }
  }
  return { blocks: rendered, requests, cached: 0 } // cached：串行朴素档没有缓存，恒 0
}
```

（文件头有八行 import：`extractBlocks` 来自第 2 章的 `./extract`，`renderBilingual` 来自第 3 章的 `./render`，`renderSegments` 与 `splitSegments` 来自第 5 章的 `./inline`，`detectMainContent` 来自 `./content`（认正文容器，后面接上），`chunkByBudget` 与 `createLimiter` 来自 `./batch`（打包与限流，同样后面接上）——`Translator`、`TranslationCache`、`EngineStats`、`TranslatableBlock` 四个类型是 `import type`，只借类型不产生运行时代码；流水线的三道工序，就是前面几个模块加一张成绩单。）

逐行看这条流水线。抽块那行 `extractBlocks(scope)`：那趟树遍历，跳过规则原样生效——nav、footer、code 整枝剪掉，回来的 14 个可译块（直接持有文本的块级元素），每个的 `text` 就是它的直接文本。循环体一次处理一块：把文本装进单条数组发给 translator（接口收数组，那就给它数组），等回包，交给 `renderBilingual`——兄弟节点插入、标记属性、幂等，第 3 章的全部纪律原封不动地带了过来。最后返回成绩单。（下一章在这条循环里加了一个分支：`preserveInline` 开着时改走占位记号的 `splitSegments`/`renderSegments`，保住译文里的加粗、链接与行内代码；再后面一章又在循环前面加了一道收窄：`mainContentOnly` 开着时先认正文容器、在它身上抽块——`scope` 说的就是这件事；批量与省钱那一章再加一个档位分支：`concurrency` 或 `cache` 任一传入就改走批量档的 `runBatched`，去重、缓存、打包、限流。三处接线全部默认关，本章的行为一寸不变。再往后的动态内容那一章，把循环体连同档位分支搬进 `runBlocks` 当块级入口——观察者带着新上树的块从这里进场，循环体本身一个字没变；正文各见其章。）

串行是刻意的：一次只发一单，等回包再发下一单。14 块就是 14 单，200 段就是 200 单——朴素，但链路是通的。每翻一块就插一个译文节点，浏览器要为这一带重新算一遍布局（重排，第 1 章记过这笔账）——串行朴素版的代价，先记在账上。并发上限、打包、缓存这些省钱手段，都要在一条能跑的流水线上再加：先对，再快，再省。

## 成绩单与降级：一块 503，整页不倒

```ts
// src/engine.ts · EngineStats 与 Engine
/**
 * run 的成绩单：本轮跑出来的数字，测试与 demo 的账本。
 * blocks＝渲染了译文的块数（失败降级的不算）；requests＝发出的翻译调用数
 * （批量档一单可带多条，数的是单不是条）；cached＝命中缓存的送翻单元数
 * （去重后口径——去重省的不记这里，记这里的都是缓存从上一轮手里接下的）。
 */
export interface EngineStats {
  blocks: number
  requests: number
  cached: number
}

/**
 * 引擎本体：装配一次，可跑任意棵树（与树解耦；useCache 开启时引擎攒下缓存
 * 这一份内部状态——树换了它不换，第 7 章）。
 * run 翻整棵树；runBlocks 翻现成的块——第 8 章的观察者带着「新上树的块」从这里进场，
 * 与整页 run 走同一条档位与降级纪律。
 */
export interface Engine {
  run(root: ParentNode): Promise<EngineStats>
  runBlocks(blocks: TranslatableBlock[]): Promise<EngineStats>
}
```

成绩单三个数字，口径都写死在注释里：blocks 只数渲染成功的（失败降级的不算）；requests 数发出过的调用（失败的那次也算——请求确实发过，钱确实花了）；cached 恒 0，等内容寻址缓存接线（去向见章末地图）。

降级为什么这样设计？真服务会抖：限流、超时、5xx（500 到 599 这段状态码，意思都是「服务器那头出了问题」，跟你的请求写对没写对无关）。一块翻译失败，最坏的应对是让异常一路炸出去——整页白屏，一段没翻好连累十三段陪葬。约定反过来：异常吃在本块内，保留原文、跳过该块、其余照常。**翻译是页面的增强，不是页面的生死要件**——13 段翻好的双语页依然可用；全部翻不出来才是事故。你可以在验证槽亲手把一条 503 塞进翻译器，看整页怎么活下来。

## 演练：从红到 createEngine

靶子：8 条测试，全部断言行为。第 1 步，测试先红。头一条钉「一键整页双语」：

```ts
// tests/pipeline-service.test.ts · 一键整页双语
  it('一键整页双语：不传 translator 也能跑（内置假翻译器），14 块逐块成对，原文一字未动', async () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const before = blocks.map((b) => b.element.outerHTML)
    const stats = await createEngine().run(doc.body) // 零配置、零网络、零密钥
    expect(stats).toEqual({ blocks: 14, requests: 14, cached: 0 }) // cached 本章恒 0
    expect(doc.querySelectorAll(`[${OWN_ATTR}]`).length).toBe(14)
    for (const b of blocks) {
      const zh = b.element.nextElementSibling! // 每块原文的正后方都是自己的译文
      expect(isOwnNode(zh)).toBe(true)
      expect(zh.textContent).toBe(`【译】${b.text}`) // 译文内容来自假翻译器，不是手填
    }
    expect(blocks.map((b) => b.element.outerHTML)).toEqual(before) // 第 3 章的纪律在管线里继续成立
  })
```

此刻 `src/translate.ts` 与 `src/engine.ts` 都不存在，跑一遍，红在 `Failed to resolve import "../src/translate"`——与第 2、3 章同一个仪式，渐进语义的机械证明。

第 2 步，translate.ts：接口、假翻译器、计数包装器（上文三段就是全文）。第 3 步，pipeline.ts：`runPipeline` 与 `runBlocks` 全文也在上文（终态）。第 4 步，engine.ts 的装配层：

```ts
// src/engine.ts · createEngine
/**
 * 组装引擎：默认全离线（内置假翻译器）；要接真服务，从 translator 传进来。
 * 引擎从上到下没有一行代码认识任何具体翻译服务——换服务、换假实现，
 * 都只是换一个满足 Translator 接口的对象，引擎零改动。
 */
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

`EngineOptions` 里此刻还立着 concurrency、useCache、mainContentOnly、preserveInline 四个字段。本章一个都不吃——它们是后续章的生长点，先占好位置：公共接口只增不破，形状现在定稳，后面只往里填行为（哪章吃哪个，见章末地图）。转绿：16 旧加 8 新，24 条全绿。

demo 三幕摆上柜台（打印语句有删节，输出是真实的）：

```ts
// demo/engine-demo.ts · 三幕的核心调用（拼版·教学示意：打印语句从略，完整输出见下）
const stats = await createEngine({ translator: createFakeTranslator(dict) }).run(doc.body)

const counting = createCountingTranslator(createFakeTranslator())
const stats2 = await createEngine({ translator: counting.translator }).run(doc2.body)

const stats3 = await createEngine({ translator: flaky }).run(doc3.body) // flaky：碰到 plugin system 就抛 503
```

```text
// companion · npm run demo:engine 的真实输出（节选）
=== 第一幕：createEngine({ translator: createFakeTranslator(dict) }).run(doc.body) ===
成绩单：14 块渲染 / 14 次请求 / 0 次缓存命中

=== 整页双语 HTML（main 区域） ===
<h2>Lightweight DOM library hits version 2.0</h2><p data-duo="1">轻量 DOM 库发布 2.0 版</p>
<p class="byline">By Jane Doe</p><p data-duo="1">【译】By Jane Doe</p>
<p class="date">Nov 8</p>
<p>The library, famous for its three-kilobyte bundle, ...</p><p data-duo="1">【译】The library, famous for ...</p>
（中略：pre/code 原样无译文、blockquote 与列表逐块双语、侧栏两个 li 照翻）

=== 第二幕：createCountingTranslator 数出的请求账单 ===
块数 14，发出的请求 14 单，每单条数：1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1 + 1
第一单内容：["The Daily Byte"]

=== 第三幕：一块 503 ===
成绩单：13 块渲染 / 14 次请求（失败那次也真发过）；页面译文节点：13
挂掉那段的原文（原样躺着，身后没有译文）：
<p>The library, famous for its three-kilobyte bundle, now ships with a plugin system. ...</p>
```

输出里有三处值得抬眼看。词典命中的 h2 拿到指定译文「轻量 DOM 库发布 2.0 版」，其余走【译】前缀——引擎零改动，产出跟着插头变，这就是「依赖注入可换实现」那条测试的现场版。第一单内容是 `["The Daily Byte"]`——header 里的 h1 也成块送翻（跳过规则剪的是 nav 与 button，没剪 header，第 2 章留的活口）。第三幕里那块 503 的原文原样躺着、身后没有译文，其余 13 块照常双语——降级不是降质，是止损。

还有两处坑，这次先记下、后面专章处理。加粗段落 `significant speedups` 的译文里 strong 没了，`mount()` 这个行内 code 从译文里整个消失——剪行内代码、纯文本往返拍平内联元素的两笔账，都由内联切分与占位标记来还（去向见章末地图）。li 的译文 p 落在 ul 里，第 3 章已登记进差异清单，不再重复记账。

## 验证：先猜，再开机

每一条先写下预言，再看输出。

1. 亲手开机：`cd companion` 后跑 `npm run demo:engine`。跑之前先猜成绩单的两个数，再猜两件事：blocks、requests 各是多少？词典没命中的块，译文长什么样？503 那段原文的下一个兄弟节点是什么？
   应看到：14 与 14；【译】加原文全文；下一个兄弟是那段紧随其后的译文 p——不，503 那段身后什么都没有，紧跟着的是下一段原文。再对一眼第一幕的输出：pre/code 的原文原样无译文（main 区域内可直接核对）；nav、footer 不在打印范围里，但 14 块的总数、加上第一单内容是 header 的 h1，侧面印证跳过规则在管线里照常生效。
2. 指认好的小破坏：打开 `src/pipeline.ts`，把 `catch {` 那一块改成 `catch (e) { throw e }`——引擎失去降级能力。先猜哪条测试红，再跑 `npm test`。
   应看到：只红「逐块失败降级」一条——flaky 翻译器的 503 直接炸出 run。其余七条照绿：它们不制造失败，验的是别的。改回去，恢复全绿。
3. 再来一个小破坏：打开 `src/translate.ts`，把 `batches.push([...texts])` 这行删掉——观察孔闭上眼。先猜红几条，再跑。
   应看到：红两条——「计数包装器」与「计数观察孔数出请求账单」，都靠 batches 对账。引擎照跑、译文照出：观察孔管的是过程账，不是结果。
4. 控制台自包含：依赖注入的最小形态，一个满足接口的对象而已。在任意 Node 或浏览器控制台贴这三行：
   ```js
   // 用法示例——自包含，不依赖伴生仓
   const reverser = { async translate(texts) { return texts.map((t) => [...t].reverse().join('')) } }
   await reverser.translate(['Hello', 'World']) // → ['olleH', 'dlroW']
   ```
   应看到：`['olleH', 'dlroW']`——这个对象没引用伴生仓任何东西，一个 `translate` 方法就够格当 Translator。给它包一层 `createCountingTranslator`，它就能进伴生仓的引擎。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，24 个测试全绿（第 2 章 9 个、第 3 章 7 个、本章 8 个——旧章测试持续全绿，公共 API 没破的哨兵还在岗）。

## 小结：CI 为什么一分钱不花，全链路照样测

回头看开篇那个冲动：接个真 API，三行代码。现在你知道那三行该写在哪了——也不写在那儿：真服务的适配器只该住在 translator 插头里，密钥、计费、流式这些接真 API 的差异，登记进书末差异清单附录；引擎与全部 24 条测试跑在假翻译器上——零网络、零密钥、零账单，CI 想跑多少遍就跑多少遍。上章欠的账还清了：手填的译文字符串换成确定性的假翻译器，抽取、翻译、渲染串成一条流水线，`createEngine().run(root)` 一键整页双语。四部件首版全部就位；装配的最后一程——装进真实浏览器——留给第 9 章。

攥着的引信也还在：渲染后再抽取，14 变 28——译文会被当成新原文再翻一遍，译文生译文的「自触发循环」从这里起步。管线版的解法（认出标记属性、只翻新增）在 MutationObserver 那一章拆；这条引信是它的前置功课。另一个小尾巴本章已经露头：接口收一批、引擎发一单——这个落差的账，挂在章末地图。

### 自查三问

先自己答，再展开对照。

::: details 1. 预测：把 Translator 接口从 `translate(texts: string[])` 改成 `translate(text: string)`，单条进出。眼下本章哪些测试还能绿？后面「批量与省钱」的哪个承诺最先崩？
眼下多半还能绿——引擎反正一块一单。先崩的是打包与省钱：按字符预算把 200 段分成几单、并发控制每单在飞的数量，全都建立在「一次调用能带一批」上；接口一改，批量与省钱的行为没有落脚点，还得回头改引擎。依赖注入的要点正在这：插头形状一次定稳，按真服务的形状定。回查「接口为什么长这样」。
:::

::: details 2. 引擎的 `stats.requests` 与计数包装器的 `batches.length` 是两本账。谁是事实源？它们什么时候会不相等？
事实源是 `batches.length`——它记的是「真实发生了的调用」；`stats.requests` 是引擎的自报账本。眼下两本账相等（有一条测试专门互证）。缓存接上之后：缓存命中的块不发调用，`batches` 不增长、`requests` 不增长，两本账继续相等；引擎把命中的句数记进 `cached`——在不失败的前提下，那时 blocks 与 requests 的差额，就是去重、缓存与打包共同省下的。回查「计数包装器」与「成绩单」的口径注释。
:::

::: details 3. 动手：写一个 `createDelayTranslator(inner, ms)`——给每次翻译加固定延迟再转发。它插得进 createEngine 吗？往测试里插它，代价是什么、值不值？
插得进：满足 Translator 接口的就是翻译器，包装器与被包者都满足。往测试里插它的代价是全套测试慢一截——而延迟换来的信息（调用顺序、次数）观察孔本来就能拿到，一分钱不用多花。延迟该用在 demo 里演示「译文逐段落地」的节奏，不是测试里。回查「计数包装器」与验证槽第 4 条。
:::

### 接下来去哪

| 章 | 接过管线做什么 |
|---|---|
| 05 | 内联切分与占位标记：加粗、链接、行内代码在译文里活回来 |
| 06 | 链接密度启发式认主内容区：额度不再花在导航侧栏上 |
| 07 | 批量、并发上限与内容寻址缓存：一块一单的账，重新算 |
| 08 | MutationObserver 增量翻译：标记属性上第二战场，拆掉 14 变 28 的引信 |
| 09 | content script 与 manifest：引擎装进 Chrome，插头继续换——演示仍用假翻译器 |
