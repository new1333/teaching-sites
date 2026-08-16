/** 依赖追踪的最小实现:ref / computed / watchEffect 三个原语 */

export interface ReadonlyRef<T> {
  readonly value: T
}
export interface Ref<T> {
  value: T
}
export type Effect = () => void

/** 全局「当前正在收集依赖的 effect」——追踪的全部机密就在这一个变量里 */
let activeEffect: Effect | null = null

/** target → (key → 读过这个 key 的 effect 集合) */
const targetMap = new WeakMap<object, Map<PropertyKey, Set<Effect>>>()
/** effect → 它当前加入的全部 dep 集合(重跑前据此精确清理) */
const effectDeps = new WeakMap<Effect, Set<Set<Effect>>>()

function track(target: object, key: PropertyKey) {
  if (!activeEffect)
    return
  let depsMap = targetMap.get(target)
  if (!depsMap)
    targetMap.set(target, (depsMap = new Map()))
  let dep = depsMap.get(key)
  if (!dep)
    depsMap.set(key, (dep = new Set()))
  dep.add(activeEffect)
  let ownDeps = effectDeps.get(activeEffect)
  if (!ownDeps)
    effectDeps.set(activeEffect, (ownDeps = new Set()))
  ownDeps.add(dep)
}

function trigger(target: object, key: PropertyKey) {
  const dep = targetMap.get(target)?.get(key)
  if (dep)
    [...dep].forEach(fn => fn())
}

/** 从所有 dep 集合里摘除 effect:重跑前调用,保证依赖列表始终精确 */
function cleanup(effect: Effect) {
  effectDeps.get(effect)?.forEach(dep => dep.delete(effect))
  effectDeps.set(effect, new Set())
}

export function ref<T>(value: T): Ref<T> {
  const obj = {
    get value(): T {
      track(obj, 'value')
      return value
    },
    set value(v: T) {
      value = v
      trigger(obj, 'value')
    },
  }
  return obj
}

/** 惰性求值 + 脏标记:依赖变更只标脏,下次被读取才真正重算 */
export function computed<T>(fn: () => T): ReadonlyRef<T> {
  let cached: T = undefined as T
  let dirty = true
  const self = {
    get value(): T {
      if (dirty) {
        const outer = activeEffect
        // 读取发生在求值期间,依赖记到 notify 头上
        activeEffect = () => {
          dirty = true
          trigger(self, 'value')
        }
        try {
          cached = fn()
        }
        finally {
          activeEffect = outer
        }
        dirty = false
      }
      // computed 自己也是可依赖的数据源
      track(self, 'value')
      return cached
    },
  }
  return self
}

export function watchEffect(fn: () => void): { stop(): void } {
  const run: Effect = () => {
    cleanup(run)
    const outer = activeEffect
    activeEffect = run
    try {
      fn()
    }
    finally {
      activeEffect = outer
    }
  }
  run()
  return {
    stop() {
      cleanup(run)
      effectDeps.delete(run)
    },
  }
}
