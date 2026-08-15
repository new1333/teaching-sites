import { effectScope, markRaw, ref, type Ref } from 'vue'
import { piniaSymbol, setActivePinia, type MinimalApp, type Pinia } from './rootStore'
import type { PiniaPlugin, StateTree, StoreGeneric } from './types'

/** 创建一个容器：一个应用一个 */
export function createPinia(): Pinia {
  const scope = effectScope(true)
  const state = scope.run<Ref<Record<string, StateTree>>>(() =>
    ref<Record<string, StateTree>>({})
  )!

  let _p: PiniaPlugin[] = []
  // install 之前 use 的插件先缓冲，install 时补挂
  let toBeInstalled: PiniaPlugin[] = []

  const pinia: Pinia = markRaw({
    install(app: MinimalApp) {
      setActivePinia(pinia)
      pinia._a = app
      app.provide(piniaSymbol, pinia)
      app.config.globalProperties.$pinia = pinia
      toBeInstalled.forEach((plugin) => _p.push(plugin))
      toBeInstalled = []
    },

    use(plugin: PiniaPlugin) {
      if (!this._a) {
        toBeInstalled.push(plugin)
      } else {
        this._p.push(plugin)
      }
      return this
    },

    _p,
    // 此刻还没有 app
    // @ts-expect-error
    _a: null,
    _e: scope,
    _s: new Map<string, StoreGeneric>(),
    state,
  })

  return pinia
}

/** 销毁容器：停掉效应作用域、清空状态与注册表（测试与多容器应用用） */
export function disposePinia(pinia: Pinia) {
  pinia._e.stop()
  pinia._s.clear()
  pinia._p.splice(0)
  pinia.state.value = {}
  // @ts-expect-error
  pinia._a = null
}
