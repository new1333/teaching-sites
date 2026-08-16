import type { IconSetData } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { createLoader, uniqPromise } from '../src/loader'

const mdiSet: IconSetData = {
  prefix: 'mdi',
  width: 24,
  height: 24,
  icons: {
    home: { body: '<path d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8h5z"/>' },
  },
}

/** 手动放行的一次网络请求:不 resolve,并发的调用者就都挂在途 */
function createDeferredFetcher() {
  let calls = 0
  let resolve!: (v: IconSetData | undefined) => void
  const fetchIconSet = (_id: string) => {
    calls++
    return new Promise<IconSetData | undefined>(r => resolve = r)
  }
  return { fetchIconSet, get calls() { return calls }, resolve: (v: IconSetData | undefined) => resolve(v) }
}

function createFakeCacheDir(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const writes: Array<{ id: string, content: string }> = []
  return {
    files,
    writes,
    read: async (id: string) => files.get(id),
    write: async (id: string, content: string) => {
      files.set(id, content)
      writes.push({ id, content })
    },
    clear: async () => { files.clear() },
  }
}

describe('uniqPromise 在途去重', () => {
  it('并发 5 次同参数调用,底层函数只执行一次', async () => {
    const fn = vi.fn(async (id: string) => `data:${id}`)
    const wrapped = uniqPromise(fn)
    const results = await Promise.all(Array.from({ length: 5 }, () => wrapped('mdi')))
    expect(fn).toHaveBeenCalledTimes(1)
    expect(results).toEqual(Array(5).fill('data:mdi'))
  })

  it('不同参数各自执行,互不去重', async () => {
    const fn = vi.fn(async (id: string) => id)
    const wrapped = uniqPromise(fn)
    await Promise.all([wrapped('mdi'), wrapped('carbon')])
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('createLoader 三级回源', () => {
  it('并发 5 次 loadIconSet,网络请求只发一次,结果一致', async () => {
    const fetcher = createDeferredFetcher()
    const cache = createFakeCacheDir()
    const loader = createLoader({ fetchIconSet: fetcher.fetchIconSet, cacheDir: cache })

    const pending = Promise.all(Array.from({ length: 5 }, () => loader.loadIconSet('mdi')))
    // 让「内存检查 → 磁盘读取」的微任务走完,fetcher 此时应当已被第一顺位调用者触发
    await Promise.resolve()
    await Promise.resolve()
    expect(fetcher.calls).toBe(1)
    fetcher.resolve(mdiSet)
    const results = await pending
    expect(results).toEqual(Array(5).fill(mdiSet))
  })

  it('已进内存后再次加载,不再触网也不再读盘', async () => {
    let fetchCalls = 0
    const cache = createFakeCacheDir()
    const cacheReadSpy = vi.fn(cache.read)
    const loader = createLoader({
      fetchIconSet: async (id) => { fetchCalls++; return mdiSet },
      cacheDir: { ...cache, read: cacheReadSpy },
    })

    await loader.loadIconSet('mdi')
    const again = await loader.loadIconSet('mdi')
    expect(again).toEqual(mdiSet)
    expect(fetchCalls).toBe(1)
    expect(cacheReadSpy).toHaveBeenCalledTimes(1)
  })

  it('首次下载成功后写入磁盘缓存,内容可完整还原', async () => {
    const cache = createFakeCacheDir()
    const loader = createLoader({
      fetchIconSet: async () => mdiSet,
      cacheDir: cache,
    })
    await loader.loadIconSet('mdi')
    expect(cache.writes).toHaveLength(1)
    expect(JSON.parse(cache.writes[0]!.content)).toEqual(mdiSet)
  })

  it('clearCache 只清内存:之后命中磁盘缓存,不再触网', async () => {
    let fetchCalls = 0
    const cache = createFakeCacheDir()
    const loader = createLoader({
      fetchIconSet: async () => { fetchCalls++; return mdiSet },
      cacheDir: cache,
    })
    await loader.loadIconSet('mdi')

    loader.clearCache()
    const reloaded = await loader.loadIconSet('mdi')
    expect(reloaded).toEqual(mdiSet)
    expect(fetchCalls).toBe(1)
  })

  it('下载失败返回 undefined、不落盘,且下次调用可重试', async () => {
    let fetchCalls = 0
    const cache = createFakeCacheDir()
    const loader = createLoader({
      fetchIconSet: async () => {
        fetchCalls++
        return fetchCalls === 1 ? undefined : mdiSet
      },
      cacheDir: cache,
    })

    expect(await loader.loadIconSet('mdi')).toBeUndefined()
    expect(cache.writes).toHaveLength(0)
    expect(await loader.loadIconSet('mdi')).toEqual(mdiSet)
    expect(fetchCalls).toBe(2)
  })

  it('磁盘缓存损坏时跳过并回源,不让坏数据卡死管线', async () => {
    let fetchCalls = 0
    const cache = createFakeCacheDir({ mdi: '<<<not json>>>' })
    const loader = createLoader({
      fetchIconSet: async () => { fetchCalls++; return mdiSet },
      cacheDir: cache,
    })
    expect(await loader.loadIconSet('mdi')).toEqual(mdiSet)
    expect(fetchCalls).toBe(1)
  })
})
