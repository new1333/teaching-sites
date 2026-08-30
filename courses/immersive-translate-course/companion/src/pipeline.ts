/**
 * 管线（第 4 章）：把前三章交付的部件串成流水——抽取 → 翻译 → 渲染。
 * 公共 API：runPipeline（engine.ts 的 createEngine 在这层之上装配选项）。
 */
import { extractBlocks, type TranslatableBlock } from './extract'
import { detectMainContent } from './content'
import { renderBilingual } from './render'
import { renderSegments, splitSegments } from './inline'
import { chunkByBudget, createLimiter } from './batch'
import type { TranslationCache } from './cache'
import type { Translator } from './translate'
import type { EngineStats } from './engine'

/**
 * 一单的字符预算：模拟真实翻译服务的单请求上限。
 * 200 是教学档的手感值——真实服务的配额以它的文档为准（差异清单有账）。
 */
const CHAR_BUDGET = 200

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

/**
 * 批量档（第 7 章）：省钱的四道工序，顺序不能换——
 * ① 去重：同样的话这一轮只送一次（省的是同轮请求）；
 * ② 缓存：上一轮翻过的直接拿走（省的是跨轮请求）——先去重再查缓存，
 *    是因为并发在飞时同一句可能同时 miss、同时出门，去重把这种竞态在源头掐掉；
 * ③ 打包：剩下的按字符预算装袋，一袋一单（省的是往返次数）；
 * ④ 限流：单数再多，同时在飞的不超过上限（防的是 429）。
 */
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
