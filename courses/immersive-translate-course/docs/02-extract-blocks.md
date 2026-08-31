---
title: 可译块：找到直接持有文字的节点
---

# 可译块：找到直接持有文字的节点

## 上章留下的问题

第 1 章的演练里，你用 `querySelector('p')` 摘下一个段落节点，把译文插到它后面。那个 `p` 是手挑的。真实页面有几万个节点：正文段落混在导航、页脚、按钮、脚本中间。引擎的第一个真问题不是「怎么翻」，是「翻谁」。上章末还欠着两笔账——块级/内联的真身到底是什么、几千个节点里怎么挑出该翻的那几百个。这一章挨个还，做出四部件里的第一个：抽取。

## 第一版引擎的两个事故

最省事的第一版，核心只有一行：

```js
// 用法示例——第一版引擎的全部核心
sendToTranslator(document.body.textContent)  // 整棵 DOM 树拍平成一大串英文
```

上线五分钟，反馈就来了。菜单里的 Home 译成了「主页」，导航被翻译得整整齐齐——可惜没人要它翻。版权声明原样过了一遍机器，页脚被翻译，中英两份并排摆着。Submit 也没躲过，按钮文字被翻译，英文按钮成了中文按钮。

正文的问题更疼。整串翻译没法对应回页面，第二版「改进」成按文本节点逐段送翻：每个文本节点单独一单。

```js
// 用法示例——第二版「改进」：按文本节点送翻
for (const el of document.body.querySelectorAll('*')) {
  for (const child of el.childNodes) {
    if (child.nodeType === 3) sendToTranslator(child.textContent)
  }
}
```

有人反馈一个段落读不通。那段原文中间带加粗，一个完整的句子在 strong 边界断成三截，各自进机器、各自出来，拼回去语序全乱——段落被切断。

两个事故加起来：多翻了废料，又拆碎了正文。病根是同一个——引擎不知道「谁有资格送翻」，它眼里的页面还是一串字符，不是一棵分了区的 DOM 树。

## 翻译的单位：可译块

双语对照的单位上一章已经露过面：一段原文领一段译文，译文插在原文正下方。所以引擎要的翻译单位，就是页面上一个「段落感」的元素。给它起名字：**可译块——直接持有文本的最小块级元素**。抽取、送翻、插译文，都以它为单位；这一章剩下的事，就是把这句话变成代码。

这句话里有两个词要当场说清：「块级」和「直接持有」。先说前者——它比你以为的有意思。

## 块级与内联的真身

上一章的人话版：默认独占一行的是块级元素，默认待在行内的是内联元素。写到这儿，多数开发者心里攒着同一个直觉：块级/内联是标签自带的属性，`p` 天生是块，`strong` 天生内联。这一节把这个直觉当场拆掉。在任一含 `strong` 的页面控制台跑（手头页面没有就先补一个 `<strong>x</strong>`）：

```js
// 用法示例——浏览器控制台，任一含 strong 的页面可跑
getComputedStyle(document.querySelector('strong')).display
// => "inline"：strong 此刻确实是内联的
const style = document.createElement('style')
style.textContent = 'strong { display: block }'
document.head.appendChild(style)
// 这页所有 strong 立刻独占一行——标签一个没换，display 换了
```

同一个 `strong`，一行样式就从内联翻脸成块级。块不块，标签说了不算，`display` 说了算。那份「天生」的块级感，来自浏览器给每个页面先套上的一份默认样式表（user agent stylesheet，UA 样式表）——你不写任何 CSS 时页面的那副长相。WHATWG 的 HTML 标准在「Rendering」一节给出这套默认样式的规范版本，`p` 的块级感就写在里面的 `display: block` 上。而 HTML 标准自己给元素分类用的是另一套词——「Kinds of content」一节的内容类别（content categories，比如 flow、phrasing），用途是规定谁能装谁，压根不管显示。合起来一句：**块级/内联的真身是默认样式表里的 display，标签本身只分内容类别**。

那引擎为什么不直接查 `getComputedStyle`？三个理由，每个都过得了反事实检验。其一，成本：几万个节点逐个问，每个问题都可能触发样式计算，而抽取每次进页面都要跑。其二，稳定性：作者 CSS 随时改 display——一个导航窄屏隐藏、宽屏恢复，跟着 computed display 走，同一页面两次抽取结果就不一样。其三，环境：测试环境的默认样式表常常不完整。伴生仓用的 jsdom——Node 里跑的纯 JS 版 DOM 实现，没有渲染引擎，默认样式表只覆盖少数标签——是现成证据：`getComputedStyle(p).display` 返回 "block"，`getComputedStyle(strong).display` 却返回空字符串，这条路在测试环境里根本没法走。

所以工程做法是**用一份标签清单近似真身**——这就是启发式：用经验规则猜答案，快、够用，但不保证全对。近似有两个已知偏差：作者改过 display 的元素会误判；清单没收的标签一律按内联处理。后果都有限——误判一格，多翻或少翻一小块，不毁页面。这两条已登记进书末的差异清单附录，见招拆招。

## 几千个节点怎么挑：走一遍树

现在回答欠下的第二笔账。答案有点反直觉：**不是挑，是走**。

「挑」的思路是写一个查询，比如 `querySelectorAll('p, h1, h2, ...')`，把符合条件的选出来。它在这一步就撞墙。跳过规则没法干净地写成选择器——「nav 里的 li 不要」得写成 `li:not(nav li)`，四族规则叠起来，选择器字符串指数膨胀。更根本的：拿到元素列表之后，「这个元素的直接文本是什么」还是得逐个再算。而「直接持有文本」本身是递归定义——一个内联元素的文本算不算外面那个块的，要看再外面还有没有块。选择器语言表达不了递归。

任务是「给每个节点分类」，不是「找到某些节点」；分类要见每个节点一眼，只能全树走一遍。这就是树遍历（tree traversal）——你多半在文件系统上写过同构代码：目录递归进去，文件处理掉，某些目录整枝跳过。DOM 版一模一样，只是「目录」换成元素节点，「文件」换成文本节点。走树时每个元素分三类，路线像这样：

```text
body（起点：只下钻，自己不判定）
├─ header → 不是块、不在跳过清单：下钻
│  ├─ h1 → 块级：直接文本 14 字符 → 块 ①
│  ├─ nav → 命中跳过清单：整枝剪掉
│  └─ button → 命中跳过清单：整枝剪掉
├─ main → 下钻
│  └─ article → 下钻
│     ├─ h2 → 块级：40 字符 → 块 ②
│     ├─ p → 块级：直接文本远超门槛 → 块 ③
│     └─ p → 块级，但直接文本 5 字符 < 6：不成块
```

注意 h1 成块之后下钻照样发生——块里可能还嵌着块，`blockquote` 里套 `p`、`li` 里套 `li`，最内层才是翻译单位。走到哪、剪到哪，这张图就是后面 `walk` 函数的全貌预览。

## 直接文本：一句话只记一本账

「直接持有」的账这么记：**直接文本——一个节点自己名下的文本，不含更深层子块里的文本**。规则两条：文本节点的账记在最近的块级祖先头上；内联元素不成块，文本摊给外面那个块。

先做反事实检验：不用这条边界、直接拿整棵子树的 `textContent`，会怎样？fixture 里有个 `blockquote`，里面套一个 `p`。按整树取文本：blockquote 连同 p 的话一起算账，43 字符，成块；下钻进去，p 又成一块。同一句话两个块——送翻两次，插两份译文，紧挨着重复。所以这条边界不是洁癖，是防重复的账本边界：一段文字只能记在一个块上，记在最内层直接持有它的那个块。

再修钩子里那个事故。含加粗的段落，`p` 的 childNodes 是三个：文本「Early users report 」、`strong` 元素、文本「 in tree-heavy workloads...」。strong 是内联元素，自己不成块；收账时递归进去，把「significant speedups」摊进来。最终一个块、一句完整的话。第二版引擎的错误在于拿文本节点当翻译单位——**内联边界不是翻译边界**。

顺带一条会留疤的取舍：句中的行内 `code`（比如「call mount() on any element」里的 `mount()`）属于跳过标签，收账时整枝剪掉，送翻的句子里就不含它了。代码不是自然语言，这个方向没错；但译文里留下的空隙要补——第 5 章的占位标记法把代码原样放回译文。

## 跳过规则：每条都要答得出反事实

跳过规则——判定「这个节点不送翻」的规则清单——每一条都要经得起一句追问：不这样会怎样？答不出的规则迟早误伤。

- 机器吃的：`script` / `style` / `noscript`。反事实：不拦，`window.__data = { userId: 42 }` 这行 JS 源码按字符计费地送进翻译接口，译文回来还没处插。它们不是给人读的自然语言，「翻译」的前提就不成立。
- 代码类：`code` / `pre`。第 1 章开篇你亲眼看过 `pre` 里的代码翻得面目全非——机器翻代码只产出垃圾。
- 表单控件：`button` / `input` / `select` / `textarea`。Submit 是操作指令，不是阅读内容；textarea 里装的是用户自己打的草稿，随打字实时变化——送翻既花额度又立刻过时，译文也帮不了输入。
- 版面地标：`nav` / `footer` / `aside`。菜单和版权声明全站每页重复，翻它们是纯浪费。`header` 特意不进清单：它常在文章内部包标题，一刀切会误杀正文标题。

再加一条与标签无关的：长度门槛——直接文本短于 6 个字符不成块。fixture 里的日期「Nov 8」恰好 5 字符，挡在门外。成因：短到这个程度的串多半不是句子——日期、编号、单词标签，翻它们没有收益。门槛数字没有魔法，6 只是「正文句子都远长于它」的保守取值，调用方可调。

## 演练：从一行 textContent 到 extractBlocks

靶子先立。fixture 是一张新闻页，真实页面的麻烦全在里面：

```ts
// 拼版·教学示意：src/fixtures/news-page.ts 的骨架（完整文件在伴生仓，测试以完整版为准）
export const NEWS_PAGE_HTML: string = `<!doctype html>
<html lang="en">
<body>
  <header>
    <h1>The Daily Byte</h1>
    <nav><a href="/">Home</a> | <a href="/topics">Topics</a> | …</nav>
    <button type="button">Subscribe</button>
  </header>
  <main>
    <article>
      <h2>Lightweight DOM library hits version 2.0</h2>
      <p class="byline">By Jane Doe</p>
      <p class="date">Nov 8</p>
      <p>The library, famous for its three-kilobyte bundle, …</p>
      <p>Early users report <strong>significant speedups</strong> in tree-heavy workloads, …</p>
      <pre><code>npm install quickdom@2</code></pre>
      <p>To try it, … call <code>mount()</code> on any element.</p>
      <blockquote><p>The fastest DOM is the one you never touch.</p></blockquote>
      <h3>What is next</h3>
      <ul><li>Server-side rendering support</li><li>…</li><li>…</li></ul>
    </article>
    <div class="sidebar">
      <h3>Trending</h3>
      <ul><li><a href="/css">CSS tricks you forgot</a></li><li>…</li></ul>
    </div>
  </main>
  <footer><p>© 2024 The Daily Byte. All rights reserved.</p><a href="/privacy">Privacy</a></footer>
  <script>window.__data = { userId: 42 };</script>
</body>
</html>`
```

第 1 步，测试先红。`tests/extract-blocks.test.ts` 的第一个测试把期望钉死——这一页该抽出 14 个块，顺序就是文档顺序：

```ts
// tests/extract-blocks.test.ts · 第一个测试
  it('从 fixture 新闻页抽出全部可译块（14 个，按文档顺序）', () => {
    const blocks = extractBlocks(parseHTML(NEWS_PAGE_HTML).body)
    expect(blocks.map((b) => b.element.tagName.toLowerCase())).toEqual([
      'h1', 'h2', // 站点名、文章标题
      'p', 'p', // 作者行、长段落
      'p', 'p', // 含 strong 的段落、含行内 code 的段落
      'p', // blockquote 里最内层的 p
      'h3', 'li', 'li', 'li', // What is next + 三个列表项
      'h3', 'li', 'li', // 侧栏 Trending + 两个列表项
    ])
  })
```

此刻 `src/extract.ts` 还不存在，跑一次，红。渐进语义就这么机械：先让期望失败，再让它成立。

测试里 `b.element`、`b.text` 这两个字段来自 `TranslatableBlock`——可译块的类型定义，抽取模块的公共契约：

```ts
// src/extract.ts · TranslatableBlock
export interface TranslatableBlock {
  /** 块级元素节点本体（第 3 章渲染译文时插在它后面） */
  element: Element
  /** 它的直接文本（自己名下 + 内联后代，不含更深层子块），空白已折叠 */
  text: string
}
```

一个装「译文插到谁后面」，一个装「送翻的是哪串字」。全书后续章（渲染、管线、批量化）拿到的都是这个形状。

第 2 步，两份清单。块级清单与跳过清单，各自带着成因写在注释里：

```ts
// src/extract.ts · 两份清单常量
/**
 * 块级标签清单——对「默认独占一行」的工程近似。
 * 真身是浏览器默认样式表的 display: block（正文「块级与内联的真身」一节）；引擎不查样式表，
 * 用清单换确定性与速度。代价见差异清单：display 被作者改过、清单没收的标签会误判。
 */
export const BLOCK_TAGS: ReadonlySet<string> = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'dd', 'dt', 'blockquote', 'td', 'th', 'figcaption', 'div',
])

/**
 * 默认跳过清单——四族标签，每族的成因见正文「跳过规则」一节：
 * ① 机器吃的：script / style / noscript——不是给人读的自然语言
 * ② 代码类：code / pre——第 1 章钩子里面目全非的就是它们
 * ③ 表单控件：button / input / select / textarea——界面指令与用户输入，不是阅读内容
 * ④ 版面地标：nav / footer / aside——全站重复的锅炉板（菜单、版权声明）。
 *   header 不在此列：它常在文章内部包标题，一刀切会误杀正文标题。
 */
export const DEFAULT_SKIP_TAGS: readonly string[] = [
  'script', 'style', 'noscript',
  'code', 'pre',
  'button', 'input', 'select', 'textarea',
  'nav', 'footer', 'aside',
]

/** 长度门槛默认值：挡住「Nov 8」（5 字符）这类不是句子的短串，正文句子都远长于它。 */
export const DEFAULT_MIN_CHARS = 6
```

第 3 步，收账与折白。`collectDirectText` 就是上一节的账本规则——文本节点记在最近块级祖先头上，内联摊平，块级子代留给它自己，行内跳过标签整枝剪掉：

```ts
// src/extract.ts · collectDirectText 与 normalize
/**
 * 收集一个块的直接文本：自己名下的文本节点 + 内联后代的文本；
 * 遇到块级子代就停——那是它自己的块，不算进我的账。
 * 行内跳过标签（如句中的 code）整枝剪掉：代码不送翻。
 */
function collectDirectText(el: Element, skip: ReadonlySet<string>): string {
  let text = ''
  for (const child of el.childNodes) {
    if (child.nodeType === 3 /* Node.TEXT_NODE */) {
      text += child.textContent ?? ''
    } else if (child.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const tag = (child as Element).tagName.toLowerCase()
      if (skip.has(tag)) continue // 跳过规则在这里同样生效
      if (BLOCK_TAGS.has(tag)) continue // 块级子代：留给它自己成块
      text += collectDirectText(child as Element, skip) // 内联子代：摊平进来
    }
  }
  return text
}

/** 折叠空白：源码的换行与缩进折成一个空格——送翻的文本不带排版空隙。 */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
```

第 4 步，走树。`walk` 就是那张路线图的代码形态：

```ts
// src/extract.ts · walk
/**
 * 深度优先走树，给每个元素分三类：跳过（整枝剪掉）/ 块级候选 / 内联路过。
 * 块按文档顺序收集——这正是译文将来出现的顺序。
 */
function walk(node: Node, skip: ReadonlySet<string>, minChars: number, out: TranslatableBlock[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType !== 1) continue // 文本、注释不独立成块：文本的归属由最近的块级祖先定
    const el = child as Element
    const tag = el.tagName.toLowerCase()
    if (skip.has(tag)) continue // 跳过规则：整棵子树剪掉，不再下钻
    if (BLOCK_TAGS.has(tag)) {
      const text = normalize(collectDirectText(el, skip))
      // 空文本的容器（纯嵌套的 div、blockquote）永远不成块——长度门槛管「短」，不管「空」
      if (text.length > 0 && text.length >= minChars) out.push({ element: el, text })
    }
    // 成块与否都要继续下钻：块里可能嵌块（div>p、li>ul>li、blockquote>p）；
    // 内联与未知标签自己不下结论，往里找块
    walk(el, skip, minChars, out)
  }
}
```

第 5 步，组装公共入口。选项两条规则都可注入，默认值就是上面的清单：

```ts
// src/extract.ts · extractBlocks
/**
 * 从 root 的子树里抽出全部可译块，按文档顺序返回。
 * 纯函数：只读不写 DOM，同一棵树跑多少遍结果一样，也不引发一次重排。
 */
export function extractBlocks(root: ParentNode, opts: ExtractOptions = {}): TranslatableBlock[] {
  const skip = new Set((opts.skipTags ?? DEFAULT_SKIP_TAGS).map((t) => t.toLowerCase()))
  const minChars = opts.minChars ?? DEFAULT_MIN_CHARS
  const out: TranslatableBlock[] = []
  walk(root, skip, minChars, out)
  return out
}
```

整个抽取只读不写：不动一个节点、不引发一次重排，幂等——同一棵树跑多少遍，结果一样。

演练里还揪出过一个真 bug，值得记下。第一版 `walk` 的门槛判断写的是 `text.length >= minChars`，九个测试里八个绿；红的那个对照测试（门槛归零时应从 14 块变 15 块）实际得到 17 块——两个纯嵌套的空容器（`blockquote`、`div.sidebar`）在 `minChars: 0` 下成了「零字符的块」。修法是补一条不变量：**空文本的容器永远不成块**，长度门槛管「短」，不管「空」。先写测试再写实现的红，红的正是这种你自己都没想到的边角。

## 验证：先猜，再看引擎眼中的页面

别急着跑——每一条先在纸上写下预言，再看输出。猜错的地方，就是理解要补的地方。

1. 亲手开机：`cd companion` 后跑 `npm run demo:extract`。跑之前先猜四个：Subscribe 会出现吗？Topics 呢？「Nov 8」呢？blockquote 那句名言报的标签是 blockquote 还是 p？
   应看到：前两个都不在（拦下它们的规则不同——button 与 nav 是标签规则，与长度无关，Subscribe 有 9 个字符照样拦）；「Nov 8」不在（5 字符，长度门槛）；名言报的是 p（最内层成块）。输出共 14 行：

```text
// companion · npm run demo:extract 的真实输出（对照段从略）
=== 引擎眼中的页面（默认规则，长度门槛 minChars=6） ===
 1. h1     The Daily Byte
 2. h2     Lightweight DOM library hits version 2.0
 3. p      By Jane Doe
 4. p      The library, famous for its three-kilobyte bundl…
 5. p      Early users report significant speedups in tree-…
 6. p      To try it, add one script tag to your page and c…
 7. p      The fastest DOM is the one you never touch.
 8. h3     What is next
 9. li     Server-side rendering support
10. li     Better TypeScript types, generated from the sour…
11. li     A new logo, at last
12. h3     Trending
13. li     CSS tricks you forgot
14. li     The quiet return of RSS
共 14 个可译块
```

2. 门槛对照：demo 末尾的对照段用 `minChars: 0` 又跑了一遍。先猜块数，再往下看。
   应看到：15 块，多出来的正是第 4 行的「Nov 8」——挡它的是长度门槛，不是标签规则。
3. 指认好的小破坏：打开 `src/extract.ts`，把 `DEFAULT_MIN_CHARS` 改成 0，先猜哪几个测试会红，再跑 `npm test`。
   应看到：恰好两个红——「从 fixture 新闻页抽出全部可译块」（清单多出一个 date 段落）与「太短的串不成块」（Nov 8 不该出现却出现了）。改回 6，恢复全绿。这一步顺手验证：测试钉住的是行为，不是实现。
4. 控制台证伪：把「块级与内联的真身」一节那三行控制台代码在任一真实页面（含 strong，没有就补一个）跑一遍。
   应看到：第一行返回 "inline"；注入样式后，页面上的 strong 全部独占一行——块级感的开关在 display，不在标签。
5. 双门槛：`npm run typecheck && npm test`。
   应看到：两条命令都零报错，9 个测试全绿。

## 小结：引擎现在认得这页了

回头看开篇的两个事故，现在你有了机制层的解释。导航、页脚、按钮进了第一版引擎，因为 `textContent` 眼里没有分区；现在跳过清单把 nav、footer、button 整枝剪掉——四族标签，每条都答得出「不这样会怎样」。段落切断，因为第二版拿文本节点当翻译单位；现在可译块是单位，内联元素把文本摊给最近的块级祖先，strong 的边界不再是翻译边界。demo 打出的那 14 行，就是引擎眼中的这页——你先猜过、再亲眼看过。

也把没做完的事摆在明处。清单是对真身的近似，两类偏差登记在差异清单附录。这 14 块里还混着站点名、作者行、侧栏标签——它们是合法的可译块，只是不值得翻；认出「正文区」需要别的武器，第 6 章的链接密度启发式干这活。至于这批块交出去之后的事——第 3 章渲染接棒：给每块插译文、打标记属性，重复调用幂等。

### 自查三问

先自己答，再展开对照。

::: details 1. 页面上有个 div.ad 广告条，里面装着三个 p。本章规则会从它抽出几个块？想整条广告不送翻，加清单、调门槛，还是别的？为什么本章做不到？
三个——div 不与子块抢文本，每个 p 直接持有文本，各自成块。想整枝跳过广告：把 div 加进跳过清单会误杀全页所有容器；调大长度门槛挡不住正常长度的广告语。按「区域」而不按「标签」认废料，是 06 主内容识别的正题。回查「直接文本」与「跳过规则」两节。
:::

::: details 2. 预测：一个页面被作者用 CSS 把所有 p 都改成 display: inline，抽取结果会变吗？页面观感会变吗？
抽取结果不变——清单按标签判定，不看 computed display；观感全变，段落全部挤进行内。这正是「清单近似 display」的已知偏差之一，登记在差异清单附录。回查「块级与内联的真身」一节。
:::

::: details 3. 要翻一个通栏全是两三个词短标题的页面（专题页、词典页），你会动 ExtractOptions 的哪个字段、怎么动？这个动作会连带放进什么？
调小 minChars（比如 2 或 0）。代价是门槛全局生效：「Nov 8」这类短串会跟着回来。标签规则与长度规则各管一边，取舍发生在调用方手里。回查「跳过规则」末条与验证槽的门槛对照。
:::

### 这批块接着去哪

| 章 | 接过这批可译块做什么 |
|---|---|
| 03 | 渲染：译文插在每个块后面，标记属性认自己人，重复调用幂等 |
| 04 | 管线：依赖注入翻译服务，假翻译器让全链路离线可测 |
| 05 | 内联切分与占位标记：行内 code 的空隙填回译文，加粗、链接保住 |
| 06 | 链接密度启发式：认出正文区，站点名与侧栏不再送翻 |
| 07 | 并发上限、内容寻址缓存：同样的句子只付一次钱 |
| 08 | MutationObserver 增量抽取：新节点长出来，walk 再跑一遍，自触发循环防在前面 |
| 09 | content script 与 manifest：装进 Chrome，真实页面见 |
