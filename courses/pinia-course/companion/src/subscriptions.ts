import { getCurrentScope, onScopeDispose } from 'vue'
import type { _Method } from './types'

export const noop = () => {}

/**
 * 登记一条订阅：默认随所在 effectScope 自动清理（detached: true 则手动解绑）
 * 返回解绑函数。
 */
export function addSubscription<T extends _Method>(
  subscriptions: Set<T>,
  callback: T,
  detached?: boolean,
  onCleanup: () => void = noop
) {
  subscriptions.add(callback)

  const removeSubscription = () => {
    const isDel = subscriptions.delete(callback)
    isDel && onCleanup()
  }

  if (!detached && getCurrentScope()) {
    onScopeDispose(removeSubscription)
  }

  return removeSubscription
}

/** 触发一批订阅 */
export function triggerSubscriptions<T extends _Method>(
  subscriptions: Set<T>,
  ...args: Parameters<T>
) {
  subscriptions.forEach((callback) => {
    callback(...args)
  })
}
