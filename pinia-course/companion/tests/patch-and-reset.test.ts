import { describe, it, expect, beforeEach } from 'vitest'
import { ref } from 'vue'
import { createPinia, defineStore, setActivePinia } from '../src'

const useCart = defineStore('cart', {
  state: () => ({
    user: { name: 'a', address: { city: 'x', street: 'y' } },
    items: [{ id: 1, qty: 1 }],
    tags: new Set(['a']),
  }),
})

describe('$patch 深合并与 $reset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('$patch 对象深合并：只动指定的键，兄弟字段保留', () => {
    const s = useCart()
    s.$patch({ user: { name: 'b' } })

    expect(s.user.name).toBe('b')
    expect(s.user.address.city).toBe('x')
    expect(s.user.address.street).toBe('y')
  })

  it('深层嵌套同样递归合并', () => {
    const s = useCart()
    s.$patch({ user: { address: { city: 'z' } } })

    expect(s.user.address.city).toBe('z')
    expect(s.user.address.street).toBe('y')
    expect(s.user.name).toBe('a')
  })

  it('Map/Set 属性整体替换（合并只对普通对象递归）', () => {
    const s = useCart()
    s.$patch({ tags: new Set(['b', 'c']) })

    expect(s.tags.has('a')).toBe(false)
    expect(s.tags.has('b')).toBe(true)
    expect(s.tags.has('c')).toBe(true)
  })

  it('$patch 函数式：直接改 state', () => {
    const s = useCart()
    s.$patch((state: any) => {
      state.items[0].qty = 5
      state.items.push({ id: 2, qty: 1 })
    })

    expect(s.items[0].qty).toBe(5)
    expect(s.items.length).toBe(2)
  })

  it('$state 整体赋值走 $patch 通道', () => {
    const s = useCart()
    s.$state = { user: { name: 'q' }, items: [], tags: new Set() }

    expect(s.user.name).toBe('q')
    expect(s.items.length).toBe(0)
  })

  it('$reset 一键回到初始 state', () => {
    const s = useCart()
    s.user.name = 'z'
    s.items.push({ id: 9, qty: 9 })
    s.tags.add('junk')
    s.$reset()

    expect(s.user.name).toBe('a')
    expect(s.items.length).toBe(1)
    expect(s.items[0].qty).toBe(1)
    expect(s.tags.has('junk')).toBe(false)
  })

  it('setup store 调 $reset 抛错', () => {
    const useSetup = defineStore('setupReset', () => {
      const n = ref(0)
      return { n }
    })
    const s = useSetup()

    expect(() => (s as any).$reset()).toThrow(/🍍/)
  })
})
