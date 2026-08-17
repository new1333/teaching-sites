// tests/http-parser-state-machine.test.ts —— 第 3 章：HTTP 解析状态机
import { describe, it, expect } from 'vitest'
import { createHttpParser, type RequestHead } from '../src/http-parser'

const REQ = 'GET /index.html HTTP/1.1\r\nHost: example.com\r\nUser-Agent: tinysrv-test\r\n\r\n'
const REQ_BYTES = new TextEncoder().encode(REQ)

/** 把字节流按每 sliceSize 字节一片切开，逐片喂给 parser */
function feedSliced(sliceSize: number): RequestHead[] {
  const p = createHttpParser()
  const heads: RequestHead[] = []
  for (let i = 0; i < REQ_BYTES.length; i += sliceSize) {
    for (const ev of p.feed(REQ_BYTES.slice(i, i + sliceSize))) {
      if (ev.type === 'request') heads.push(ev.head)
    }
  }
  return heads
}

describe('整块到货', () => {
  it('一次喂入完整请求，产出正确的请求头', () => {
    const p = createHttpParser()
    const events = p.feed(new TextEncoder().encode(REQ))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('request')
    if (events[0].type !== 'request') return
    expect(events[0].head.method).toBe('GET')
    expect(events[0].head.path).toBe('/index.html')
    expect(events[0].head.version).toBe('HTTP/1.1')
    expect(events[0].head.headers).toEqual({
      host: 'example.com',
      'user-agent': 'tinysrv-test',
    })
  })
})

describe('半包：任意切法结果一致', () => {
  it('每 3 字节一片，产出与整块一致', () => {
    const heads = feedSliced(3)
    expect(heads).toHaveLength(1)
    expect(heads[0].method).toBe('GET')
    expect(heads[0].path).toBe('/index.html')
    expect(heads[0].headers.host).toBe('example.com')
  })

  it('每 7 字节一片（跨过所有边界），产出一致', () => {
    const heads = feedSliced(7)
    expect(heads).toHaveLength(1)
    expect(heads[0].headers['user-agent']).toBe('tinysrv-test')
  })

  it('逐字节喂入——最狠的切法，产出依然一致', () => {
    const heads = feedSliced(1)
    expect(heads).toHaveLength(1)
    expect(heads[0].method).toBe('GET')
    expect(heads[0].version).toBe('HTTP/1.1')
  })
})

describe('粘包：一次到货两个请求', () => {
  it('一次喂入两个完整请求，按序产出两个事件', () => {
    const p = createHttpParser()
    const two = 'POST /api HTTP/1.1\r\nHost: a.com\r\n\r\nGET /b HTTP/1.1\r\nHost: b.com\r\n\r\n'
    const events = p.feed(new TextEncoder().encode(two))
    const requests = events.filter((e) => e.type === 'request')
    expect(requests).toHaveLength(2)
    if (requests[0].type !== 'request' || requests[1].type !== 'request') return
    expect(requests[0].head.method).toBe('POST')
    expect(requests[0].head.path).toBe('/api')
    expect(requests[1].head.method).toBe('GET')
    expect(requests[1].head.path).toBe('/b')
  })
})

describe('畸形输入：报错不崩溃', () => {
  it('请求行不合法（两段），产出 bad-request-line 错误事件', () => {
    const p = createHttpParser()
    const events = p.feed(new TextEncoder().encode('GIBBERISH\r\nHost: x\r\n\r\n'))
    expect(events.some((e) => e.type === 'error' && e.reason === 'bad-request-line')).toBe(true)
  })

  it('版本号缺失，产出 bad-request-line', () => {
    const p = createHttpParser()
    const events = p.feed(new TextEncoder().encode('GET /x FTP/2\r\n\r\n'))
    expect(events.some((e) => e.type === 'error' && e.reason === 'bad-request-line')).toBe(true)
  })

  it('头部行没有冒号，产出 bad-header', () => {
    const p = createHttpParser()
    const events = p.feed(new TextEncoder().encode('GET / HTTP/1.1\r\nNoColonHere\r\n\r\n'))
    expect(events.some((e) => e.type === 'error' && e.reason === 'bad-header')).toBe(true)
  })

  it('出错之后状态机闭嘴：后续喂数不再产出任何事件', () => {
    const p = createHttpParser()
    p.feed(new TextEncoder().encode('BAD\r\n\r\n'))
    const after = p.feed(new TextEncoder().encode('GET / HTTP/1.1\r\nHost: x\r\n\r\n'))
    expect(after).toHaveLength(0)
  })
})

describe('慢速攻击防线：行长上限', () => {
  it('无换行的超长行触发 line-too-long', () => {
    const p = createHttpParser({ maxLineBytes: 64 })
    const events = p.feed(new TextEncoder().encode('G'.repeat(100)))
    expect(events.some((e) => e.type === 'error' && e.reason === 'line-too-long')).toBe(true)
  })
})
