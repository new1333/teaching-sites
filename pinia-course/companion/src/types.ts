import type { UnwrapRef } from 'vue'
import type { MinimalApp, Pinia } from './rootStore'

/** 任意 store 的状态：一个普通对象 */
export interface StateTree extends Record<string, any> {}

/** 任意函数（action / 订阅回调的底类型） */
export type _Method = (...args: any[]) => any

/** getters 树 */
export interface _GettersTree<S extends StateTree> {
  [key: string]: ((state: UnwrapRef<S>) => any) | (() => any)
}

/** actions 树 */
export interface _ActionsTree {
  [key: string]: _Method
}

/** 订阅回调收到的变更类型 */
export const MutationType = {
  direct: 'direct',
  patchObject: 'patch object',
  patchFunction: 'patch function',
} as const
export type MutationType = (typeof MutationType)[keyof typeof MutationType]

/** $subscribe 回调收到的变更描述 */
export interface SubscriptionCallbackMutation {
  storeId: string
  type: MutationType
  events?: unknown
}

/** $subscribe 的回调类型 */
export type SubscriptionCallback = (
  mutation: SubscriptionCallbackMutation,
  state: StateTree
) => void

/** $onAction 回调收到的上下文 */
export interface StoreOnActionListenerContext {
  args: unknown[]
  name: string
  store: StoreGeneric
  after: (callback: (resolvedReturn: unknown) => unknown) => void
  onError: (callback: (error: unknown) => unknown) => void
}

/** $onAction 的回调类型 */
export type StoreOnActionListener = (context: StoreOnActionListenerContext) => void

/** 未知具体类型的 store：$ 系公共面 + 任意业务属性 */
export interface StoreGeneric {
  $id: string
  $state: StateTree
  $patch: (
    partialStateOrMutator: Record<string, unknown> | ((state: any) => void)
  ) => void
  $reset: () => void
  $subscribe: (
    callback: SubscriptionCallback,
    options?: { detached?: boolean; flush?: 'pre' | 'post' | 'sync' }
  ) => () => void
  $onAction: (
    callback: StoreOnActionListener,
    detached?: boolean
  ) => () => void
  $dispose: () => void
  [key: string]: any
}

export interface PiniaPluginContext {
  pinia: Pinia
  app: MinimalApp
  store: StoreGeneric
  options: DefineStoreOptionsInPlugin
}

export interface PiniaPlugin {
  (context: PiniaPluginContext): Partial<Record<string, any>> | void
}

export interface DefineStoreOptionsInPlugin {
  id: string
  state?: () => StateTree
  getters?: _GettersTree<StateTree>
  actions?: _ActionsTree
}

/** defineStore 的选项形态（选项式 store 三件套） */
export interface DefineStoreOptions {
  id?: string
  state?: () => StateTree
  getters?: _GettersTree<StateTree>
  actions?: _ActionsTree
}

/** 判断普通对象（Map/Set/数组都不是） */
export function isPlainObject(o: unknown): o is StateTree {
  return Object.prototype.toString.call(o) === '[object Object]'
}
