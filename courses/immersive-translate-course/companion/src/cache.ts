/**
 * 内容寻址缓存（第 7 章）：同样的话只翻一次——第一轮的成果，留给后面的每一轮。
 * 公共 API：TranslationCache / createTranslationCache。
 */

/**
 * 翻译缓存的接口：get 查、set 存、size 数。
 * 为什么叫「内容寻址」：键不是编号、不是位置、不是时间——是内容本身。
 * 同一句原文永远命中同一条缓存，不需要任何额外的对账；
 * 工业版会把内容算成哈希再当键（防超长键、便于落盘共享），本书的规模
 * 直接拿原文当键，性质相同：地址＝内容。
 */
export interface TranslationCache {
  /** 查一句原文的既有译文；没翻过返回 undefined（Map 的「没有」就是 undefined） */
  get(text: string): string | undefined
  /** 记一句原文的译文；同句再记是覆盖，不是新增 */
  set(text: string, translated: string): void
  /** 缓存里躺着多少条——demo 的账单用它对数 */
  size(): number
}

/**
 * 造一个缓存：一张以原文为键、译文为值的 Map，生命期跟创建它的引擎实例走。
 * 它是引擎的第一份内部状态：树换了它不换——第二页同句直接命中，就是它的功劳。
 */
export function createTranslationCache(): TranslationCache {
  const store = new Map<string, string>()
  return {
    get: (text) => store.get(text),
    set: (text, translated) => {
      store.set(text, translated)
    },
    size: () => store.size,
  }
}
