import type { AppLike, InstanceLike, VNodeLike } from '../../src/types'

/** 造一个组件实例（模拟框架内部形态） */
export function createInstance(name: string, uid: number, overrides: Partial<InstanceLike> = {}): InstanceLike {
  return {
    uid,
    type: { name, ...overrides.type },
    ...overrides,
  } as InstanceLike
}

/** 造一个应用，根实例可选 */
export function createApp(name: string, uid: number, root?: InstanceLike): AppLike {
  return { uid, name, _instance: root }
}

/** 把孩子实例挂到父实例的 subTree 上（vnode 中转，模拟真实结构） */
export function linkChildren(parent: InstanceLike, children: InstanceLike[]): void {
  parent.subTree = {
    type: 'fragment',
    children: children.map< VNodeLike >(child => ({ type: 'component', component: child })),
  }
}

/** 造一个 keep-alive 实例：active 孩子走 subTree，缓存（失活）孩子挂 __cachedChildren */
export function createKeepAlive(uid: number, active: InstanceLike[], cached: InstanceLike[]): InstanceLike {
  const keepAlive = createInstance('KeepAlive', uid, {
    type: { name: 'KeepAlive', __isKeepAlive: true },
  })
  linkChildren(keepAlive, active)
  keepAlive.__cachedChildren = cached
  return keepAlive
}

/** 便捷：注册应用并登记根（每章测试独享一个登记处） */
export function setupApp(name: string, uid: number, root: InstanceLike): AppLike {
  const app = createApp(name, uid, root)
  return app
}
