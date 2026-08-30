/**
 * 翻译服务抽象（第 4 章）：引擎对「翻译怎么做」的全部认知就这一个文件里的一个接口。
 * 公共 API：Translator / createFakeTranslator / createCountingTranslator。
 */

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
