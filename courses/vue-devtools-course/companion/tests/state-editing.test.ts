import { describe, expect, it } from 'vitest'
import { editState } from '../src/editor'
import { createInstance } from './helpers/fake-app'

describe('editState', () => {
  it('沿路径写回 props 上的活对象', () => {
    const instance = createInstance('Card', 1, {
      props: { title: 'old', count: 3 },
    })

    const ok = editState(instance, ['props', 'title'], 'new')

    expect(ok).toBe(true)
    expect(instance.props!.title).toBe('new')
    expect(instance.props!.count).toBe(3)          // 邻居不动
  })

  it('写回 setupState 与 data 同样生效', () => {
    const instance = createInstance('Card', 1, {
      setupState: { count: 1 },
      data: { label: 'a' },
    })

    expect(editState(instance, ['setupState', 'count'], 100)).toBe(true)
    expect(editState(instance, ['data', 'label'], 'b')).toBe(true)
    expect(instance.setupState!.count).toBe(100)
    expect(instance.data!.label).toBe('b')
  })

  it('嵌套对象与数组索引都能下行', () => {
    const nested = { deep: { value: 1 } }
    const list = [10, 20, 30]
    const instance = createInstance('Card', 1, {
      props: { nested, list },
    })

    expect(editState(instance, ['props', 'nested', 'deep', 'value'], 42)).toBe(true)
    expect(editState(instance, ['props', 'list', 1], 99)).toBe(true)

    expect(nested.deep.value).toBe(42)              // 写的是本体，不是拷贝
    expect(list[1]).toBe(99)
    expect(instance.props!.nested).toBe(nested)     // 引用身份未变
  })

  it('中途路径不存在：返回 false，不抛出', () => {
    const instance = createInstance('Card', 1, {
      props: { title: 'x' },
    })

    expect(editState(instance, ['props', 'nope', 'deeper'], 1)).toBe(false)
    expect(instance.props!.title).toBe('x')
  })

  it('路径穿过非对象（原始值）：返回 false', () => {
    const instance = createInstance('Card', 1, {
      props: { title: 'plain-string' },
    })

    expect(editState(instance, ['props', 'title', 'sub'], 1)).toBe(false)
    expect(instance.props!.title).toBe('plain-string')
  })

  it('空路径返回 false', () => {
    const instance = createInstance('Card', 1, { props: { a: 1 } })
    expect(editState(instance, [], 1)).toBe(false)
  })

  it('路径终点是新键：允许创建（最后一跳直接赋值）', () => {
    const instance = createInstance('Card', 1, {
      props: { existing: 1 },
    })

    expect(editState(instance, ['props', 'fresh'], 2)).toBe(true)
    expect(instance.props!.fresh).toBe(2)
  })

  it('写入被拒（冻结对象）：返回 false，不抛出', () => {
    const frozen = Object.freeze({ locked: 1 })
    const instance = createInstance('Card', 1, {
      props: frozen,
    })

    expect(editState(instance, ['props', 'locked'], 2)).toBe(false)
    expect(instance.props!.locked).toBe(1)
  })

  it('读取中途属性抛错：返回 false，不抛出', () => {
    const hostile = Object.create({}, {
      trap: {
        get() {
          throw new Error('no reading allowed')
        },
        enumerable: true,
      },
    }) as Record<string, unknown>
    const instance = createInstance('Card', 1, { props: hostile })

    expect(editState(instance, ['props', 'trap', 'x'], 1)).toBe(false)
  })
})
