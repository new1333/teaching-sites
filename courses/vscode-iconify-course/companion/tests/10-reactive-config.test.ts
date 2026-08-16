import { describe, expect, it, vi } from 'vitest'
import { createConfig } from '../src/config'
import { findIconKeys } from '../src/scan'
import { computed, ref, watchEffect } from '../src/reactivity'

describe('ref 读写与触发', () => {
  it('写 value 触发读过它的 effect,不触发没读过的', () => {
    const a = ref(1)
    const b = ref(1)
    const effectA = vi.fn(() => { a.value })
    const effectB = vi.fn(() => { b.value })
    watchEffect(effectA)
    watchEffect(effectB)
    expect(effectA).toHaveBeenCalledTimes(1)
    expect(effectB).toHaveBeenCalledTimes(1)

    a.value = 2
    expect(effectA).toHaveBeenCalledTimes(2)
    expect(effectB).toHaveBeenCalledTimes(1)
  })

  it('同一 effect 依赖多个字段,任一变更即重算', () => {
    const a = ref('x')
    const b = ref(1)
    const runs: Array<[string, number]> = []
    watchEffect(() => { runs.push([a.value, b.value]) })
    expect(runs).toEqual([['x', 1]])
    b.value = 2
    expect(runs).toEqual([['x', 1], ['x', 2]])
    a.value = 'y'
    expect(runs).toEqual([['x', 1], ['x', 2], ['y', 2]])
  })
})

describe('computed 惰性与精准重算', () => {
  it('未读取不计算(惰性)', () => {
    const source = ref(1)
    const fn = vi.fn(() => source.value * 2)
    computed(fn)
    expect(fn).not.toHaveBeenCalled()
  })

  it('首次读取计算一次,重复读取命中缓存', () => {
    const source = ref(1)
    const fn = vi.fn(() => source.value * 2)
    const doubled = computed(fn)
    expect(doubled.value).toBe(2)
    expect(doubled.value).toBe(2)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('依赖变更后标脏,下次读取才重算', () => {
    const source = ref(1)
    const fn = vi.fn(() => source.value * 2)
    const doubled = computed(fn)
    doubled.value
    source.value = 5
    // 只改不读:不重算
    expect(fn).toHaveBeenCalledTimes(1)
    expect(doubled.value).toBe(10)
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('computed 也是可依赖的数据源:变更沿链传播', () => {
    const source = ref(1)
    const doubled = computed(() => source.value * 2)
    const runs: number[] = []
    watchEffect(() => { runs.push(doubled.value) })
    expect(runs).toEqual([2])
    source.value = 10
    expect(runs).toEqual([2, 20])
  })
})

describe('接入引擎:配置活了', () => {
  it('改分隔符配置,findIconKeys 的产物自动换新', () => {
    const configRef = ref(createConfig({ delimiters: [':'] }))
    const text = 'mdi:home carbon-home'
    const keys = computed(() => findIconKeys(text, configRef.value).map(m => m.key))
    const seen: string[][] = []
    watchEffect(() => { seen.push(keys.value) })

    expect(seen).toEqual([['mdi:home']])

    configRef.value = { ...configRef.value, delimiters: ['-'] }
    expect(seen).toEqual([['mdi:home'], ['carbon-home']])
  })

  it('stop 之后不再触发', () => {
    const source = ref(1)
    const fn = vi.fn(() => { source.value })
    const { stop } = watchEffect(fn)
    stop()
    source.value = 2
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
