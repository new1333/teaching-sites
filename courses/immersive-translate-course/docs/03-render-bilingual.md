---
title: 双语渲染：原文纹丝不动，译文插到下面
---

# 双语渲染：原文纹丝不动，译文插到下面

## 上章留下的问题

第 2 章结束时，跳过规则筛过整页，引擎眼里那张新闻页剩下 14 个可译块——每个块是一个 `TranslatableBlock`，`element` 字段装着节点本体，`text` 字段装着它的直接文本。可它们还只是一张清单：译文从哪来、插到哪去，一个都没解决。上章末欠的账你还记得吗——「这批块交出去做什么」？这一章还账：做出四部件里的第三个，渲染。

## 一行代码的代价

demo 已经能抽出可译块了，组里同事扫了一眼说：这还不简单，把译文接到段落后面，一行的事：

```js
// 用法示例——同事的一行代码（别在生产页面跑）
p.innerText += '\n' + translated
```

一行代码上线，第二天用户反馈就来了：段落里的链接点不动了。链接消失得干干净净——不是样式问题，`<a>` 节点根本不在了。用 innerText 追加译文，走的是赋值：子元素被清掉，整段重建成一串全新的纯文本节点（换行处是个 `<br>`），加粗、链接、行内代码连同挂在它们身上的监听器，一起陪葬。译文倒是显示出来了，代价是原文的结构。

这个事故值得拆到底：直觉里 `+=` 是「在后面添一点」，为什么实际是「全拆重建」？这章就把这条路线拆开看清楚，然后换一条根本碰不到原文的路。

## 重写原文这条路，整个是死的

先把你心里的直觉摆到桌面上——往段落里加译文，最自然的写法不就是改它自己的 `innerText` 或 `innerHTML` 吗？这一节当场证伪。

`p.innerText += x` 不是一步，是两步：先读，`p.innerText` 把整段渲染文本拍平成一个字符串——树的结构信息当场丢失，加粗和链接这类内联元素的边界在字符串里不存在；再写，`p.innerText = 拼好的串` 触发赋值。而 WHATWG 的 HTML 标准给 innerText 赋值的定义是：拿一批全新节点替换掉全部子节点（replace all）——赋值串拆成文本节点序列，换行处转成 `<br>` 元素；`textContent` 赋值更简单，DOM 标准规定它拿单个新文本节点替换全部子节点。也就是说，**赋值这个动作本身就是「清空重建」**——不管你赋的是拼接串还是新句子。`innerHTML` 赋值更狠，走的是「字符串重新解析成新节点」——第 1 章演练里你亲手废掉的那个按钮，走的就是这条路。

反事实检验：如果不用「重写原文」的路线，会怎样？反过来问更清楚——重写路线下哪一条罪能逃掉？

- 子元素销毁：`strong`、`a`、行内 `code` 全部清掉，段落被切断成一根纯文本绳子；
- 监听器死亡：挂在旧节点对象上的事件监听器随旧节点一起出局——「链接点不动了」的机制层解释；
- 原文消失：译文顶掉了原文的位置，双语对照的定义直接破产。

第三条最要命。**双语对照的本质是树上多出一排节点，不是某个节点的内容变了样**——「对照」要求原文与译文同时在树上都活着，改内容最多做到「换」，永远做不到「对照」。所以不动原文不是代码洁癖，是产品定义推导出的硬约束。

顺带交代一件事：伴生仓跑在 jsdom 里，而 jsdom 没有实现 `innerText`——算「渲染文本」需要排版引擎，jsdom 没有。这章的反事实实验用 `textContent` 复现，两个 setter 的赋值语义同族，物理是同一套。

## 兄弟节点插入：给译文一个不占原文的位置

路线换到树上：不往原文**里面**写任何东西，把译文作为**兄弟节点插入**——兄弟（sibling）是 DOM 树里的说法：同一个父亲名下的两个孩子互为兄弟。要插的槽位就一个：原文的正后方，也就是 `nextElementSibling` 站的那个位置。

第 1 章演练用过 `p.after(zh)`，它等价于 `insertBefore(zh, p.nextSibling)`，也等价于这章用的 `insertAdjacentElement('afterend', node)`——三种写法，同一个位置，选顺手的。

为什么是兄弟、不是塞进原文当孩子？三条理由，每条都答得出反事实：

- **原文子树零接触。** 译文不在原文的 childNodes 里，原文的 `outerHTML` 一个字节不变——这给了本章测试一个最强断言：渲染前后序列化逐字相同。塞进原文？「一个字不动」连表述都不成立了。
- 不搅原文的排版。译文进了原文子树，就要吃原文的行高、缩进，连 `::first-line` 这类伪元素选择器都会捎带上它。
- 语义上译文不是原文的一部分。它是一个新段落，是树的新成员，与原文平级——放对层级，后面的部件（增量、缓存、重复渲染）才都有干净的边界。

第 1 章自查里你预测过「appendChild 插成孩子会怎样」：译文被算进原文的排版本体，下次抽取时「原文加旧译文」被当成新原文。兄弟位置天然没这个问题——不过它有另一个引信，本章末尾看。

译文节点用什么标签？原文是块级元素，译文要独占一行落在正下方，自己也得是块级——用 `p`。它不带原文的 class 和属性，样式自己管（钩子马上到）。一个如实声明的取舍：`li` 的译文也是插在列表项外的正下方，按 HTML 内容模型 `ul` 里只该装 `li`——浏览器照常渲染，这个观感偏差登记进书末差异清单。

## 节点从哪来：出生证找这棵树自己开

要插一个新节点，先得把它造出来。直觉写法是 `document.createElement('p')`——全局 `document`。问题藏在这个「全局」上。

demo 脚本跑在纯 Node 里（tsx），根本没有全局 `document`；就算有，一份进程里也可以同时活着好几棵树——测试里每个用例 new 一份 JSDOM，就是好几份文档并存——全局只有一个，凭什么指到你正要插的这棵？

解法是问节点自己要工厂：`block.element.ownerDocument`——每个节点身上都带着「我属于哪份文档」的引用，ownerDocument 就是那份文档对象。从它 createElement，译文天生属于正确的树，也不依赖任何全局。这章 demo 的第一行就打印了 `typeof document`，输出是 `undefined`，demo 照样跑通——出生证找这棵树自己开的证据。

## 标记属性：引擎怎么认出自己人

树上多出来的每个译文节点，都要打一个记号：`data-duo="1"`。这叫**标记属性——插入译文节点时打上的 data-* 属性，引擎靠它认出自己的产出**。为什么必须打？因为引擎总有一天要回答「这个节点是不是我插的」，而这道题没有别的解法——DOM 不会替你记住节点的出身。

这个记号至少有三个用武之地，本章用第一个：

1. 幂等：重复渲染前，先看原文身边有没有自己的译文——有就不再插；
2. 增量抽取时把译文从「新原文」里摘出去——本章末尾的 demo 会把这个引信点给你看，第 8 章拆；
3. 样式钩子：`[data-duo]` 天然是 CSS 选择器，给译文上浅色样式这类活，属性选择器这套路在真实引擎里也常见。

为什么用 `data-*` 前缀？HTML 标准把 `data-` 开头的属性留作页面自定义数据的地界，页面作者自己的属性几乎不会叫这个名——撞车面小。为什么不用 class？class 是样式协议地带，页面作者和框架天天在用，往里挤是自找冲突。判定只看「有没有」（`hasAttribute`），不看值——值 `"1"` 是给人看的，语义是「这节点是我生的吗」，是或不是，二值。

## 幂等：做一次和做多次，结果相同

最后一块拼图。**幂等（idempotent）——同一操作做一次和做多次，结果相同**：一段原文渲染一次，树上是「原文加一段译文」；渲染一百次，还是「原文加一段译文」，不多不少。

为什么渲染必须幂等？反事实：不幂等会怎样？用户重复点翻译按钮是最基本的操作；往后看，等引擎长出变化监听，页面每次变化它都要重新处理，同一块被反复光顾是常态。每次重复都多插一份译文，滚几轮就是译文叠译文——第 1 章验证槽你亲手插出过两份「【译文】提交」，那就是不幂等的样子。成本上还有一笔：每次插入都引发一次重排（浏览器重新计算这一带的布局，第 1 章记过这笔账），重复插入是白白多付的重排。

实现是三行的「先认后插」：插入之前，先看原文紧邻的下一个兄弟是不是自己人（`isOwnNode`）。是——原地刷新那个节点的文本，返回它；不是——新建、打记号、插到正后方。于是同一输入怎么重复，树都是同一个形态。附带一个有用的语义：重译刷新——第二次调用的译文文字变了（用户改了词重跑），节点还是那个节点，文本原地换新，不产生垃圾节点。

诚实边界：认领范围只到「紧邻的下一个兄弟」。如果有脚本往原文与译文中间插了一个广告节点，引擎会判定「这里没有我的译文」，再插一份。要防这种，得让译文记住自己属于哪块原文——更强的认领，本章不展开，够用的部分先用着。

## 演练：从一行事故到 renderBilingual

靶子先立：7 个测试，全部断言行为。第 1 步，测试先红。第一个测试把「插在哪、长什么样」钉死：

```ts
// tests/render-bilingual.test.ts · 第一个测试
  it('译文节点插在原文正后方：块级 p、带标记属性、文本正确、与原文同属一棵文档', () => {
    const doc = parseHTML(NEWS_PAGE_HTML)
    const blocks = extractBlocks(doc.body)
    const strongP = blocks.find((b) => b.text.includes('significant speedups'))!
    const zh = renderBilingual(strongP, '早期用户报告在树密集的工作负载中有显著提速……')
    expect(zh.tagName).toBe('P') // 原文是块级，译文也用块级标签才能独占一行落在正下方
    expect(zh.hasAttribute(OWN_ATTR)).toBe(true)
    expect(zh.getAttribute(OWN_ATTR)).toBe('1')
    expect(zh.textContent).toBe('早期用户报告在树密集的工作负载中有显著提速……')
    expect(strongP.element.nextElementSibling).toBe(zh) // 位置：紧跟原文的下一个兄弟
    expect(zh.isConnected).toBe(true)
    expect(zh.ownerDocument).toBe(strongP.element.ownerDocument) // 出生证来自这棵树，不是别处
  })
```

「为什么不能重写原文」不是嘴上说说，它有一条专门的对照测试——同一个段落，两条路线各跑一遍：

```ts
// tests/render-bilingual.test.ts · 反事实对照测试
  it('反事实对照：textContent 追加路线销毁子元素——同一个段落，两条路两种结局', () => {
    // jsdom 未实现 innerText（算「渲染文本」需要排版引擎），用同族语义的 textContent 复现钩子：
    // 两个 setter 在规范里都是「清空全部子节点、替换成全新节点」（innerText 拆段、换行转 <br>，
    // textContent 塞单个文本节点）——重写路线，销毁结构。
    const html = '<div><p>Use <a href="/x">strict mode</a> in production.</p></div>'
    // 路线 A：插兄弟节点
    const docA = parseHTML(html)
    const pA = docA.querySelector('p')!
    const beforeA = pA.outerHTML
    renderBilingual({ element: pA, text: pA.textContent ?? '' }, '在生产环境使用严格模式。')
    expect(pA.querySelector('a')).not.toBeNull() // 链接还在
    expect(pA.outerHTML).toBe(beforeA) // 原文没被动过
    // 路线 B：往原文自己的文本属性里追加
    const docB = parseHTML(html)
    const pB = docB.querySelector('p')!
    pB.textContent += '\n在生产环境使用严格模式。'
    expect(pB.querySelector('a')).toBeNull() // 链接消失
    expect(pB.childNodes.length).toBe(1) // 只剩一个纯文本节点
  })
```

此刻 `src/render.ts` 还不存在，跑一遍，红在 `Failed to resolve import "../src/render"`——渐进语义的机械证明，与第 2 章同一个仪式。

第 2 步，记号与判定。三行：

```ts
// src/render.ts · OWN_ATTR 与 isOwnNode
/**
 * 标记属性名：引擎插入的每个译文节点都打这个记号。
 * 认自己人全靠它——重复渲染不重复插（本章），第 8 章变化监听还要靠它
 * 把译文从「新原文」里摘出去。data-* 前缀是 HTML 留给页面自定义数据的属性地界，
 * 不会跟页面作者的属性撞车；它还顺手是 CSS 选择器（[data-duo]），样式钩子白送。
 */
export const OWN_ATTR = 'data-duo'

/**
 * 判定一个元素是不是引擎自己插入的译文节点。
 * 只看「有没有标记属性」，不看值——值（"1"）是给人看的，判定语义是「这节点是我生的吗」。
 */
export function isOwnNode(el: Element): boolean {
  return el.hasAttribute(OWN_ATTR)
}
```

第 3 步，主函数。这一章的全部原理落进十来行：

```ts
// src/render.ts · renderBilingual
/**
 * 把译文渲染成可译块的正后方兄弟节点，返回译文节点；幂等。
 *
 * 三条纪律都在这十来行里：
 * ① 只插不改——原文的子树一个字节不碰，监听器、状态、行内结构原封不动；
 * ② 先认后插——紧邻的下一个兄弟若已是自己的译文，原地刷新文本并返回它，
 *    不产生第二份（认领范围只到紧邻兄弟：中间被别人插了节点，引擎会当它没有译文）；
 * ③ 出生证找这棵树自己开——ownerDocument 是节点所属的文档对象，
 *    不依赖全局 document（Node 与测试环境里它可能不存在，或不是这棵树）。
 */
export function renderBilingual(block: TranslatableBlock, translated: string): Element {
  const existing = block.element.nextElementSibling
  if (existing !== null && isOwnNode(existing)) {
    existing.textContent = translated // 重复调用：刷新旧译文的文本，节点还是那个节点
    return existing
  }
  // 原文是块级元素，译文也用块级标签 p——独占一行，才能落在正下方；
  // 不带原文的 class 与属性：译文自己管自己的样子（样式钩子就是 [data-duo]）
  const node = block.element.ownerDocument.createElement('p')
  node.setAttribute(OWN_ATTR, '1') // 先打记号再上树：从挂上那一刻起它就是「自己人」
  node.textContent = translated
  block.element.insertAdjacentElement('afterend', node) // 插在原文正后方当兄弟，等价于 after()
  return node
}
```

七行实现、七条测试，转绿。剩下五条测试钉的全是本章概念：原文 outerHTML 逐字不变、监听器存活、幂等两连（同文重复拿同一节点、换文原地刷新）、整页 14 块各领一段译文、isOwnNode 的判定边界。

demo 把整件事摆上柜台——同一个段落，两条路线并排跑（打印语句从略，完整输出见下）：

```ts
// demo/render-demo.ts · 两条路线的核心调用（拼版·教学示意：打印语句从略，完整输出见下）
renderBilingual(strongP, '早期用户报告在树密集的工作负载中有显著提速，不过也有人怀念更简单的旧 API。')

const p2 = extractBlocks(doc2.body).find((b) => b.text.includes('significant speedups'))!.element
p2.textContent += '\n早期用户报告在树密集的工作负载中有显著提速……'
```

```text
// companion · npm run demo:render 的真实输出（节选）
本 demo 跑在纯 Node 里：全局 document 的类型是 undefined

=== 渲染前：原文（一段带加粗的段落） ===
<p>Early users report <strong>significant speedups</strong> in tree-heavy workloads, though some miss the simpler old API.</p>

=== 路线 A · renderBilingual 之后 ===
原文（一字未动）：
<p>Early users report <strong>significant speedups</strong> in tree-heavy workloads, though some miss the simpler old API.</p>
紧跟其后的译文：
<p data-duo="1">早期用户报告在树密集的工作负载中有显著提速，不过也有人怀念更简单的旧 API。</p>
子元素点名：strong 还在吗 → true

=== 路线 B · 同事的一行代码（textContent +=；jsdom 未实现 innerText，两者同族语义） ===
<p>Early users report significant speedups in tree-heavy workloads, though some miss the simpler old API.
早期用户报告在树密集的工作负载中有显著提速……</p>
子元素点名：strong 还在吗 → false
结局：子元素被清掉重建成了纯文本节点——行内结构与监听器一起陪葬。

=== 整页逐块渲染 ===
译文节点数：14；原文 outerHTML 逐字未变：true

=== 幂等：同一批块原样再渲染一遍 ===
译文节点数：14 → 14（不变——重复调用不产生第二份译文）

=== 抬眼一看：渲染后再跑一遍抽取 ===
可译块数：14 → 28（多出来的全是刚插的译文——「译文生译文」的引信）
```

演练里还踩过一个真 bug，值得记下。demo 第一版把块直接当节点用——`p2.textContent += …` 写在了 `TranslatableBlock` 上而不是它的 `element` 字段上。普通对象没有这个属性，赋值默默创建了一个同名属性，随后 `p2.outerHTML` 打出 `undefined`、`p2.querySelector` 直接不是函数。两个教训：**`TranslatableBlock` 是「块」不是「节点」，`element` 字段才是本体**；以及运行顺序——typecheck 本可以在写码当下拦住它，先跑后查就是把它放到了运行时才爆。

## 验证：先猜，再渲染

每一条先写下预言，再看输出。

1. 亲手开机：`cd companion` 后跑 `npm run demo:render`。跑之前先猜四个：译文节点会带原文的 class 吗？路线 B 里那段译文的 `<strong>` 标签还在吗？整页渲染后再原样渲染一遍，data-duo 节点数变不变？渲染完再跑一遍抽取，块数变多少？
   应看到：译文不带原文任何属性，只有 `data-duo="1"`；路线 B 里 strong 没了（整段成了纯文本）；重复渲染 14 → 14；重抽 14 → 28——多出来的 14 个全是译文自己，引信见小结。
2. 指认好的小破坏：打开 `src/render.ts`，把 `if (existing !== null && isOwnNode(existing))` 改成 `if (false && existing !== null && isOwnNode(existing))`——引擎失去认领能力。先猜哪几条测试红，再跑 `npm test`。
   应看到：幂等两条全红（重复调用拿到了新节点、全页多出一倍译文），其余照绿。改回去，恢复全绿。
3. 再来一个小破坏：把 `insertAdjacentElement('afterend', node)` 改成 `'beforebegin'`——译文插到原文**上方**。先猜红哪些，再跑。
   应看到：四条红——「正后方」一条、幂等两条、外加「整页渲染」（它断言每段译文的紧邻前身就是自己的原文，位置一错必红）。位置错了，紧邻兄弟的认领跟着失效，重复调用照样叠译文；位置与幂等在实现里咬合，破坏哪半边另一半都塌。
4. 控制台自包含：找个带链接的真实段落（浏览器里 `innerText` 是实现了的），控制台跑 `const p = document.querySelector('p'); console.log(p.innerText += '\n测试')`。
   应看到：译文出现在段尾的同时，链接变回裸文字、点不动了——`+=` 糖衣下的整体重写，浏览器里亲手复现。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令零报错，16 个测试全绿（第 2 章 9 个加本章 7 个——旧章测试持续全绿，是公共 API 没被破坏的哨兵）。

## 小结：链接为什么点不动，你现在能亲口解释了

回头看开篇那个事故。用户的链接点不动，机制层一句话：`innerText` 赋值的规范语义是拿全新节点替换全部子节点（换行处是 `<br>`）——`+=` 的糖衣之下，先拍平、后重建，子元素与监听器一起出局。而你的 `renderBilingual` 走的是另一条路：兄弟节点插入、标记属性、先认后插的幂等。原文 `outerHTML` 一个字节不变，这不是口头承诺，是测试逐字钉住的断言。

四部件已经交付两件：抽取给出「翻谁」，渲染给出「译文放哪、怎么放」。这章 demo 里的译文还是手填的字符串——第 4 章管线接棒，用依赖注入把翻译服务装进来，手填的字符串换成确定性的假翻译器，全链路离线可测。还有一个引信攥在手里：渲染后再抽取，14 块变 28 块——译文被当成了新原文，这正是「译文生译文」自触发循环的起点；标记属性的第二战场在第 8 章。

### 自查三问

先自己答，再展开对照。

::: details 1. 页面作者自己在一个 `<p>` 上写了 data-duo="1"（他不知道引擎也用这个名字）。引擎随后渲染这个块，再渲染一次，各会发生什么？这个风险的根源是什么？
第一次：块的正后方还没有紧邻的自己人（作者那个 p 就是原文本体），照常插入译文。第二次：认领看的是「原文的下一个兄弟」，还是碰不到作者那个节点——但如果作者的元素恰好插到了原文紧后方，就会被误认成已有译文，文本被改写。根源：data-* 是共享地界，挑冷门名字只能降低碰撞概率，不能消灭；命名前缀是工程惯例，不是规范保证。回查「标记属性」一节。
:::

::: details 2. 预测：把译文节点从 createElement('p') 改成 createElement('span')，哪条测试会红？页面上观感会怎么变？为什么测试连标签都要钉？
红的是「译文节点插在原文正后方」——它断言 tagName 是 P。观感：span 默认内联（display: inline，第 2 章的默认样式表），译文不再独占一行，挤在原文尾巴后面。测试钉标签，是因为「译文必须块级」是这个部件的契约本身——p 就是块级约束在代码里的化身。回查「兄弟节点插入」与演练。
:::

::: details 3. 译文插好后，页面脚本把原文整段删了。树上还挂着什么？谁该负责清理？为什么本章还不用管？
还挂着那段 `data-duo` 译文——它成了没有原文的孤儿，仍渲染在原位。清理它需要「看见原文被删」的机制，那是变化监听（MutationObserver）的辖区——它能收到「哪个节点被移除」的记录，全书后面专门有一章管活页面。本章的调用场景是静态页一次渲染，孤儿不会出现——知道它在哪等着，就够了。回查「幂等」的边界声明与「标记属性」的三个用武之地。
:::

### 接下来去哪

| 章 | 接过渲染部件做什么 |
|---|---|
| 04 | 管线：依赖注入翻译服务，假翻译器替掉本章手填的译文字符串 |
| 05 | 内联切分与占位标记：译文里的加粗和链接保住 |
| 06 | 链接密度启发式认正文区，导航侧栏不再送翻 |
| 07 | 并发上限与内容寻址缓存：同样的句子只付一次钱，重译命中缓存原地刷新 |
| 08 | MutationObserver 增量抽取：标记属性上第二战场，防译文生译文 |
| 09 | content script 与 manifest：装进 Chrome，真实页面见 |
