// 嵌入层：binding——JS 函数调用与原生实现之间的注册表与转发。
// 边界规则：参数与返回值都过序列化（纯数据深拷贝），函数/符号拒收。
// 注册侧允许带具体类型签名；边界把类型抹成 unknown 是序列化的本质，any 只出现在这一行
export type NativeFn = (...args: any[]) => unknown

export interface Bridge {
  register(name: string, fn: NativeFn): void
  invoke(name: string, ...args: unknown[]): unknown
}

/** 深拷贝纯数据；碰到函数、symbol、class 实例立即抛错——它们过不了边界 */
export function serialize(value: unknown, seen: string): unknown {
  const t = typeof value
  if (value === null || t === 'undefined' || t === 'number' || t === 'boolean' || t === 'string' || t === 'bigint') {
    return value
  }
  if (t === 'function' || t === 'symbol') {
    throw new Error(`[binding] args must be serializable (函数/符号不能跨边界): ${seen}`)
  }
  if (Array.isArray(value)) return value.map((v, i) => serialize(v, `${seen}[${i}]`))
  if (value instanceof Date) return new Date(value)
  // 纯对象：原型是 Object.prototype 或 null；class 实例的原型不是，拒收
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`[binding] args must be serializable (class 实例不能跨边界): ${seen}`)
  }
  const out: Record<string, unknown> = {}
  const src = value as Record<string, unknown>
  for (const [k, v] of Object.entries(src)) out[k] = serialize(v, `${seen}.${k}`)
  return out
}

export function createBridge(): Bridge {
  const registry = new Map<string, NativeFn>()
  return {
    register(name, fn) {
      registry.set(name, fn)
    },
    invoke(name, ...args) {
      const fn = registry.get(name)
      if (!fn) throw new Error(`[binding] unknown api: ${name}`)
      const copiedArgs = args.map((a, i) => serialize(a, `args[${i}]`))
      const result = fn(...copiedArgs)
      return serialize(result, 'result')
    },
  }
}
