import { describe, expect, it } from 'vitest'
import { getInstanceState } from '../src/state'
import type { InspectorStateItem } from '../src/state'
import { createInstance } from './helpers/fake-app'

function findItem(items: InspectorStateItem[], type: string, key: string) {
  return items.find(item => item.type === type && item.key === key)
}

describe('getInstanceState', () => {
  it('props/setup/data 各归各类', () => {
    const instance = createInstance('Card', 1, {
      props: { title: 'hello', count: 3 },
      setupState: { doubled: 6, visible: true },
      data: { list: [1, 2], label: 'x' },
    })

    const items = getInstanceState(instance)

    expect(findItem(items, 'props', 'title')?.value).toBe('hello')
    expect(findItem(items, 'props', 'count')?.value).toBe(3)
    expect(findItem(items, 'setup', 'doubled')?.value).toBe(6)
    expect(findItem(items, 'data', 'list')?.value).toEqual([1, 2])
    expect(findItem(items, 'data', 'label')?.value).toBe('x')
  })

  it('分类顺序：props 在前，setup 其次，data 最后', () => {
    const instance = createInstance('Card', 1, {
      props: { a: 1 },
      setupState: { b: 2 },
      data: { c: 3 },
    })

    const types = getInstanceState(instance).map(item => item.type)

    expect(types).toEqual(['props', 'setup', 'data'])
  })

  it('函数值清洗为占位串，且 editable 为 false', () => {
    const instance = createInstance('Card', 1, {
      props: { title: 'hello' },
      setupState: { onClick() { return 1 }, doubled: 6 },
    })

    const items = getInstanceState(instance)

    const fnItem = findItem(items, 'setup', 'onClick')!
    expect(fnItem.value).toBe('[Function]')
    expect(fnItem.editable).toBe(false)
    expect(findItem(items, 'setup', 'doubled')!.editable).toBe(true)
    expect(findItem(items, 'props', 'title')!.editable).toBe(true)
  })

  it('读取即抛错的字段：该项标记错误，不毁整份快照', () => {
    const instance = createInstance('Card', 1, {
      props: Object.create({}, {
        broken: {
          get() {
            throw new Error('getter exploded')
          },
          enumerable: true,
        },
        fine: { value: 'ok', enumerable: true },
      }) as Record<string, unknown>,
    })

    const items = getInstanceState(instance)

    const broken = findItem(items, 'props', 'broken')!
    expect(String(broken.value)).toContain('getter exploded')
    expect(findItem(items, 'props', 'fine')?.value).toBe('ok')
  })

  it('空实例返回空数组而不抛错', () => {
    const instance = createInstance('Ghost', 1)
    expect(getInstanceState(instance)).toEqual([])
  })

  it('嵌套对象按引用保留（拍快照不深拷贝）', () => {
    const nested = { deep: { value: 42 } }
    const instance = createInstance('Card', 1, {
      props: { model: nested },
    })

    const items = getInstanceState(instance)

    expect(findItem(items, 'props', 'model')?.value).toBe(nested)
  })
})
