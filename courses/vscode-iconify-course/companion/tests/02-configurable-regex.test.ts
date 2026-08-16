import { describe, expect, it } from 'vitest'
import { buildRegexes, createConfig } from '../src/config'
import { findIconKeys } from '../src/scan'

describe('createConfig 默认值', () => {
  it('空入参得到完整默认配置', () => {
    const config = createConfig()
    expect(config.delimiters).toEqual([':', '--', '-', '/'])
    expect(config.prefixes).toEqual(['', 'i-', '~icons/'])
    expect(config.suffixes).toEqual(['', 'i-'])
  })

  it('部分入参只覆盖对应字段,其余保留默认', () => {
    const config = createConfig({ delimiters: [':'] })
    expect(config.delimiters).toEqual([':'])
    expect(config.prefixes).toContain('i-')
  })
})

describe('buildRegexes 正则组装', () => {
  it('每次调用产出全新 RegExp,全局正则不可复用', () => {
    const config = createConfig()
    const a = buildRegexes(config)
    const b = buildRegexes(config)
    expect(a.full).not.toBe(b.full)
    expect(a.full.global).toBe(true)
  })

  it('full 正则识别「集合+分隔符+图标名」完整形态', () => {
    const config = createConfig()
    const m = buildRegexes(config).full.exec('a mdi:home b')
    expect(m?.[1]).toBe('mdi:home')
  })

  it('配置里的特殊字符会被转义,不会变成正则元字符', () => {
    const config = createConfig({ delimiters: ['.'], prefixes: [''], suffixes: [''] })
    const { full } = buildRegexes(config)
    expect(full.exec('a carbon.home b')?.[1]).toBe('carbon.home')
    expect(full.exec('a carbonXhome b')).toBe(null)
  })
})

describe('findIconKeys 文本扫描', () => {
  it('默认配置识别 mdi:home,匹配范围不含前置边界字符', () => {
    const config = createConfig()
    const matches = findIconKeys('text mdi:home more', config)
    expect(matches).toEqual([
      { start: 5, end: 13, key: 'mdi:home' },
    ])
  })

  it('默认前缀组含 i-,识别 UnoCSS 风格的 i-carbon-home', () => {
    const config = createConfig()
    const matches = findIconKeys('<div class="i-carbon-home">', config)
    expect(matches).toEqual([
      { start: 12, end: 25, key: 'carbon-home' },
    ])
  })

  it('自定义前缀组不含空串时,无前缀的形态不再识别', () => {
    const config = createConfig({ prefixes: ['ic-'], delimiters: [':'] })
    const matches = findIconKeys('a ic-mdi:home b mdi:home c', config)
    expect(matches).toEqual([
      { start: 2, end: 13, key: 'mdi:home' },
    ])
  })

  it('处于文本第 0 位的图标键也能识别(哨兵边界)', () => {
    const config = createConfig()
    const matches = findIconKeys('mdi:home at start', config)
    expect(matches).toEqual([{ start: 0, end: 8, key: 'mdi:home' }])
  })

  it('贪婪名不截断:mdi:homepage 是一个整体,不会报成 mdi:home', () => {
    const config = createConfig()
    const matches = findIconKeys('mdi:home mdi:account mdi:homepage', config)
    expect(matches.map(m => m.key)).toEqual(['mdi:home', 'mdi:account', 'mdi:homepage'])
  })

  it('aliases 配置里的别名本身也是可识别形态', () => {
    const config = createConfig({ aliases: ['save'] })
    const matches = findIconKeys('please save it', config)
    expect(matches.map(m => m.key)).toEqual(['save'])
  })
})
