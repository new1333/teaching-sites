// tests/fake-ip.test.ts —— 第 8 章：fake-ip（取号池 + DNS 应答器 + 入口还原接线）
// 纪律：127.0.0.1 回环 + listen(0)/bind(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
// UDP 测试自设：dgram 客户端发原始查询字节、断言应答字节——应答器有没有按 RFC 1035 的形状说话，字节说了算。
import dgram from 'node:dgram'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProxyTarget } from '../src/http-proxy'
import { FakeIpPool, startFakeDns, type FakeDnsHandle } from '../src/fakeip'
import { matchTarget, parseRules, type Rule } from '../src/rules'
import { connectViaRelay, startRelayServer, type RelayServerHandle } from '../src/relay'
import { startSocks5Server, type Socks5ServerHandle } from '../src/socks5'

// —— 脚手架（与第 4、6、7 章同款） ——

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

// host 缺省回环；传 '::' 时拿双栈（IPv4 与 IPv6 的来客都接）——给「还原后按域名直连」的用例当靶子
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

function closeDns(d: FakeDnsHandle): void {
  cleanups.push(() => void d.close())
}

// —— DNS 报文拼装（测试当一台只会发原始字节的解析器；裁判是 RFC 1035） ——

function dnsQuery(id: number, name: string, qtype = 0x0001): Buffer {
  const labels = name.split('.').map((l) => Buffer.from(l, 'latin1'))
  const qname = Buffer.concat(labels.flatMap((l) => [Buffer.from([l.length]), l]).concat([Buffer.from([0])]))
  const head = Buffer.alloc(12)
  head.writeUInt16BE(id, 0)
  head.writeUInt16BE(0x0100, 2) // RD=1：请递归
  head.writeUInt16BE(1, 4) // 一个问题
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(qtype, 0)
  tail.writeUInt16BE(1, 2) // QCLASS=IN
  return Buffer.concat([head, qname, tail])
}

// 问题段原文（应答必须一字不差抄回，比对用）
const QUESTION_OF = (q: Buffer) => q.subarray(12)

// 从应答尾部抠出 RDATA 里的四个字节，拼回点分 IPv4（答案区定长 16、RDATA 居末 4 字节）
function answerIp(reply: Buffer): string {
  const at = reply.length - 4
  return [reply[at], reply[at + 1], reply[at + 2], reply[at + 3]].join('.')
}

// UDP 一问一答：原始字节进、原始字节出；超时兜底防挂死
function ask(dns: FakeDnsHandle, query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    const timer = setTimeout(() => done(new Error('等待 DNS 应答超时')), 3000)
    const done = (e: Error | null, out?: Buffer) => {
      clearTimeout(timer)
      sock.close()
      if (e) reject(e)
      else resolve(out ?? Buffer.alloc(0))
    }
    sock.once('message', (b) => done(null, b))
    sock.once('error', (e) => done(e))
    sock.send(query, dns.port, '127.0.0.1')
  })
}

// 单向发一包、不等应答：把字节塞进应答器就走（残缺报文用例用）
function fireAndForget(dns: FakeDnsHandle, buf: Buffer): Promise<void> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    sock.send(buf, dns.port, '127.0.0.1', () => {
      sock.close()
      resolve()
    })
  })
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

// —— 本章的固定道具 ——

const PASSWORD = 'course-password'

// 入口接线（第 7 章 routeByRules 的 fake-ip 版）：假门牌先还原成真名字，再交规则引擎判决
function restoreThenRoute(pool: FakeIpPool, rules: Rule[], relayPort: number, password = PASSWORD) {
  return (t: ProxyTarget): ProxyTarget | Duplex | Promise<ProxyTarget | Duplex> => {
    const domain = pool.restore(t.host) // 还原不出名字的是普通目标（真 IP 直报），原样放行
    const target: ProxyTarget = domain === null ? t : { host: domain, port: t.port }
    const hit = matchTarget(rules, target)
    return hit !== null && hit.rule.outbound === 'PROXY'
      ? connectViaRelay({ host: '127.0.0.1', port: relayPort }, target, password)
      : target
  }
}

// —— 单元：取号池 ——

describe('FakeIpPool：取号、登记、还原、让位', () => {
  it('同名同号，不同名按序取新号，号从 198.18.0.1 起发', () => {
    const pool = new FakeIpPool()
    expect(pool.allocate('site.example')).toBe('198.18.0.1')
    expect(pool.allocate('site.example')).toBe('198.18.0.1') // 问两遍同一号：客户端缓不缓存都不乱
    expect(pool.allocate('SITE.EXAMPLE')).toBe('198.18.0.1') // 域名大小写不敏感，与规则引擎同一纪律
    expect(pool.allocate('api.site.example')).toBe('198.18.0.2')
    expect(pool.size).toBe(2) // 两个名字在册
    expect(pool.restore('198.18.0.2')).toBe('api.site.example') // 双向账本：号还原得回名字
  })

  it('还原只认在册的号：段外真门牌与段内未发的号都还原不出', () => {
    const pool = new FakeIpPool()
    expect(pool.restore('203.0.113.7')).toBeNull() // 真门牌：不是本池发的
    expect(pool.restore('198.18.9.9')).toBeNull() // 在保留网段里、但还没发给谁
  })

  it('池满 FIFO 让位：最老的交出号码，旧号易主，回访者拿到别人的号', () => {
    const pool = new FakeIpPool({ capacity: 2 })
    expect(pool.allocate('a.example')).toBe('198.18.0.1')
    expect(pool.allocate('b.example')).toBe('198.18.0.2')
    expect(pool.allocate('c.example')).toBe('198.18.0.1') // 池满：a 最老，让出 198.18.0.1 给 c
    expect(pool.restore('198.18.0.1')).toBe('c.example') // 旧号已易主：a 的映射不复存在
    expect(pool.restore('198.18.0.2')).toBe('b.example')
    expect(pool.allocate('a.example')).toBe('198.18.0.2') // a 回访：又满，这回 b 让位——a 拿到的是 b 的号
    expect(pool.size).toBe(2)
  })
})

// —— 单元：DNS 应答器 ——

describe('startFakeDns：UDP 上的假电话簿', () => {
  it('A 查询收到一条按 RFC 1035 形状拼的答案：问题抄回、指针指名、TTL=1、RDATA 是假门牌', async () => {
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    const query = dnsQuery(0x1234, 'www.site.example')
    const reply = await ask(dns, query)
    expect(reply.length).toBe(query.length + 16) // 头 + 原问题抄回 + 一条 16 字节答案
    expect(reply.readUInt16BE(0)).toBe(0x1234) // ID 回显：让客户端对得上号
    expect(reply.readUInt16BE(2)).toBe(0x8580) // QR|AA|RA|RD：这是应答，戏服三件 + 抄回的 RD
    expect(reply.readUInt16BE(4)).toBe(1) // 问题数 1
    expect(reply.readUInt16BE(6)).toBe(1) // 答案数 1
    expect(reply.subarray(12, reply.length - 16)).toEqual(QUESTION_OF(query)) // 问题段一字不差抄回
    const ans = reply.subarray(reply.length - 16)
    expect(Array.from(ans.subarray(0, 2))).toEqual([0xc0, 0x0c]) // 压缩指针：答案的名字就是问题里那个名字
    expect(ans.readUInt16BE(2)).toBe(0x0001) // TYPE=A
    expect(ans.readUInt16BE(4)).toBe(0x0001) // CLASS=IN
    expect(ans.readUInt32BE(6)).toBe(1) // TTL=1 秒：假答案不配被久缓存
    expect(ans.readUInt16BE(10)).toBe(4) // RDLENGTH：IPv4 地址四字节
    expect(pool.restore(answerIp(reply))).toBe('www.site.example') // 应答里的号，池里还原得回名字
  })

  it('同名两问同一号，池不重复登记', async () => {
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    const first = await ask(dns, dnsQuery(0x0001, 'www.site.example'))
    const second = await ask(dns, dnsQuery(0x0002, 'www.site.example')) // 换个 ID，还是同一个名字
    expect(answerIp(first)).toBe(answerIp(second))
    expect(pool.size).toBe(1)
  })

  it('AAAA 查询回「查无此录」的空答案：问题抄回、答案数为 0、池不动', async () => {
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    const query = dnsQuery(0x00ff, 'www.site.example', 0x001c) // QTYPE=28（AAAA：IPv6 形态的 A 记录）
    const reply = await ask(dns, query)
    expect(reply.readUInt16BE(0)).toBe(0x00ff)
    expect(reply.readUInt16BE(6)).toBe(0) // 没有答案：教学版只发 IPv4 假门牌
    expect(reply.length).toBe(query.length) // 头 + 抄回的问题，仅此而已
    expect(reply.subarray(12)).toEqual(QUESTION_OF(query))
    expect(pool.size).toBe(0) // 没登记：只有 A 查询才取号
  })

  it('残缺查询搞不垮应答器：丢弃之后，下一个正经查询照常拿到答案', async () => {
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    await fireAndForget(dns, Buffer.from([0x01, 0x02, 0x03])) // 连 12 字节头都不齐
    const reply = await ask(dns, dnsQuery(0x0777, 'ok.example'))
    expect(pool.restore(answerIp(reply))).toBe('ok.example')
  })
})

// —— 集成：入口还原接线 ——

describe('入口接线：假门牌先还原，再交规则引擎', () => {
  it('同一个入口：假 IP 连接还原成域名判 PROXY 走加密两跳，真 IP 连接落兜底直连', async () => {
    const target = await startLineTarget('::') // 双栈：还原出的 localhost 无论解析到 v4 还是 v6 都接得住
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const tap = await startTap(relay.port) // 探针立在远端门前：走没走第二跳，数连接就知道
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    const rules = parseRules(['DOMAIN,localhost,PROXY', 'MATCH,DIRECT'])
    const entry = await startSocks5Server({ port: 0, onConnect: restoreThenRoute(pool, rules, tap.port) })
    closeSocks(entry)

    // 「浏览器」先查电话簿（拿到的当然是假门牌），再拿假门牌发起 CONNECT
    const reply = await ask(dns, dnsQuery(0x0042, 'localhost'))
    const fakeIp = answerIp(reply)
    expect(fakeIp.startsWith('198.18.')).toBe(true) // 保留网段里的假门牌
    const byFake = await connect(entry.port)
    byFake.write(greeting())
    await readExact(byFake, 2) // 方法选定应答：05 00
    const echoedFake = readUntil(byFake, 'BY-FAKE')
    byFake.write(connectIPv4(fakeIp, target.port))
    byFake.write('by-fake\n')
    expect((await echoedFake).toString()).toContain('BY-FAKE')
    expect(tap.connections()).toBe(1) // 假 IP 还原成 localhost → 命中 DOMAIN 行 → 加密两跳（域名过隧道，远端解析）
    expect(target.connections()).toBe(1)

    // 对照组：直接报真 IP——还原不出名字，落 MATCH 兜底直连
    const byReal = await connect(entry.port)
    byReal.write(greeting())
    await readExact(byReal, 2)
    const echoedReal = readUntil(byReal, 'BY-REAL')
    byReal.write(connectIPv4('127.0.0.1', target.port))
    byReal.write('by-real\n')
    expect((await echoedReal).toString()).toContain('BY-REAL')
    expect(tap.connections()).toBe(1) // 没涨：这回没走第二跳
    expect(target.connections()).toBe(2) // 同一台目标站，殊途同归
  })

  it('规则表倒过来（DOMAIN 行判 DIRECT、MATCH 兜底 PROXY）：还原后的判决跟着翻', async () => {
    const target = await startLineTarget('::')
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const tap = await startTap(relay.port)
    const pool = new FakeIpPool()
    const dns = await startFakeDns({ port: 0, pool })
    closeDns(dns)
    const rules = parseRules(['DOMAIN,localhost,DIRECT', 'MATCH,PROXY'])
    const entry = await startSocks5Server({ port: 0, onConnect: restoreThenRoute(pool, rules, tap.port) })
    closeSocks(entry)

    const speak = async (host: string, marker: string) => {
      const client = await connect(entry.port)
      client.write(greeting())
      await readExact(client, 2)
      const echoed = readUntil(client, marker.toUpperCase())
      client.write(connectIPv4(host, target.port))
      client.write(marker + '\n')
      expect((await echoed).toString()).toContain(marker.toUpperCase())
      client.destroy()
    }

    const reply = await ask(dns, dnsQuery(0x0043, 'localhost'))
    await speak(answerIp(reply), 'by-fake') // 假 IP → 还原 → DOMAIN 行判直连：按域名拨号，远端零连接
    expect(tap.connections()).toBe(0)
    await speak('127.0.0.1', 'by-real') // 真 IP → 还原不出 → MATCH 兜底：这回走了加密两跳
    expect(tap.connections()).toBe(1)
    expect(target.connections()).toBe(2)
  })
})
