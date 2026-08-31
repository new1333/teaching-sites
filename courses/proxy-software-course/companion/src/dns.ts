// src/dns.ts —— DNS 策略：preserve-domain（DIRECT 才解析）/ resolve-first（先解析再判断）
// resolver 由调用方注入（config/测试都提供固定实现），本模块自身从不发起真实 DNS 查询。

import { classifyHost } from './authority.js'
import { errorMessage } from './errors.js'
import { route } from './rules.js'
import type { DnsStrategy, Resolver, Rule, RouteContext, RouteDecision, TargetAddress } from './types.js'

export type RoutePlanOutcome =
  | { readonly ok: true; readonly decision: RouteDecision; readonly dialTarget: TargetAddress }
  | { readonly ok: false; readonly reason: string }

function toResolvedTarget(ip: string, port: number): TargetAddress {
  return { kind: classifyHost(ip), host: ip, port }
}

async function resolveOrFail(resolver: Resolver, host: string): Promise<{ ok: true; ip: string } | { ok: false; reason: string }> {
  try {
    const ip = await resolver(host)
    return { ok: true, ip }
  } catch (err) {
    return { ok: false, reason: `dns resolve failed for ${host}: ${errorMessage(err)}` }
  }
}

/**
 * 按 dnsStrategy 决定何时解析、用什么上下文匹配规则，产出路由决策 + 最终应当拨号的地址。
 *
 * - preserve-domain：先用域名（若有）匹配规则；只有命中 DIRECT 才在此刻解析成 IP 再拨号，
 *   REJECT 不需要拨号，PROXY 把域名原样交给上游（比如 SOCKS5 CONNECT 域名帧）。
 * - resolve-first：目标是域名就先解析成 IP，再用「域名 + IP」的完整上下文匹配规则
 *   （IP-CIDR 一类规则才有 IP 可用），后续统一按解析出的 IP 拨号。
 */
export async function planRoute(
  target: TargetAddress,
  strategy: DnsStrategy,
  rules: readonly Rule[],
  resolver: Resolver,
): Promise<RoutePlanOutcome> {
  if (strategy === 'resolve-first') {
    let ip: string
    let domain: string | undefined
    if (target.kind === 'domain') {
      const resolved = await resolveOrFail(resolver, target.host)
      if (!resolved.ok) return { ok: false, reason: resolved.reason }
      ip = resolved.ip
      domain = target.host
    } else {
      ip = target.host
    }
    const ctx: RouteContext = domain === undefined ? { ip, port: target.port } : { domain, ip, port: target.port }
    const decision = route(ctx, rules)
    if (!decision) return { ok: false, reason: 'no rule matched' }
    return { ok: true, decision, dialTarget: toResolvedTarget(ip, target.port) }
  }

  // preserve-domain
  const ctx: RouteContext = target.kind === 'domain' ? { domain: target.host, port: target.port } : { ip: target.host, port: target.port }
  const decision = route(ctx, rules)
  if (!decision) return { ok: false, reason: 'no rule matched' }

  if (decision.action === 'DIRECT' && target.kind === 'domain') {
    const resolved = await resolveOrFail(resolver, target.host)
    if (!resolved.ok) return { ok: false, reason: resolved.reason }
    return { ok: true, decision, dialTarget: toResolvedTarget(resolved.ip, target.port) }
  }

  return { ok: true, decision, dialTarget: target }
}
