import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHook } from '../src/hook'
import { pluginEvents, registerPluginsForApp, setupDevToolsPlugin, getInspectorState, getInspectorTree } from '../src/plugin'
import { createAppRegistry } from '../src/record'
import { subscribeHook } from '../src/events'
import { createApp, createInstance } from './helpers/fake-app'

beforeEach(() => {
  createAppRegistry()          // 空登记处：无活动应用，插件应进缓冲
})

describe('setupDevToolsPlugin', () => {
  it('无活动应用时进缓冲，registerPluginsForApp 后执行恰好一次', () => {
    const setupFn = vi.fn()
    setupDevToolsPlugin({ id: 'router', label: 'Router' }, setupFn)

    expect(setupFn).not.toHaveBeenCalled()

    const app = createApp('main', 1)
    registerPluginsForApp(app)
    expect(setupFn).toHaveBeenCalledTimes(1)

    registerPluginsForApp(app)          // 重放过的不再重放
    expect(setupFn).toHaveBeenCalledTimes(1)
  })

  it('已有活动应用时立即执行', () => {
    const registry = createAppRegistry()
    const app = createApp('main', 1)
    registry.registerApp(app)

    const setupFn = vi.fn()
    setupDevToolsPlugin({ id: 'pinia-like', label: 'Stores' }, setupFn)

    expect(setupFn).toHaveBeenCalledTimes(1)
  })

  it('descriptor 指定了 app 时只在该应用登记后重放', () => {
    const setupFn = vi.fn()
    const subApp = createApp('sub', 2)
    setupDevToolsPlugin({ id: 'scoped', label: 'Scoped', app: subApp }, setupFn)

    const mainApp = createApp('main', 1)
    registerPluginsForApp(mainApp)
    expect(setupFn).not.toHaveBeenCalled()   // 不属于 main：留在缓冲

    registerPluginsForApp(subApp)
    expect(setupFn).toHaveBeenCalledTimes(1)
  })
})

describe('PluginApi', () => {
  it('api.on 挂在事件系统上：钩子事件经转发到达插件', () => {
    const hook = createHook()
    subscribeHook(hook, pluginEvents)

    const received: string[] = []
    setupDevToolsPlugin({ id: 'lib', label: 'Lib' }, (api) => {
      api.on('component:updated', (app, uid) => {
        received.push(`${(app as { name: string }).name}:${uid}`)
      })
    })

    const app = createApp('main', 1)
    registerPluginsForApp(app)
    hook.emit('component:updated', app, 7, 1, createInstance('Card', 7))

    expect(received).toEqual(['main:7'])
  })

  it('api.on 返回解绑，解绑后事件不再到达', () => {
    const hook = createHook()
    subscribeHook(hook, pluginEvents)
    const app = createApp('main', 1)
    registerPluginsForApp(app)

    const fn = vi.fn()
    setupDevToolsPlugin({ id: 'lib', label: 'Lib' }, (api) => {
      const off = api.on('component:added', fn)
      off()
    })

    hook.emit('component:added', app, 7, 1, createInstance('Card', 7))
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('custom inspector', () => {
  it('插件注册的检查器可拉树、可拉状态', () => {
    const app = createApp('main', 1)
    registerPluginsForApp(app)

    setupDevToolsPlugin({ id: 'stores', label: 'Stores' }, (api) => {
      api.addCustomInspector({
        id: 'stores-panel',
        label: 'Stores',
        tree: () => [
          { id: 'store:cart', label: 'cart', children: [{ id: 'store:cart.items', label: 'items' }] },
        ],
        state: () => [
          { type: 'setup', key: 'count', value: 3, editable: true },
        ],
      })
    })

    const tree = getInspectorTree('stores-panel')
    expect(tree.length).toBe(1)
    expect(tree[0].label).toBe('cart')
    expect(tree[0].children?.[0].id).toBe('store:cart.items')

    const state = getInspectorState('stores-panel')
    expect(state[0]).toEqual({ type: 'setup', key: 'count', value: 3, editable: true })
  })

  it('查无此检查器：返回空而不是抛错', () => {
    expect(getInspectorTree('nope')).toEqual([])
    expect(getInspectorState('nope')).toEqual([])
  })

  it('拉取是按需的：树函数每次调用都重新执行', () => {
    const app = createApp('main', 1)
    registerPluginsForApp(app)

    let revision = 0
    setupDevToolsPlugin({ id: 'stores', label: 'Stores' }, (api) => {
      api.addCustomInspector({
        id: 'live-panel',
        label: 'Live',
        tree: () => [{ id: `node:${++revision}`, label: `rev-${revision}` }],
        state: () => [],
      })
    })

    expect(getInspectorTree('live-panel')[0].label).toBe('rev-1')
    expect(getInspectorTree('live-panel')[0].label).toBe('rev-2')   // 不是缓存
  })
})
