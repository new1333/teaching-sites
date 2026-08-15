import { getCurrentRegistry, registerInstance } from './record'
import type { AppLike, InstanceLike, VNodeLike } from './types'

export interface TreeNode {
  id: string
  name: string
  children: TreeNode[]
  hasChildren: boolean
  inactive: boolean
  file: string
}
export type { TreeNode as ComponentTreeNode }

export interface ComponentTreeOptions {
  filter?: string
  maxDepth?: number
}

/** 从 vnode 树里收集组件实例（component 直接命中，children 递归） */
function collectInstances(subTree: VNodeLike | undefined): InstanceLike[] {
  const list: InstanceLike[] = []
  if (!subTree)
    return list
  if (subTree.component)
    list.push(subTree.component)
  else if (Array.isArray(subTree.children))
    subTree.children.forEach(child => list.push(...collectInstances(child as VNodeLike)))
  return list
}

function isAlive(instance: InstanceLike): boolean {
  return !instance.isBeingDestroyed && instance.type?.devtools?.hide !== true
}

/** 组件树遍历器：按需走 vnode（不是 DOM），产出快照节点 */
export function getComponentTree(app: AppLike, options: ComponentTreeOptions = {}): TreeNode[] {
  const { filter = '', maxDepth = Number.POSITIVE_INFINITY } = options
  const root = app._instance
  if (!root)
    return []

  const registry = getCurrentRegistry()
  if (!registry.apps.some(record => record.app === app))
    registry.registerApp(app)

  const isQualified = (instance: InstanceLike): boolean =>
    !filter || (safeName(instance).includes(filter))

  function safeName(instance: InstanceLike): string {
    try {
      return instance.type?.name ?? `Anonymous-${instance.uid}`
    }
    catch {
      return 'Anonymous'
    }
  }

  function childInstances(instance: InstanceLike): Array<{ instance: InstanceLike, inactive: boolean }> {
    const active = collectInstances(instance.subTree)
      .filter(isAlive)
      .map(child => ({ instance: child, inactive: child.isDeactivated === true }))

    // keep-alive：缓存里还活着但已从 subTree 摘下的实例，以失活姿态入树
    if (instance.type?.__isKeepAlive && Array.isArray(instance.__cachedChildren)) {
      const activeSet = new Set(active.map(item => item.instance))
      for (const cached of instance.__cachedChildren) {
        if (!activeSet.has(cached) && isAlive(cached))
          active.push({ instance: cached, inactive: true })
      }
    }
    return active
  }

  function capture(instance: InstanceLike, depth: number, inactive: boolean): TreeNode {
    const id = registerInstance(app, instance)
    const children = childInstances(instance)
    const node: TreeNode = {
      id,
      name: safeName(instance),
      children: [],
      hasChildren: children.length > 0,
      inactive,
      file: (instance.type?.__file as string | undefined) ?? '',
    }
    // 深度截断：children 留空，但 hasChildren 说真话——UI 据此显示「可展开」
    if (depth < maxDepth) {
      node.children = children.map(child => capture(child.instance, depth + 1, child.inactive))
    }
    return node
  }

  function findQualified(instance: InstanceLike, depth: number): TreeNode[] {
    if (!isAlive(instance))
      return []
    if (isQualified(instance))
      return [capture(instance, depth, instance.isDeactivated === true)]
    // 自身未命中过滤词：向孩子下钻，找到命中的后代为止
    const children = collectInstances(instance.subTree).filter(isAlive)
    return children.flatMap(child => findQualified(child, depth))
  }

  return findQualified(root, 0)
}
