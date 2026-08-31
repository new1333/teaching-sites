// tests/05-rule-engine.test.ts —— 第 5 章：规则引擎
// 按首条命中；DOMAIN / DOMAIN-SUFFIX（尊重标签边界）/ IP-CIDR（IPv4）/ PORT / MATCH；
// 动作 DIRECT / REJECT / PROXY。纯函数测试，不涉及网络。

import { describe, expect, it } from 'vitest'
import { ipInCidr, route } from '../src/rules.js'
import type { Rule } from '../src/types.js'

describe('规则引擎：ipInCidr', () => {
  it('IPv4 地址落在 CIDR 网段内', () => {
    expect(ipInCidr('10.0.0.5', '10.0.0.0/8')).toBe(true)
    expect(ipInCidr('192.168.1.42', '192.168.1.0/24')).toBe(true)
    expect(ipInCidr('192.168.1.42', '192.168.1.0/25')).toBe(true) // .42 在 .0-.127
    expect(ipInCidr('192.168.1.200', '192.168.1.0/25')).toBe(false) // .200 在 .128-.255
  })

  it('IPv4 地址不在 CIDR 网段内', () => {
    expect(ipInCidr('172.16.0.1', '10.0.0.0/8')).toBe(false)
  })

  it('/0 匹配一切合法 IPv4', () => {
    expect(ipInCidr('8.8.8.8', '0.0.0.0/0')).toBe(true)
  })

  it('/32 只匹配单一地址', () => {
    expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).toBe(true)
    expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).toBe(false)
  })

  it('非法 CIDR 或非 IPv4 地址一律不匹配（不抛异常）', () => {
    expect(ipInCidr('not-an-ip', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('10.0.0.1', 'not-a-cidr')).toBe(false)
    expect(ipInCidr('::1', '10.0.0.0/8')).toBe(false)
  })
})

describe('规则引擎：route() 按首条命中', () => {
  it('DOMAIN 精确匹配', () => {
    const rules: Rule[] = [
      { type: 'DOMAIN', value: 'example.com', action: 'DIRECT' },
      { type: 'MATCH', value: '', action: 'REJECT' },
    ]
    expect(route({ domain: 'example.com', port: 80 }, rules)).toEqual({ action: 'DIRECT', rule: rules[0] })
    expect(route({ domain: 'www.example.com', port: 80 }, rules)?.action).toBe('REJECT') // 精确匹配不含子域名
  })

  it('DOMAIN-SUFFIX 尊重标签边界：子域名匹配，同后缀但非同一标签的域名不匹配', () => {
    const rules: Rule[] = [
      { type: 'DOMAIN-SUFFIX', value: 'example.com', action: 'DIRECT' },
      { type: 'MATCH', value: '', action: 'REJECT' },
    ]
    expect(route({ domain: 'example.com', port: 443 }, rules)?.action).toBe('DIRECT')
    expect(route({ domain: 'www.example.com', port: 443 }, rules)?.action).toBe('DIRECT')
    expect(route({ domain: 'api.www.example.com', port: 443 }, rules)?.action).toBe('DIRECT')
    // "evil-example.com" 只是字符串意义上以 "example.com" 结尾，标签边界不同，不该匹配
    expect(route({ domain: 'evil-example.com', port: 443 }, rules)?.action).toBe('REJECT')
    expect(route({ domain: 'notexample.com', port: 443 }, rules)?.action).toBe('REJECT')
  })

  it('IP-CIDR 规则参与匹配需要上下文里有 ip', () => {
    const rules: Rule[] = [
      { type: 'IP-CIDR', value: '10.0.0.0/8', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    expect(route({ ip: '10.1.2.3', port: 80 }, rules)?.action).toBe('REJECT')
    expect(route({ ip: '8.8.8.8', port: 80 }, rules)?.action).toBe('DIRECT')
    expect(route({ domain: 'no-ip-here.com', port: 80 }, rules)?.action).toBe('DIRECT') // 没有 ip，IP-CIDR 规则跳过
  })

  it('PORT 规则按字符串端口号匹配', () => {
    const rules: Rule[] = [
      { type: 'PORT', value: '22', action: 'REJECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    expect(route({ port: 22 }, rules)?.action).toBe('REJECT')
    expect(route({ port: 443 }, rules)?.action).toBe('DIRECT')
  })

  it('MATCH 兜底始终命中', () => {
    const rules: Rule[] = [{ type: 'MATCH', value: '', action: 'DIRECT' }]
    expect(route({ port: 1 }, rules)?.action).toBe('DIRECT')
  })

  it('按首条命中：排在前面的规则优先，即便后面还有更具体的规则', () => {
    const rules: Rule[] = [
      { type: 'DOMAIN-SUFFIX', value: 'com', action: 'REJECT' },
      { type: 'DOMAIN', value: 'example.com', action: 'DIRECT' },
      { type: 'MATCH', value: '', action: 'DIRECT' },
    ]
    // 虽然第二条精确匹配 example.com，但第一条 DOMAIN-SUFFIX "com" 先命中
    expect(route({ domain: 'example.com', port: 80 }, rules)?.action).toBe('REJECT')
  })

  it('PROXY 动作会带上 outbound 名字', () => {
    const rules: Rule[] = [{ type: 'MATCH', value: '', action: 'PROXY', outbound: 'upstream-a' }]
    const decision = route({ port: 80 }, rules)
    expect(decision?.action).toBe('PROXY')
    expect(decision?.outbound).toBe('upstream-a')
  })

  it('没有规则命中时返回 null（config.ts 的校验应当阻止这种配置出现）', () => {
    const rules: Rule[] = [{ type: 'DOMAIN', value: 'only-this.com', action: 'DIRECT' }]
    expect(route({ domain: 'other.com', port: 80 }, rules)).toBeNull()
  })
})
