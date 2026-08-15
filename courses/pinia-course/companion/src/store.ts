import {
  computed,
  effectScope,
  hasInjectionContext,
  inject,
  isReactive,
  isRef,
  nextTick,
  reactive,
  toRaw,
  toRefs,
  watch,
  type ComputedRef,
  type Ref,
  type UnwrapRef,
} from 'vue'
import { activePinia, piniaSymbol, setActivePinia, type MinimalApp, type Pinia } from './rootStore'
import { addSubscription, triggerSubscriptions } from './subscriptions'
import {
  MutationType,
  isPlainObject,
  type DefineStoreOptions,
  type StateTree,
  type StoreGeneric,
  type _GettersTree,
  type DefineStoreOptionsInPlugin,
  type _Method,
  type StoreOnActionListener,
  type SubscriptionCallback,
} from './types'

/** useStore：惰性创建 + 单例取用 */
export type StoreDefinition = ((pinia?: Pinia | null) => StoreGeneric) & {
  $id: string
}

/** 判断一个值是不是 computed（Vue 没有官方 API，真 pinia 也是这么探测的） */
function isComputed(value: unknown): value is ComputedRef {
  return !!(isRef(value) && (value as ComputedRef).effect)
}

const { assign } = Object

/**
 * 深合并：只对普通对象递归；Map/Set 在自身作为合并目标时逐项合并（hydration 路径用），
 * 作为属性值时整体替换——替换是刻意为之，避免「半个 Set」的歧义状态。
 */
function mergeReactiveObjects<
  T extends Record<any, unknown> | Map<unknown, unknown> | Set<unknown>
>(target: T, patchToApply: Partial<T>): T {
  if (target instanceof Map && patchToApply instanceof Map) {
    patchToApply.forEach((value, key) => target.set(key, value))
  } else if (target instanceof Set && patchToApply instanceof Set) {
    patchToApply.forEach(target.add, target)
  }

  for (const key in patchToApply) {
    if (!Object.hasOwn(patchToApply, key)) continue
    const subPatch = patchToApply[key]
    const targetValue = target[key]
    if (
      isPlainObject(targetValue) &&
      isPlainObject(subPatch) &&
      Object.hasOwn(target, key) &&
      !isRef(subPatch) &&
      !isReactive(subPatch)
    ) {
      // 两边都是普通对象：递归合并
      ;(target as Record<any, unknown>)[key] = mergeReactiveObjects(
        targetValue as Record<any, unknown>,
        subPatch as Record<any, unknown>
      )
    } else {
      // 其余情况（含 ref/reactive/Map/Set 属性）：整体替换
      ;(target as Record<any, unknown>)[key] = subPatch
    }
  }

  return target
}

/**
 * 选项式 store：state/getters/actions 三个选项，归一为一棵 setup 返回值。
 * 思想：选项式只是组合式的语法糖。
 */
function createOptionsStore(
  id: string,
  options: DefineStoreOptions,
  pinia: Pinia
): StoreGeneric {
  const { state, actions, getters } = options

  // 状态进容器根状态：pinia.state.value[id]
  // 已有值（hydration/测试预置）时不覆盖
  if (!(id in pinia.state.value)) {
    pinia.state.value[id] = state ? state() : {}
  }
  const localState = toRefs(pinia.state.value[id])

  function setup() {
    return assign(
      localState,
      actions,
      Object.keys(getters || {}).reduce(
        (computedGetters: Record<string, ComputedRef>, name) => {
          computedGetters[name] = computed(() => {
            setActivePinia(pinia)
            // 可能跨 store 引用：从注册表现取最新的 store
            const store = pinia._s.get(id)!
            return (getters as _GettersTree<StateTree>)[name]!.call(store, store)
          })
          return computedGetters
        },
        {}
      )
    )
  }

  return createSetupStore(id, setup, options, pinia, true)
}

/**
 * 组合式 store：执行 setup，把返回值逐属性分类挂载。
 * 一切 store（包括选项式）最终都走这里——归一点。
 */
export function createSetupStore(
  $id: string,
  setup: () => Record<string, unknown>,
  options: DefineStoreOptions,
  pinia: Pinia,
  isOptionsStore?: boolean
): StoreGeneric {
  // store 自己的 scope，挂在容器 scope 下：$dispose 一键清场
  const scope = pinia._e.run(() => effectScope())!

  // 内部状态：state 订阅与 action 订阅
  let subscriptions = new Set<_Method>()
  let actionSubscriptions = new Set<_Method>()
  // watcher 的静音标志：$patch 期间关掉 watcher 通道，只走手动触发——避免双份通知
  let isListening = true

  // 选项式已把 state 写进容器根状态；组合式先占位，分类时再搬
  if (!isOptionsStore && !($id in pinia.state.value)) {
    pinia.state.value[$id] = {}
  }
  // 占位之后读：可能是 {}（新建）也可能是预置的状态树（hydration）
  const initialState = pinia.state.value[$id]

  function $patch(
    partialStateOrMutator: Record<string, unknown> | ((state: any) => void)
  ): void {
    let subscriptionMutation: { storeId: string; type: MutationType }
    // 静音 watcher 通道：本次变更的通知由下面的手动触发独家负责
    isListening = false
    if (typeof partialStateOrMutator === 'function') {
      partialStateOrMutator(pinia.state.value[$id])
      subscriptionMutation = { storeId: $id, type: MutationType.patchFunction }
    } else {
      mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator as Record<string, unknown>)
      subscriptionMutation = { storeId: $id, type: MutationType.patchObject }
    }
    nextTick().then(() => {
      isListening = true
    })
    // 手动触发恰好一次订阅——不靠 watcher 的触发次数（不可控），自己数
    triggerSubscriptions(
      subscriptions as Set<_Method>,
      subscriptionMutation,
      pinia.state.value[$id]
    )
  }

  // $reset 只有选项式有：state 工厂可重跑；组合式的初始值散在 setup 闭包里，无法回收
  const $reset = isOptionsStore
    ? function $reset(this: StoreGeneric) {
        const { state } = options as DefineStoreOptions
        const newState = state ? state() : {}
        this.$patch(($state: StateTree) => {
          assign($state, newState)
        })
      }
    : function $reset() {
        throw new Error(
          `🍍: store "${$id}" 是组合式语法，没有 state 工厂，不支持 $reset。请用 $patch 重置。`
        )
      }

  /**
   * action 包装器：入口 setActivePinia（跨 store 调用时找对家），
   * 前后埋 after/onError 两个回调收集器——$onAction 的全部时序都从这里产生
   */
  function action(fn: _Method, name: string = ''): _Method {
    const wrappedAction = function (this: any, ...args: unknown[]) {
      setActivePinia(pinia)
      const afterCallbackSet = new Set<(resolvedReturn: unknown) => unknown>()
      const onErrorCallbackSet = new Set<(error: unknown) => unknown>()
      function after(callback: (resolvedReturn: unknown) => unknown) {
        afterCallbackSet.add(callback)
      }
      function onError(callback: (error: unknown) => unknown) {
        onErrorCallbackSet.add(callback)
      }

      triggerSubscriptions(actionSubscriptions as Set<_Method>, {
        args,
        name,
        store,
        after,
        onError,
      } as unknown as Parameters<_Method>)

      let ret: unknown
      try {
        ret = fn.apply(store, args)
      } catch (error) {
        triggerSubscriptions(onErrorCallbackSet as Set<_Method>, error)
        throw error
      }

      if (ret instanceof Promise) {
        return ret
          .then((value) => {
            triggerSubscriptions(afterCallbackSet as Set<_Method>, value)
            return value
          })
          .catch((error) => {
            triggerSubscriptions(onErrorCallbackSet as Set<_Method>, error)
            return Promise.reject(error)
          })
      }

      triggerSubscriptions(afterCallbackSet as Set<_Method>, ret)
      return ret
    } as _Method

    return wrappedAction
  }

  function $subscribe(
    callback: SubscriptionCallback,
    options: { detached?: boolean; flush?: 'pre' | 'post' | 'sync' } = {}
  ) {
    // 同一回调重复订阅：直接返回（防一个回调挂两个 watcher）
    if (subscriptions.has(callback)) {
      return () => {}
    }
    const removeSubscription = addSubscription(
      subscriptions,
      callback,
      options.detached,
      () => stopWatcher()
    )
    // watcher 在 store 的 scope 里创建：$dispose 时跟着停
    const stopWatcher = scope.run(() =>
      watch(
        () => pinia.state.value[$id],
        (state) => {
          // patch 场景已被静音，这里只放行「直接改字段」的通知
          if (isListening) {
            callback(
              { storeId: $id, type: MutationType.direct, events: undefined },
              state
            )
          }
        },
        { deep: true, flush: options.flush ?? 'pre' }
      )
    )!
    return removeSubscription
  }

  function $onAction(
    callback: StoreOnActionListener,
    detached?: boolean
  ) {
    return addSubscription(actionSubscriptions, callback, detached)
  }

  function $dispose() {
    scope.stop()
    subscriptions.clear()
    actionSubscriptions.clear()
    pinia._s.delete($id)
  }

  // 先立外壳再登记：让 setup 里就能 use 别的 store（互相引用不成环死锁）
  const store = reactive({
    _p: pinia,
    $id,
    $patch,
    $reset,
    $subscribe,
    $onAction,
    $dispose,
  }) as unknown as StoreGeneric
  pinia._s.set($id, store)

  const setupStore = scope.run(() => setup())!

  for (const key in setupStore) {
    const prop = setupStore[key]

    if ((isRef(prop) && !isComputed(prop)) || isReactive(prop)) {
      // 状态通道：组合式的 ref/reactive 搬进容器根状态
      if (!isOptionsStore) {
        // hydration：容器根状态里已有预置值（SSR 直出 / 测试预置），
        // 把它写回 setup 刚创建的默认 ref——而不是让默认值覆盖它
        if (key in initialState) {
          if (isRef(prop)) {
            ;(prop as Ref).value = initialState[key]
          } else if (prop instanceof Set || prop instanceof Map) {
            // 键集合清空后逐项合并，保住响应式连接（替换会换掉整个 Proxy）
            ;(prop as Set<unknown>).clear()
            mergeReactiveObjects(prop as never, initialState[key] as never)
          } else {
            mergeReactiveObjects(
              prop as Record<any, unknown>,
              initialState[key] as Record<any, unknown>
            )
          }
        }
        pinia.state.value[$id][key] = prop as Ref
      }
    } else if (isComputed(prop)) {
      // getter 通道：computed 原样挂载
    } else if (typeof prop === 'function') {
      // action 通道：包上 $onAction 的外壳再挂载
      setupStore[key] = action(prop as _Method, key)
    }
  }

  // 挂载：经过 reactive 外壳（读取时 ref 自动解包），同时把原始形态（含 ref）存进 raw
  // ——storeToRefs 要靠 raw 里的 ref 识别状态字段
  assign(store, setupStore)
  assign(toRaw(store), setupStore)

  // $state：整棵状态树的视图；整体赋值也走 $patch（一次订阅事件）
  Object.defineProperty(store, '$state', {
    get: () => pinia.state.value[$id] as UnwrapRef<StateTree>,
    set(state) {
      $patch(($state: StateTree) => {
        assign($state, state)
      })
    },
  })

  // 应用插件：每个 store 创建时跑一遍全部已注册插件，返回值合并进 store
  const optionsForPlugin = assign({ actions: {} }, options, { id: $id })
  pinia._p.forEach((extender) => {
    const extensions = scope.run(() =>
      extender({
        store,
        app: pinia._a as MinimalApp,
        pinia,
        options: optionsForPlugin as DefineStoreOptionsInPlugin,
      })
    )!
    assign(store, extensions ?? {})
  })

  return store
}

/**
 * 定义一个 store，返回 useStore 函数。
 * 第一次调用 useStore 时才真正创建（惰性），此后同一容器内返回同一实例。
 */
export function defineStore(
  id: string,
  setupOrOptions?: DefineStoreOptions | (() => Record<string, unknown>),
  setupOptions?: DefineStoreOptions
): StoreDefinition {
  const isSetupStore = typeof setupOrOptions === 'function'
  const options = (isSetupStore ? setupOptions : setupOrOptions) ?? {}

  function useStore(pinia?: Pinia | null): StoreGeneric {
    // 找家的两条路：显式传参 > 组件内注入 > 模块级活动容器
    pinia =
      pinia ||
      (hasInjectionContext() ? inject(piniaSymbol, null) : null) ||
      activePinia ||
      null

    if (!pinia) {
      throw new Error(
        '🍍: 没有活动容器。请先 app.use(pinia)，或给 useStore 显式传入 pinia。'
      )
    }
    setActivePinia(pinia)

    if (!pinia._s.has(id)) {
      if (isSetupStore) {
        createSetupStore(id, setupOrOptions as () => Record<string, unknown>, options, pinia)
      } else {
        createOptionsStore(id, options, pinia)
      }
    }

    return pinia._s.get(id)!
  }

  useStore.$id = id
  return useStore as StoreDefinition
}
