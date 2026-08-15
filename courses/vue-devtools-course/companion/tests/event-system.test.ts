import { describe, expect, it, vi } from 'vitest'
import { createEvents, subscribeHook } from '../src/events'
import { createHook } from '../src/hook'
import type { AppLike, InstanceLike } from '../src/types'

function createInstance(name: string, overrides: Partial<InstanceLike> = {}): InstanceLike {
  return {
    uid: 1,
    type: { name },
    ...overrides,
  }
}

function createApp(name: string, root?: InstanceLike): AppLike {
  return { uid: 1, name, _instance: root }
}

describe('createEvents', () => {
  it('on 注册的监听能收到 emit 的载荷', () => {
    const events = createEvents()
    const seen: string[] = []
    events.on('component:added', (instance: InstanceLike) => {
      seen.push(instance.type.name!)
    })
    events.emit('component:added', createInstance('Card'))
    expect(seen).toEqual(['Card'])
  })

  it('on 返回解绑函数，解绑后不再触发', () => {
    const events = createEvents()
    const fn = vi.fn()
    const off = events.on('app:init', fn)
    off()
    events.emit('app:init', createApp('main'))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('subscribeHook', () => {
  it('把钩子的原始事件转发进事件系统', () => {
    const hook = createHook()
    const events = createEvents()
    subscribeHook(hook, events)
    const fn = vi.fn()
    events.on('component:added', fn)

    const app = createApp('main')
    const instance = createInstance('Card')
    hook.emit('component:added', app, 7, 1, instance)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(app, 7, 1, instance)
  })

  it('守门：标记 devtools.hide 的组件事件不转发', () => {
    const hook = createHook()
    const events = createEvents()
    subscribeHook(hook, events)
    const fn = vi.fn()
    events.on('component:added', fn)

    const hidden = createInstance('InternalSlot', { type: { name: 'InternalSlot', devtools: { hide: true } } })
    hook.emit('component:added', createApp('main'), 7, 1, hidden)
    expect(fn).not.toHaveBeenCalled()

    const visible = createInstance('Card')
    hook.emit('component:added', createApp('main'), 8, 1, visible)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('守门：标记 hide 的应用 init 事件不转发', () => {
    const hook = createHook()
    const events = createEvents()
    subscribeHook(hook, events)
    const fn = vi.fn()
    events.on('app:init', fn)

    const hiddenApp = createApp('hidden', createInstance('Root', { type: { name: 'Root', devtools: { hide: true } } }))
    hook.emit('app:init', hiddenApp, '3.5.0', {})
    expect(fn).not.toHaveBeenCalled()
  })

  it('守门：载荷不完整的事件不转发', () => {
    const hook = createHook()
    const events = createEvents()
    subscribeHook(hook, events)
    const fn = vi.fn()
    events.on('component:added', fn)

    hook.emit('component:added', undefined, undefined, undefined, undefined)
    hook.emit('component:added', createApp('main'), 'not-a-uid', 1, createInstance('X'))
    expect(fn).not.toHaveBeenCalled()
  })

  it('解绑后停止转发', () => {
    const hook = createHook()
    const events = createEvents()
    const off = subscribeHook(hook, events)
    const fn = vi.fn()
    events.on('component:updated', fn)

    const payload = [createApp('main'), 7, 1, createInstance('Card')] as const
    hook.emit('component:updated', ...payload)
    expect(fn).toHaveBeenCalledTimes(1)

    off()
    hook.emit('component:updated', ...payload)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
