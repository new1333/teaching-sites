import { describe, it, expect } from 'vitest'
import { createRuntime } from '../src/runtime/host'
import { createBridge } from '../src/runtime/bridge'

describe('host: 宿主注入全局', () => {
  it('宿主挂什么，脚本世界就有什么', () => {
    const host = createRuntime('main')
    let called = false
    host.inject('sayHi', () => { called = true })
    host.run(() => {
      // 脚本视角：sayHi 天生就在
      const g = host.globals as Record<string, () => void>
      g.sayHi()
    })
    expect(called).toBe(true)
  })

  it('两个 runtime 的全局互不可见（隔离环境）', () => {
    const a = createRuntime('main')
    const b = createRuntime('renderer')
    a.inject('onlyInA', 1)
    expect((a.globals as Record<string, unknown>).onlyInA).toBe(1)
    expect((b.globals as Record<string, unknown>).onlyInA).toBeUndefined()
  })
})

describe('bridge: 注册表 + 序列化边界', () => {
  it('invoke 走到注册的原生函数并拿到返回值', () => {
    const bridge = createBridge()
    bridge.register('math.double', (n: number) => n * 2)
    expect(bridge.invoke('math.double', 21)).toBe(42)
  })

  it('调用不存在的 API 报 [binding] 前缀错误', () => {
    const bridge = createBridge()
    expect(() => bridge.invoke('fs.read')).toThrowError(/\[binding\] unknown api: fs\.read/)
  })

  it('参数是副本不是引用：原生侧改不动 JS 的对象', () => {
    const bridge = createBridge()
    let received: unknown = null
    bridge.register('mutate', (obj: Record<string, unknown>) => {
      received = obj
      obj.hacked = true // 原生侧试图污染调用方
    })
    const arg = { count: 1 }
    bridge.invoke('mutate', arg)
    expect(received).toMatchObject({ count: 1 })
    expect((arg as Record<string, unknown>).hacked).toBeUndefined()
  })

  it('返回值也是副本：改返回值不影响下次调用', () => {
    const bridge = createBridge()
    bridge.register('stat', () => ({ wins: 1 }))
    const r1 = bridge.invoke('stat') as Record<string, number>
    r1.wins = 99
    expect(bridge.invoke('stat')).toEqual({ wins: 1 })
  })

  it('函数过不了边界（直接传或藏在对象里都拒收）', () => {
    const bridge = createBridge()
    bridge.register('noop', () => {})
    expect(() => bridge.invoke('noop', () => 1)).toThrowError(/\[binding\].*(serializable|序列化)/)
    expect(() => bridge.invoke('noop', { cb: () => 1 })).toThrowError(/\[binding\].*(serializable|序列化)/)
  })

  it('嵌套的纯数据结构可以过（数组套对象）', () => {
    const bridge = createBridge()
    bridge.register('echo', (v: unknown) => v)
    const data = { items: [{ id: 1 }, { id: 2 }], total: 2 }
    expect(bridge.invoke('echo', data)).toEqual(data)
  })
})
