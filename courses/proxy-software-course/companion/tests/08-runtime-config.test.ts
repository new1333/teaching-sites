// tests/08-runtime-config.test.ts —— 第 8 章：运行时配置解析与校验
// listeners(http/socks host/port)、dnsStrategy、rules、outbounds（至少 DIRECT/REJECT，
// 可选 PROXY 用的 SOCKS5）；未知动作、无 MATCH 兜底、非法端口、PROXY 未配置上游都要显式报错。

import { describe, expect, it } from 'vitest'
import { parseProxyConfig } from '../src/config.js'

function baseConfig(): Record<string, unknown> {
  return {
    listeners: {
      http: { host: '127.0.0.1', port: 0 },
      socks: { host: '127.0.0.1', port: 0 },
    },
    dnsStrategy: 'preserve-domain',
    rules: [{ type: 'MATCH', value: '', action: 'DIRECT' }],
    outbounds: {
      DIRECT: { type: 'DIRECT' },
      REJECT: { type: 'REJECT' },
    },
  }
}

describe('config：合法配置', () => {
  it('最小合法配置能正确解析', () => {
    const outcome = parseProxyConfig(baseConfig())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.config.dnsStrategy).toBe('preserve-domain')
    expect(outcome.config.rules).toHaveLength(1)
  })

  it('带 SOCKS5 上游的 PROXY 规则能正确解析', () => {
    const config = baseConfig()
    config['rules'] = [
      { type: 'DOMAIN-SUFFIX', value: 'example.com', action: 'PROXY', outbound: 'upstream-a' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    config['outbounds'] = {
      DIRECT: { type: 'DIRECT' },
      REJECT: { type: 'REJECT' },
      'upstream-a': { type: 'SOCKS5', host: '127.0.0.1', port: 1080 },
    }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(true)
  })
})

describe('config：根节点与 listeners 校验', () => {
  it('根节点不是对象时报错', () => {
    const outcome = parseProxyConfig('not-an-object')
    expect(outcome.ok).toBe(false)
  })

  it('缺少 listeners 时报错', () => {
    const config = baseConfig()
    delete config['listeners']
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('listeners'))).toBe(true)
  })

  it('非法端口（超范围）报错', () => {
    const config = baseConfig()
    config['listeners'] = { http: { host: '127.0.0.1', port: 70000 }, socks: { host: '127.0.0.1', port: 0 } }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('listeners.http.port'))).toBe(true)
  })

  it('非法端口（非整数）报错', () => {
    const config = baseConfig()
    config['listeners'] = { http: { host: '127.0.0.1', port: 8080.5 }, socks: { host: '127.0.0.1', port: 0 } }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
  })

  it('非法端口（0 或负数）报错', () => {
    const config = baseConfig()
    config['listeners'] = { http: { host: '127.0.0.1', port: 0 }, socks: { host: '127.0.0.1', port: -1 } }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
  })
})

describe('config：dnsStrategy 校验', () => {
  it('未知 dnsStrategy 报错', () => {
    const config = baseConfig()
    config['dnsStrategy'] = 'fastest-guess'
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('dnsStrategy'))).toBe(true)
  })
})

describe('config：rules 校验', () => {
  it('空规则数组报错', () => {
    const config = baseConfig()
    config['rules'] = []
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
  })

  it('规则数组末尾不是 MATCH 时报错（没有兜底）', () => {
    const config = baseConfig()
    config['rules'] = [{ type: 'DOMAIN', value: 'example.com', action: 'DIRECT' }]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('MATCH'))).toBe(true)
  })

  it('未知规则类型报错', () => {
    const config = baseConfig()
    config['rules'] = [
      { type: 'DOMAIN-WILDCARD', value: 'x', action: 'DIRECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('type 未知'))).toBe(true)
  })

  it('未知动作报错', () => {
    const config = baseConfig()
    config['rules'] = [
      { type: 'DOMAIN', value: 'example.com', action: 'ALLOW' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('action 未知'))).toBe(true)
  })

  it('PROXY 动作缺少 outbound 报错', () => {
    const config = baseConfig()
    config['rules'] = [{ type: 'MATCH', value: '', action: 'PROXY' }]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('PROXY'))).toBe(true)
  })

  it('PROXY 引用了不存在的 outbound 报错', () => {
    const config = baseConfig()
    config['rules'] = [{ type: 'MATCH', value: '', action: 'PROXY', outbound: 'ghost' }]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('ghost'))).toBe(true)
  })

  it('PROXY 引用的 outbound 类型不是 SOCKS5 时报错', () => {
    const config = baseConfig()
    config['rules'] = [{ type: 'MATCH', value: '', action: 'PROXY', outbound: 'DIRECT' }]
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('SOCKS5'))).toBe(true)
  })
})

describe('config：outbounds 校验', () => {
  it('缺少 DIRECT 出站报错', () => {
    const config = baseConfig()
    config['outbounds'] = { REJECT: { type: 'REJECT' } }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('DIRECT'))).toBe(true)
  })

  it('缺少 REJECT 出站报错', () => {
    const config = baseConfig()
    config['outbounds'] = { DIRECT: { type: 'DIRECT' } }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('REJECT'))).toBe(true)
  })

  it('SOCKS5 出站缺少 port 报错', () => {
    const config = baseConfig()
    config['outbounds'] = {
      DIRECT: { type: 'DIRECT' },
      REJECT: { type: 'REJECT' },
      'upstream-a': { type: 'SOCKS5', host: '127.0.0.1' },
    }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
  })

  it('未知 outbound 类型报错', () => {
    const config = baseConfig()
    config['outbounds'] = {
      DIRECT: { type: 'DIRECT' },
      REJECT: { type: 'REJECT' },
      weird: { type: 'HTTP-CONNECT' },
    }
    const outcome = parseProxyConfig(config)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.errors.some((e) => e.includes('type 未知'))).toBe(true)
  })
})
