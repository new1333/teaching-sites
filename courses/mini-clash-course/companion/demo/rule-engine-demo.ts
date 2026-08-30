// companion/demo/rule-engine-demo.ts —— 亲手开机：判决台 + 入口按判决分流
// 第一幕：一张规则表对一组域名/IP 打印判决与命中的规则行——顺序就是优先级，看得见
// 第二幕：入口接上规则引擎——域名目标判直连、IP 目标判加密两跳，探针数连接作证
// 第三幕：把 MATCH 兜底行搬到最前——专线全部作废，分流整体失灵（开篇那个手滑的复现）
// 跑法：cd companion && npm run demo:rule-engine
import net from 'node:net'
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

// 规则行还原成原文：判决台打印「命中哪行」用
function showRule(r: Rule): string {
  return r.type === 'MATCH' ? 'MATCH,' + r.outbound : `${r.type},${r.value},${r.outbound}`
}

// —— 第一幕：判决台 ——

const LINES = [
  'DOMAIN,localhost,DIRECT', // 本机上的实验站点：直连
  'DOMAIN-SUFFIX,example.com,PROXY', // 这家及其子域：走加密两跳
  'DOMAIN-KEYWORD,ads,DIRECT', // 名字里带 ads 的：多半是广告，直连省一跳
  'IP-CIDR,203.0.113.0/24,DIRECT', // 文档示例网段这条「街」：直连
  'MATCH,PROXY', // 兜底：其余全部走加密两跳
]

const PROBES: Array<{ host: string; port: number }> = [
  { host: 'mail.example.com', port: 443 },
  { host: 'example.com.art', port: 443 },
  { host: 'ads.tracker.example', port: 80 },
  { host: '203.0.113.7', port: 80 },
  { host: '203.0.114.7', port: 80 },
  { host: '192.0.2.1', port: 443 },
]

// —— 开机 ——

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
  // 双栈监听：域名 localhost 无论解析到 127.0.0.1 还是 ::1，都接得住
  const tport = (target.address() as net.AddressInfo).port
  void startRelayServer({ port: 0, password: PASSWORD }).then(async (relay) => {
    // 计数探针：透明转发，数「入口 → 远端」方向来了几条连接——判决走没走第二跳，看它就知道
    let tapCount = 0
    const tap = net.createServer((front) => {
      tapCount += 1
      const back = net.connect(relay.port, '127.0.0.1')
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

    await new Promise<void>((resolve) => tap.listen(0, '127.0.0.1', resolve))
    const tapport = (tap.address() as net.AddressInfo).port

    // 入口接线：onConnect 先问规则引擎，PROXY 走加密两跳，其余照原目标直连
    const entryOf = (rules: Rule[]) =>
      startSocks5Server({
        port: 0,
        onConnect: (t) => {
          const hit = matchTarget(rules, t)
          return hit !== null && hit.rule.outbound === 'PROXY'
            ? connectViaRelay({ host: '127.0.0.1', port: tapport }, t, PASSWORD)
            : t
        },
      })

    console.log('目标站已监听（双栈）:      localhost:' + tport + '（即 127.0.0.1:' + tport + '）')
    console.log('远端中继已监听（已上锁）: 127.0.0.1:' + relay.port)
    console.log('')

    // —— 第一幕：判决台 ——
    console.log('—— 第一幕：一张规则表，一组目标，逐行判决 ——')
    const rules = parseRules(LINES)
    LINES.forEach((l, i) => console.log(`  第 ${i} 行  ${l}`))
    console.log('')
    for (const p of PROBES) {
      const hit = matchTarget(rules, p)
      if (hit === null) {
        console.log(`  ${p.host}:${p.port}  → 一行未中（表尾没兜 MATCH）`)
      } else {
        console.log(`  ${p.host}:${p.port}  → ${hit.rule.outbound.padEnd(6)} 命中第 ${hit.index} 行 ${showRule(hit.rule)}`)
      }
    }

    // —— 第二幕：入口接上规则引擎 ——
    console.log('')
    console.log('—— 第二幕：入口按判决分流——同一个目标站，两条线各走一遍 ——')
    const entry = await entryOf(rules)
    const speak = async (label: string, buf: Buffer, marker: string) => {
      const browser = await connect(entry.port)
      browser.write(Buffer.from([0x05, 0x01, 0x00])) // SOCKS5 greeting
      await readExact(browser, 2)
      const echoed = readUntil(browser, marker.toUpperCase())
      browser.write(buf) // CONNECT 目标
      browser.write(marker + '\n') // 载荷
      await echoed // 响应原路回来——两条线都该把货送到
      console.log(`  ${label}  收到回声 ${marker.toUpperCase()}（货送到了）→ 此刻远端侧连接数: ${tapCount}`)
      browser.destroy()
    }
    await speak('域名目标 localhost  ', Buffer.from([0x05, 0x01, 0x00, 0x03, 9, ...Buffer.from('localhost'), tport >> 8, tport & 0xff]), 'by-name')
    await speak('IP 目标 127.0.0.1   ', Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, tport >> 8, tport & 0xff]), 'by-ip')
    console.log('  （域名目标判直连：远端零连接；IP 目标判给兜底行走加密两跳：远端一连接。）')

    // —— 第三幕：MATCH 抢跑 ——
    console.log('')
    console.log('—— 第三幕：把 MATCH 兜底行搬到最前——开篇那个手滑的复现 ——')
    const hoisted = parseRules(['MATCH,DIRECT', ...LINES])
    const brokenEntry = await entryOf(hoisted)
    const speakHoisted = async (label: string, buf: Buffer, marker: string) => {
      const browser = await connect(brokenEntry.port)
      browser.write(Buffer.from([0x05, 0x01, 0x00]))
      await readExact(browser, 2)
      const echoed = readUntil(browser, marker.toUpperCase())
      browser.write(buf)
      browser.write(marker + '\n')
      await echoed
      console.log(`  ${label}  收到回声 ${marker.toUpperCase()} → 此刻远端侧连接数: ${tapCount}`)
      browser.destroy()
    }
    await speakHoisted('域名目标 localhost  ', Buffer.from([0x05, 0x01, 0x00, 0x03, 9, ...Buffer.from('localhost'), tport >> 8, tport & 0xff]), 'hoist-name')
    await speakHoisted('IP 目标 127.0.0.1   ', Buffer.from([0x05, 0x01, 0x00, 0x01, 127, 0, 0, 1, tport >> 8, tport & 0xff]), 'hoist-ip')
    console.log('  （兜底行抢跑：两个目标都直连——第 1～4 行专线全部作废，加密两跳一条都没走。分流整体失灵。）')
    console.log('')
    console.log('收摊。规则表此刻写在源码里；第 10 章的声明式配置会让它搬进配置文件。')
    void relay.close().then(() => process.exit(0))
  })
})
