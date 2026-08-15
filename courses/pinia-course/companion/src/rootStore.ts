import { hasInjectionContext, inject, type EffectScope, type InjectionKey, type Ref } from 'vue'
import type { PiniaPlugin, StateTree, StoreGeneric } from './types'

/** 模块级「当前哪个容器在干活」——SSR 章的主角 */
export let activePinia: Pinia | undefined

/** 设置/清除活动容器：install 与每次 action、getter 入口都会调用 */
export const setActivePinia = (pinia: Pinia | undefined) => (activePinia = pinia)

/** 取当前活动容器：组件内走注入，组件外走模块变量 */
export const getActivePinia = (): Pinia | undefined =>
  (hasInjectionContext() && inject(piniaSymbol)) || activePinia

/** 最小 app 形状：pinia-mini 的 install 只依赖这三个口（真 Vue App 结构上满足它） */
export interface MinimalApp {
  provide: (key: unknown, value: unknown) => void
  runWithContext?: <T>(fn: () => T) => T
  config: { globalProperties: Record<string, any> }
}

/** 容器：一个应用一个 */
export interface Pinia {
  install: (app: MinimalApp) => void
  state: Ref<Record<string, StateTree>>
  use(plugin: PiniaPlugin): Pinia
  _p: PiniaPlugin[]
  _a: MinimalApp
  _e: EffectScope
  _s: Map<string, StoreGeneric>
}

/** 容器的注入键：Symbol 防撞名 */
export const piniaSymbol = Symbol('pinia') as InjectionKey<Pinia>
