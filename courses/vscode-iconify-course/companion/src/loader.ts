import type { IconSetData } from './types'

/** 磁盘缓存通道:真实实现是扩展的 globalStorage 目录,测试注入内存假实现 */
export interface CacheDir {
  read(id: string): Promise<string | undefined>
  write(id: string, content: string): Promise<void>
  clear(): Promise<void>
}

export interface LoaderOptions {
  /** 远程数据源,测试注入可控的假实现,实验场零网络 */
  fetchIconSet: (id: string) => Promise<IconSetData | undefined>
  cacheDir?: CacheDir
  log?: { info(msg: string): void, error(msg: string): void }
}

/**
 * 在途去重:同一参数的并发调用共享同一个进行中的 Promise。
 * 任务结算后从表里移除——成功的结果由上层缓存接管,失败则允许下次重试。
 */
export function uniqPromise<A, R>(fn: (arg: A) => Promise<R>): (arg: A) => Promise<R> {
  const tasks = new Map<A, Promise<R>>()
  return (arg: A) => {
    let task = tasks.get(arg)
    if (!task) {
      task = fn(arg).finally(() => tasks.delete(arg))
      tasks.set(arg, task)
    }
    return task
  }
}

export function createLoader(options: LoaderOptions) {
  const memory = new Map<string, IconSetData>()
  const log = options.log ?? { info: () => {}, error: () => {} }

  const loadIconSet = uniqPromise(async (id: string): Promise<IconSetData | undefined> => {
    // 第一级:内存
    const cached = memory.get(id)
    if (cached) {
      log.info(`[${id}] 命中内存`)
      return cached
    }
    // 第二级:磁盘
    if (options.cacheDir) {
      const raw = await options.cacheDir.read(id)
      if (raw !== undefined) {
        try {
          const data = JSON.parse(raw) as IconSetData
          memory.set(id, data)
          log.info(`[${id}] 命中磁盘缓存`)
          return data
        }
        catch {
          log.error(`[${id}] 磁盘缓存损坏,跳过并回源`)
        }
      }
    }
    // 第三级:远程下载
    const data = await options.fetchIconSet(id)
    if (!data) {
      log.error(`[${id}] 下载失败`)
      return undefined
    }
    memory.set(id, data)
    await options.cacheDir?.write(id, JSON.stringify(data))
    return data
  })

  /** 只清内存:用于「重新加载」语义,磁盘缓存继续兜底 */
  function clearCache() {
    memory.clear()
  }

  return { loadIconSet, clearCache }
}
