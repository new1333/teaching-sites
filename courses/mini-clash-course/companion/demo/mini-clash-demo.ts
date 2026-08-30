// companion/demo/mini-clash-demo.ts —— 亲手开机：一条命令拉起「远端 + mini-clash + 目标站」
// 第一幕：全部角色就位——两台各带锁的远端中继、测速目标、目标站、一台 startMiniClash 拉起的整机
// 第二幕：整机自证——浏览器视角走完整链路（DNS 假门牌 → 还原 → 判决 → 组 → 加密两跳 → 目标 → 原路返回）
// 第三幕：亲手走链路——照打印出的 curl 命令，在另一个终端把同一条链路再走一遍（60 秒窗口）
// 跑法：cd companion && npm run demo:mini-clash
import dgram from 'node:dgram'
import net from 'node:net'
import { startMiniClash } from '../src/mini-clash'
import { startRelayServer } from '../src/relay'

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

// —— 回环桩：测速应答器、目标站、快/慢两台节点（带锁中继 + 门前的转发器） ——

const probeServer = net.createServer((s) => {
  s.on('data', () => {
    s.write('HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    s.end()
  })
})

// 目标站：最小 HTTP 服务——回了什么、被谁连过，一眼可查
const SITE_BODY = 'hello from the mini-clash target site'
let siteConns = 0
let siteReqs = 0
const siteServer = net.createServer((s) => {
  siteConns += 1
  s.on('data', () => {
    siteReqs += 1
    s.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SITE_BODY.length}\r\nConnection: close\r\n\r\n${SITE_BODY}`)
    s.end()
  })
})

// 快桩：透明转发 + 抄录（抄录为了第二幕作证：线上是不是密文）
let fastSeen = Buffer.alloc(0)
function startFastTap(downPort: number): Promise<number> {
  return new Promise((resolve) => {
    const tap = net.createServer((front) => {
      const back = net.connect(downPort, '127.0.0.1')
      front.on('data', (b: Buffer) => {
        fastSeen = Buffer.concat([fastSeen, b])
        back.write(b)
      })
      back.on('data', (b: Buffer) => {
        fastSeen = Buffer.concat([fastSeen, b])
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
    tap.listen(0, '127.0.0.1', () => resolve((tap.address() as net.AddressInfo).port))
  })
}

// 慢桩：每批字节压 120ms 再转发——给 url-test 造出可量的快慢差
function startSlowTap(downPort: number, delayMs = 120): Promise<number> {
  return new Promise((resolve) => {
    const tap = net.createServer((front) => {
      const back = net.connect(downPort, '127.0.0.1')
      const relayChunk = (from: net.Socket, to: net.Socket, b: Buffer) => {
        if (from.destroyed || to.destroyed) return
        setTimeout(() => {
          if (!from.destroyed && !to.destroyed) to.write(b)
        }, delayMs)
      }
      front.on('data', (b: Buffer) => relayChunk(front, back, b))
      back.on('data', (b: Buffer) => relayChunk(back, front, b))
      const hangup = () => {
        front.destroy()
        back.destroy()
      }
      front.on('close', hangup)
      back.on('close', hangup)
      front.on('error', hangup)
      back.on('error', hangup)
    })
    tap.listen(0, '127.0.0.1', () => resolve((tap.address() as net.AddressInfo).port))
  })
}

// —— DNS / SOCKS5 报文拼装（demo 当浏览器：原始字节进出，与第 8 章测试同款手艺） ——

function dnsQuery(id: number, name: string): Buffer {
  const labels = name.split('.').map((l) => Buffer.from(l, 'latin1'))
  const qname = Buffer.concat(labels.flatMap((l) => [Buffer.from([l.length]), l]).concat([Buffer.from([0])]))
  const head = Buffer.alloc(12)
  head.writeUInt16BE(id, 0)
  head.writeUInt16BE(0x0100, 2) // RD=1
  head.writeUInt16BE(1, 4) // 一个问题
  const tail = Buffer.alloc(4)
  tail.writeUInt16BE(0x0001, 0) // QTYPE=A
  tail.writeUInt16BE(1, 2) // QCLASS=IN
  return Buffer.concat([head, qname, tail])
}

function answerIp(reply: Buffer): string {
  const at = reply.length - 4
  return [reply[at], reply[at + 1], reply[at + 2], reply[at + 3]].join('.')
}

function ask(dnsPort: number, query: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    sock.once('message', (b) => {
      sock.close()
      resolve(b)
    })
    sock.once('error', reject)
    sock.send(query, dnsPort, '127.0.0.1')
  })
}

function greeting(): Buffer {
  return Buffer.from([0x05, 0x01, 0x00])
}

function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([0x05, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

// —— 开机 ——

void (async () => {
  await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve))
  const probePort = (probeServer.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => siteServer.listen(0, '::', resolve)) // 双栈：还原出的 localhost 解析到哪边都接住
  const sitePort = (siteServer.address() as net.AddressInfo).port

  const fastRelay = await startRelayServer({ port: 0, password: 'pw-fast' })
  const slowRelay = await startRelayServer({ port: 0, password: 'pw-slow' })
  const fastPort = await startFastTap(fastRelay.port)
  const slowPort = await startSlowTap(slowRelay.port)

  const text = JSON.stringify(
    {
      inbound: { port: 0 },
      proxies: [
        { name: 'node-slow', host: '127.0.0.1', port: slowPort, password: 'pw-slow' },
        { name: 'node-fast', host: '127.0.0.1', port: fastPort, password: 'pw-fast' },
      ],
      groups: [
        { name: 'choose', type: 'select', proxies: ['node-fast', 'node-slow'] },
        { name: 'auto', type: 'url-test', proxies: ['node-slow', 'node-fast'], url: `http://127.0.0.1:${probePort}/generate_204` },
      ],
      rules: ['DOMAIN,localhost,choose', 'DOMAIN-SUFFIX,example.com,auto', 'IP-CIDR,127.0.0.0/8,DIRECT', 'MATCH,DIRECT'],
    },
    null,
    2,
  )

  // —— 第一幕：全部角色就位 ——
  console.log('—— 第一幕：一条命令拉起全部角色（端口每次随机） ——')
  console.log('  远端 node-slow = 带锁中继 + 压 120ms 的转发器    远端 node-fast = 带锁中继 + 透明抄录探针')
  console.log(`  测速目标 127.0.0.1:${probePort}（回 204）   目标站 localhost:${sitePort}（回固定正文）`)
  console.log('')
  const handle = await startMiniClash(text) // 配置文本进，整机出
  console.log('  配置文本：')
  console.log(text)
  console.log(`  mini-clash 已起：SOCKS5 入口 127.0.0.1:${handle.socksPort}   fake-ip DNS 127.0.0.1:${handle.dnsPort}`)
  for (const d of handle.router.decisions()) {
    if (d.type === 'select') console.log(`  组 ${d.group}（select）  此刻出: ${d.chosen}`)
    else console.log(`  组 ${d.group}（url-test） 探测 ${d.scores?.map((s) => `${s.name} ${s.delayMs}ms`).join('，')} → 此刻出: ${d.chosen}`)
  }
  console.log('')

  // —— 第二幕：整机自证（浏览器视角走完整链路） ——
  console.log('—— 第二幕：浏览器视角走完整链路 ——')
  const reply = await ask(handle.dnsPort, dnsQuery(0x0042, 'localhost'))
  const fakeIp = answerIp(reply)
  console.log(`  ① 查 DNS「localhost」→ 应答假门牌 ${fakeIp}（真名字记在 mini-clash 的账上）`)

  const verdict = handle.router.route({ host: 'localhost', port: sitePort })
  console.log(`  ② 拿假门牌连入口 → 还原回 localhost → 命中第 ${verdict.index} 行（${verdict.rule?.type}）→ 出站 ${verdict.outbound} → 节点 ${verdict.node?.name}`)

  const seenBefore = fastSeen.length
  const browser = await connect(handle.socksPort)
  browser.write(greeting())
  await readExact(browser, 2)
  browser.write(connectIPv4(fakeIp, sitePort))
  await readExact(browser, 10) // SOCKS5 CONNECT 应答：00 = 隧道已建立
  browser.write('GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
  const raw = (await readUntil(browser, SITE_BODY)).toString()
  browser.destroy()
  console.log(`  ③ GET 过整机 → 目标站收到（第 ${siteReqs} 封请求）→ 应答原路返回：`)
  console.log(`     "${raw.substring(raw.indexOf('\r\n\r\n') + 4)}"`)
  console.log(`  ④ 节点门前的抄录（${fastSeen.length - seenBefore} 字节过境）：明文 GET ${fastSeen.includes(Buffer.from('GET /')) ? '找得到?!' : '搜不到'}，域名 localhost ${fastSeen.includes(Buffer.from('localhost')) ? '找得到?!' : '搜不到'}——线上只有盐与密文块`)

  const direct = await connect(handle.socksPort)
  direct.write(greeting())
  await readExact(direct, 2)
  const seenDirect = fastSeen.length
  direct.write(connectIPv4('127.0.0.1', sitePort))
  await readExact(direct, 10)
  direct.write('GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
  await readUntil(direct, SITE_BODY)
  direct.destroy()
  console.log(`  ⑤ 对照：直接报真 IP 127.0.0.1 → 命中 IP-CIDR 行 → 直连（快桩新过境 ${fastSeen.length - seenDirect} 字节，零）`)
  console.log(`     目标站共被连 ${siteConns} 次、应答 ${siteReqs} 封——两封都送到了，走的不是同一条线`)
  console.log('')

  // —— 第三幕：亲手走链路 ——
  console.log('—— 第三幕：亲手走链路（另开一个终端，整机保持运行 60 秒） ——')
  console.log('  A. 域名交给 mini-clash（走 DOMAIN 行 → choose 组 → 加密两跳）：')
  console.log(`     curl --socks5-hostname 127.0.0.1:${handle.socksPort} http://localhost:${sitePort}/`)
  console.log('  B. 本地先解析成真 IP 再交给 mini-clash（走 IP-CIDR 行 → 直连）：')
  console.log(`     curl --socks5 127.0.0.1:${handle.socksPort} http://127.0.0.1:${sitePort}/`)
  console.log('  C. 看假电话簿（装有 dig 的机器；Windows 自带 nslookup 指定不了端口，跳过无妨——第二幕①已亲眼看过应答）：')
  console.log(`     dig @127.0.0.1 -p ${handle.dnsPort} localhost`)
  console.log(`  两条 curl 的正文都是 "${SITE_BODY}"；差别在路径：A 的名字过线走隧道，B 的名字没出本机。`)
  console.log('  （真把系统 DNS 指向 mini-clash 后，浏览器就会自动走第二幕那条假门牌链路——第 8 章的手工步骤，整机里已接线。）')
  await new Promise((resolve) => setTimeout(resolve, 60_000))
  console.log('')
  console.log('收摊。零件已成整机：一份配置文本进去，入口、DNS、规则、组、隧道按各自章节的语义同时就位。')
  await Promise.all([handle.close(), fastRelay.close(), slowRelay.close()])
  process.exit(0)
})()
