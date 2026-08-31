// src/types.ts —— 共享类型：地址、规则、DNS 策略、出站、运行时配置
// 这些类型贯穿全部模块；先看类型，再看实现，是理解这个迷你代理最快的路径。

/** 代理需要转发到的目标地址。domain 未解析；ipv4/ipv6 已经是字面量地址。 */
export type TargetAddress =
  | { readonly kind: 'domain'; readonly host: string; readonly port: number }
  | { readonly kind: 'ipv4'; readonly host: string; readonly port: number }
  | { readonly kind: 'ipv6'; readonly host: string; readonly port: number }

/** 规则可命中的动作：直连、拒绝、经由某个 outbound 代理。 */
export type RuleAction = 'DIRECT' | 'REJECT' | 'PROXY'

export type RuleType = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'IP-CIDR' | 'PORT' | 'MATCH'

/** 一条路由规则。value 对 MATCH 无意义（留空字符串）；outbound 仅 PROXY 需要。 */
export interface Rule {
  readonly type: RuleType
  readonly value: string
  readonly action: RuleAction
  /** action === 'PROXY' 时必须给出 outbounds 中的名字 */
  readonly outbound?: string
}

/** 参与规则匹配的上下文：解析前只有 domain，解析后 ip 才可能存在。 */
export interface RouteContext {
  readonly domain?: string
  readonly ip?: string
  readonly port: number
}

export interface RouteDecision {
  readonly action: RuleAction
  readonly outbound?: string
  /** 命中的规则，便于日志/测试排障 */
  readonly rule: Rule
}

/** preserve-domain：优先按域名规则判断，DIRECT 才在拨号前解析。
 *  resolve-first：先解析域名成 IP，让 IP-CIDR 一类规则也能参与判断。 */
export type DnsStrategy = 'preserve-domain' | 'resolve-first'

/** 域名解析器；测试里注入固定实现，永不触达公网 DNS。*/
export type Resolver = (host: string) => Promise<string>

export interface DirectOutboundConfig {
  readonly type: 'DIRECT'
}

export interface RejectOutboundConfig {
  readonly type: 'REJECT'
}

export interface Socks5OutboundConfig {
  readonly type: 'SOCKS5'
  readonly host: string
  readonly port: number
}

export type OutboundConfig = DirectOutboundConfig | RejectOutboundConfig | Socks5OutboundConfig

export interface ListenerConfig {
  readonly host: string
  readonly port: number
}

export interface ProxyConfig {
  readonly listeners: {
    readonly http: ListenerConfig
    readonly socks: ListenerConfig
  }
  readonly dnsStrategy: DnsStrategy
  readonly rules: readonly Rule[]
  readonly outbounds: Readonly<Record<string, OutboundConfig>>
}

/** 拨号成功后拿到的原始 TCP socket，由 relay 负责后续双向转发。 */
export interface DialResult {
  readonly socket: import('node:net').Socket
}

export type DialOutcome = { readonly ok: true; readonly result: DialResult } | { readonly ok: false; readonly reason: string }

/** 出站适配器统一接口：不管 DIRECT/REJECT/SOCKS5，上层只认这一个函数签名。 */
export type Dialer = (target: TargetAddress) => Promise<DialOutcome>

export interface ProxyEvent {
  readonly type:
    | 'listening'
    | 'connection'
    | 'route'
    | 'dial-error'
    | 'relay-close'
    | 'server-error'
    | 'closed'
  readonly message: string
  readonly detail?: Readonly<Record<string, unknown>>
}

export type EventSink = (event: ProxyEvent) => void
