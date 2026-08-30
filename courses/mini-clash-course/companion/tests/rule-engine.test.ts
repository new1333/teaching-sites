// tests/rule-engine.test.ts —— 第 7 章：规则引擎（解析 + 按序首中即停 + 入口按判决分流）
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
// 误区证伪的靶子（先猜后跑）：「规则表里找得到就命中」——两张表内容相同、只换两行的顺序，判决相反。
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { matchTarget, parseRules, type Rule } from '../src/rules'
import { connectViaRelay, startRelayServer, type RelayServerHandle } from '../src/relay'
import { startSocks5Server, type Socks5ServerHandle } from '../src/socks5'

// —— 脚手架（与第 4、6 章同款） ——

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

// host 缺省回环；传 '::' 时拿双栈（IPv4 与 IPv6 的来客都接）——给「域名目标走直连」的用例当靶子
function listen(server: net.Server, host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    cleanups.push(() => server.close())
    server.listen(0, host, () => resolve((server.address() as net.AddressInfo).port))
  })
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
}

// 读满 n 个字节为止；超时兜底防挂死
function readExact(socket: net.Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`等待 ${n} 个字节超时`)), 3000)
    let buf = Buffer.alloc(0)
    const onData = (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.length >= n) done(null, buf)
    }
    const onErr = (e: Error) => done(e)
    const done = (e: Error | null, out?: Buffer) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
      if (e) reject(e)
      else resolve(out ?? Buffer.alloc(0))
    }
    socket.on('data', onData)
    socket.on('error', onErr)
  })
}

// 读到出现 needle 为止；超时兜底防挂死
function readUntil(socket: net.Socket, needle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`等待 ${JSON.stringify(needle)} 超时`)), 3000)
    let buf = Buffer.alloc(0)
    const onData = (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.includes(needle)) done(null, buf)
    }
    const onErr = (e: Error) => done(e)
    const done = (e: Error | null, out?: Buffer) => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
      if (e) reject(e)
      else resolve(out ?? Buffer.alloc(0))
    }
    socket.on('data', onData)
    socket.on('error', onErr)
  })
}

// —— 目标站桩与计数探针 ——

// 行协议目标：攒到一行（\n 收尾）才回大写整行
function startLineTarget(host = '127.0.0.1'): Promise<{ port: number; connections: () => number }> {
  let count = 0
  const server = net.createServer((s) => {
    count += 1
    let buf = Buffer.alloc(0)
    s.on('data', (b) => {
      buf = Buffer.concat([buf, b])
      const i = buf.indexOf('\n')
      if (i < 0) return
      s.write(buf.subarray(0, i).toString('latin1').toUpperCase() + '\n')
      buf = buf.subarray(i + 1)
    })
  })
  return listen(server, host).then((port) => ({ port, connections: () => count }))
}

// 计数探针：透明转发，只数「入口 → 远端」方向来了几条连接——判决走没走第二跳，看它就知道
function startTap(downPort: number): Promise<{ port: number; connections: () => number }> {
  let count = 0
  const tap = net.createServer((front) => {
    count += 1
    const back = net.connect(downPort, '127.0.0.1')
    front.on('data', (b: Buffer) => back.write(b))
    back.on('data', (b: Buffer) => front.write(b))
    const hangup = () => {
      front.destroy()
      back.destroy()
    }
    front.on('close', hangup)
    back.on('close', hangup)
    front.on('error', hangup)
    back.on('error', hangup)
  })
  return listen(tap).then((port) => ({ port, connections: () => count }))
}

function closeRelay(r: RelayServerHandle): void {
  cleanups.push(() => void r.close())
}

function closeSocks(s: Socks5ServerHandle): void {
  cleanups.push(() => void s.close())
}

// —— SOCKS5 报文拼装（集成用例里测试当浏览器） ——

const VER = 0x05

function greeting(): Buffer {
  return Buffer.from([VER, 0x01, 0x00]) // 版本 5，会 1 种方法：无认证
}

function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([VER, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

function connectDomain(host: string, port: number): Buffer {
  const name = Buffer.from(host, 'latin1')
  return Buffer.from([VER, 0x01, 0x00, 0x03, name.length, ...name, port >> 8, port & 0xff])
}

// —— 本章的固定道具 ——

const PASSWORD = 'course-password'

// 入口接线：onConnect 钩子先问规则引擎，PROXY 走加密两跳，其余（DIRECT 与落空）照原目标直连
function routeByRules(rules: Rule[], relayPort: number, password = PASSWORD) {
  return (t: { host: string; port: number }) => {
    const hit = matchTarget(rules, t)
    return hit !== null && hit.rule.outbound === 'PROXY'
      ? connectViaRelay({ host: '127.0.0.1', port: relayPort }, t, password)
      : t
  }
}

// —— 单元：解析 ——

describe('parseRules：五行各就各位', () => {
  it('五种形态解析成带类型的规则对象，IP-CIDR 预解析成整数对', () => {
    const rules = parseRules([
      'DOMAIN,example.com,DIRECT',
      'DOMAIN-SUFFIX,google.com,PROXY',
      'DOMAIN-KEYWORD,video,DIRECT',
      'IP-CIDR,203.0.113.0/24,DIRECT',
      'MATCH,PROXY',
    ])
    expect(rules).toHaveLength(5)
    expect(rules[0]).toEqual({ type: 'DOMAIN', value: 'example.com', outbound: 'DIRECT' })
    expect(rules[1]).toEqual({ type: 'DOMAIN-SUFFIX', value: 'google.com', outbound: 'PROXY' })
    expect(rules[2]).toEqual({ type: 'DOMAIN-KEYWORD', value: 'video', outbound: 'DIRECT' })
    // 203.0.113.0 = 0xCB007100 = 3405803776；/24 掩码 = 0xFFFFFF00 = 4294967040——解析一次，匹配只做按位与
    expect(rules[3]).toEqual({ type: 'IP-CIDR', value: '203.0.113.0/24', net: 3405803776, mask: 4294967040, outbound: 'DIRECT' })
    expect(rules[4]).toEqual({ type: 'MATCH', outbound: 'PROXY' })
  })

  it('坏行带着行号尽早抛错：不认识的类型、段数不对、前缀越界、出站不认识', () => {
    expect(() => parseRules(['GEOIP,CN,DIRECT'])).toThrow(/GEOIP/) // 教学版不做的类型（差异清单见附录）
    expect(() => parseRules(['DOMAIN-SUFFIX,google.com'])).toThrow(/第 1 行/) // 缺出站段
    expect(() => parseRules(['DOMAIN,example.com,DIRECT', 'MATCH,DIRECT,EXTRA'])).toThrow(/第 2 行/) // MATCH 只有「MATCH,出站」两段
    expect(() => parseRules(['IP-CIDR,203.0.113.0/33,DIRECT'])).toThrow(/33/) // 前缀只到 32
    expect(() => parseRules(['DOMAIN,example.com,MY-NODE'])).toThrow(/MY-NODE/) // 出站此刻只有 DIRECT/PROXY 两条线
  })
})

// —— 单元：域名三种行 ——

describe('域名规则：全等、按点边界的后缀、按子串的关键字', () => {
  it('DOMAIN 全等：本尊命中，子域不认', () => {
    const rules = parseRules(['DOMAIN,example.com,PROXY', 'MATCH,DIRECT'])
    const verdict = (host: string) => matchTarget(rules, { host, port: 443 })?.rule.outbound
    expect(verdict('example.com')).toBe('PROXY')
    expect(verdict('www.example.com')).toBe('DIRECT') // 全等就是全等，多一级都不算
  })

  it('DOMAIN-SUFFIX 按点边界：mail.google.com 与 google.com 命中，google.art 与 agoogle.com 不命中', () => {
    const rules = parseRules(['DOMAIN-SUFFIX,google.com,PROXY', 'MATCH,DIRECT'])
    const verdict = (host: string) => matchTarget(rules, { host, port: 443 })?.rule.outbound
    expect(verdict('mail.google.com')).toBe('PROXY') // 子域：一个点分一级，仍在这棵树上
    expect(verdict('google.com')).toBe('PROXY') // 本尊也命中
    expect(verdict('google.art')).toBe('DIRECT') // 同名不同尾巴：差一个字母都不行
    expect(verdict('agoogle.com')).toBe('DIRECT') // 子串撞名：前缀多一个字母都不行——按点边界，不是按子串
    expect(verdict('mail.google.com.example.org')).toBe('DIRECT') // 后缀出现在中间：不算
    expect(verdict('MAIL.Google.COM')).toBe('PROXY') // 域名大小写不敏感
  })

  it('DOMAIN-KEYWORD 按子串：google.art 与 agoogle.com 这回都命中——与后缀行语义不同', () => {
    const rules = parseRules(['DOMAIN-KEYWORD,google,PROXY', 'MATCH,DIRECT'])
    const verdict = (host: string) => matchTarget(rules, { host, port: 443 })?.rule.outbound
    expect(verdict('google.art')).toBe('PROXY') // 关键字看的是「串里有没有」，不看边界
    expect(verdict('agoogle.com')).toBe('PROXY')
    expect(verdict('gogo.dev')).toBe('DIRECT') // 没有关键字就是不命中
  })
})

// —— 单元：顺序（误区证伪的机械化） ——

describe('第一条命中即停：顺序就是优先级', () => {
  it('同一目标、同样两行规则，只换个序，判决相反——「表里找得到就命中」不成立', () => {
    const lines = ['DOMAIN-SUFFIX,example.com,PROXY', 'MATCH,DIRECT']
    const suffixFirst = matchTarget(parseRules(lines), { host: 'www.example.com', port: 443 })
    const matchFirst = matchTarget(parseRules([...lines].reverse()), { host: 'www.example.com', port: 443 })
    // 两张表里都「找得到」www.example.com，命运却相反：命中的是顺序上更靠前的那行
    expect(suffixFirst?.rule.type).toBe('DOMAIN-SUFFIX')
    expect(suffixFirst?.rule.outbound).toBe('PROXY')
    expect(suffixFirst?.index).toBe(0)
    expect(matchFirst?.rule.type).toBe('MATCH')
    expect(matchFirst?.rule.outbound).toBe('DIRECT')
    expect(matchFirst?.index).toBe(0)
  })
})

// —— 单元：IP-CIDR ——

describe('IP-CIDR：掩码按位与，刀口落在位上', () => {
  it('/24 对齐字节与 /22 切在字节中间都按同一套位运算判', () => {
    const rules = parseRules([
      'IP-CIDR,203.0.113.0/24,DIRECT',
      'IP-CIDR,192.0.0.0/22,PROXY',
      'IP-CIDR,198.51.100.7/32,DIRECT',
      'MATCH,PROXY',
    ])
    const hitLine = (host: string) => matchTarget(rules, { host, port: 80 })?.index
    expect(hitLine('203.0.113.7')).toBe(0) // 街内
    expect(hitLine('203.0.114.7')).toBe(3) // 隔一条街：落到兜底
    expect(hitLine('192.0.3.77')).toBe(1) // /22 的刀口在第三字节中间：3 AND 252 = 0，仍在这条街
    expect(hitLine('192.0.4.1')).toBe(3) // 4 AND 252 = 4，出了街
    expect(hitLine('198.51.100.7')).toBe(2) // /32 = 单门牌
    expect(hitLine('198.51.100.8')).toBe(3) // 隔壁门牌都不算
  })
})

// —— 单元：决策树（域名先不做 DNS 解析） ——

describe('决策树：有域名先不解析，IP 行与域名行互不越界', () => {
  it('0.0.0.0/0 罩得住一切 IP，却对域名目标无效——不做解析就没有 IP 可试', () => {
    const rules = parseRules(['IP-CIDR,0.0.0.0/0,PROXY', 'MATCH,DIRECT'])
    expect(matchTarget(rules, { host: '192.0.2.1', port: 443 })?.rule.outbound).toBe('PROXY')
    // 试 IP 行得先有 IP，那要先做 DNS 解析；教学版不解析：域名目标整行跳过，落兜底直连
    expect(matchTarget(rules, { host: 'anything.example', port: 443 })?.rule.outbound).toBe('DIRECT')
  })

  it('IP 目标对域名行失明：字面里含关键字 203 也不认，判给 IP 行', () => {
    const rules = parseRules(['DOMAIN-KEYWORD,203,PROXY', 'IP-CIDR,203.0.113.0/24,DIRECT'])
    // '203.0.113.7' 这串字面里确有 '203'——但它是 IP 字面量，没有「名字」，域名行对它不开门
    expect(matchTarget(rules, { host: '203.0.113.7', port: 80 })?.rule.outbound).toBe('DIRECT')
  })
})

// —— 集成：入口按判决分流 ——

describe('入口接入规则引擎：onConnect 先问判决，再选线', () => {
  it('同样两行只换顺序，同一条连接从直连改走加密两跳（顺序实验的链路版）', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const tap = await startTap(relay.port) // 探针立在远端门前：判决走没走第二跳，数连接就知道

    const speak = async (entryPort: number, host: string, port: number, marker: string) => {
      const client = await connect(entryPort)
      client.write(greeting())
      await readExact(client, 2) // 方法选定应答：05 00
      const echoed = readUntil(client, marker.toUpperCase())
      client.write(connectIPv4(host, port))
      client.write(marker + '\n')
      expect((await echoed).toString()).toContain(marker.toUpperCase()) // 两条线都该把货送到
      client.destroy()
    }

    // 序一：127.0.0.1/32 在前 → 直连；远端一个连接都没来
    const directFirst = await startSocks5Server({
      port: 0,
      onConnect: routeByRules(parseRules(['IP-CIDR,127.0.0.1/32,DIRECT', 'MATCH,PROXY']), tap.port),
    })
    closeSocks(directFirst)
    await speak(directFirst.port, '127.0.0.1', target.port, 'order-one')
    expect(tap.connections()).toBe(0)

    // 序二：同样两行倒过来 → 同一目标改走加密两跳；连接这次到了远端
    const relayFirst = await startSocks5Server({
      port: 0,
      onConnect: routeByRules(parseRules(['IP-CIDR,127.0.0.1/32,PROXY', 'MATCH,DIRECT']), tap.port),
    })
    closeSocks(relayFirst)
    await speak(relayFirst.port, '127.0.0.1', target.port, 'order-two')
    expect(tap.connections()).toBe(1)

    expect(target.connections()).toBe(2) // 两条路殊途同归：目标站各收到一次连接
  })

  it('同一张规则表：域名目标判给 DOMAIN 行直连，IP 目标判给 IP-CIDR 行走加密两跳', async () => {
    const target = await startLineTarget('::') // 双栈：域名 localhost 无论解析到 v4 还是 v6 都接得住
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const tap = await startTap(relay.port)
    const entry = await startSocks5Server({
      port: 0,
      onConnect: routeByRules(
        parseRules(['DOMAIN,localhost,DIRECT', 'IP-CIDR,127.0.0.0/8,PROXY', 'MATCH,DIRECT']),
        tap.port,
      ),
    })
    closeSocks(entry)

    // 域名目标（ATYP=3）：命中 DOMAIN 行 → 直连，远端零连接
    const byName = await connect(entry.port)
    byName.write(greeting())
    await readExact(byName, 2)
    const echoedName = readUntil(byName, 'BY-NAME')
    byName.write(connectDomain('localhost', target.port))
    byName.write('by-name\n')
    expect((await echoedName).toString()).toContain('BY-NAME')
    expect(tap.connections()).toBe(0)

    // IP 目标（ATYP=1）：DOMAIN 行对它失明 → IP-CIDR 行 → 加密两跳
    const byIp = await connect(entry.port)
    byIp.write(greeting())
    await readExact(byIp, 2)
    const echoedIp = readUntil(byIp, 'BY-IP')
    byIp.write(connectIPv4('127.0.0.1', target.port))
    byIp.write('by-ip\n')
    expect((await echoedIp).toString()).toContain('BY-IP')
    expect(tap.connections()).toBe(1)

    expect(target.connections()).toBe(2)
  })
})
