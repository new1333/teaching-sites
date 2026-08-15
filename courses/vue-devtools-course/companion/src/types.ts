export type HookEventHandler = (...args: any[]) => void

export interface Hook {
  id: string
  on(event: string, fn: HookEventHandler): () => void
  once(event: string, fn: HookEventHandler): void
  off(event: string, fn: HookEventHandler): void
  emit(event: string, ...payload: any[]): void
  apps: unknown[]
}

/** 模拟 window 的目标对象：测试里用普通对象代替真实全局对象 */
export interface HookTarget {
  __MINI_DEVTOOLS_HOOK__?: Hook
  __MINI_DEVTOOLS_REPLAY__?: Array<(hook: Hook) => void>
  [key: string]: unknown
}

/** 模拟框架内部虚拟节点的最小面（只取遍历所需） */
export interface VNodeLike {
  component?: InstanceLike
  children?: VNodeLike[] | unknown
  type?: unknown
  [key: string]: unknown
}

/** 模拟组件实例的最小面：调试器视角下「你的应用」里的一个组件 */
export interface InstanceLike {
  uid: number
  type: {
    name?: string
    __file?: string
    __isKeepAlive?: boolean
    devtools?: { hide?: boolean }
    [key: string]: unknown
  }
  subTree?: VNodeLike
  parent?: InstanceLike
  props?: Record<string, unknown>
  setupState?: Record<string, unknown>
  data?: Record<string, unknown>
  /** 模拟生命周期标记：正在销毁 / 已被 keep-alive 失活 */
  isBeingDestroyed?: boolean
  isDeactivated?: boolean
  /** keep-alive 缓存的孩子（已从 subTree 摘下但实例仍存活） */
  __cachedChildren?: InstanceLike[]
  [key: string]: unknown
}

/** 模拟应用：一个挂载完成的根 */
export interface AppLike {
  uid: number
  name?: string
  _instance?: InstanceLike
  [key: string]: unknown
}
