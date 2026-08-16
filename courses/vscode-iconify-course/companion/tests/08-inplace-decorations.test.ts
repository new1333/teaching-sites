import type { IconSetData } from '../src/types'
import { describe, expect, it } from 'vitest'
import { createConfig } from '../src/config'
import { collectDecorations } from '../src/decorations'
import { createRenderer } from '../src/render'
import { builtinCollectionIds } from '../src/collections'

const mdiSet: IconSetData = {
  prefix: 'mdi',
  width: 24,
  height: 24,
  icons: {
    home: { body: '<path d="M10 20v-6h4v6h5v-8h3L12 3L2 12h3v8h5z" fill="currentColor"/>' },
    account: { body: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z" fill="currentColor"/>' },
  },
}

function createEnv(overrides: Record<string, unknown> = {}) {
  return {
    config: createConfig(),
    collectionIds: builtinCollectionIds,
    loadIconSet: async (id: string) => (id === 'mdi' ? mdiSet : undefined),
    render: createRenderer(),
    fontSize: 12,
    color: '#222',
    ...overrides,
  }
}

describe('collectDecorations 装饰收集', () => {
  it('普通模式:每个图标键一个装饰,按出现顺序,内容齐全', async () => {
    const decorations = await collectDecorations('x mdi:home\ny mdi:account', createEnv())
    expect(decorations).toHaveLength(2)
    expect(decorations[0]).toMatchObject({
      key: 'mdi:home',
      range: { start: { line: 0, character: 2 }, end: { line: 0, character: 10 } },
      hideText: false,
    })
    expect(decorations[0]!.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(decorations[0]!.hoverMarkdown).toContain('mdi:home')
    expect(decorations[1]!.key).toBe('mdi:account')
  })

  it('in-place 模式:光标所在行豁免隐藏,其余行照常隐藏', async () => {
    const decorations = await collectDecorations(
      'x mdi:home\ny mdi:account',
      createEnv({ inplace: true, cursorLine: 0 }),
    )
    expect(decorations[0]!.hideText).toBe(false)
    expect(decorations[1]!.hideText).toBe(true)
  })

  it('in-place 模式:光标移到第二行,豁免关系对调', async () => {
    const decorations = await collectDecorations(
      'x mdi:home\ny mdi:account',
      createEnv({ inplace: true, cursorLine: 1 }),
    )
    expect(decorations[0]!.hideText).toBe(true)
    expect(decorations[1]!.hideText).toBe(false)
  })

  it('别名先展开再解析,装饰上保留用户书写的原始键', async () => {
    const decorations = await collectDecorations(
      'save it',
      createEnv({ aliases: { save: 'mdi:home' } }),
    )
    expect(decorations).toHaveLength(1)
    expect(decorations[0]!.key).toBe('save')
  })

  it('集合加载失败或图标不存在时安静跳过,不抛异常', async () => {
    expect(await collectDecorations('a ph:cycle', createEnv())).toEqual([])
    expect(await collectDecorations('a mdi:ghost', createEnv())).toEqual([])
  })
})
