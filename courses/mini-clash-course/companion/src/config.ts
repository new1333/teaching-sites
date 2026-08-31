// src/config.ts —— 声明式配置与代理组：一份 JSON 文本驱动端口、节点、规则与组的全部行为
// 与真实 Clash 的 YAML 同构语义（proxies / groups / rules 三段用同名 JSON 段表达），解析器不引 yaml 依赖
import { performance } from 'node:perf_hooks'
import type { Duplex } from 'node:stream'
import { matchTarget, parseRules, type Rule } from './rules'
import { connectViaRelay } from './relay'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// —— 配置的形状：菜单上的四段 ——

export interface ProxyNode {
  name: string // 节点名：规则行与组都拿它当出站名，全配置唯一
  host: string // 节点（中继）的门牌
  port: number // 节点（中继）的房间号
  password: string // 这条线的门锁钥匙（第 6 章的 password 原样搬进数据）
}

export interface SelectGroupDef {
  name: string
  type: 'select' // 手动选择：默认出名单第一个，随时可切
  proxies: string[] // 组员名单（教学版只认节点名，组套组不做）
}

export interface UrlTestGroupDef {
  name: string
  type: 'url-test' // 自动测速：对每台组员发探测，谁延迟低谁上
  proxies: string[]
  url: string // 测速 URL：探测经由节点对它发 HTTP 请求、掐表到应答首字节
  timeoutMs?: number // 单次探测的超时（缺省 2000ms）——超时算没成绩
}

export type GroupDef = SelectGroupDef | UrlTestGroupDef

export interface Config {
  inbound: { port: number } // SOCKS5 入口监听哪个端口（0 = 请系统随手分一个空闲端口）
  proxies: ProxyNode[] // 节点名册
  groups: GroupDef[] // 组：把若干节点打包成一个可切换/可测速的虚拟出口
  rules: Rule[] // 规则表（已按名册解析）：出站可写 DIRECT、组名或节点名
}

// —— 加载与校验：错误带路径报出，错在加载时，不留给每条连接去撞 ——

// 校验失败即抛：where 是 JSON 路径（$.proxies[1].port 这类），消息里能直接翻到出错的那一格
function fail(where: string, msg: string): never {
  throw new Error(`${where}：${msg}`)
}

const RESERVED = new Set(['DIRECT', 'PROXY']) // 保留出站名：不能拿来当节点名/组名（DIRECT 是语义不是名字）

export function loadConfig(text: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    fail('$', `看不懂这份 JSON——${(e as Error).message}`) // V8 的报错自带出错位置，原样带出
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail('$', '应为对象，装 inbound / proxies / groups / rules 四段')
  const o = raw as Record<string, unknown>

  // inbound 段：端口由配置接管
  const inboundRaw = o.inbound
  if (typeof inboundRaw !== 'object' || inboundRaw === null) fail('$.inbound', '应为对象 { port }')
  const port = (inboundRaw as Record<string, unknown>).port
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535)
    fail('$.inbound.port', '应为 0..65535 的整数（0 = 请系统随手分一个空闲端口）')

  // proxies 段：节点名册
  if (!Array.isArray(o.proxies)) fail('$.proxies', '应为节点数组')
  const proxies: ProxyNode[] = []
  const nodeNames = new Set<string>() // 节点名册：组员只认这里面的名字
  const allNames = new Set<string>() // 全配置名字总册（节点名 + 组名）：出站名必须一伙里唯一
  o.proxies.forEach((p, i) => {
    const where = `$.proxies[${i}]`
    if (typeof p !== 'object' || p === null) fail(where, '应为对象 { name, host, port, password }')
    const r = p as Record<string, unknown>
    const name = r.name
    if (typeof name !== 'string' || name === '') fail(`${where}.name`, '应为非空字符串')
    if (RESERVED.has(name)) fail(`${where}.name`, `「${name}」是保留出站名，不能拿来当节点名`)
    if (allNames.has(name)) fail(`${where}.name`, `「${name}」与前面的名字撞了——配置里的名字就是出站名，一伙里必须唯一`)
    const host = r.host
    if (typeof host !== 'string' || host === '') fail(`${where}.host`, '应为非空字符串')
    const nodePort = r.port
    if (typeof nodePort !== 'number' || !Number.isInteger(nodePort) || nodePort < 1 || nodePort > 65535)
      fail(`${where}.port`, '应为 1..65535 的整数')
    const password = r.password
    if (typeof password !== 'string' || password === '') fail(`${where}.password`, '应为非空字符串（节点的门锁钥匙，省不得）')
    proxies.push({ name, host, port: nodePort, password })
    nodeNames.add(name)
    allNames.add(name)
  })

  // groups 段：组名也是出站名，同样入总册
  if (!Array.isArray(o.groups)) fail('$.groups', '应为组数组')
  const groups: GroupDef[] = []
  o.groups.forEach((g, i) => {
    const where = `$.groups[${i}]`
    if (typeof g !== 'object' || g === null) fail(where, '应为对象 { name, type, proxies }')
    const r = g as Record<string, unknown>
    const name = r.name
    if (typeof name !== 'string' || name === '') fail(`${where}.name`, '应为非空字符串')
    if (RESERVED.has(name)) fail(`${where}.name`, `「${name}」是保留出站名，不能拿来当组名`)
    if (allNames.has(name)) fail(`${where}.name`, `「${name}」与前面的名字撞了——配置里的名字就是出站名，一伙里必须唯一`)
    if (!Array.isArray(r.proxies) || r.proxies.length === 0) fail(`${where}.proxies`, '应为非空的节点名数组')
    const members: string[] = []
    r.proxies.forEach((m, j) => {
      if (typeof m !== 'string') fail(`${where}.proxies[${j}]`, '应为节点名（字符串）')
      if (RESERVED.has(m)) fail(`${where}.proxies[${j}]`, `「${m}」不能当组员——教学版组员只认节点名`)
      if (!nodeNames.has(m)) fail(`${where}.proxies[${j}]`, `「${m}」不在节点名册里（教学版组员只能是节点，组套组不做）`)
      members.push(m)
    })
    if (r.type === 'select') {
      groups.push({ name, type: 'select', proxies: members })
    } else if (r.type === 'url-test') {
      const url = r.url
      if (typeof url !== 'string' || url === '') fail(`${where}.url`, 'url-test 组必须指明测速 URL（探测经由节点对它发请求）')
      const u = parseProbeUrl(url)
      if (u === null) fail(`${where}.url`, `应为 http:// 开头、带主机的合法地址，看不懂「${url}」`)
      const timeoutMs = r.timeoutMs
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs < 1))
        fail(`${where}.timeoutMs`, '应为正整数毫秒')
      groups.push({ name, type: 'url-test', proxies: members, url, ...(timeoutMs === undefined ? {} : { timeoutMs }) })
    } else {
      fail(`${where}.type`, `只认 select 或 url-test，看不懂「${String(r.type)}」`)
    }
    allNames.add(name)
  })

  // rules 段：规则行解析交给第 7 章的解析器，名册（组名 + 节点名）一并带进去
  if (!Array.isArray(o.rules)) fail('$.rules', '应为规则行数组（字符串）')
  const lines: string[] = []
  o.rules.forEach((l, i) => {
    if (typeof l !== 'string') fail(`$.rules[${i}]`, '应为字符串规则行')
    lines.push(l)
  })
  try {
    const rules = parseRules(lines, [...allNames]) // 名册进判决：组名与节点名从此是合法出站
    // 「PROXY」是单远端时代的旧出站：解析器认它（独立用 parseRules 的旧调用方还靠它），
    // 但配置世界里远端不止一台——直呼组名或节点名，别让「PROXY」指谁靠猜
    lines.forEach((l, i) => {
      const seg = l.trim().split(',')
      const outbound = seg[seg[0] === 'MATCH' ? 1 : 2]
      if (outbound === 'PROXY') fail(`$.rules[${i}]`, '「PROXY」是世上只有一个远端时的旧出站——配置里请直呼组名或节点名')
    })
    return { inbound: { port }, proxies, groups, rules }
  } catch (e) {
    fail('$.rules', (e as Error).message) // 坏行带行号（在 rules 数组内数），前面钉上配置路径
  }
}

// 测速 URL 的最小校验：只支持 http://（教学版不做 TLS），拆出 host/port 供探测拨号
function parseProbeUrl(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' || u.hostname === '') return null
    return { host: u.hostname, port: u.port === '' ? 80 : Number(u.port) }
  } catch {
    return null
  }
}

// —— 延迟探测：经由节点向测速 URL 发一个 HTTP 请求，掐表到「应答首字节回来」为止 ——

// 延迟算的是整段往返：拨节点 + CONNECT 代连 + 测速目标应答首字节——「走这条线要多久」的问题本身。
// 与 Clash 公开文档同款语义（对配置的测速 URL 经由节点发请求、取应答往返，面板里的延迟数就是它）；
// 教学简化：不按 interval 周期测、不设 tolerance 容差、不做 lazy（差异登记附录）。
// 返回 null = 超时或失败：没成绩就不参赛
async function probeNode(node: ProxyNode, url: string, timeoutMs: number): Promise<number | null> {
  const u = parseProbeUrl(url)
  if (u === null) return null // loadConfig 已拦过坏 URL，这里只是兜底
  const started = performance.now() // 从「开始拨节点」起表：隧道建立也算这条线的延迟
  return new Promise((resolve) => {
    let settled = false
    let pipe: Duplex | null = null
    const done = (v: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      pipe?.destroy()
      done(null) // 超时：这条题答不上来，按失败记
    }, timeoutMs)
    connectViaRelay({ host: node.host, port: node.port }, { host: u.host, port: u.port }, node.password).then(
      (t) => {
        pipe = t
        t.once('data', () => done(Math.round(performance.now() - started))) // 首字节到达：停表
        t.once('close', () => done(null)) // 没等到应答就收线：失败
        t.once('error', () => done(null))
        t.write(`HEAD /generate_204 HTTP/1.1\r\nHost: ${u.host}\r\nConnection: close\r\n\r\n`) // HEAD：只要应答头，不下载正文
      },
      () => done(null), // 拨不通或代连失败
    )
  })
}

// —— 路由器：判决（规则引擎）→ 出站（组策略）→ 建线（直连或节点的加密两跳） ——

export interface RouteVerdict {
  outbound: string // 判决出的出站名：DIRECT、组名或节点名
  node: ProxyNode | null // 这个出站此刻会用的节点；DIRECT（与落空）为 null
  rule: Rule | null // 命中的规则行；表尾没兜 MATCH 落空时为 null
  index: number // 命中第几行（从 0 数）；落空为 -1
}

export interface ProbeScore {
  name: string
  delayMs: number | null // null = 超时或失败
}

export interface GroupDecision {
  group: string
  type: 'select' | 'url-test'
  chosen: string // 此刻会出的节点名
  scores?: ProbeScore[] // url-test 的成绩单（select 没有这张单）
}

export interface Router {
  route(target: ProxyTarget): RouteVerdict // 只判决不建线：demo 打印组决策用
  connect(target: ProxyTarget): Promise<ProxyTarget | Duplex> // 直接可作 onConnect 钩子：判决、选节点、建线一气呵成
  select(group: string, choice: string): void // select 组手动换人：规则行不动
  decisions(): GroupDecision[] // 各组此刻的决策快照
}

export async function createRouter(config: Config): Promise<Router> {
  const nodes = new Map(config.proxies.map((p) => [p.name, p] as const))
  const groupByName = new Map(config.groups.map((g) => [g.name, g] as const))
  const current = new Map<string, string>() // 每组「此刻出谁」：select 是当前选择，url-test 是当前赢家
  const scoresByGroup = new Map<string, ProbeScore[]>()

  for (const g of config.groups) {
    if (g.type !== 'url-test') {
      current.set(g.name, g.proxies[0]) // select 默认出名单第一个
      continue
    }
    // url-test：建路由器时现场测一轮——经由每台组员向测速 URL 发请求，谁的首字节先回来谁快
    const scores: ProbeScore[] = []
    for (const name of g.proxies) {
      const delayMs = await probeNode(nodes.get(name)!, g.url, g.timeoutMs ?? 2000)
      scores.push({ name, delayMs })
    }
    scoresByGroup.set(g.name, scores)
    const alive = scores.filter((s) => s.delayMs !== null)
    // 并列与全灭都按先来后到：名单第一个——测不出差距时，位置就是规则
    const best = alive.length === 0 ? g.proxies[0] : alive.reduce((a, b) => ((a.delayMs as number) <= (b.delayMs as number) ? a : b)).name
    current.set(g.name, best)
  }

  // 出站名 → 此刻的节点：DIRECT 不是名字是语义（null）；组名问 current；节点名直呼直应
  const nodeOf = (outbound: string): ProxyNode | null => {
    if (outbound === 'DIRECT') return null
    const chosen = current.get(outbound)
    return chosen === undefined ? nodes.get(outbound)! : nodes.get(chosen)!
  }

  const route = (target: ProxyTarget): RouteVerdict => {
    const hit = matchTarget(config.rules, target)
    const outbound = hit === null ? 'DIRECT' : hit.rule.outbound // 落空按 DIRECT 收场：引擎只管判决，兜法由路由器定
    return { outbound, node: nodeOf(outbound), rule: hit === null ? null : hit.rule, index: hit === null ? -1 : hit.index }
  }

  const connect = async (target: ProxyTarget): Promise<ProxyTarget | Duplex> => {
    const { node } = route(target)
    // DIRECT / 落空：把原目标交回，入口照直连（与第 7 章接线同款）；否则经选中的节点走加密两跳
    return node === null ? target : connectViaRelay({ host: node.host, port: node.port }, target, node.password)
  }

  const select = (group: string, choice: string): void => {
    const g = groupByName.get(group)
    if (g === undefined) throw new Error(`没有叫「${group}」的组`)
    if (g.type !== 'select') throw new Error(`select 只管 select 组：「${group}」是 url-test，谁快谁上，不收手动指定`)
    if (!g.proxies.includes(choice)) throw new Error(`「${choice}」不在组「${group}」的名单里`)
    current.set(group, choice)
  }

  const decisions = (): GroupDecision[] =>
    config.groups.map((g) => {
      const chosen = current.get(g.name)!
      return g.type === 'select' ? { group: g.name, type: 'select', chosen } : { group: g.name, type: 'url-test', chosen, scores: scoresByGroup.get(g.name)! }
    })

  return { route, connect, select, decisions }
}
