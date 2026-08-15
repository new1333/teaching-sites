import { describe, expect, it, vi } from 'vitest'
import { createHook, installHook, queueUntilHookInstalled } from '../src/hook'
import type { Hook, HookTarget } from '../src/types'

function createTarget(): HookTarget {
  return {}
}

describe('createHook', () => {
  it('提供 on/emit，on 返回解绑函数', () => {
    const hook = createHook()
    const seen: string[] = []
    const off = hook.on('app:init', (app: unknown) => {
      seen.push(`init:${(app as { name: string }).name}`)
    })
    hook.emit('app:init', { name: 'main' })
    off()
    hook.emit('app:init', { name: 'after-off' })
    expect(seen).toEqual(['init:main'])
  })

  it('once 只触发一次', () => {
    const hook = createHook()
    const fn = vi.fn()
    hook.once('legacy:init', fn)
    hook.emit('legacy:init', 1)
    hook.emit('legacy:init', 2)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(1)
  })

  it('off 之后同事件的其他监听不受影响', () => {
    const hook = createHook()
    const a = vi.fn()
    const b = vi.fn()
    hook.on('component:added', a)
    const offB = hook.on('component:added', b)
    offB()
    hook.emit('component:added')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })
})

describe('installHook', () => {
  it('把钩子挂到目标对象的约定名上', () => {
    const target = createTarget()
    const hook = installHook(target)
    expect(target.__MINI_DEVTOOLS_HOOK__).toBe(hook)
  })

  it('幂等：重复安装返回同一个钩子', () => {
    const target = createTarget()
    const first = installHook(target)
    const second = installHook(target)
    expect(second).toBe(first)
  })
})

describe('queueUntilHookInstalled', () => {
  it('钩子未就位时排队，installHook 后重放且恰好一次', () => {
    const target = createTarget()
    const seen: string[] = []
    queueUntilHookInstalled(target, (hook) => {
      seen.push(`first:${hook.id}`)
    })
    queueUntilHookInstalled(target, () => {
      seen.push('second')
    })
    expect(seen).toEqual([])
    const hook = installHook(target)
    expect(seen).toEqual([`first:${hook.id}`, 'second'])
  })

  it('重放后清空队列，不会二次重放', () => {
    const target = createTarget()
    const fn = vi.fn()
    queueUntilHookInstalled(target, fn)
    installHook(target)
    installHook(target)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('钩子已就位时立即执行', () => {
    const target = createTarget()
    const hook: Hook = installHook(target)
    const fn = vi.fn()
    queueUntilHookInstalled(target, fn)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(hook)
  })
})
