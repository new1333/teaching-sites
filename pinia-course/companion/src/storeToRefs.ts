import { computed, isReactive, isRef, toRaw, toRef } from 'vue'
import type { StoreGeneric } from './types'

/**
 * 把 store 的状态与 getter 转成 ref 活引用，供安全解构。
 * action 天然免疫解构（函数引用本来就稳定），不转也不出现。
 */
export function storeToRefs<SS extends StoreGeneric>(store: SS): Record<string, any> {
  // 读 raw：reactive 代理会把 ref 解包，raw 里才看得出谁是 ref/computed
  const rawStore = toRaw(store)

  const refs: Record<string, any> = {}
  for (const key in rawStore) {
    const value = rawStore[key]
    if ((value as any)?.effect) {
      // getter：包一层可写 computed（写直通 store）
      refs[key] = computed({
        get: () => store[key],
        set(value: unknown) {
          store[key] = value as never
        },
      })
    } else if (isRef(value) || isReactive(value)) {
      // 状态：toRef 活引用——.value 直通 store[key]
      refs[key] = toRef(store, key)
    }
    // 函数（action）与非响应式属性：跳过
  }
  return refs
}
