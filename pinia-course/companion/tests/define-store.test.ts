import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, defineStore, getActivePinia, setActivePinia } from '../src'

describe('defineStore 与单例身份', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('两次 useStore 拿到同一个实例', () => {
    const useCounter = defineStore('counter', {
      state: () => ({ count: 0 }),
    })

    const a = useCounter()
    const b = useCounter()

    expect(a).toBe(b)
  })

  it('不同 id 是不同实例，且都登记进容器注册表', () => {
    const useA = defineStore('a', { state: () => ({ n: 1 }) })
    const useB = defineStore('b', { state: () => ({ n: 2 }) })

    const a = useA()
    const b = useB()

    expect(a).not.toBe(b)
    expect(a.$id).toBe('a')
    expect(b.$id).toBe('b')
    expect(getActivePinia()?._s.get('a')).toBe(a)
    expect(getActivePinia()?._s.get('b')).toBe(b)
  })

  it('显式传入 pinia 时，store 登记进那个容器', () => {
    const pinia = createPinia()
    const useCounter = defineStore('counter', {})

    const store = useCounter(pinia)

    expect(pinia._s.get('counter')).toBe(store)
    expect(useCounter()).toBe(store)
  })

  it('没有活动容器时调用抛错', () => {
    setActivePinia(undefined)
    const useCounter = defineStore('counter', {})

    expect(() => useCounter()).toThrow(/🍍/)
  })
})
