// src/config.ts —— JSON 配置解析与严格校验：listeners / dnsStrategy / rules / outbounds
// 校验对象是从 JSON.parse 得到的 unknown 值；全程用类型谓词（type predicate）逐层收窄，
// 不用 as any/as unknown 断言绕过类型检查——每次窄化都来自一次可复查的运行时判断。

import type { DnsStrategy, ListenerConfig, OutboundConfig, ProxyConfig, Rule, RuleAction, RuleType } from './types.js'

export type ConfigParseOutcome = { readonly ok: true; readonly config: ProxyConfig } | { readonly ok: false; readonly errors: readonly string[] }

const RULE_TYPE_NAMES: readonly string[] = ['DOMAIN', 'DOMAIN-SUFFIX', 'IP-CIDR', 'PORT', 'MATCH']
const RULE_ACTION_NAMES: readonly string[] = ['DIRECT', 'REJECT', 'PROXY']
const DNS_STRATEGY_NAMES: readonly string[] = ['preserve-domain', 'resolve-first']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidPort(value: unknown): value is number {
  // 端口 0 是合法值——交给内核挑一个空闲端口（listeners 用 port:0 做测试时正是这个用法）。
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65535
}

function isRuleType(value: unknown): value is RuleType {
  return typeof value === 'string' && RULE_TYPE_NAMES.includes(value)
}

function isRuleAction(value: unknown): value is RuleAction {
  return typeof value === 'string' && RULE_ACTION_NAMES.includes(value)
}

function isDnsStrategy(value: unknown): value is DnsStrategy {
  return typeof value === 'string' && DNS_STRATEGY_NAMES.includes(value)
}

function parseListener(value: unknown, name: string, errors: string[]): ListenerConfig | null {
  if (!isRecord(value)) {
    errors.push(`listeners.${name} 必须是对象`)
    return null
  }
  const host = value['host']
  if (typeof host !== 'string' || host.length === 0) {
    errors.push(`listeners.${name}.host 必须是非空字符串`)
    return null
  }
  const port = value['port']
  if (!isValidPort(port)) {
    errors.push(`listeners.${name}.port 必须是 0-65535 的整数，实际为 ${JSON.stringify(port)}`)
    return null
  }
  return { host, port }
}

function parseRule(value: unknown, index: number, errors: string[]): Rule | null {
  if (!isRecord(value)) {
    errors.push(`rules[${index}] 必须是对象`)
    return null
  }
  const type = value['type']
  if (!isRuleType(type)) {
    errors.push(`rules[${index}].type 未知：${JSON.stringify(type)}（允许：${RULE_TYPE_NAMES.join(', ')}）`)
    return null
  }
  const ruleValue = value['value']
  if (typeof ruleValue !== 'string') {
    errors.push(`rules[${index}].value 必须是字符串`)
    return null
  }
  const action = value['action']
  if (!isRuleAction(action)) {
    errors.push(`rules[${index}].action 未知：${JSON.stringify(action)}（允许：${RULE_ACTION_NAMES.join(', ')}）`)
    return null
  }
  const outbound = value['outbound']
  if (outbound !== undefined && typeof outbound !== 'string') {
    errors.push(`rules[${index}].outbound 必须是字符串`)
    return null
  }
  if (action === 'PROXY') {
    if (outbound === undefined) {
      errors.push(`rules[${index}].action 为 PROXY 时必须提供字符串类型的 outbound`)
      return null
    }
    return { type, value: ruleValue, action, outbound }
  }
  return { type, value: ruleValue, action }
}

function parseOutbound(value: unknown, name: string, errors: string[]): OutboundConfig | null {
  if (!isRecord(value)) {
    errors.push(`outbounds.${name} 必须是对象`)
    return null
  }
  const type = value['type']
  if (type === 'DIRECT') return { type: 'DIRECT' }
  if (type === 'REJECT') return { type: 'REJECT' }
  if (type === 'SOCKS5') {
    const host = value['host']
    if (typeof host !== 'string' || host.length === 0) {
      errors.push(`outbounds.${name}.host 必须是非空字符串`)
      return null
    }
    const port = value['port']
    if (!isValidPort(port)) {
      errors.push(`outbounds.${name}.port 必须是 0-65535 的整数，实际为 ${JSON.stringify(port)}`)
      return null
    }
    return { type: 'SOCKS5', host, port }
  }
  errors.push(`outbounds.${name}.type 未知：${JSON.stringify(type)}（允许：DIRECT, REJECT, SOCKS5）`)
  return null
}

/** 从 JSON.parse 得到的任意值解析并严格校验出 ProxyConfig；失败时把收集到的全部错误一并返回。*/
export function parseProxyConfig(raw: unknown): ConfigParseOutcome {
  const errors: string[] = []
  if (!isRecord(raw)) {
    return { ok: false, errors: ['配置根节点必须是 JSON 对象'] }
  }

  const listenersRaw = raw['listeners']
  let http: ListenerConfig | null = null
  let socks: ListenerConfig | null = null
  if (!isRecord(listenersRaw)) {
    errors.push('listeners 必须是对象，包含 http 与 socks 两个监听地址')
  } else {
    http = parseListener(listenersRaw['http'], 'http', errors)
    socks = parseListener(listenersRaw['socks'], 'socks', errors)
  }

  const dnsStrategyRaw = raw['dnsStrategy']
  const dnsStrategy: DnsStrategy | null = isDnsStrategy(dnsStrategyRaw) ? dnsStrategyRaw : null
  if (dnsStrategy === null) {
    errors.push(`dnsStrategy 未知：${JSON.stringify(dnsStrategyRaw)}（允许：${DNS_STRATEGY_NAMES.join(', ')}）`)
  }

  const rulesRaw = raw['rules']
  const rules: Rule[] = []
  if (!Array.isArray(rulesRaw) || rulesRaw.length === 0) {
    errors.push('rules 必须是非空数组')
  } else {
    for (let i = 0; i < rulesRaw.length; i++) {
      const rule = parseRule(rulesRaw[i], i, errors)
      if (rule) rules.push(rule)
    }
    const last = rulesRaw[rulesRaw.length - 1]
    const lastIsMatch = isRecord(last) && last['type'] === 'MATCH'
    if (!lastIsMatch) {
      errors.push('rules 必须以一条 MATCH 规则兜底（放在数组末尾），否则未命中任何规则时无法决策')
    }
  }

  const outboundsRaw = raw['outbounds']
  const outbounds: Record<string, OutboundConfig> = {}
  if (!isRecord(outboundsRaw)) {
    errors.push('outbounds 必须是对象')
  } else {
    for (const name of Object.keys(outboundsRaw)) {
      const outbound = parseOutbound(outboundsRaw[name], name, errors)
      if (outbound) outbounds[name] = outbound
    }
    if (!('DIRECT' in outbounds)) errors.push('outbounds 必须包含 DIRECT 出站（{"type":"DIRECT"}）')
    if (!('REJECT' in outbounds)) errors.push('outbounds 必须包含 REJECT 出站（{"type":"REJECT"}）')
  }

  // 交叉校验：PROXY 规则引用的 outbound 必须存在且类型为 SOCKS5
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    if (rule === undefined || rule.action !== 'PROXY') continue
    const target = rule.outbound === undefined ? undefined : outbounds[rule.outbound]
    if (target === undefined) {
      errors.push(`rules[${i}] 引用了未定义的 outbound：${JSON.stringify(rule.outbound)}`)
    } else if (target.type !== 'SOCKS5') {
      errors.push(`rules[${i}] 的 outbound "${rule.outbound}" 必须是 SOCKS5 类型，实际为 ${target.type}`)
    }
  }

  if (errors.length > 0 || http === null || socks === null || dnsStrategy === null) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    config: {
      listeners: { http, socks },
      dnsStrategy,
      rules,
      outbounds,
    },
  }
}
