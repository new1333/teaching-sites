// tests/config-groups.test.ts —— 第 10 章：声明式配置与代理组（loadConfig 带路径校验 + createRouter 组策略）
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
// 里程碑的两块可感知面都在这：只改配置 JSON 的规则行 → 分流判决翻转（代码一字不动）；url-test 在慢/快桩之间选中快者。
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { createRouter, loadConfig } from '../src/config'
import { startRelayServer, type RelayServerHandle } from '../src/relay'
import { startSocks5Server, type Socks5ServerHandle } from '../src/socks5'

// —— 脚手架（与第 4、6、7 章同款） ——

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn()
})

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    cleanups.push(() => server.close())
    server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
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

// —— 本章的回环桩：测速应答器、快桩、慢桩 ——

// 测速目标：收到任何字节就回一封 204 应答——url-test 掐表掐到它的首字节
function startProbeTarget(): Promise<number> {
  const server = net.createServer((s) => {
    s.on('data', () => {
      s.write('HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
      s.end()
    })
  })
  return listen(server)
}

// 计数探针：透明转发，只数来了几条连接（第 7 章同款）——判决走了哪台节点，看它就知道
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

// 慢桩：在节点（中继）前面立一台「每批字节都压 120ms 再转发」的转发器——快慢差在节点路径上，测速目标同一个
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
  return listen(tap).then((port) => ({ port, connections: () => count }))
}

// 一套完整世界：测速目标 + 快/慢两台节点（各自带锁的中继，密码不同——路由器拿错密码这条线就哑）
async function startWorld(): Promise<{
  probePort: number
  fast: { port: number; connections: () => number }
  slow: { port: number; connections: () => number }
}> {
  const probePort = await startProbeTarget()
  const fastRelay = await startRelayServer({ port: 0, password: 'pw-fast' })
  cleanups.push(() => void fastRelay.close())
  const slowRelay = await startRelayServer({ port: 0, password: 'pw-slow' })
  cleanups.push(() => void slowRelay.close())
  const fast = await startTap(fastRelay.port)
  const slow = await startSlowTap(slowRelay.port)
  return { probePort, fast, slow }
}

// 配置文本：两节点、select 组 choose、url-test 组 auto——端口由桩决定，文本当场拼
function configText(w: { probePort: number; fast: { port: number }; slow: { port: number } }, rules: string[]): string {
  return JSON.stringify(
    {
      inbound: { port: 0 },
      proxies: [
        { name: 'node-slow', host: '127.0.0.1', port: w.slow.port, password: 'pw-slow' },
        { name: 'node-fast', host: '127.0.0.1', port: w.fast.port, password: 'pw-fast' },
      ],
      groups: [
        { name: 'choose', type: 'select', proxies: ['node-fast', 'node-slow'] },
        { name: 'auto', type: 'url-test', proxies: ['node-slow', 'node-fast'], url: `http://127.0.0.1:${w.probePort}/generate_204` },
      ],
      rules,
    },
    null,
    2,
  )
}

const RULES = ['DOMAIN-SUFFIX,example.com,choose', 'DOMAIN,slow.example,auto', 'IP-CIDR,203.0.113.0/24,DIRECT', 'MATCH,DIRECT']

// —— 单元：loadConfig ——

describe('loadConfig：JSON 文本 → 结构化配置', () => {
  it('端口、节点、组、规则行各就各位——组名成了合法出站', () => {
    // 端口随手写的假地址也能解析：加载不碰网，错误全部拦在加载时
    const cfg = loadConfig(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, RULES))
    expect(cfg.inbound.port).toBe(0)
    expect(cfg.proxies).toEqual([
      { name: 'node-slow', host: '127.0.0.1', port: 9102, password: 'pw-slow' },
      { name: 'node-fast', host: '127.0.0.1', port: 9101, password: 'pw-fast' },
    ])
    expect(cfg.groups.map((g) => [g.name, g.type])).toEqual([
      ['choose', 'select'],
      ['auto', 'url-test'],
    ])
    expect(cfg.rules[0]).toEqual({ type: 'DOMAIN-SUFFIX', value: 'example.com', outbound: 'choose' }) // 第 7 章只认 DIRECT/PROXY 的那一格，从此写组名
    expect(cfg.rules[3]).toEqual({ type: 'MATCH', outbound: 'DIRECT' })
  })

  it('坏 JSON 与坏字段都带路径报出：错在加载时，不留给每条连接去撞', () => {
    expect(() => loadConfig('{oops')).toThrow(/JSON/) // JSON 本身看不懂
    expect(() => loadConfig('[]')).toThrow(/\$/) // 根上就该是对象
    expect(() => loadConfig('{}')).toThrow(/\$\.inbound/) // 缺 inbound 段
    const noPort = JSON.parse(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, RULES))
    delete noPort.inbound
    expect(() => loadConfig(JSON.stringify({ ...noPort, inbound: {} }))).toThrow(/\$\.inbound\.port/) // 缺端口
    const bad = JSON.parse(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, RULES))
    bad.proxies[1].port = '80x'
    expect(() => loadConfig(JSON.stringify(bad))).toThrow(/\$\.proxies\[1\]\.port/) // 端口不是整数
  })

  it('名册类错误带路径报出：重名、保留名、组员不在册、url-test 缺测速 URL、规则出站不认识', () => {
    const base = JSON.parse(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, RULES))
    const dupe = JSON.parse(JSON.stringify(base))
    dupe.proxies[1].name = 'node-slow' // 两个同名节点：出站名字撞了
    expect(() => loadConfig(JSON.stringify(dupe))).toThrow(/撞了/)
    const reserved = JSON.parse(JSON.stringify(base))
    reserved.proxies[0].name = 'DIRECT' // DIRECT 是保留出站名，不能当节点名
    expect(() => loadConfig(JSON.stringify(reserved))).toThrow(/\$\.proxies\[0\]\.name/)
    const ghost = JSON.parse(JSON.stringify(base))
    ghost.groups[0].proxies.push('node-ghost') // 组员不在节点名册
    expect(() => loadConfig(JSON.stringify(ghost))).toThrow(/\$\.groups\[0\]\.proxies\[2\].*node-ghost/)
    const noUrl = JSON.parse(JSON.stringify(base))
    delete noUrl.groups[1].url // url-test 组缺测速 URL
    expect(() => loadConfig(JSON.stringify(noUrl))).toThrow(/\$\.groups\[1\]\.url/)
    expect(() => loadConfig(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, ['DOMAIN,a.example,MY-NODE', 'MATCH,DIRECT']))).toThrow(
      /\$\.rules.*MY-NODE/, // 规则出站不在名册
    )
    expect(() => loadConfig(configText({ probePort: 9100, fast: { port: 9101 }, slow: { port: 9102 } }, ['DOMAIN,a.example,PROXY', 'MATCH,DIRECT']))).toThrow(
      /PROXY.*旧出站|旧出站.*PROXY/, // 「PROXY」是单远端时代的名字，配置里请直呼组名/节点名
    )
  })
})

// —— 单元：组策略 ——

describe('select 组：默认第一个，切换即换节点', () => {
  it('默认出名单第一个；select() 切换后出另一个；节点名也能直接当出站；表尾没兜 MATCH 落空按 DIRECT 收场', async () => {
    const text = JSON.stringify({
      inbound: { port: 0 },
      proxies: [
        { name: 'node-fast', host: '127.0.0.1', port: 9101, password: 'pw-fast' },
        { name: 'node-slow', host: '127.0.0.1', port: 9102, password: 'pw-slow' },
      ],
      groups: [{ name: 'choose', type: 'select', proxies: ['node-fast', 'node-slow'] }],
      rules: ['DOMAIN-SUFFIX,example.com,choose', 'DOMAIN,slow.example,node-slow'],
    })
    const router = await createRouter(loadConfig(text))
    const verdict = router.route({ host: 'mail.example.com', port: 443 })
    expect(verdict.outbound).toBe('choose')
    expect(verdict.node?.name).toBe('node-fast') // select 默认出名单第一个
    expect(verdict.rule?.type).toBe('DOMAIN-SUFFIX')
    expect(verdict.index).toBe(0)
    router.select('choose', 'node-slow') // 手动切换：规则行一字不动
    expect(router.route({ host: 'mail.example.com', port: 443 }).node?.name).toBe('node-slow')
    expect(() => router.select('choose', 'node-ghost')).toThrow(/node-ghost/) // 切到不在名单的名字：拒绝
    const direct = router.route({ host: 'slow.example', port: 443 })
    expect(direct.outbound).toBe('node-slow') // 节点名直接当出站：不经过组，直呼其名
    expect(direct.node?.name).toBe('node-slow')
    const miss = router.route({ host: 'nowhere.example', port: 443 }) // 表尾没兜 MATCH：落空
    expect(miss.outbound).toBe('DIRECT')
    expect(miss.rule).toBeNull()
    expect(miss.index).toBe(-1)
  })
})

describe('url-test 组：成绩说话，慢桩在前也选不出它', () => {
  it('createRouter 现场探测：慢/快桩成绩入账，选中快者；测速组不收手动切换', async () => {
    const world = await startWorld()
    const router = await createRouter(loadConfig(configText(world, RULES)))
    const auto = router.decisions().find((g) => g.group === 'auto')
    expect(auto?.type).toBe('url-test')
    expect(auto?.chosen).toBe('node-fast') // 名单里慢桩在前——并列时先来后到，但这里不并列：成绩说话
    const scores = new Map(auto?.scores?.map((s) => [s.name, s.delayMs]))
    expect(scores.get('node-fast')!).toBeLessThan(100) // 快桩：本机直来直回
    expect(scores.get('node-slow')!).toBeGreaterThan(120) // 慢桩：每批字节压了 120ms
    expect(scores.get('node-slow')! - scores.get('node-fast')!).toBeGreaterThan(50) // 差距是量出来的，不是猜的
    expect(() => router.select('auto', 'node-fast')).toThrow(/url-test/) // 谁快谁上，不收手动指定
    const choose = router.decisions().find((g) => g.group === 'choose')
    expect(choose).toEqual({ group: 'choose', type: 'select', chosen: 'node-fast' }) // select 组没有成绩单，只有当前选择
  })
})

describe('只改配置 JSON 的规则行，判决就翻转——代码一字不动', () => {
  it('同一目标：第 0 行出站 choose → 判给组；改成 DIRECT → 直连', async () => {
    const world = await startWorld()
    const target = { host: 'mail.example.com', port: 443 }
    const toChoose = await createRouter(loadConfig(configText(world, ['DOMAIN-SUFFIX,example.com,choose', 'MATCH,DIRECT'])))
    const toDirect = await createRouter(loadConfig(configText(world, ['DOMAIN-SUFFIX,example.com,DIRECT', 'MATCH,DIRECT'])))
    const a = toChoose.route(target)
    const b = toDirect.route(target)
    expect(a.outbound).toBe('choose')
    expect(a.node?.name).toBe('node-fast')
    expect(b.outbound).toBe('DIRECT')
    expect(b.node).toBeNull() // 同一份代码、同一个目标：配置文本里改了一行，出站换了人
  })
})

// —— 集成：入口接上路由器 ——

describe('入口接上 createRouter：select 切节点，规则行不动，连接跟着搬家', () => {
  it('同一规则表两次拜访：连接先到快桩、select 切换后到慢桩，两次都把货送到', async () => {
    const world = await startWorld()
    // 行协议目标：攒到一行才回大写整行（与第 7 章同款）
    let echoCount = 0
    const echoServer = net.createServer((s) => {
      let buf = Buffer.alloc(0)
      s.on('data', (b: Buffer) => {
        buf = Buffer.concat([buf, b])
        const i = buf.indexOf('\n')
        if (i < 0) return
        s.write(buf.subarray(0, i).toString('latin1').toUpperCase() + '\n')
        buf = buf.subarray(i + 1)
      })
    })
    const echoPort = await listen(echoServer)
    const router = await createRouter(loadConfig(configText(world, ['DOMAIN,localhost,choose', 'MATCH,DIRECT'])))
    // url-test 组建组时已各自探测过一轮：两台节点的连接计数都从 1 起——探测本身也是走节点的真实连接
    const baseFast = world.fast.connections()
    const baseSlow = world.slow.connections()
    expect(baseFast).toBe(1)
    expect(baseSlow).toBe(1)
    const entry = await startSocks5Server({ port: 0, onConnect: router.connect }) // 钩子直接交给路由器：判决、选节点、建线一气呵成
    cleanups.push(() => void entry.close())

    const speak = async (marker: string) => {
      const browser = await connect(entry.port)
      browser.write(Buffer.from([0x05, 0x01, 0x00]))
      await readExact(browser, 2)
      const echoed = readUntil(browser, marker.toUpperCase())
      const name = Buffer.from('localhost', 'latin1') // 域名目标走 ATYP=3；远端代连它落在本机回环（与第 7 章集成用例同款）
      browser.write(Buffer.from([0x05, 0x01, 0x00, 0x03, name.length, ...name, echoPort >> 8, echoPort & 0xff]))
      browser.write(marker + '\n')
      expect((await echoed).toString()).toContain(marker.toUpperCase()) // 走哪台节点都得把货送到
      browser.destroy()
      echoCount += 1
    }

    await speak('before-switch') // choose 默认 node-fast：连接到快桩
    expect(world.fast.connections()).toBe(baseFast + 1)
    expect(world.slow.connections()).toBe(baseSlow)

    router.select('choose', 'node-slow') // 切组不切规则：第 0 行还是 choose，出的节点换了人
    await speak('after-switch')
    expect(world.fast.connections()).toBe(baseFast + 1)
    expect(world.slow.connections()).toBe(baseSlow + 1) // 这次连接到了慢桩——组内选谁由策略定，规则行纹丝没动
    expect(echoCount).toBe(2)
  })
})
