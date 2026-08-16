import type { IconSetData } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { base64ToUtf8, utf8ToBase64 } from '../src/base64'
import { createRenderer, pathToSvg, toDataUrl, toRenderInfo } from '../src/render'

describe('utf8ToBase64 / base64ToUtf8', () => {
  it('已知向量:foobar 编码为 Zm9vYmFy', () => {
    expect(utf8ToBase64('foobar')).toBe('Zm9vYmFy')
    expect(utf8ToBase64('foob')).toBe('Zm9vYg==')
  })

  it('往返一致:中文与 emoji 都能无损还原', () => {
    for (const input of ['中文图标', '图标 😀🎉', '<svg xmlns="..."/>'])
      expect(base64ToUtf8(utf8ToBase64(input))).toBe(input)
  })

  it('解码已知向量', () => {
    expect(base64ToUtf8('Zm9vYmFy')).toBe('foobar')
  })
})

describe('toRenderInfo 尺寸回退链', () => {
  const set: IconSetData = {
    prefix: 'mdi',
    width: 24,
    height: 24,
    icons: {
      home: { body: '<path d="M10 20"/>' },
      wide: { body: '<path d="M0 0"/>', width: 48, height: 24 },
    },
  }
  const bare: IconSetData = { prefix: 'bare', icons: { dot: { body: '<circle/>' } } }

  it('图标自身无尺寸时用集合默认尺寸', () => {
    expect(toRenderInfo(set, 'home', 'mdi:home')).toMatchObject({ width: 24, height: 24, ratio: 1 })
  })

  it('图标自身的尺寸优先于集合默认', () => {
    expect(toRenderInfo(set, 'wide', 'mdi:wide')).toMatchObject({ width: 48, height: 24, ratio: 2 })
  })

  it('集合也没有尺寸时回退到 16', () => {
    expect(toRenderInfo(bare, 'dot', 'bare:dot')).toMatchObject({ width: 16, height: 16, ratio: 1 })
  })

  it('集合里不存在的图标返回 undefined', () => {
    expect(toRenderInfo(set, 'ghost', 'mdi:ghost')).toBeUndefined()
  })
})

describe('pathToSvg 壳与宽高比', () => {
  it('非正方形图标按 ratio 撑宽,不被压扁', () => {
    const info = { key: 'flag:x', body: '<path/>', width: 24, height: 16, ratio: 1.5 }
    const svg = pathToSvg(info, 12)
    expect(svg).toContain('width="18px"')
    expect(svg).toContain('height="12px"')
    expect(svg).toContain('viewBox="0 0 24 16"')
    expect(svg).toContain('<path/>')
  })

  it('正方形图标宽高相等', () => {
    const info = { key: 'mdi:home', body: '<path/>', width: 24, height: 24, ratio: 1 }
    expect(pathToSvg(info, 14)).toContain('width="14px"')
  })
})

describe('createRenderer 主题色与缓存', () => {
  const info = { key: 'mdi:home', body: '<path fill="currentColor"/>', width: 24, height: 24, ratio: 1 }

  it('data URL 前缀正确,且能解码回渲染后的 SVG', () => {
    const url = toDataUrl('<svg>ok</svg>')
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(base64ToUtf8(url.slice('data:image/svg+xml;base64,'.length))).toBe('<svg>ok</svg>')
  })

  it('浅色主题:#222 替换 currentColor,解码验证', () => {
    const { getIconDataUrl } = createRenderer()
    const url = getIconDataUrl(info, 32, '#222')
    const svg = base64ToUtf8(url.slice('data:image/svg+xml;base64,'.length))
    expect(svg).toContain('fill="#222"')
    expect(svg).not.toContain('currentColor')
  })

  it('深色主题:#eee 生效——颜色不同,产物不同', () => {
    const { getIconDataUrl } = createRenderer()
    const light = getIconDataUrl(info, 32, '#222')
    const dark = getIconDataUrl(info, 32, '#eee')
    expect(light).not.toBe(dark)
  })

  it('同一(颜色,字号,键)只编码一次,任一维度变化都重新编码', () => {
    const encode = vi.fn((svg: string) => `url:${svg}`)
    const { getIconDataUrl } = createRenderer({ toDataUrl: encode })
    const first = getIconDataUrl(info, 32, '#222')
    getIconDataUrl(info, 32, '#222')
    expect(encode).toHaveBeenCalledTimes(1)
    expect(getIconDataUrl(info, 48, '#222')).not.toBe(first)
    getIconDataUrl(info, 48, '#eee')
    expect(encode).toHaveBeenCalledTimes(3)
  })
})
