// tests/06-dns-strategy.test.ts —— 第 6 章：DNS 策略
// preserve-domain（先按域名规则判断，DIRECT 才解析）与 resolve-first（先解析、IP 规则才能参与）；
// resolver 全部由测试注入固定实现，不发起真实 DNS 查询。

import { describe, expect, it, vi } from 'vitest'
import { planRoute } from '../src/dns.js'
import type { Resolver, Rule, TargetAddress } from '../src/types.js'

function fakeResolver(table: Record<string, string>): Resolver {
  return async (host: string) => {
    const ip = table[host]
    if (ip === undefined) throw new Error(`no fake DNS record for ${host}`)
    return ip
  }
}

const DOMAIN_TARGET: TargetAddress = { kind: 'domain', host: 'internal.example.com', port: 443 }

describe('DNS 策略：preserve-domain', () => {
  it('命中 REJECT 时不需要解析域名', async () => {
    const resolver = vi.fn(fakeResolver({ 'internal.example.com': '10.0.0.9' }))
    const rules: Rule[] = [
      { type: 'DOMAIN', value: 'internal.example.com', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = await planRoute(DOMAIN_TARGET, 'preserve-domain', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('REJECT')
    expect(outcome.dialTarget).toEqual(DOMAIN_TARGET)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('命中 PROXY 时保留域名，不在本地解析（交给上游解析）', async () => {
    const resolver = vi.fn(fakeResolver({ 'internal.example.com': '10.0.0.9' }))
    const rules: Rule[] = [
      { type: 'DOMAIN', value: 'internal.example.com', action: 'PROXY', outbound: 'upstream-a' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = await planRoute(DOMAIN_TARGET, 'preserve-domain', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision).toEqual({ action: 'PROXY', outbound: 'upstream-a', rule: rules[0] })
    expect(outcome.dialTarget).toEqual(DOMAIN_TARGET)
    expect(resolver).not.toHaveBeenCalled()
  })

  it('命中 DIRECT 时才解析域名，dialTarget 变成解析出的 IP', async () => {
    const resolver = vi.fn(fakeResolver({ 'internal.example.com': '203.0.113.7' }))
    const rules: Rule[] = [{ type: 'MATCH', value: '', action: 'DIRECT' }]
    const outcome = await planRoute(DOMAIN_TARGET, 'preserve-domain', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('DIRECT')
    expect(outcome.dialTarget).toEqual({ kind: 'ipv4', host: '203.0.113.7', port: 443 })
    expect(resolver).toHaveBeenCalledWith('internal.example.com')
  })

  it('目标本来就是 IP 时不需要解析，直接用 IP 上下文匹配规则', async () => {
    const resolver = vi.fn(fakeResolver({}))
    const rules: Rule[] = [
      { type: 'IP-CIDR', value: '203.0.113.0/24', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const target: TargetAddress = { kind: 'ipv4', host: '203.0.113.7', port: 443 }
    const outcome = await planRoute(target, 'preserve-domain', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('REJECT')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('解析失败时返回明确的失败原因', async () => {
    const resolver = fakeResolver({}) // 表里没有这个域名，resolver 会抛错
    const rules: Rule[] = [{ type: 'MATCH', value: '', action: 'DIRECT' }]
    const outcome = await planRoute(DOMAIN_TARGET, 'preserve-domain', rules, resolver)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('internal.example.com')
  })
})

describe('DNS 策略：resolve-first', () => {
  it('域名先解析成 IP，IP-CIDR 规则才能参与判断', async () => {
    const resolver = fakeResolver({ 'internal.example.com': '10.1.2.3' })
    const rules: Rule[] = [
      { type: 'IP-CIDR', value: '10.0.0.0/8', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = await planRoute(DOMAIN_TARGET, 'resolve-first', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('REJECT')
    expect(outcome.dialTarget).toEqual({ kind: 'ipv4', host: '10.1.2.3', port: 443 })
  })

  it('解析后 DOMAIN / DOMAIN-SUFFIX 规则依然可用', async () => {
    const resolver = fakeResolver({ 'internal.example.com': '203.0.113.7' })
    const rules: Rule[] = [
      { type: 'DOMAIN-SUFFIX', value: 'example.com', action: 'PROXY', outbound: 'upstream-a' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    const outcome = await planRoute(DOMAIN_TARGET, 'resolve-first', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('PROXY')
    expect(outcome.dialTarget).toEqual({ kind: 'ipv4', host: '203.0.113.7', port: 443 })
  })

  it('目标本来就是 IP 时跳过解析，直接用 IP 匹配', async () => {
    const resolver = vi.fn(fakeResolver({}))
    const rules: Rule[] = [
      { type: 'IP-CIDR', value: '198.51.100.0/24', action: 'DIRECT' },
      { type: 'MATCH', value: '', action: 'REJECT' },
    ]
    const target: TargetAddress = { kind: 'ipv4', host: '198.51.100.5', port: 80 }
    const outcome = await planRoute(target, 'resolve-first', rules, resolver)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.decision.action).toBe('DIRECT')
    expect(resolver).not.toHaveBeenCalled()
  })

  it('没有规则命中时返回失败', async () => {
    const resolver = fakeResolver({ 'internal.example.com': '10.1.2.3' })
    const rules: Rule[] = [{ type: 'DOMAIN', value: 'only-this.example.com', action: 'DIRECT' }]
    const outcome = await planRoute(DOMAIN_TARGET, 'resolve-first', rules, resolver)
    expect(outcome.ok).toBe(false)
  })
})
