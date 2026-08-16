import { describe, expect, it } from 'vitest'
import { applyAlias, parseIcon } from '../src/parse'

const IDS = ['mdi', 'mdi-light', 'carbon', 'ph']

describe('parseIcon 集合消歧与拆分', () => {
  it('把图标键拆成集合与图标名', () => {
    expect(parseIcon('mdi:home', IDS)).toEqual({ collection: 'mdi', icon: 'home' })
  })

  it('前缀重叠时,长集合 id 优先:mdi-light 不会被吃成 mdi', () => {
    expect(parseIcon('mdi-light:home', IDS)).toEqual({ collection: 'mdi-light', icon: 'home' })
  })

  it('调用方传入乱序集合 id,内部仍按长度降序消歧', () => {
    expect(parseIcon('mdi-light:home', ['mdi', 'mdi-light'])).toEqual({ collection: 'mdi-light', icon: 'home' })
  })

  it('多字符分隔符优先于单字符:carbon--home 的分隔符是 -- 而非 -', () => {
    expect(parseIcon('carbon--home', ['carbon'])).toEqual({ collection: 'carbon', icon: 'home' })
  })

  it('短横线也是默认分隔符', () => {
    expect(parseIcon('mdi-home', IDS)).toEqual({ collection: 'mdi', icon: 'home' })
  })

  it('不在集合清单里的字符串返回 undefined,不抛异常', () => {
    expect(parseIcon('nosuch:home', IDS)).toBeUndefined()
  })

  it('只有集合没有图标名的残键返回 undefined', () => {
    expect(parseIcon('mdi:', IDS)).toBeUndefined()
    expect(parseIcon('mdi', IDS)).toBeUndefined()
  })
})

describe('applyAlias 别名展开', () => {
  it('命中别名表时映射到真实图标键', () => {
    expect(applyAlias('save', { save: 'mdi:content-save' })).toBe('mdi:content-save')
  })

  it('未命中时原样返回', () => {
    expect(applyAlias('mdi:home', { save: 'mdi:content-save' })).toBe('mdi:home')
  })

  it('先展开别名再解析,得到真实集合与图标名', () => {
    const aliases = { save: 'mdi:content-save' }
    const actual = applyAlias('save', aliases)
    expect(parseIcon(actual, IDS)).toEqual({ collection: 'mdi', icon: 'content-save' })
  })
})
