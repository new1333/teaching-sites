import type { Hook, HookEventHandler, HookTarget } from './types'

export const HOOK_GLOBAL_NAME = '__MINI_DEVTOOLS_HOOK__'
export const REPLAY_QUEUE_NAME = '__MINI_DEVTOOLS_REPLAY__'

export function createHook(): Hook {
  const events = new Map<string, HookEventHandler[]>()
  const hook: Hook = {
    id: 'mini-devtools',
    apps: [],
    on(event, fn) {
      if (!events.has(event))
        events.set(event, [])
      events.get(event)!.push(fn)
      return () => hook.off(event, fn)
    },
    once(event, fn) {
      const onceFn: HookEventHandler = (...args) => {
        hook.off(event, onceFn)
        fn(...args)
      }
      hook.on(event, onceFn)
    },
    off(event, fn) {
      const list = events.get(event)
      if (!list)
        return
      const index = list.indexOf(fn)
      if (index !== -1)
        list.splice(index, 1)
    },
    emit(event, ...payload) {
      // 复制一份：监听器里解绑自己时不能影响本轮遍历
      const list = [...(events.get(event) ?? [])]
      list.forEach(fn => fn(...payload))
    },
  }
  return hook
}

/** 应用侧调用：钩子未就位时把回调排进等待队列，已就位则立即执行 */
export function queueUntilHookInstalled(target: HookTarget, cb: (hook: Hook) => void): void {
  const existing = target[HOOK_GLOBAL_NAME]
  if (existing) {
    cb(existing)
    return
  }
  if (!target[REPLAY_QUEUE_NAME])
    target[REPLAY_QUEUE_NAME] = []
  ;(target[REPLAY_QUEUE_NAME] as Array<(hook: Hook) => void>).push(cb)
}

/** 工具侧调用：把钩子安装到目标对象上；幂等，且重放先到的等待队列 */
export function installHook(target: HookTarget): Hook {
  const existing = target[HOOK_GLOBAL_NAME]
  if (existing)
    return existing

  const hook = createHook()

  const queue = target[REPLAY_QUEUE_NAME] as Array<(hook: Hook) => void> | undefined
  if (queue) {
    try {
      queue.forEach(cb => cb(hook))
    }
    finally {
      target[REPLAY_QUEUE_NAME] = []
    }
  }

  target[HOOK_GLOBAL_NAME] = hook
  return hook
}
