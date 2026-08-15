/**
 * 编码传输：把含循环引用的对象图编码成「对象表 + 索引」的平面结构。
 *
 * 表的结构约定：
 * - 表的每一项要么是容器（普通对象/数组，属性值全部是索引），要么是原始值；
 * - 对象/数组的每个属性槽位存的是「表内索引」（数字）；
 * - 原始值直接躺在表项里，靠槽位的索引引用；
 * - 因此「值 42」与「第 42 项」永远不混淆：槽位里的数字一律是索引，
 *   真正的数字躺在表项中。
 */

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === 'object'
}

function encode(value: unknown, list: unknown[], seen: Map<unknown, number>): number {
  if (!isContainer(value)) {
    // 原始值：占一个表项，返回它的索引
    const index = list.length
    list.push(value)
    return index
  }

  const seenIndex = seen.get(value)
  if (seenIndex != null)
    return seenIndex                     // 循环与共享：只写索引，不二次展开

  const index = list.length
  seen.set(value, index)                 // 先登记再填槽：环在展开前就已可引用

  if (Array.isArray(value)) {
    const stored: unknown[] = []
    list.push(stored)
    value.forEach((item) => {
      stored.push(encode(item, list, seen))
    })
  }
  else {
    const stored: Record<string, unknown> = {}
    list.push(stored)
    for (const key of Object.keys(value))
      stored[key] = encode(value[key], list, seen)
  }
  return index
}

/** 编码：任意（含环）对象图 → 可安全过桥的平面对象表，根在索引 0 */
export function encodeState(data: unknown): unknown[] {
  const list: unknown[] = []
  encode(data, list, new Map())
  return list
}

function resolve(index: number, list: unknown[], cache: Map<number, unknown>): unknown {
  if (cache.has(index))
    return cache.get(index)              // 环与共享：同一索引只建一次

  const entry = list[index]
  if (Array.isArray(entry)) {
    const built: unknown[] = []
    cache.set(index, built)              // 先缓存再填槽，环才有回头路
    entry.forEach((slot) => {
      built.push(resolve(slot as number, list, cache))
    })
    return built
  }
  if (entry !== null && typeof entry === 'object') {
    const built: Record<string, unknown> = {}
    cache.set(index, built)
    for (const key of Object.keys(entry))
      built[key] = resolve((entry as Record<string, unknown>)[key] as number, list, cache)
    return built
  }
  return entry                            // 原始值：躺在表项里，直接取
}

/** 解码：对象表 → 还原对象图（共享引用身份保持） */
export function decodeState(list: unknown[]): unknown {
  return resolve(0, list, new Map())
}
