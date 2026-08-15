import { describe, it, expect } from 'vitest'
import { createRunLoop } from '../src/native/runLoop'
import { createEventDispatch, emitNative } from '../src/events/dispatch'

describe('native 事件 → JS 回调', () => {
  it('订阅窗口事件：消息进队列、泵转动，JS 回调收到 payload', () => {
    const loop = createRunLoop()
    const d = createEventDispatch(loop)
    const got: unknown[] = []
    d.onWindowEvent(1, 'click', (p) => got.push(p))
    emitNative(loop, { type: 'click', targetId: 1, payload: { x: 10, y: 20 } })
    loop.pumpOnce()
    expect(got).toEqual([{ x: 10, y: 20 }])
  })

  it('事件按 targetId 归属：别的窗口的点击不投给我', () => {
    const loop = createRunLoop()
    const d = createEventDispatch(loop)
    const got: unknown[] = []
    d.onWindowEvent(1, 'click', () => got.push('mine'))
    emitNative(loop, { type: 'click', targetId: 99 })
    loop.pumpOnce()
    expect(got).toEqual([])
  })

  it('解绑后同一事件不再触发', () => {
    const loop = createRunLoop()
    const d = createEventDispatch(loop)
    const got: unknown[] = []
    const off = d.onWindowEvent(1, 'click', () => got.push('x'))
    off()
    emitNative(loop, { type: 'click', targetId: 1 })
    loop.pumpOnce()
    expect(got).toEqual([])
  })

  it('同一目标同一事件可以挂多个回调，按注册顺序触发', () => {
    const loop = createRunLoop()
    const d = createEventDispatch(loop)
    const order: string[] = []
    d.onWindowEvent(1, 'resize', () => order.push('first'))
    d.onWindowEvent(1, 'resize', () => order.push('second'))
    emitNative(loop, { type: 'resize', targetId: 1 })
    loop.pumpOnce()
    expect(order).toEqual(['first', 'second'])
  })

  it('泵一次只处理一条：排队中的第二条要等下一泵', () => {
    const loop = createRunLoop()
    const d = createEventDispatch(loop)
    const count = { n: 0 }
    d.onWindowEvent(1, 'click', () => { count.n++ })
    emitNative(loop, { type: 'click', targetId: 1 })
    emitNative(loop, { type: 'click', targetId: 1 })
    loop.pumpOnce()
    expect(count.n).toBe(1)
    loop.pumpOnce()
    expect(count.n).toBe(2)
  })
})
