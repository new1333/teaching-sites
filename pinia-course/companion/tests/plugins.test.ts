import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, defineStore, getActivePinia, setActivePinia } from '../src'

function createAppStub() {
  return {
    provided: new Map<unknown, unknown>(),
    config: { globalProperties: {} as Record<string, unknown> },
    provide(key: unknown, value: unknown) {
      this.provided.set(key, value)
    },
    runWithContext<T>(fn: () => T): T {
      return fn()
    },
  }
}

describe('插件系统', () => {
  // 官方契约：use 要在 install 之后调用——install 前的 use 只会缓冲
  beforeEach(() => {
    const pinia = createPinia()
    pinia.install(createAppStub())
    setActivePinia(pinia)
  })

  it('插件返回值合并进之后创建的每个 store，已存在的 store 不回补', () => {
    const pinia = getActivePinia()!
    const useA = defineStore('a', { state: () => ({ n: 1 }) })
    const before = useA()

    pinia.use(() => ({ router: { go: () => {} } }))
    pinia.use(() => ({ late: true }))

    const useB = defineStore('b', { state: () => ({ n: 2 }) })
    const b = useB()

    expect(b.router).toBeDefined()
    expect(b.late).toBe(true)
    expect((before as any).router).toBeUndefined()
    expect((before as any).late).toBeUndefined()
  })

  it('install 之前 use 的插件在 install 时补挂，对之后新建的 store 生效', () => {
    const pinia = createPinia()
    pinia.use(() => ({ fromBuffered: true }))

    const app = createAppStub()
    pinia.install(app)
    setActivePinia(pinia)

    const useC = defineStore('c', { state: () => ({ n: 1 }) })

    expect(useC().fromBuffered).toBe(true)
  })

  it('context 携带 store / pinia / options', () => {
    const pinia = getActivePinia()!
    const seen: any[] = []
    pinia.use((ctx) => {
      seen.push(ctx)
    })

    const useCtx = defineStore('ctx', { state: () => ({ n: 1 }) })
    useCtx()

    const ctx = seen[0]
    expect(ctx.store.$id).toBe('ctx')
    expect(ctx.pinia).toBe(pinia)
    expect(typeof ctx.options.state).toBe('function')
  })

  it('持久化插件：$patch 后写入存储桩，重建 store 时水合', () => {
    const storage = new Map<string, string>()
    const pinia = createPinia()
    pinia.install(createAppStub())
    setActivePinia(pinia)

    pinia.use(({ store }) => {
      const key = `pinia-${store.$id}`
      const saved = storage.get(key)
      if (saved) store.$patch(JSON.parse(saved))
      store.$subscribe(
        (_mutation, state) => {
          storage.set(key, JSON.stringify(state))
        },
        { detached: true }
      )
    })

    const useCart = defineStore('cart', { state: () => ({ count: 0 }) })
    const s = useCart()
    s.$patch({ count: 3 })

    expect(storage.get('pinia-cart')).toBe(JSON.stringify({ count: 3 }))

    // 模拟「新会话」：销毁后重建，状态应从存储恢复
    s.$dispose()
    const s2 = useCart()

    expect(s2.count).toBe(3)
  })
})
