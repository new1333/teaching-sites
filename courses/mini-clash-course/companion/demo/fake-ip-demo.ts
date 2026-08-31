// companion/demo/fake-ip-demo.ts —— 亲手开机：假电话簿三幕
// 第一幕：查号台——把 DNS 指向 mini-clash，A 查询当场拿回 198.18.x.x 的假门牌（同名同号）
// 第二幕：还原判决——拿假门牌发起 SOCKS5 连接，入口按账本换回真名字送规则引擎：
//         判 PROXY 走加密两跳（域名过隧道，远端解析）；对照组拿真 IP 直连（MATCH 兜底）
// 第三幕：账本的一生——容量 3 的小池发到第 4 个名字，最老的让位、旧号易主（映射的生命周期）
// 跑法：cd companion && npm run demo:fake-ip
import dgram from 'node:dgram'
import net from 'node:net'
import { FakeIpPool, startFakeDns } from '../src/fakeip'
import { matchTarget, parseRules, type Rule } from '../src/rules'
import { connectViaRelay, startRelayServer } from '../src/relay'
import { startSocks5Server } from '../src/socks5'

const PASSWORD = 'mini-clash-demo-password'

// —— 小工具：事件驱动等待，与测试同一件手艺 ——

function readExact(sock: net.Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.length >= n) {
        sock.removeAllListeners('data')
        sock.removeAllListeners('error')
        resolve(buf)
      }
    })
    sock.once('error', reject)
  })
}

function readUntil(sock: net.Socket, needle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0)
    sock.on('data', (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      if (buf.includes(needle)) {
        sock.removeAllListeners('data')
        sock.removeAllListeners('error')
        resolve(buf)
      }
    })
    sock.once('error', reject)
  })
}

function connect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, '127.0.0.1', () => resolve(s))
    s.once('error', reject)
  })
}

// DNS 查询报文：12 字节头（RD=1、一个问题）+ 名字 + QTYPE/QCLASS——与测试同款拼装
function dnsQuery(id: number, name: string): Buffer {
  const labels = name.split('.').map((l) => Buffer.from(l, 'latin1'))
  const qname = Buffer.concat(labels.flatMap((l) => [Buffer.from([l.length]), l]).concat([Buffer.from([0])]))
  const head = Buffer.alloc(12)
  head.writeUInt16BE(id, 0)
  head.writeUInt16BE(0x0100, 2)
  head.writeUInt16BE(1, 4)
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(0x0001, 0)
  tail.writeUInt16BE(0x0001, 2)
  return Buffer.concat([head, qname, tail])
}

// UDP 一问一答；从应答尾部抠出 RDATA 四字节拼回点分 IPv4
function askDns(port: number, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    const done = (e: Error | null, out?: Buffer) => {
      sock.close()
      if (e) reject(e)
      else resolve([out![out!.length - 4], out![out!.length - 3], out![out!.length - 2], out![out!.length - 1]].join('.'))
    }
    sock.once('message', (b) => done(null, b))
    sock.once('error', (e) => done(e))
    sock.send(dnsQuery(0x00aa, name), port, '127.0.0.1')
  })
}

// 规则行还原成原文：判决台打印「命中哪行」用
function showRule(r: Rule): string {
  return r.type === 'MATCH' ? 'MATCH,' + r.outbound : `${r.type},${r.value},${r.outbound}`
}

// —— 开机 ——

const pool = new FakeIpPool()
const target = net.createServer((s) => {
  let buf = Buffer.alloc(0)
  s.on('data', (b) => {
    buf = Buffer.concat([buf, b])
    const i = buf.indexOf('\n')
    if (i < 0) return
    s.write(buf.subarray(0, i).toString('latin1').toUpperCase() + '\n')
    buf = buf.subarray(i + 1)
  })
})

target.listen(0, '::', () => {
  // 双栈监听：还原出的 localhost 无论解析到 127.0.0.1 还是 ::1，都接得住
  const tport = (target.address() as net.AddressInfo).port
  void startRelayServer({ port: 0, password: PASSWORD }).then(async (relay) => {
    // 计数探针：透明转发，数「入口 → 远端」方向来了几条连接——判决走没走第二跳，看它就知道
    let tapCount = 0
    const tap = net.createServer((front) => {
      tapCount += 1
      const back = net.connect(relay.port, '127.0.0.1')
      front.on('data', (b) => back.write(b))
      back.on('data', (b) => front.write(b))
      const hangup = () => {
        front.destroy()
        back.destroy()
      }
      front.on('close', hangup)
      back.on('close', hangup)
      front.on('error', hangup)
      back.on('error', hangup)
    })
    await new Promise<void>((resolve) => tap.listen(0, '127.0.0.1', resolve))
    const tapport = (tap.address() as net.AddressInfo).port

    const dns = await startFakeDns({ port: 0, pool })
    // 入口接线：假门牌先按账本还原，再交规则引擎判决（第 7 章 routeByRules 的 fake-ip 版）
    const rules = parseRules(['DOMAIN,localhost,PROXY', 'MATCH,DIRECT'])
    const entry = await startSocks5Server({
      port: 0,
      onConnect: (t) => {
        const domain = pool.restore(t.host)
        const use = domain === null ? t : { host: domain, port: t.port }
        const hit = matchTarget(rules, use)
        return hit !== null && hit.rule.outbound === 'PROXY'
          ? connectViaRelay({ host: '127.0.0.1', port: tapport }, use, PASSWORD)
          : use
      },
    })

    console.log(`假电话簿已监听: 127.0.0.1:${dns.port}（真 DNS 住 53 端口，教学版用临时端口免管理员）`)
    console.log(`目标站已监听（双栈）:  localhost:${tport}（即 127.0.0.1:${tport}）`)
    console.log(`远端中继已监听（已上锁）: 127.0.0.1:${relay.port}`)
    console.log('')

    // —— 第一幕：查号台 ——
    console.log('—— 第一幕：把 DNS 指向 mini-clash，A 查询当场拿假门牌 ——')
    for (const name of ['www.site.example', 'api.site.example', 'www.site.example']) {
      const ip = await askDns(dns.port, name)
      console.log(`  查询 ${name.padEnd(18)} → ${ip}`)
    }
    console.log('  （同名两问同一号——www.site.example 没拿第二个门牌；账本在册 ' + pool.size + ' 条。）')
    console.log(`  有 dig 的读者可亲手再查：dig @127.0.0.1 -p ${dns.port} www.site.example A`)
    console.log(`  Windows 自带 nslookup 的读者：nslookup -port=${dns.port} www.site.example 127.0.0.1`)
    console.log('  （ANSWER 段里的 A 记录就是上面这个假门牌；没有 dig 时，第一幕自带的就是同款报文往返。）')

    // —— 第二幕：还原判决 ——
    console.log('')
    console.log('—— 第二幕：拿假门牌去连接，入口换回真名字再判决 ——')
    const fakeIp = await askDns(dns.port, 'localhost') // 「浏览器」先查电话簿
    const speak = async (label: string, host: string, marker: string) => {
      const browser = await connect(entry.port)
      browser.write(Buffer.from([0x05, 0x01, 0x00])) // SOCKS5 greeting
      await readExact(browser, 2)
      const echoed = readUntil(browser, marker.toUpperCase())
      const ip = host.split('.').map(Number)
      browser.write(Buffer.from([0x05, 0x01, 0x00, 0x01, ...ip, tport >> 8, tport & 0xff])) // CONNECT 目标（ATYP=IPv4）
      browser.write(marker + '\n')
      await echoed
      console.log(`  ${label} 收到回声 ${marker.toUpperCase()}（货送到了）→ 此刻远端侧连接数: ${tapCount}`)
      browser.destroy()
    }
    const verdictOf = (host: string) => {
      const domain = pool.restore(host)
      const use = domain === null ? { host, port: tport } : { host: domain, port: tport }
      const hit = matchTarget(rules, use)
      const restored = domain === null ? '还原不出名字（非本池门牌）' : `还原成 ${domain}`
      return hit === null ? restored + '，一行未中' : `${restored} → 判 ${hit.rule.outbound.padEnd(6)} 命中第 ${hit.index} 行 ${showRule(hit.rule)}`
    }
    console.log(`  假门牌 ${fakeIp}:${tport}  ${verdictOf(fakeIp)}`)
    await speak('拿假门牌连接', fakeIp, 'by-fake')
    console.log(`  真门牌 127.0.0.1:${tport}  ${verdictOf('127.0.0.1')}`)
    await speak('拿真门牌连接', '127.0.0.1', 'by-real')
    console.log('  （假门牌还原成 localhost 判 PROXY：域名过加密隧道，由远端解析；真门牌还原不出名字，落 MATCH 兜底直连。')
    console.log('   同一个入口、同一台目标站——假门牌那条的「解析」发生在隧道另一头。）')

    // —— 第三幕：账本的一生 ——
    console.log('')
    console.log('—— 第三幕：容量 3 的小池发到第 4 个名字——最老的让位，旧号易主 ——')
    const mini = new FakeIpPool({ capacity: 3 })
    const who: Array<[string, string]> = []
    for (const name of ['a.example', 'b.example', 'c.example', 'd.example']) who.push([name, mini.allocate(name)])
    for (const [name, ip] of who) console.log(`  ${name.padEnd(12)} → ${ip}`)
    console.log(`  d.example 进场时池已满：最老的 a.example 让位，旧号 198.18.0.1 现在还原出 ${mini.restore('198.18.0.1')}`)
    console.log('  （让位不是删除名字，是旧号易主——还握着旧假门牌的连接，还原出的是别人的名字。）')
    console.log('')
    console.log('收摊。账本与还原接线此刻长在测试与 demo 里；第 11 章总装把 DNS 也拉进一条命令。')
    void relay.close().then(() => {
      void dns.close().then(() => {
        void entry.close().then(() => process.exit(0))
      })
    })
  })
})
