import { describe, it, expect } from 'vitest'
import { createEventQueue } from '../src/native/eventQueue'
import { createRunLoop } from '../src/native/runLoop'

describe('native event queue', () => {
  it('FIFO：先入队的先出队', () => {
    const q = createEventQueue()
    q.push({ type: 'mousedown' })
    q.push({ type: 'mouseup' })
    q.push({ type: 'click', targetId: 7 })
    expect(q.next()?.type).toBe('mousedown')
    expect(q.next()?.type).toBe('mouseup')
    expect(q.next()).toMatchObject({ type: 'click', targetId: 7 })
  })

  it('空队列 next 返回 null 且 size 归零', () => {
    const q = createEventQueue()
    expect(q.next()).toBeNull()
    q.push({ type: 'tick' })
    expect(q.size()).toBe(1)
    q.next()
    expect(q.size()).toBe(0)
  })
})

describe('native run loop', () => {
  it('按 type 分发给注册的处理函数，保持入队顺序', () => {
    const loop = createRunLoop(createEventQueue())
    const order: string[] = []
    loop.on('click', (e) => order.push(`click:${e.targetId}`))
    loop.on('paint', () => order.push('paint'))
    loop.queue.push({ type: 'paint' })
    loop.queue.push({ type: 'click', targetId: 3 })
    loop.queue.push({ type: 'paint' })
    loop.run()
    expect(order).toEqual(['paint', 'click:3', 'paint'])
  })

  it('收到 quit 消息立即退出，剩余事件不再分发', () => {
    const loop = createRunLoop(createEventQueue())
    const seen: string[] = []
    loop.on('click', () => seen.push('click'))
    loop.on('quit', () => seen.push('quit'))
    loop.queue.push({ type: 'click' })
    loop.queue.push({ type: 'quit' })
    loop.queue.push({ type: 'click' }) // quit 之后，不该被处理
    loop.run()
    expect(seen).toEqual(['click', 'quit'])
    expect(loop.queue.size()).toBe(1)
  })

  it('没有注册处理函数的消息不报错（OS 消息远多于你关心的）', () => {
    const loop = createRunLoop(createEventQueue())
    loop.queue.push({ type: 'system-tray-blink' })
    loop.queue.push({ type: 'quit' })
    expect(() => loop.run()).not.toThrow()
  })

  it('pumpOnce 只处理一条消息', () => {
    const loop = createRunLoop(createEventQueue())
    const seen: string[] = []
    loop.on('tick', () => seen.push('tick'))
    loop.queue.push({ type: 'tick' })
    loop.queue.push({ type: 'tick' })
    loop.pumpOnce()
    expect(seen).toEqual(['tick'])
    expect(loop.queue.size()).toBe(1)
  })
})
