import { describe, expect, it } from 'vitest'
import { createConfig } from '../src/config'
import { collectMatches, positionAt } from '../src/scan'

describe('positionAt 偏移换行列', () => {
  it('LF 文本:换行符属于下一行,行列一律 0 起', () => {
    const text = 'ab\ncd'
    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 })
    expect(positionAt(text, 2)).toEqual({ line: 0, character: 2 })
    expect(positionAt(text, 3)).toEqual({ line: 1, character: 0 })
    expect(positionAt(text, 5)).toEqual({ line: 1, character: 2 })
  })

  it('CRLF 文本:\\r 属于行尾序列,不计入行内字符', () => {
    const text = 'ab\r\ncd'
    expect(positionAt(text, 0)).toEqual({ line: 0, character: 0 })
    expect(positionAt(text, 2)).toEqual({ line: 0, character: 2 })
    expect(positionAt(text, 3)).toEqual({ line: 0, character: 2 })
    expect(positionAt(text, 4)).toEqual({ line: 1, character: 0 })
    expect(positionAt(text, 6)).toEqual({ line: 1, character: 2 })
  })

  it('越界偏移收敛到文本末尾,不抛异常', () => {
    expect(positionAt('ab', 100)).toEqual({ line: 0, character: 2 })
    expect(positionAt('ab', -1)).toEqual({ line: 0, character: 0 })
  })
})

describe('collectMatches 匹配升级为行列范围', () => {
  it('同一个图标在 LF 与 CRLF 文本里得到相同的行列', () => {
    const config = createConfig()
    const lf = collectMatches('x mdi:home\ny mdi:home', config)
    const crlf = collectMatches('x mdi:home\r\ny mdi:home', config)
    expect(lf).toEqual(crlf)
    expect(lf).toEqual([
      {
        key: 'mdi:home',
        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 10 } },
      },
      {
        key: 'mdi:home',
        range: { start: { line: 1, character: 2 }, end: { line: 0 + 1, character: 10 } },
      },
    ])
  })

  it('跨多行的文本中,第三行的图标落在第三行', () => {
    const config = createConfig()
    const text = 'line one\nline two\n  mdi:account end'
    const matches = collectMatches(text, config)
    expect(matches).toEqual([
      {
        key: 'mdi:account',
        range: { start: { line: 2, character: 2 }, end: { line: 2, character: 13 } },
      },
    ])
  })
})
