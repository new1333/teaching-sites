import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, defineStore, setActivePinia } from '../src'

const useCounter = defineStore('counter', {
  state: () => ({ count: 0, items: [1, 2] }),
  getters: {
    double: (state) => state.count * 2,
    quad(this: any) {
      return this.double * 2
    },
  },
  actions: {
    increment(this: any) {
      this.count++
    },
    add(this: any, n: number) {
      this.count += n
    },
  },
})

describe('选项式 store 三件套', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('state 可读写', () => {
    const s = useCounter()
    expect(s.count).toBe(0)
    s.count = 5
    expect(s.count).toBe(5)
  })

  it('getter 随 state 联动，getter 之间可以互引', () => {
    const s = useCounter()
    expect(s.double).toBe(0)
    s.count = 5
    expect(s.double).toBe(10)
    expect(s.quad).toBe(20)
  })

  it('action 修改状态，this 指向 store', () => {
    const s = useCounter()
    s.increment()
    s.add(4)
    expect(s.count).toBe(5)
    expect(s.double).toBe(10)
  })

  it('$state 反映整棵状态树', () => {
    const s = useCounter()
    expect(s.$state).toEqual({ count: 0, items: [1, 2] })
    s.count = 3
    expect(s.$state.count).toBe(3)
  })
})
