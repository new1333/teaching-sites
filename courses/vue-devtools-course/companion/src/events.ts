import type { AppLike, Hook, HookEventHandler } from './types'

export type EventPayloads = Record<string, any[]>

export interface Events<T extends EventPayloads = EventPayloads> {
  on<K extends keyof T & string>(name: K, fn: (...args: T[K]) => void): () => void
  emit<K extends keyof T & string>(name: K, ...payload: T[K]): void
}

/** 工具内核的语义事件总线 */
export function createEvents<T extends EventPayloads = EventPayloads>(): Events<T> {
  const handlers = new Map<string, Array<(...args: any[]) => void>>()
  return {
    on(name, fn) {
      if (!handlers.has(name))
        handlers.set(name, [])
      handlers.get(name)!.push(fn)
      return () => {
        const list = handlers.get(name)
        if (!list)
          return
        const index = list.indexOf(fn)
        if (index !== -1)
          list.splice(index, 1)
      }
    },
    emit(name, ...payload) {
      const list = [...(handlers.get(name) ?? [])]
      list.forEach(fn => fn(...payload))
    },
  }
}

/** 原始事件转发与守门：载荷不完整、或应用/组件标记了 devtools.hide 的事件不进入事件系统 */
function isGuarded(eventName: string, args: any[]): boolean {
  if (eventName === 'app:init' || eventName === 'app:unmount') {
    const [app] = args
    return !app || (app as AppLike)._instance?.type?.devtools?.hide === true
  }
  if (eventName.startsWith('component:')) {
    const [app, uid, , instance] = args
    return !app || typeof uid !== 'number' || !instance || instance?.type?.devtools?.hide === true
  }
  return false
}

const FORWARDED_EVENTS = ['app:init', 'app:unmount', 'component:added', 'component:updated', 'component:removed', 'component:emit']

/** 订阅钩子的原始事件并转发进事件系统；返回解绑函数 */
export function subscribeHook(hook: Hook, events: Events): () => void {
  const offs = FORWARDED_EVENTS.map((eventName) => {
    return hook.on(eventName, (...args: any[]) => {
      if (isGuarded(eventName, args))
        return
      events.emit(eventName, ...args as any[])
    })
  })
  return () => offs.forEach(off => off())
}

export type { HookEventHandler }
