import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'
import { createPinia, defineStore, setActivePinia } from '../src'

const useSetupCounter = defineStore('setupCounter', () => {
  const count = ref(0)
  const double = computed(() => count.value * 2)
  function increment() {
    count.value++
  }
  return { count, double, increment }
})

describe('组合式 store 与运行时分类', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setup 语法与选项式行为等价', () => {
    const s = useSetupCounter()
    expect(s.count).toBe(0)
    s.increment()
    expect(s.count).toBe(1)
    expect(s.double).toBe(2)
    s.count = 10
    expect(s.double).toBe(20)
  })

  it('ref 状态搬进容器集中营（$state 与 store 是同一份数据）', () => {
    const s = useSetupCounter()
    expect(s.$state.count).toBe(0)
    s.count = 7
    expect(s.$state.count).toBe(7)
  })

  it('hydration：容器已有状态时不被 setup 默认值覆盖', () => {
    const pinia = createPinia()
    pinia.state.value['setupCounter'] = { count: 42 }
    setActivePinia(pinia)

    const s = useSetupCounter()

    expect(s.count).toBe(42)
  })

  it('setup 里可以组装第三方 composable', () => {
    // 模拟 useRouter 这类外部 composable
    function useUserSession() {
      const loggedIn = ref(false)
      const login = () => {
        loggedIn.value = true
      }
      return { loggedIn, login }
    }

    const useAccount = defineStore('account', () => {
      const { loggedIn, login } = useUserSession()
      return { loggedIn, login }
    })

    const s = useAccount()
    expect(s.loggedIn).toBe(false)
    s.login()
    expect(s.loggedIn).toBe(true)
  })
})
