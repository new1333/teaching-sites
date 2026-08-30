/**
 * 可译块抽取（第 2 章）：遍历 DOM 树，找出直接持有文本的块级元素。
 * 公共 API：TranslatableBlock / ExtractOptions / extractBlocks。
 */

/** 可译块：直接持有文本的最小块级元素——引擎抽取、翻译、插译文的基本单位。 */
export interface TranslatableBlock {
  /** 块级元素节点本体（第 3 章渲染译文时插在它后面） */
  element: Element
  /** 它的直接文本（自己名下 + 内联后代，不含更深层子块），空白已折叠 */
  text: string
}

/** 抽取选项：两条规则都可注入、可覆盖默认值。 */
export interface ExtractOptions {
  /** 跳过规则·标签族：命中的元素整棵子树不参与抽取（默认 DEFAULT_SKIP_TAGS） */
  skipTags?: string[]
  /** 长度门槛：短于它的文本不成块——短串多半是日期、编号、界面标签（默认 6） */
  minChars?: number
}

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
