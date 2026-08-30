// src/rules.ts —— 规则引擎：拿目标（域名或 IP）按序逐行试规则，第一条命中即停
// 规则行沿用 Clash 公开语义的两段/三段写法（DOMAIN-SUFFIX,google.com,PROXY / MATCH,DIRECT），解析器是自写教学版
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// 出站：DIRECT = 本机直连目标；PROXY = 第 6 章的加密两跳（远端由调用参数指定）。
// 第 10 章起还可以是配置名册里的组名/节点名（「string & {}」交集写法：保留这两条的自动补全，又不拒收别的名字）
export type Outbound = 'DIRECT' | 'PROXY' | (string & {})

export type Rule =
  | { type: 'DOMAIN'; value: string; outbound: Outbound } // 域名全等：一字不差才算
  | { type: 'DOMAIN-SUFFIX'; value: string; outbound: Outbound } // 域名后缀：本尊与其子域（按点边界，不是子串）
  | { type: 'DOMAIN-KEYWORD'; value: string; outbound: Outbound } // 域名关键字：串里含这个词就算
  | { type: 'IP-CIDR'; value: string; net: number; mask: number; outbound: Outbound } // 网段：解析一次存成整数对，匹配只做按位与
  | { type: 'MATCH'; outbound: Outbound } // 兜底：其余全部

export interface MatchOutcome {
  rule: Rule // 命中的那行（出站从它身上读）
  index: number // 命中第几行（从 0 数）——判决台打印「命中哪行」用
}

// '203.0.113.7' → 一个 32 位无符号整数（0xCB007100 + 低位）；不像 IPv4 字面量则返回 null。
// IPv4 地址在 RFC 791 里就是 32 位，点分的四段只是「每 8 位写成一格十进制」的方便记法
function parseIpv4(host: string): number | null {
  const parts = host.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null // 只认 1..3 位数字，'1e2'、'-1'、空段都不认
    const v = Number(p)
    if (v > 255) return null // 每段 8 位，封顶 255
    n = n * 256 + v // 四段从左到右就是 32 位的高位到低位：逐段左移拼进一个整数
  }
  return n >>> 0 // JS 位运算按有符号 32 位算，>>> 0 转回无符号
}

// 前缀长度 → 掩码：前 bits 位全 1、其余全 0（/24 → 0xFFFFFF00）。
// bits=0 要单列：JS 的移位量按 32 取模，1 << 32 原样回到 1，「全零掩码」反而做不出来
function maskOf(bits: number): number {
  return bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
}

// 解析规则表。坏行带着行号尽早抛错——规则表是配置，错在加载时暴露，不留给每条连接去撞。
// knownOutbounds（可选名册）：第 10 章的配置把「已声明的组名与节点名」带进来，出站从此可以是名册里的名字；
// 不报名册时行为与从前一字不差——只认 DIRECT 与 PROXY 两条线
export function parseRules(lines: string[], knownOutbounds?: readonly string[]): Rule[] {
  const out: Rule[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    const seg = line.split(',')
    const where = `第 ${i + 1} 行「${line}」`
    const outbound = (s: string): Outbound => {
      if (s !== 'DIRECT' && s !== 'PROXY' && !(knownOutbounds ?? []).includes(s))
        throw new Error(`${where}：出站只认 DIRECT 或 PROXY，看不懂「${s}」`)
      return s
    }
    if (seg[0] === 'MATCH') {
      if (seg.length !== 2) throw new Error(`${where}：MATCH 没有参数，只有「MATCH,出站」两段`)
      out.push({ type: 'MATCH', outbound: outbound(seg[1]) })
      return
    }
    if (seg.length !== 3) throw new Error(`${where}：应为「类型,参数,出站」三段，实得 ${seg.length} 段`)
    const value = seg[1]
    if (value === '') throw new Error(`${where}：参数是空的`)
    if (seg[0] === 'DOMAIN' || seg[0] === 'DOMAIN-KEYWORD') {
      out.push({ type: seg[0], value: value.toLowerCase(), outbound: outbound(seg[2]) }) // 域名大小写不敏感，入库先统一小写
    } else if (seg[0] === 'DOMAIN-SUFFIX') {
      out.push({ type: 'DOMAIN-SUFFIX', value: value.toLowerCase(), outbound: outbound(seg[2]) })
    } else if (seg[0] === 'IP-CIDR') {
      const [addr, prefix] = value.split('/')
      const net = parseIpv4(addr ?? '')
      const bits = prefix === undefined ? NaN : Number(prefix)
      if (net === null || !/^\d{1,2}$/.test(prefix ?? '') || bits > 32)
        throw new Error(`${where}：IP-CIDR 的参数应为「IPv4 地址/前缀长度(0..32)」，看不懂「${value}」`)
      out.push({ type: 'IP-CIDR', value, net, mask: maskOf(bits), outbound: outbound(seg[2]) }) // 解析一次，匹配多次
    } else {
      throw new Error(`${where}：不认识的规则类型「${seg[0]}」（教学版只做 DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / IP-CIDR / MATCH）`)
    }
  })
  return out
}

// 按序匹配，第一条命中即停——顺序就是优先级；「把 MATCH 放最前，分流整体失灵」正是这句话的反面教材。
// 目标是域名时：域名行照序试；IP-CIDR 一律跳过——试它得先有个 IP，那要先做 DNS 解析，
// 教学版不解析（域名信息留在本地），域名目标的命运只由域名行与 MATCH 决定。
// 目标是 IP 字面量时：反过来，三类域名行对它失明（一串数字没有「名字」），能试的只剩 IP-CIDR 与 MATCH
export function matchTarget(rules: Rule[], target: ProxyTarget): MatchOutcome | null {
  const host = target.host.toLowerCase()
  const asIp = parseIpv4(target.host) // 是 IP 字面量则拿到 32 位整数；是域名则是 null
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i]
    const hit =
      r.type === 'MATCH'
        ? true
        : r.type === 'IP-CIDR'
          ? asIp !== null && ((asIp & r.mask) >>> 0) === r.net // 按位与出网号：与网段起点对上就是同街（>>> 0 转回无符号再比）
          : asIp === null && // 域名行只对域名目标开门
            (r.type === 'DOMAIN'
              ? host === r.value
              : r.type === 'DOMAIN-SUFFIX'
                ? host === r.value || host.endsWith('.' + r.value) // 本尊或子域：按点边界，不是子串
                : host.includes(r.value)) // DOMAIN-KEYWORD：子串语义
    if (hit) return { rule: r, index: i }
  }
  return null // 一行都没命中（表尾没兜 MATCH 才会走到这）：怎么收场由调用方定
}
