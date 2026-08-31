// companion/demo/config-groups-demo.ts —— 亲手开机：一份 JSON 拉起端口/节点/组/规则，看组决策
// 第一幕：坏配置在加载时带路径报错——错误进不了运行时
// 第二幕：url-test 成绩单（慢/快桩同台，选中快者）+ select 组的当前选择
// 第三幕：只改配置 JSON 的一行规则，同一目标判决翻转（代码一字不动）
// 第四幕：入口接上路由器——select 切节点不改规则行，连接跟着搬家
// 跑法：cd companion && npm run demo:config-groups
import net from 'node:net'
import { createRouter, loadConfig, type ProxyNode } from '../src/config'
import { startRelayServer } from '../src/relay'
import { startSocks5Server } from '../src/socks5'

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

// —— 回环桩：测速应答器、快桩、慢桩、行协议目标站 ——

// 测速目标：收到任何字节就回一封 204 应答
const probeServer = net.createServer((s) => {
  s.on('data', () => {
    s.write('HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    s.end()
  })
})

// 计数探针：透明转发，只数来了几条连接——连接走了哪台节点，看它就知道
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
  return new Promise((resolve) => tap.listen(0, '127.0.0.1', () => resolve({ port: (tap.address() as net.AddressInfo).port, connections: () => count })))
}

// 慢桩：每批字节压 120ms 再转发——快慢差造在节点路径上，测速目标同一个
function startSlowTap(downPort: number, delayMs = 120): Promise<{ port: number; connections: () => number }> {
  let count = 0
  const tap = net.createServer((front) => {
    count += 1
    const back = net.connect(downPort, '127.0.0.1')
    const relayChunk = (from: net.Socket, to: net.Socket, b: Buffer) => {
      if (from.destroyed || to.destroyed) return
      setTimeout(() => {
        if (!from.destroyed && !to.destroyed) to.write(b) // 压 120ms 再放行：去程与回程都慢
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
  return new Promise((resolve) => tap.listen(0, '127.0.0.1', () => resolve({ port: (tap.address() as net.AddressInfo).port, connections: () => count })))
}

// 行协议目标：攒到一行（\n 收尾）才回大写整行
const echoServer = net.createServer((s) => {
  let buf = Buffer.alloc(0)
  s.on('data', (b) => {
    buf = Buffer.concat([buf, b])
    const i = buf.indexOf('\n')
    if (i < 0) return
    s.write(buf.subarray(0, i).toString('latin1').toUpperCase() + '\n')
    buf = buf.subarray(i + 1)
  })
})

// —— 开机 ——

const configText = (w: { probePort: number; fast: number; slow: number }, firstRuleOutbound: string): string =>
  JSON.stringify(
    {
      inbound: { port: 0 },
      proxies: [
        { name: 'node-slow', host: '127.0.0.1', port: w.slow, password: 'pw-slow' },
        { name: 'node-fast', host: '127.0.0.1', port: w.fast, password: 'pw-fast' },
      ],
      groups: [
        { name: 'choose', type: 'select', proxies: ['node-fast', 'node-slow'] },
        { name: 'auto', type: 'url-test', proxies: ['node-slow', 'node-fast'], url: `http://127.0.0.1:${w.probePort}/generate_204` },
      ],
      rules: [`DOMAIN-SUFFIX,example.com,${firstRuleOutbound}`, 'DOMAIN,localhost,choose', 'DOMAIN,slow.example,auto', 'IP-CIDR,203.0.113.0/24,DIRECT', 'MATCH,DIRECT'],
    },
    null,
    2,
  )

const showVerdict = (label: string, cfg: { outbound: string; node: ProxyNode | null; index: number }): string =>
  `${label} → 命中第 ${cfg.index} 行 → 出站 ${cfg.outbound}` + (cfg.node === null ? '（直连，无节点）' : ` → 此刻出节点 ${cfg.node.name}`)

void (async () => {
  await new Promise<void>((resolve) => probeServer.listen(0, '127.0.0.1', resolve))
  const probePort = (probeServer.address() as net.AddressInfo).port
  await new Promise<void>((resolve) => echoServer.listen(0, '127.0.0.1', resolve))
  const echoPort = (echoServer.address() as net.AddressInfo).port

  const fastRelay = await startRelayServer({ port: 0, password: 'pw-fast' })
  const slowRelay = await startRelayServer({ port: 0, password: 'pw-slow' })
  const fast = await startTap(fastRelay.port)
  const slow = await startSlowTap(slowRelay.port)

  console.log('回环桩已就位（端口每次随机）：')
  console.log(`  测速目标 127.0.0.1:${probePort}（回 204）   目标站 127.0.0.1:${echoPort}（回大写整行）`)
  console.log(`  快桩 node-fast = 中继 ${fastRelay.port} 前的透明探针   慢桩 node-slow = 中继 ${slowRelay.port} 前压 120ms 的转发器`)
  console.log('')

  const world = { probePort, fast: fast.port, slow: slow.port }
  const textA = configText(world, 'choose')

  // —— 第一幕：坏配置带路径报错 ——
  console.log('—— 第一幕：配置错在加载时——带路径报出，进不了运行时 ——')
  const bad = JSON.parse(textA)
  bad.groups[0].proxies.push('node-ghost') // 组员写了个不存在的节点名
  try {
    loadConfig(JSON.stringify(bad))
  } catch (e) {
    console.log(`  loadConfig 抛错：${(e as Error).message}`)
  }
  console.log('  （错的那一格由路径直指：$.groups[0].proxies[2]——不用翻代码找。）')
  console.log('')

  // —— 第二幕：组决策 ——
  console.log('—— 第二幕：createRouter 现场测速，组决策亮出来 ——')
  console.log(textA)
  const router = await createRouter(loadConfig(textA))
  const baseFast = fast.connections() // 探测本身也是走节点的真实连接：两桩此刻各 1 条
  const baseSlow = slow.connections()
  for (const d of router.decisions()) {
    if (d.type === 'select') {
      console.log(`  组 ${d.group}（select）  此刻出: ${d.chosen}（默认名单第一个，随时可切）`)
    } else {
      console.log(`  组 ${d.group}（url-test） 探测 ${d.scores?.map((s) => `${s.name} ${s.delayMs}ms`).join('，')}`)
      console.log(`  组 ${d.group}（url-test） 此刻出: ${d.chosen} ← 成绩说话，慢桩排在名单前面也选不出它`)
    }
  }
  console.log('')

  // —— 第三幕：只改一行规则 ——
  console.log('—— 第三幕：只改配置 JSON 的第 0 行（choose → DIRECT），同一目标判决翻转 ——')
  const textB = configText(world, 'DIRECT')
  const routerB = await createRouter(loadConfig(textB))
  const target = { host: 'mail.example.com', port: 443 }
  console.log('  mail.example.com:443')
  console.log(`    配置 A  ${showVerdict('判决', router.route(target))}`)
  console.log(`    配置 B  ${showVerdict('判决', routerB.route(target))}`)
  console.log('  （同一份代码、同一个目标：配置文本里改了一行，出站换了人——代码一行没动、没重编译。）')
  console.log('')

  // —— 第四幕：入口接上路由器 ——
  console.log('—— 第四幕：入口接上路由器——select 切节点，规则行不动，连接搬家 ——')
  const entryRouter = router // 复用配置 A 的路由器（同一份判决世界；幕三的配置 B 又探测过一轮，连接数从这里重起算）
  const runFast = fast.connections()
  const runSlow = slow.connections()
  const entry = await startSocks5Server({ port: 0, onConnect: entryRouter.connect })
  const speak = async (marker: string) => {
    const browser = await connect(entry.port)
    browser.write(Buffer.from([0x05, 0x01, 0x00])) // SOCKS5 greeting
    await readExact(browser, 2)
    const echoed = readUntil(browser, marker.toUpperCase())
    const name = Buffer.from('localhost', 'latin1') // 域名目标走 ATYP=3；命中 DOMAIN,localhost,choose 这行专线（远端代连它落在本机回环）
    browser.write(Buffer.from([0x05, 0x01, 0x00, 0x03, name.length, ...name, echoPort >> 8, echoPort & 0xff])) // CONNECT 域名目标
    browser.write(marker + '\n')
    await echoed
    browser.destroy()
  }
  await speak('before')
  console.log(`  第 1 次拜访 localhost → 回声 BEFORE（货送到）→ 快桩连接 ${fast.connections() - runFast}，慢桩连接 ${slow.connections() - runSlow}`)
  entryRouter.select('choose', 'node-slow')
  console.log("  router.select('choose', 'node-slow')：组内换人，规则行一字未动")
  await speak('after')
  console.log(`  第 2 次拜访同一目标 → 回声 AFTER（货送到）→ 快桩连接 ${fast.connections() - runFast}，慢桩连接 ${slow.connections() - runSlow}`)
  console.log('')
  console.log('收摊。端口、密码、节点、组、规则从此都住在配置文本里——换节点改 JSON，不改代码。')
  console.log('第 11 章总装：startMiniClash(config) 把它们串成一条命令拉起的整机。')
  void Promise.all([fastRelay.close(), slowRelay.close(), entry.close()]).then(() => process.exit(0))
})()
