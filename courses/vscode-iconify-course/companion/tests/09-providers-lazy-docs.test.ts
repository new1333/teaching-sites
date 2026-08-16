import type { IconSetData } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { builtinCollections, builtinCollectionIds } from '../src/collections'
import { createConfig } from '../src/config'
import { createLoader } from '../src/loader'
import { getCollectionMarkdown, getIconMarkdown } from '../src/markdown'
import { provideCompletions, resolveCompletion } from '../src/providers'
import { createRenderer } from '../src/render'

const mdiSet: IconSetData = {
  prefix: 'mdi',
  width: 24,
  height: 24,
  icons: {
    home: { body: '<path d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8h5z" fill="currentColor"/>' },
    account: { body: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="currentColor"/>' },
    'content-save': { body: '<path d="M15 9H5V5h10z" fill="currentColor"/>' },
  },
}

function createEnv(overrides: { config?: ReturnType<typeof createConfig>, aliases?: Record<string, string> } = {}) {
  let fetchCalls = 0
  const fetchIconSet = async (id: string) => {
    fetchCalls++
    return id === 'mdi' ? mdiSet : undefined
  }
  const loader = createLoader({ fetchIconSet })
  const env = {
    config: overrides.config ?? createConfig(),
    collectionIds: builtinCollectionIds,
    aliases: overrides.aliases,
    loadIconSet: loader.loadIconSet,
    render: createRenderer(),
    collectionNames: { mdi: 'Material Design Icons' },
  }
  const ctx = {
    config: env.config,
    collections: builtinCollections,
    aliases: overrides.aliases,
    getIconMarkdown: vi.fn((key: string) => getIconMarkdown(key, env)),
    getCollectionMarkdown: vi.fn((id: string) => getCollectionMarkdown(id, env)),
  }
  return { env, ctx, get fetchCalls() { return fetchCalls } }
}

describe('provideCompletions 两段式补全', () => {
  it('命名空间上下文(集合+分隔符后):补该集合的图标名,替换区间只覆盖正在敲的词', () => {
    const { ctx } = createEnv()
    const items = provideCompletions('<span class="mdi:ho', ctx)
    expect(items).not.toBeNull()
    const icons = items!.filter(i => i.kind === 'icon')
    expect(icons.map(i => i.label).sort()).toEqual(['account', 'content-save', 'home'])
    expect(icons[0]!.detail).toMatch(/^mdi:/)
    expect(icons[0]!.replaceStart).toBe('<span class="mdi:'.length)
  })

  it('裸前缀上下文:补集合 id,替换区间不含前缀', () => {
    const { ctx } = createEnv()
    const items = provideCompletions('<span class="i-ca', ctx)!
    const labels = items.filter(i => i.kind === 'collection').map(i => i.label)
    expect(labels).toContain('carbon')
    expect(labels).not.toContain('ca')
    // 'ca' 是被替换的词,替换起点应在 'i-' 之后
    expect(items.find(i => i.label === 'carbon')!.replaceStart).toBe('<span class="i-'.length)
  })

  it('customAliasesOnly 模式只补别名', () => {
    const { ctx } = createEnv({ config: createConfig({ customAliasesOnly: true }), aliases: { save: 'mdi:home' } })
    const items = provideCompletions('a save', ctx)!
    expect(items.map(i => i.kind)).toEqual(['alias'])
    expect(items[0]!.detail).toBe('mdi:home')
  })

  it('行尾词前没有边界上下文时返回 null', () => {
    const { ctx } = createEnv()
    expect(provideCompletions('abc', ctx)).toBeNull()
  })
})

describe('resolveCompletion 延迟文档', () => {
  it('provideCompletions 本身零文档开销,resolve 时才取', async () => {
    const { ctx } = createEnv()
    const items = provideCompletions('<span class="mdi:ho', ctx)!
    expect(ctx.getIconMarkdown).not.toHaveBeenCalled()

    const resolved = await resolveCompletion(items.find(i => i.label === 'home')!, ctx)
    expect(ctx.getIconMarkdown).toHaveBeenCalledTimes(1)
    expect(resolved.documentation).toContain('data:image/svg+xml;base64,')
    expect(resolved.documentation).toContain('mdi:home')
  })

  it('集合项的文档走 getCollectionMarkdown', async () => {
    const { ctx } = createEnv()
    const items = provideCompletions('<span class="i-ca', ctx)!
    const resolved = await resolveCompletion(items.find(i => i.label === 'carbon')!, ctx)
    expect(ctx.getCollectionMarkdown).toHaveBeenCalledWith('carbon')
    expect(resolved.documentation).toBe('') // carbon 无数据源,安静返回空
  })

  it('补全到文档的全链路里,同一集合只下载一次', async () => {
    // 注意不解构 fetchCalls:getter 会在解构瞬间固化成 0
    const h = createEnv()
    const items = provideCompletions('<span class="mdi:ho', h.ctx)!
    await resolveCompletion(items.find(i => i.label === 'home')!, h.ctx)
    await resolveCompletion(items.find(i => i.label === 'account')!, h.ctx)
    await resolveCompletion(items.find(i => i.label === 'home')!, h.ctx)
    expect(h.fetchCalls).toBe(1)
  })
})

describe('markdown 悬停文档', () => {
  it('图标文档:内嵌 data URL 大图 + 键名', async () => {
    const { env } = createEnv()
    const md = await getIconMarkdown('mdi:home', env)
    expect(md).toContain('![](data:image/svg+xml;base64,')
    expect(md).toContain('`mdi:home`')
  })

  it('别名键的文档解析到真实图标,展示用户书写的键', async () => {
    const { env } = createEnv({ aliases: { save: 'mdi:content-save' } })
    const md = await getIconMarkdown('save', env)
    expect(md).toContain('`save`')
    expect(md).toContain('data:image/svg+xml;base64,')
  })

  it('不存在的图标返回空字符串,不抛异常', async () => {
    const { env } = createEnv()
    expect(await getIconMarkdown('mdi:ghost', env)).toBe('')
    expect(await getIconMarkdown('ph:cycle', env)).toBe('')
  })

  it('集合文档:标题 + 至多 5 个图标预览', async () => {
    const { env } = createEnv()
    const md = await getCollectionMarkdown('mdi', env)
    expect(md).toContain('#### Material Design Icons')
    const previews = md.match(/!\[\]\(data:/g) ?? []
    expect(previews).toHaveLength(3)
  })
})
