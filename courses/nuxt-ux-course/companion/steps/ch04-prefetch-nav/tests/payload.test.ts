// companion/tests/payload.test.ts · payload 探针逻辑（纯逻辑，固定 HTML fixture，无网络无时间）
// gate:ch2 用 extractPayloadText 判定「payload 含同源数据」——这个探针自身先要被守住：
// 拿不出数据时判空、拿得到时逐字一致、多个 script 标签时不越界吞并。
import { describe, expect, it } from 'vitest'
import { extractPayloadBytes, extractPayloadText } from '../scripts/lib/measure-core.mjs'

const FIXTURE_DATA = '["preload",{"id":1,"name":"云朵雨伞","summary":"雨天出门的第一道防线，雨具区第 1 号慢销款。"}]'
const FIXTURE_HTML = [
  '<!DOCTYPE html><html lang="zh-CN"><head>',
  '<script src="/_nuxt/entry.abcd1234.js" crossorigin><\/script>',
  '<script type="application/json" id="__NUXT_DATA__" data-src="/products">',
  FIXTURE_DATA,
  '<\/script>',
  '<script>window.other = 1<\/script>',
  '</head><body><h1>全部商品</h1></body></html>',
].join('')

const SHELL_HTML =
  '<!DOCTYPE html><html><head></head><body><p>商品加载中……蜗牛也在努力。</p></body></html>'

describe('payload 探针（__NUXT_DATA__ 提取）', () => {
  it('有内联 payload 时提取出原始 JSON 文本，同源数据逐字在内', () => {
    const text = extractPayloadText(FIXTURE_HTML)
    expect(text).toBe(FIXTURE_DATA)
    expect(text).toContain('云朵雨伞')
    expect(text).toContain('雨天出门的第一道防线')
  })

  it('提取止于 __NUXT_DATA__ 的闭合标签，不吞并后续 script', () => {
    expect(extractPayloadText(FIXTURE_HTML)).not.toContain('window.other')
  })

  it('客户端取数的壳页面提取为空串，字节数为 0', () => {
    expect(extractPayloadText(SHELL_HTML)).toBe('')
    expect(extractPayloadBytes(SHELL_HTML)).toBe(0)
  })

  it('字节数等于提取文本的 UTF-8 编码长度（中文按字节计）', () => {
    expect(extractPayloadBytes(FIXTURE_HTML)).toBe(Buffer.byteLength(FIXTURE_DATA, 'utf8'))
    expect(extractPayloadBytes(FIXTURE_HTML)).toBeGreaterThan(FIXTURE_DATA.length)
  })
})
