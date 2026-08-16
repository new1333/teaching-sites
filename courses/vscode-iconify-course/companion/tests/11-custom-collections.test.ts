import type { IconSetData } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { builtinCollectionIds } from '../src/collections'
import { createCustomCollections } from '../src/custom-collections'
import { parseIcon } from '../src/parse'

const setA: IconSetData = {
  prefix: 'my',
  width: 24,
  height: 24,
  icons: { star: { body: '<path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"/>' } },
}
const setB: IconSetData = {
  ...setA,
  icons: { ...setA.icons, bolt: { body: '<path d="M11 21l1-7-4 1 6-12-1 7 4-1z"/>' } },
}
const setC: IconSetData = { prefix: 'remote', icons: { sun: { body: '<circle cx="12" cy="12" r="10"/>' } } }

function harness(disk: Record<string, IconSetData> = {}, remote: Record<string, IconSetData> = {}) {
  const calls = { readJson: [] as string[], fetchJson: [] as string[], watch: [] as string[][], disposed: 0 }
  let handlers: { onChange(path: string): void, onDelete(path: string): void } | null = null
  const cc = createCustomCollections({
    readJson: async (path) => {
      calls.readJson.push(path)
      const data = disk[path]
      if (!data)
        throw new Error('ENOENT')
      return data
    },
    fetchJson: async (url) => {
      calls.fetchJson.push(url)
      const data = remote[url]
      if (!data)
        throw new Error('404')
      return data
    },
    watchFiles: (paths, h) => {
      calls.watch.push(paths)
      handlers = h
      return { dispose: () => { calls.disposed++ } }
    },
  })
  return {
    cc,
    calls,
    fire: {
      change: (path: string) => handlers?.onChange(path),
      delete: (path: string) => handlers?.onDelete(path),
    },
  }
}

describe('createCustomCollections 加载与热重载', () => {
  it('本地路径:读文件进集合表,并挂上文件监听', async () => {
    const h = harness({ './icons.json': setA })
    await h.cc.update(['./icons.json'])
    expect(h.cc.collections.value).toEqual([setA])
    expect(h.calls.watch[0]).toEqual(['./icons.json'])
  })

  it('热重载:文件保存事件后,集合表自动换新', async () => {
    const disk = { './icons.json': setA }
    const h = harness(disk)
    await h.cc.update(['./icons.json'])

    disk['./icons.json'] = setB
    h.fire.change('./icons.json')
    await vi.waitFor(() => {
      expect(h.cc.collections.value).toEqual([setB])
    })
  })

  it('文件删除事件后,对应集合卸载', async () => {
    const h = harness({ './icons.json': setA })
    await h.cc.update(['./icons.json'])
    h.fire.delete('./icons.json')
    expect(h.cc.collections.value).toEqual([])
  })

  it('配置变化时重新挂监听:旧 watcher 先销毁', async () => {
    const h = harness({ './icons.json': setA })
    await h.cc.update(['./icons.json'])
    await h.cc.update(['./icons.json'])
    expect(h.calls.watch).toHaveLength(2)
    expect(h.calls.disposed).toBe(1)
  })
})

describe('远程集合的增删', () => {
  it('远程 URL 走 fetchJson,从配置移除后自动卸载', async () => {
    const h = harness({}, { 'https://cdn/x.json': setC })
    await h.cc.update(['https://cdn/x.json'])
    expect(h.calls.fetchJson).toEqual(['https://cdn/x.json'])
    expect(h.cc.collections.value).toEqual([setC])

    await h.cc.update([])
    expect(h.cc.collections.value).toEqual([])
  })

  it('已加载的远程集合在重复 update 时不重复拉取', async () => {
    const h = harness({}, { 'https://cdn/x.json': setC })
    await h.cc.update(['https://cdn/x.json'])
    await h.cc.update(['https://cdn/x.json'])
    expect(h.calls.fetchJson).toHaveLength(1)
  })

  it('本地 file:// 与远程 http 键互不冲突,可共存', async () => {
    const h = harness({ 'E:/a.json': setA }, { 'https://cdn/b.json': setC })
    await h.cc.update(['file:///E:/a.json', 'https://cdn/b.json'])
    expect(h.cc.collections.value).toHaveLength(2)
    expect(h.calls.readJson).toEqual(['E:/a.json'])
    expect(h.calls.fetchJson).toEqual(['https://cdn/b.json'])
  })

  it('加载失败的路径不留陈旧条目', async () => {
    const h = harness({})
    await h.cc.update(['./missing.json'])
    expect(h.cc.collections.value).toEqual([])
  })
})

describe('与引擎组合', () => {
  it('自定义前缀进入集合清单后,parseIcon 立即可解析', async () => {
    const h = harness({ './icons.json': setA })
    await h.cc.update(['./icons.json'])
    const ids = [...builtinCollectionIds, ...h.cc.collections.value.map(c => c.prefix)]
    expect(parseIcon('my:star', ids)).toEqual({ collection: 'my', icon: 'star' })
  })

  it('collections 是响应式 ref:接入 watchEffect 后,热重载自动传播', async () => {
    const disk = { './icons.json': setA }
    const h = harness(disk)
    await h.cc.update(['./icons.json'])

    const prefixes: string[][] = []
    const { watchEffect } = await import('../src/reactivity')
    watchEffect(() => { prefixes.push(h.cc.collections.value.map(c => c.prefix)) })
    expect(prefixes).toEqual([['my']])

    disk['./icons.json'] = { ...setB, prefix: 'my2' }
    h.fire.change('./icons.json')
    await vi.waitFor(() => {
      expect(prefixes).toEqual([['my'], ['my2']])
    })
  })
})
