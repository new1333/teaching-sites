import type { IconSetData } from './types'
import { ref, type ReadonlyRef } from './reactivity'

export interface CustomCollectionsOptions {
  readJson: (path: string) => Promise<IconSetData>
  fetchJson: (url: string) => Promise<IconSetData>
  watchFiles?: (
    paths: string[],
    handlers: { onChange(path: string): void, onDelete(path: string): void },
  ) => { dispose(): void }
  log?: { info?(msg: string): void, error?(msg: string): void }
}

export interface CustomCollections {
  /** 当前生效的全部自定义集合;响应式 ref,热重载与增删都会更新它 */
  collections: ReadonlyRef<IconSetData[]>
  /** 配置的路径/URL 清单变化时调用:负责分流、加载、卸载与重挂监听 */
  update(paths: string[]): Promise<void>
  dispose(): void
}

/** http(s) 走远程,其余(含 file:// 与普通路径)都归本地 */
function classify(paths: string[]) {
  const local: string[] = []
  const remote: string[] = []
  for (const p of paths) {
    if (/^https?:\/\//.test(p)) {
      remote.push(p)
    }
    else if (p.startsWith('file://')) {
      // file:///E:/a.json:剥掉协议与残留的前导斜杠,得到本地路径 E:/a.json
      local.push(p.slice('file://'.length).replace(/^\//, ''))
    }
    else {
      local.push(p)
    }
  }
  return { local, remote }
}

/** 本地与远程统一进一张表:键是规范化 URL,本地补 file:// 前缀,与 http 键天然不冲突 */
function fileKey(path: string) {
  return `file://${path.replaceAll('\\', '/')}`
}

export function createCustomCollections(options: CustomCollectionsOptions): CustomCollections {
  const store = new Map<string, IconSetData>()
  const collections = ref<IconSetData[]>([])
  let watcher: { dispose(): void } | null = null

  function sync() {
    collections.value = [...store.values()]
  }

  function unload(key: string) {
    if (store.delete(key))
      sync()
  }

  /** 本地文件读取:失败时清掉同键旧数据,不留陈旧条目 */
  async function loadLocal(path: string) {
    try {
      store.set(fileKey(path), await options.readJson(path))
      options.log?.info?.(`loaded ${path}`)
    }
    catch (e) {
      store.delete(fileKey(path))
      options.log?.error?.(`load failed: ${path} ${String(e)}`)
    }
    sync()
  }

  async function loadRemote(url: string) {
    try {
      store.set(url, await options.fetchJson(url))
      options.log?.info?.(`fetched ${url}`)
    }
    catch (e) {
      unload(url)
      options.log?.error?.(`fetch failed: ${url} ${String(e)}`)
    }
    sync()
  }

  async function update(paths: string[]) {
    const { local, remote } = classify(paths)

    // 本地清单变化即重挂监听:旧 watcher 先销毁,新清单整体接管
    watcher?.dispose()
    watcher = null
    if (options.watchFiles && local.length) {
      watcher = options.watchFiles(local, {
        onChange: path => void loadLocal(path),
        onDelete: path => unload(fileKey(path)),
      })
    }

    // 本地全量重读(文件小,简单正确);远程只拉新键(重复 update 不重复拉)
    await Promise.all([
      ...local.map(loadLocal),
      ...remote.filter(url => !store.has(url)).map(loadRemote),
    ])

    // 扫除:已从配置消失的键(本地或远程)统一卸载
    const validKeys = new Set([...local.map(fileKey), ...remote])
    for (const key of [...store.keys()])
      if (!validKeys.has(key))
        unload(key)
    sync()
  }

  function dispose() {
    watcher?.dispose()
    watcher = null
  }

  return { collections, update, dispose }
}
