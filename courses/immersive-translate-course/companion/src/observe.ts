/**
 * 动态内容适配（第 8 章）：MutationObserver 盯住 root 子树，新上树的块增量翻译；
 * 标记属性把自己人摘出去，译文生译文的自触发循环在源头掐灭。
 * 公共 API：observeDynamic。
 */
import { extractBlocks, type TranslatableBlock } from './extract'
import { isOwnNode } from './render'
import type { Engine } from './engine'

/**
 * 观察动态页面：接上就翻现有内容（开机即整页），然后盯住 root 的整棵子树——
 * 有新节点上树，只翻「新来的块」。返回把手只有 disconnect 一个。
 *
 * 三条设计线：
 * ① 增量以「新上树的子树」为单位——在每个新节点落地的地方（它的父元素）重跑一遍抽取，
 *    只捡落在新子树里的块：老块不重翻（同一块不重复翻译），跳过规则原样生效；
 * ② 自己人甄别——带标记属性的译文节点即使作为「新增」入账也不送翻：自己刚插的译文
 *    不是新闻，翻它就是译文生译文（第 3 章 14→28 的引信在这里拆除）；
 * ③ 回调时机是微任务——引擎在回调里插译文，那笔账下一轮才交。所以过滤不是开机做一次，
 *    而是每一轮交账都做：自触发循环没有哪一轮能混进去。
 */
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

/**
 * 从一批变更记录里收「新上树的块」。
 * 纯函数：只读记录与树，不渲染、不翻译——收多收少，交给引擎。
 */
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
