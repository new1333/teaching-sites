import { createEvents } from './events'
import type { Events } from './events'
import { getCurrentRegistry } from './record'
import type { AppLike, InstanceLike } from './types'
import type { InspectorStateItem } from './state'

export interface PluginDescriptor {
  /** 插件唯一标识 */
  id: string
  /** 面板展示名 */
  label: string
  /** 只在该应用登记后生效；缺省表示跟随活动应用 */
  app?: AppLike
}

export interface InspectorTreeNode {
  id: string
  label: string
  children?: InspectorTreeNode[]
}

export interface InspectorDescriptor {
  id: string
  label: string
  /** 拉树：每次调用重新执行（按需，不缓存） */
  tree: () => InspectorTreeNode[]
  /** 拉状态：每次调用重新执行 */
  state: () => InspectorStateItem[]
}

export interface PluginApi {
  on(name: string, fn: (...args: any[]) => void): () => void
  addCustomInspector(descriptor: InspectorDescriptor): void
}

/** 插件层共用的事件总线：与第 3 章的转发桥同构 */
export const pluginEvents: Events = createEvents()

/** 检查器注册表 */
const inspectors = new Map<string, InspectorDescriptor>()

/** 插件缓冲：app 未就位时暂存，就位后重放 */
const pluginBuffer: Array<{ descriptor: PluginDescriptor, setupFn: (api: PluginApi) => void }> = []

function createPluginApi(): PluginApi {
  return {
    on(name, fn) {
      return pluginEvents.on(name, fn)
    },
    addCustomInspector(descriptor) {
      inspectors.set(descriptor.id, descriptor)
    },
  }
}

function matchesApp(descriptor: PluginDescriptor, app: AppLike): boolean {
  return descriptor.app === undefined || descriptor.app === app
}

/** 插件 API 入口：有匹配的活动应用就立即执行，否则进缓冲 */
export function setupDevToolsPlugin(descriptor: PluginDescriptor, setupFn: (api: PluginApi) => void): void {
  const active = getCurrentRegistry().activeAppRecord?.app as AppLike | undefined
  if (active && matchesApp(descriptor, active)) {
    setupFn(createPluginApi())
    return
  }
  pluginBuffer.push({ descriptor, setupFn })
}

/** 应用登记后重放缓冲里属于它的插件；应用若未登记则先幂等登记（真实链路里两者同时发生） */
export function registerPluginsForApp(app: AppLike): void {
  getCurrentRegistry().registerApp(app)

  const remaining: typeof pluginBuffer = []
  for (const entry of pluginBuffer) {
    if (matchesApp(entry.descriptor, app))
      entry.setupFn(createPluginApi())
    else
      remaining.push(entry)          // 不属于这个应用的：继续等
  }
  pluginBuffer.length = 0
  pluginBuffer.push(...remaining)
}

/** 拉检查器树：查无此检查器返回空 */
export function getInspectorTree(inspectorId: string): InspectorTreeNode[] {
  try {
    return inspectors.get(inspectorId)?.tree() ?? []
  }
  catch {
    return []
  }
}

/** 拉检查器状态：查无此检查器返回空 */
export function getInspectorState(inspectorId: string): InspectorStateItem[] {
  try {
    return inspectors.get(inspectorId)?.state() ?? []
  }
  catch {
    return []
  }
}

export type { InstanceLike }
