/**
 * 扩展壳（第 9 章）：content script 的全部家当——装配引擎、上弦开机。
 * 壳不写一行引擎逻辑：抽取、翻译、渲染、装配的功力全在前八章的 src/ 里；
 * 这里只做两件事——把引擎接到一棵文档树上（startShell），以及决定什么时候开机（autoStart）。
 * 公共面：startShell（测试与 demo 从这里进场）。
 */
import { createEngine } from '../src/engine'
import { observeDynamic } from '../src/observe'

/**
 * 壳的装配单：把整套引擎接到一棵文档树上，返回观察者的把手。
 * 五字段配了三个，一个都不传 translator——内置假翻译器顶上，离线零密钥：
 * preserveInline——译文里保住加粗、链接与行内代码（第 5 章）；
 * useCache——同样的话只翻一次；concurrency——同时在飞的请求至多 2（第 7 章）。
 * 开机整页与增量交给 observeDynamic（第 8 章）——无限滚动的页面也跟得上。
 */
export function startShell(doc: Document): { disconnect(): void } {
  const engine = createEngine({ preserveInline: true, useCache: true, concurrency: 2 })
  return observeDynamic(doc.body, engine)
}

/**
 * 扩展环境的指纹：chrome.runtime.id 只在扩展上下文里有值——content script 里它是扩展 ID
 * （Chrome 文档明说 runtime.id 是 content script 可直接访问的 API），Node 与 jsdom 里
 * chrome 干脆不存在。靠它把「自动上弦」限定在扩展里：测试与 demo import 这个文件，
 * 不会有人在旁边偷偷开机。
 */
declare const chrome: { runtime?: { id?: string } } | undefined

/** 自动上弦：文档还在加载就等 DOMContentLoaded，已经就绪就立刻开机。 */
function autoStart(): void {
  const boot = (): void => {
    startShell(document) // 把手不接——壳与页面同生共死，永不断开
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}

if (typeof chrome !== 'undefined' && chrome.runtime?.id !== undefined) {
  autoStart() // 只有跑在扩展里才开机——import 本身不触发
}
