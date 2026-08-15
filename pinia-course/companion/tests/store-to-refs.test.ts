import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, defineStore, setActivePinia, storeToRefs } from '../src'

const useCounter = defineStore('counter', {
  state: () => ({ count: 0, user: { name: 'a' } }),
  getters: {
    double: (s: any) => s.count * 2,
  },
  actions: {
    increment(this: any) {
      this.count++
    },
  },
})

describe('storeToRefs：解构不丢响应性', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('状态解构后仍是活引用：双向同步', () => {
    const s = useCounter()
    const { count } = storeToRefs(s)

    expect(count.value).toBe(0)
    s.count = 5
    expect(count.value).toBe(5)
    count.value = 10
    expect(s.count).toBe(10)
  })

  it('getter 变成可写 computed，随状态联动', () => {
    const s = useCounter()
    const { double } = storeToRefs(s)

    expect(double.value).toBe(0)
    s.count = 8
    expect(double.value).toBe(16)
  })

  it('action 与内部属性不出现在结果里', () => {
    const s = useCounter()
    const refs = storeToRefs(s)

    expect('increment' in refs).toBe(false)
    expect(Object.keys(refs).sort()).toEqual(['count', 'double', 'user'])
  })

  it('嵌套状态对象也拿到活引用', () => {
    const s = useCounter()
    const { user } = storeToRefs(s)

    expect(user.value.name).toBe('a')
    s.user.name = 'b'
    expect(user.value.name).toBe('b')
  })
})
