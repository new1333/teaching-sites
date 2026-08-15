import { describe, it, expect } from 'vitest'
import { createPinia, getActivePinia, piniaSymbol } from '../src'

// 最小 app 桩：install 只需要 provide / config / runWithContext 三个口
function createAppStub() {
  const provided = new Map<unknown, unknown>()
  return {
    provided,
    config: { globalProperties: {} as Record<string, unknown> },
    provide(key: unknown, value: unknown) {
      provided.set(key, value)
    },
    runWithContext<T>(fn: () => T): T {
      return fn()
    },
  }
}

describe('createPinia', () => {
  it('install 后成为活动容器，并可经 piniaSymbol 注入', () => {
    const pinia = createPinia()
    const app = createAppStub()

    expect(getActivePinia()).not.toBe(pinia)

    pinia.install(app)

    expect(getActivePinia()).toBe(pinia)
    expect(app.provided.get(piniaSymbol)).toBe(pinia)
    expect(app.config.globalProperties.$pinia).toBe(pinia)
  })

  it('每个容器拥有各自独立的 state', () => {
    const a = createPinia()
    const b = createPinia()

    a.state.value['cart'] = { count: 1 }

    expect(b.state.value['cart']).toBeUndefined()
    expect(a.state).not.toBe(b.state)
  })

  it('新容器自带空注册表与活跃的效应作用域', () => {
    const pinia = createPinia()

    expect(pinia._s.size).toBe(0)
    expect(pinia._e.active).toBe(true)
    expect(pinia._p).toEqual([])
  })
})
