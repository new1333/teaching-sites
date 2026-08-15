import { describe, expect, it } from 'vitest'
import { decodeState, encodeState } from '../src/transfer'

describe('encodeState / decodeState', () => {
  it('普通嵌套对象往返等价', () => {
    const data = {
      name: 'Card',
      count: 3,
      nested: { list: [1, 2, { deep: true }], flag: false },
      empty: null,
      missing: undefined,
    }

    const decoded = decodeState(encodeState(data))

    expect(decoded).toEqual(data)
  })

  it('根是原始值也能往返', () => {
    expect(decodeState(encodeState(42))).toBe(42)
    expect(decodeState(encodeState('hello'))).toBe('hello')
    expect(decodeState(encodeState(null))).toBe(null)
    expect(decodeState(encodeState([1, 'a', true]))).toEqual([1, 'a', true])
  })

  it('自引用环：往返后 self 指向解码结果自身', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node

    const decoded = decodeState(encodeState(node)) as Record<string, unknown>

    expect(decoded.name).toBe('root')
    expect(decoded.self).toBe(decoded)          // 环还原，且是同一个对象
  })

  it('数组里的环同样可往返', () => {
    const arr: unknown[] = [1, 2]
    arr.push(arr)                                // arr[2] = arr

    const decoded = decodeState(encodeState(arr)) as unknown[]

    expect(decoded[0]).toBe(1)
    expect(decoded[1]).toBe(2)
    expect(decoded[2]).toBe(decoded)
  })

  it('共享引用：两个属性指向同一对象，解码后仍是同一对象', () => {
    const shared = { id: 's1' }
    const data = { a: shared, b: shared }

    const decoded = decodeState(encodeState(data)) as Record<string, unknown>

    expect(decoded.a).toEqual({ id: 's1' })
    expect(decoded.a).toBe(decoded.b)            // 身份保持，不是两份拷贝
  })

  it('数字值不会被误当索引：42 与索引 42 不混淆', () => {
    // 造一个超过 42 个条目的表，让「值 42」与「第 42 项」同时存在
    const big: Record<string, unknown> = {}
    for (let i = 0; i < 60; i++)
      big[`k${i}`] = i === 42 ? 'sentinel' : i
    const data = { lucky: 42, big }

    const decoded = decodeState(encodeState(data)) as Record<string, unknown>

    expect(decoded.lucky).toBe(42)               // 值就是 42，不是查表结果
    expect((decoded.big as Record<string, unknown>).k42).toBe('sentinel')
  })

  it('编码产物里不含循环：可以被 JSON.stringify', () => {
    const node: Record<string, unknown> = { name: 'root' }
    node.self = node
    node.children = [{ parent: node }]

    const encoded = encodeState(node)

    expect(() => JSON.stringify(encoded)).not.toThrow()
    const decoded = JSON.parse(JSON.stringify(encoded))
    expect(() => decodeState(decoded)).not.toThrow()
  })

  it('深层嵌套不爆栈（500 层）', () => {
    let deep: Record<string, unknown> = { bottom: true }
    for (let i = 0; i < 500; i++)
      deep = { next: deep }

    const decoded = decodeState(encodeState(deep)) as Record<string, unknown>
    let cursor: Record<string, unknown> = decoded
    let depth = 0
    while (cursor.next) {
      cursor = cursor.next as Record<string, unknown>
      depth += 1
    }
    expect(depth).toBe(500)
    expect(cursor.bottom).toBe(true)
  })
})
