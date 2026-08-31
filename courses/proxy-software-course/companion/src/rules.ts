// src/rules.ts —— 规则引擎：按首条命中，DOMAIN / DOMAIN-SUFFIX / IP-CIDR / PORT / MATCH
// DOMAIN-SUFFIX 尊重标签边界：pattern "example.com" 匹配 "www.example.com"，
// 不匹配 "evil-example.com"（后者只是字符串意义上的后缀，标签边界不同）。

import net from 'node:net'
import type { Rule, RouteContext, RouteDecision } from './types.js'

function domainEquals(domain: string, pattern: string): boolean {
  return domain.toLowerCase() === pattern.toLowerCase()
}

/** 后缀匹配必须落在 label 边界上：要么完全相等，要么前面紧跟一个 '.'。*/
function domainSuffixMatches(domain: string, suffix: string): boolean {
  const d = domain.toLowerCase()
  const s = suffix.toLowerCase()
  if (d === s) return true
  return d.endsWith(`.${s}`)
}

function ipv4ToInt(ip: string): number | null {
  if (net.isIP(ip) !== 4) return null
  const parts = ip.split('.').map((p) => Number(p))
  if (parts.length !== 4) return null
  const [a, b, c, d] = parts
  if (a === undefined || b === undefined || c === undefined || d === undefined) return null
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function parseCidr(cidr: string): { base: number; maskBits: number } | null {
  const slashIdx = cidr.indexOf('/')
  if (slashIdx < 0) return null
  const addr = cidr.slice(0, slashIdx)
  const bitsRaw = cidr.slice(slashIdx + 1)
  if (!/^\d+$/.test(bitsRaw)) return null
  const maskBits = Number(bitsRaw)
  if (maskBits < 0 || maskBits > 32) return null
  const base = ipv4ToInt(addr)
  if (base === null) return null
  return { base, maskBits }
}

/** 仅支持 IPv4 CIDR，题目要求已声明「IPv4 足够」。*/
export function ipInCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr)
  if (!parsed) return false
  const ipInt = ipv4ToInt(ip)
  if (ipInt === null) return false
  if (parsed.maskBits === 0) return true
  const mask = (0xffffffff << (32 - parsed.maskBits)) >>> 0
  return (ipInt & mask) >>> 0 === (parsed.base & mask) >>> 0
}

function matchRule(rule: Rule, ctx: RouteContext): boolean {
  switch (rule.type) {
    case 'DOMAIN':
      return ctx.domain !== undefined && domainEquals(ctx.domain, rule.value)
    case 'DOMAIN-SUFFIX':
      return ctx.domain !== undefined && domainSuffixMatches(ctx.domain, rule.value)
    case 'IP-CIDR':
      return ctx.ip !== undefined && ipInCidr(ctx.ip, rule.value)
    case 'PORT':
      return String(ctx.port) === rule.value
    case 'MATCH':
      return true
  }
}

/** 按首条命中返回决策；规则列表没有兜底 MATCH 时可能返回 null（config.ts 校验会挡住这种配置）。*/
export function route(ctx: RouteContext, rules: readonly Rule[]): RouteDecision | null {
  for (const rule of rules) {
    if (matchRule(rule, ctx)) {
      const outbound = rule.outbound
      return outbound === undefined ? { action: rule.action, rule } : { action: rule.action, outbound, rule }
    }
  }
  return null
}
