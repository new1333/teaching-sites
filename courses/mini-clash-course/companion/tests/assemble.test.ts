// tests/assemble.test.ts —— 第 11 章：总装（startMiniClash 把入口、fake-ip DNS、规则、组、隧道、远端串成整机）
// 纪律：127.0.0.1 回环 + listen(0)/bind(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
// 端到端用例全链路在回环上：测试当浏览器（UDP 查 DNS + SOCKS5 CONNECT + 说 HTTP），远端与目标站都是回环桩。
import dgram from 'node:dgram'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startMiniClash, type MiniClashHandle } from '../src/mini-clash'
import { loadConfig } from '../src/config'
import { startRelayServer } from '../src/relay'

// —— 脚手架（与第 4、6、7、8、10 章同款） ——

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

// host 缺省回环；传 '::' 时拿双栈（IPv4 与 IPv6 的来客都接）——还原出的 localhost 无论解析到哪边都接得住
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

// 等到收线为止；超时兜底防挂死（篡改用例的靶子：坏块即断线）
function waitClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error('等收线超时——连接居然还活着')), 3000)
    const done = (e: Error | null) => {
      clearTimeout(timer)
      if (e) reject(e)
      else resolve()
    }
    socket.once('close', () => done(null))
    socket.once('error', () => done(null)) // 断线常伴 error 事件：一样算「没活下来」
  })
}

// —— 本章的回环桩：目标站、透明抄录探针、中途篡改者 ——

// 目标站：一个最小 HTTP 服务——收到请求就回一封 200，正文是固定暗号；连接数与请求数都记账
function startTargetSite(): Promise<{ port: number; connections: () => number; requests: () => number }> {
  let conns = 0
  let reqs = 0
  const body = 'HELLO-FROM-TARGET'
  const server = net.createServer((s) => {
    conns += 1
    s.on('data', () => {
      if (reqs > conns - 1) return // 一条连接只应一封（测试不发第二封，防御性收口）
      reqs += 1
      s.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`)
      s.end()
    })
  })
  return listen(server, '::').then((port) => ({ port, connections: () => conns, requests: () => reqs }))
}

// 透明抄录探针：立在远端门前，只数连接、只抄字节不动手——线上走的是密文还是明文，抄录说了算
function startTap(downPort: number): Promise<{ port: number; connections: () => number; seen: () => Buffer }> {
  let count = 0
  let recorded = Buffer.alloc(0)
  const tap = net.createServer((front) => {
    count += 1
    const back = net.connect(downPort, '127.0.0.1')
    front.on('data', (b: Buffer) => {
      recorded = Buffer.concat([recorded, b])
      back.write(b)
    })
    back.on('data', (b: Buffer) => {
      recorded = Buffer.concat([recorded, b])
      front.write(b)
    })
    const hangup = () => {
      front.destroy()
      back.destroy()
    }
    front.on('close', hangup)
    back.on('close', hangup)
    front.on('error', hangup)
    back.on('error', hangup)
  })
  return listen(tap).then((port) => ({ port, connections: () => count, seen: () => recorded }))
}

// 中途篡改者：也是透明转发，但「远端方向」的字节，从见到回程流量起（链路已建立），每批末字节翻一位——
// 模拟中间人对密文动手脚：不需要读懂，改一个字节就够
function startCorruptor(downPort: number): Promise<{ port: number }> {
  let seenFromBack = false // 回程有字节 = 盐与回执已过境，链路已建立：此后去程字节才动手
  const tap = net.createServer((front) => {
    const back = net.connect(downPort, '127.0.0.1')
    front.on('data', (b: Buffer) => {
      if (!seenFromBack || b.length === 0) return back.write(b)
      const broken = Buffer.from(b) // 别改原块（事件参数可能被复用），抄一份再下毒
      broken[broken.length - 1] ^= 0x55
      back.write(broken)
    })
    back.on('data', (b: Buffer) => {
      seenFromBack = true
      front.write(b)
    })
    const hangup = () => {
      front.destroy()
      back.destroy()
    }
    front.on('close', hangup)
    back.on('close', hangup)
    front.on('error', hangup)
    back.on('error', hangup)
  })
  return listen(tap).then((port) => ({ port }))
}

// —— DNS / SOCKS5 报文拼装（与第 8 章同款：测试当浏览器，原始字节进出） ——

function dnsQuery(id: number, name: string): Buffer {
  const labels = name.split('.').map((l) => Buffer.from(l, 'latin1'))
  const qname = Buffer.concat(labels.flatMap((l) => [Buffer.from([l.length]), l]).concat([Buffer.from([0])]))
  const head = Buffer.alloc(12)
  head.writeUInt16BE(id, 0)
  head.writeUInt16BE(0x0100, 2) // RD=1：请递归
  head.writeUInt16BE(1, 4) // 一个问题
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(0x0001, 0) // QTYPE=A
  tail.writeUInt16BE(1, 2) // QCLASS=IN
  return Buffer.concat([head, qname, tail])
}

// 从应答尾部抠出 RDATA 里的四个字节，拼回点分 IPv4（答案区定长 16、RDATA 居末 4 字节）
function answerIp(reply: Buffer): string {
  const at = reply.length - 4
  return [reply[at], reply[at + 1], reply[at + 2], reply[at + 3]].join('.')
}

function ask(handle: MiniClashHandle, query: Buffer): Promise<Buffer> {
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
    sock.send(query, handle.dnsPort, '127.0.0.1')
  })
}

const VER = 0x05

function greeting(): Buffer {
  return Buffer.from([VER, 0x01, 0x00]) // 版本 5，会 1 种方法：无认证
}

function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([VER, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

// —— 一套整机世界：带锁远端 + 门前的抄录探针 + 目标站 + 指向它们的配置文本 ——

function configText(nodePort: number, rules: string[]): string {
  return JSON.stringify(
    {
      inbound: { port: 0 },
      proxies: [{ name: 'node-a', host: '127.0.0.1', port: nodePort, password: 'pw-node-a' }],
      groups: [{ name: 'choose', type: 'select', proxies: ['node-a'] }],
      rules,
    },
    null,
    2,
  )
}

const PROXY_RULES = ['DOMAIN,localhost,choose', 'IP-CIDR,127.0.0.0/8,DIRECT', 'MATCH,DIRECT']

async function startWorld(rules = PROXY_RULES): Promise<{
  target: { port: number; connections: () => number; requests: () => number }
  tap: { port: number; connections: () => number; seen: () => Buffer }
  configText: string
}> {
  const relay = await startRelayServer({ port: 0, password: 'pw-node-a' })
  cleanups.push(() => void relay.close())
  const tap = await startTap(relay.port)
  const target = await startTargetSite()
  return { target, tap, configText: configText(tap.port, rules) }
}

function closeMiniClash(m: MiniClashHandle): void {
  cleanups.push(() => void m.close())
}

// 浏览器过整机走一封 HTTP：SOCKS5 CONNECT 到「host:目标端口」，随后说 GET，等到正文暗号
async function browse(handle: MiniClashHandle, host: string, targetPort: number): Promise<string> {
  const browser = await connect(handle.socksPort)
  browser.write(greeting())
  await readExact(browser, 2) // 方法选定应答：05 00
  const reply = readExact(browser, 10) // CONNECT 应答骨架定长 10 字节
  const body = readUntil(browser, 'HELLO-FROM-TARGET')
  browser.write(connectIPv4(host, targetPort))
  const r = await reply
  expect(r[1]).toBe(0x00) // REP=00：接通了
  browser.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`)
  const raw = (await body).toString()
  browser.destroy()
  return raw.substring(raw.indexOf('\r\n\r\n') + 4) // 只要正文
}

// —— 端到端：一条配置拉起的整机 ——

describe('startMiniClash：域名经 fake-ip 的全链路', () => {
  it('DNS 查询得假 IP → 连接还原域名 → 规则判决 → 组选节点 → 加密两跳 → 远端代连目标，响应原路返回', async () => {
    const world = await startWorld()
    const handle = await startMiniClash(world.configText) // 配置文本进，整机出
    closeMiniClash(handle)
    expect(handle.socksPort).toBeGreaterThan(0)
    expect(handle.dnsPort).toBeGreaterThan(0)

    // 第一步：浏览器先查电话簿——拿到的当然是假门牌
    const reply = await ask(handle, dnsQuery(0x0042, 'localhost'))
    const fakeIp = answerIp(reply)
    expect(fakeIp.startsWith('198.18.')).toBe(true) // 保留网段里的假门牌
    expect(handle.pool.restore(fakeIp)).toBe('localhost') // 账本记着它的主人

    // 第二步：拿假门牌发起 CONNECT，随后说 HTTP——整机要自己把名字换回来
    const body = await browse(handle, fakeIp, world.target.port)
    expect(body).toBe('HELLO-FROM-TARGET') // 响应原路返回：目标 → 远端 → 隧道 → 入口 → 浏览器
    expect(world.tap.connections()).toBe(1) // 走了第二跳：入口确曾连向远端
    expect(world.target.connections()).toBe(1) // 目标由远端代连（不是入口直连的位置）
    expect(world.target.requests()).toBe(1) // 请求真的送达了目标站

    // 第三步：抄录探针的账——线上没有明文：载荷与「去哪儿」都搜不到
    const seen = world.tap.seen()
    expect(seen.includes(Buffer.from('GET / HTTP'))).toBe(false) // 载荷上锁
    expect(seen.includes(Buffer.from('localhost'))).toBe(false) // CONNECT 帧里的目标也上锁
    expect(seen.length).toBeGreaterThan(32) // 线上不是空的：盐与密文块都在过境
  })

  it('DIRECT 目标直连：真 IP 命中 IP-CIDR 行，第二跳零连接，货照送', async () => {
    const world = await startWorld()
    const handle = await startMiniClash(loadConfig(world.configText)) // 入参也认 Config 对象：加载与总装各管各的
    closeMiniClash(handle)

    const body = await browse(handle, '127.0.0.1', world.target.port)
    expect(body).toBe('HELLO-FROM-TARGET')
    expect(world.tap.connections()).toBe(0) // 没走第二跳：判决落在本机直连
    expect(world.target.connections()).toBe(1) // 殊途同归：入口自己拨的目标
  })

  it('还原出的域名被判 DIRECT 时：名字留在本地，解析交给操作系统——一样把货送到', async () => {
    const world = await startWorld(['DOMAIN,localhost,DIRECT', 'MATCH,DIRECT']) // 规则倒过来：域名行判直连
    const handle = await startMiniClash(world.configText)
    closeMiniClash(handle)

    const reply = await ask(handle, dnsQuery(0x0043, 'localhost'))
    const body = await browse(handle, answerIp(reply), world.target.port) // 还是拿假门牌发起连接
    expect(body).toBe('HELLO-FROM-TARGET') // 还原 → 判 DIRECT → 按域名直连：双栈目标站无论解析到 v4/v6 都接住
    expect(world.tap.connections()).toBe(0) // 全程没碰远端
    expect(world.target.connections()).toBe(1)
  })

  it('handle.close() 收摊：入口与 DNS 两个监听都落地', async () => {
    const world = await startWorld()
    const handle = await startMiniClash(world.configText)
    const port = handle.socksPort
    await handle.close() // 不走 cleanups（本章要亲手收摊这一次）

    await expect(connect(port)).rejects.toThrow(/ECONNREFUSED/) // 入口没了
    const sock = dgram.createSocket('udp4')
    await new Promise<void>((resolve) => {
      // DNS 收摊后一问不答：等满 300ms 的静默即算证实（close 的 socket 不回任何字节）
      sock.send(dnsQuery(0x0044, 'localhost'), handle.dnsPort, '127.0.0.1')
      sock.once('message', () => {
        sock.close()
        throw new Error('收摊后的 DNS 竟然还在应答')
      })
      setTimeout(() => {
        sock.close()
        resolve()
      }, 300)
    })
  })
})

// —— 端到端：整机上的安全语义回归（第 6 章在整机上仍成立） ——

describe('整机上的篡改回归：改一个密文字节，连接活不成', () => {
  it('中途篡改已建立链路的密文：整机拒收断开，坏数据到不了目标', async () => {
    const relay = await startRelayServer({ port: 0, password: 'pw-node-a' })
    cleanups.push(() => void relay.close())
    const evil = await startCorruptor(relay.port) // 篡改者顶替探针立在远端门前
    const target = await startTargetSite()
    const text = configText(evil.port, PROXY_RULES)
    const handle = await startMiniClash(text)
    closeMiniClash(handle)

    // 先走通一半：假门牌 → 还原 → 判 choose → 加密两跳建立（CONNECT 应答 00 到手）
    const reply = await ask(handle, dnsQuery(0x0045, 'localhost'))
    const fakeIp = answerIp(reply)
    const browser = await connect(handle.socksPort)
    browser.write(greeting())
    await readExact(browser, 2)
    browser.write(connectIPv4(fakeIp, target.port))
    expect((await readExact(browser, 10))[1]).toBe(0x00) // 链路建立：此后去程字节开始被翻
    const closed = waitClose(browser) // 先猜后跑的靶子：这封请求过不了验漆，连接必死
    browser.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
    await closed // 断线而不是错位内容：第 6 章「验不过整封拒收」在整机上原样成立

    expect(target.connections()).toBe(1) // 目标曾被代连……
    expect(target.requests()).toBe(0) // ……但坏请求一个字节都没送达：AEAD 把它拦在远端门外
  })
})
