import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { createPinia, defineStore, setActivePinia } from '../src'

const useCart = defineStore('cart', {
  state: () => ({ count: 0, nested: { a: 1, b: 2 } }),
  actions: {
    increment(this: any) {
      this.count++
    },
    async fetchTwo(this: any) {
      await Promise.resolve()
      this.count += 2
      return 99
    },
    boom() {
      throw new Error('boom')
    },
    async asyncBoom() {
      await Promise.resolve()
      throw new Error('async boom')
    },
  },
})

describe('$subscribe', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('$patch 无论改多少键，恰好触发一次订阅', () => {
    const s = useCart()
    const cb = vi.fn()
    s.$subscribe(cb)

    s.$patch({ nested: { a: 10, b: 20 } })

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatchObject({ storeId: 'cart', type: 'patch object' })
  })

  it('直接改字段触发订阅（type: direct）', async () => {
    const s = useCart()
    const cb = vi.fn()
    s.$subscribe(cb)

    s.count++
    await nextTick()

    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].type).toBe('direct')
  })

  it('解绑后不再触发', async () => {
    const s = useCart()
    const cb = vi.fn()
    const unbind = s.$subscribe(cb)
    unbind()

    s.count++
    await nextTick()

    expect(cb).not.toHaveBeenCalled()
  })

  it('订阅默认随 effectScope 自动清理', async () => {
    const s = useCart()
    const cb = vi.fn()
    const scope = effectScope()
    scope.run(() => s.$subscribe(cb))
    scope.stop()

    s.count++
    await nextTick()

    expect(cb).not.toHaveBeenCalled()
  })
})

describe('$onAction', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function recorder(s: ReturnType<typeof useCart>) {
    const seen: unknown[] = []
    const unbind = s.$onAction(({ name, after, onError }) => {
      seen.push(name)
      after((ret) => seen.push(['after', ret]))
      onError((e) => seen.push(['onError', (e as Error).message]))
    })
    return { seen, unbind }
  }

  it('同步 action：before 记录名字，after 收到返回值', () => {
    const s = useCart()
    const { seen } = recorder(s)

    s.increment()

    expect(seen).toEqual(['increment', ['after', undefined]])
  })

  it('异步 action：after 收到 resolved 值', async () => {
    const s = useCart()
    const { seen } = recorder(s)

    await s.fetchTwo()

    expect(seen).toEqual(['fetchTwo', ['after', 99]])
  })

  it('同步抛错：onError 收到错误，错误继续上抛', () => {
    const s = useCart()
    const { seen } = recorder(s)

    expect(() => s.boom()).toThrow('boom')
    expect(seen).toEqual(['boom', ['onError', 'boom']])
  })

  it('异步抛错：onError 收到错误，reject 继续上抛', async () => {
    const s = useCart()
    const { seen } = recorder(s)

    await expect(s.asyncBoom()).rejects.toThrow('async boom')
    expect(seen).toEqual(['asyncBoom', ['onError', 'async boom']])
  })

  it('解绑后不再触发', () => {
    const s = useCart()
    const { seen, unbind } = recorder(s)
    unbind()

    s.increment()

    expect(seen).toEqual([])
  })
})

describe('$dispose', () => {
  it('停作用域、清订阅、从注册表除名', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const s = useCart()
    const cb = vi.fn()
    s.$subscribe(cb)
    expect(pinia._s.has('cart')).toBe(true)

    s.$dispose()

    expect(pinia._s.has('cart')).toBe(false)
    const state = s.$state
    ;(state as any).count = 100
    await nextTick()
    expect(cb).not.toHaveBeenCalled()
  })
})
