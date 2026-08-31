/**
 * 引擎（第 4 章）：管线之上的装配层——依赖注入的入口、选项的集中地。
 * 公共 API：EngineOptions / EngineStats / Engine / createEngine。
 */
import { runPipeline, runBlocks } from './pipeline'
import { createFakeTranslator, type Translator } from './translate'
import { createTranslationCache } from './cache'
import type { TranslatableBlock } from './extract'

/**
 * 引擎选项：一次装配、逐章生长。本章吃满全部字段：translator 是引擎认识外界的唯一窗口，
 * concurrency 与 useCache 是第 7 章接上的省钱档——任一设置，管线切换到批量档
 * （去重 → 缓存 → 打包 → 限流）；都不设，走的还是第 4 章的串行朴素档。
 */
export interface EngineOptions {
  /** 翻译服务：引擎对「翻译怎么做」的全部认知（不传＝内置假翻译器，离线可跑） */
  translator?: Translator
  /** 并发上限：同时在飞的请求数——柜台叫号，第 7 章生效 */
  concurrency?: number
  /** 内容寻址缓存开关：同样的话只翻一次——第 7 章生效 */
  useCache?: boolean
  /** 只翻主内容区：语义地标＋密度启发式先认正文容器，认不出就全页（默认关） */
  mainContentOnly?: boolean
  /** 内联格式保留：译文里的加粗和链接，第 5 章生效 */
  preserveInline?: boolean
}

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
