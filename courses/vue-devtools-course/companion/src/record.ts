import type { AppLike, InstanceLike } from './types'

export interface AppRecord {
  id: string
  name: string
  app: AppLike
  instanceMap: Map<string, InstanceLike>
}

export interface AppRegistry {
  apps: AppRecord[]
  activeAppRecord: AppRecord
  registerApp(app: AppLike, meta?: { name?: string }): AppRecord
  unregisterApp(app: AppLike): void
  setActive(id: string): void
}

const INSTANCE_ID_KEY = '__MINI_DEVTOOLS_NEXT_ID__'

/** 模块级「当前登记处」：独立函数 registerInstance/getInstance 都落在它身上 */
let currentRegistry: AppRegistry | null = null

/** 应用登记处：给每个被调试的应用发一条记录，维护活动应用 */
export function createAppRegistry(): AppRegistry {
  const apps: AppRecord[] = []
  let appSeq = 0

  const registry: AppRegistry = {
    apps,
    get activeAppRecord() {
      return apps[0]
    },
    registerApp(app, meta) {
      const existing = apps.find(record => record.app === app)
      if (existing)
        return existing

      appSeq += 1
      const record: AppRecord = {
        id: `app:${appSeq}:${app.name ?? 'anonymous'}`,
        name: meta?.name ?? app.name ?? 'anonymous',
        app,
        instanceMap: new Map(),
      }
      apps.push(record)
      return record
    },
    unregisterApp(app) {
      const index = apps.findIndex(record => record.app === app)
      if (index !== -1)
        apps.splice(index, 1)
    },
    setActive(id) {
      const index = apps.findIndex(record => record.id === id)
      if (index > 0) {
        const [record] = apps.splice(index, 1)
        apps.unshift(record)
      }
    },
  }

  currentRegistry = registry
  return registry
}

function requireRegistry(): AppRegistry {
  if (!currentRegistry)
    throw new Error('[mini-devtools] no registry yet: call createAppRegistry() first')
  return currentRegistry
}

/** 取当前登记处；不存在则创建一个空的（按需拉取的入口都能安全调用） */
export function getCurrentRegistry(): AppRegistry {
  currentRegistry ??= createAppRegistry()
  return currentRegistry
}

/** 实例登记：分配自维护唯一 id（同一实例复用），登记进所属应用记录的实例表 */
export function registerInstance(app: AppLike, instance: InstanceLike): string {
  const record = requireRegistry().apps.find(r => r.app === app)
  if (!record)
    throw new Error(`[mini-devtools] app not registered: ${app.name ?? app.uid}`)

  const memoId = instance[INSTANCE_ID_KEY] as string | undefined
  if (memoId != null) {
    // 复用：多次遍历/多次快照面对的是同一实例
    if (!record.instanceMap.has(memoId))
      record.instanceMap.set(memoId, instance)
    return memoId
  }

  const id = `${record.id}:instance:${record.instanceMap.size + 1}`
  instance[INSTANCE_ID_KEY] = id
  record.instanceMap.set(id, instance)
  return id
}

/** 凭 id 从所属应用的实例表里取活引用 */
export function getInstance(app: AppLike, id: string): InstanceLike | undefined {
  const record = requireRegistry().apps.find(r => r.app === app)
  return record?.instanceMap.get(id)
}
