// tests/two-hop-relay.test.ts —— 第 4 章：两跳链路（入口 → 远端中继 → 目标）的行为测试
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { connectViaRelay, startRelayServer, type RelayServerHandle } from '../src/relay'
import { startSocks5Server, type Socks5ServerHandle } from '../src/socks5'

// —— 脚手架 ——

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

type Pipe = net.Socket | Duplex // 对入口来说，能 write、能 on('data') 的就是一根管子

// 读满 n 个字节为止；超时兜底防挂死（中途多到的字节原样带回，不吞）
function readExact(socket: Pipe, n: number): Promise<Buffer> {
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
function readUntil(socket: Pipe, needle: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => done(new Error(`等待 ${JSON.stringify(needle)} 超时`)), 3000)
    let buf = Buffer.alloc(0)
    const onData = (b: Buffer) => {
      buf = Buffer.concat([buf, b])
      const i = buf.indexOf(needle)
      if (i >= 0) done(null, buf)
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

function waitClose(socket: Pipe): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待关闭超时')), 3000)
    socket.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
    socket.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

// —— 帧的手工拼装：测试自己当客户端，按第 4 章结构表手写线上字节 ——

const MAX_PAYLOAD = 0x3fff

// 数据帧：2 字节大端长度 + 载荷
function frame(payload: string): Buffer {
  const body = Buffer.from(payload, 'latin1')
  return Buffer.concat([Buffer.from([body.length >> 8, body.length & 0xff]), body])
}

// CONNECT 帧 + IPv4 目标（ATYP=01）
function connectFrameIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([0x01, ...ip, port >> 8, port & 0xff])
}

// CONNECT 帧 + 域名目标（ATYP=03）：名字原样过境，解析交给远端
function connectFrameDomain(host: string, port: number): Buffer {
  const name = Buffer.from(host, 'latin1')
  return Buffer.from([0x03, name.length, ...name, port >> 8, port & 0xff])
}

// —— 目标站桩 ——

// 大写回声 + 连接计数：connections 用来指认「目标连接发生在哪一侧」
function startEchoTarget(): Promise<{ port: number; connections: () => number }> {
  let count = 0
  const echo = net.createServer((s) => {
    count += 1
    s.on('data', (b) => s.write(b.toString('latin1').toUpperCase()))
  })
  return listen(echo).then((port) => ({ port, connections: () => count }))
}

// 行协议目标：攒到一行（\n 收尾）才回大写整行——应答次数与帧的拆分方式解耦，断言才确定
function startLineTarget(): Promise<{ port: number; connections: () => number }> {
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
  return listen(server).then((port) => ({ port, connections: () => count }))
}

// 占一个端口再关掉：得到一个确定没人监听的门牌
async function deadPort(): Promise<number> {
  const gone = net.createServer()
  const port = await listen(gone)
  await new Promise<void>((r) => gone.close(() => r()))
  return port
}

function closeRelay(r: RelayServerHandle): void {
  cleanups.push(() => void r.close())
}

function closeSocks(s: Socks5ServerHandle): void {
  cleanups.push(() => void s.close())
}

// —— SOCKS5 报文拼装（与第 3 章同款，端到端用例里测试当浏览器） ——

const VER = 0x05

function greeting(): Buffer {
  return Buffer.from([VER, 0x01, 0x00]) // 版本 5，会 1 种方法：无认证
}

function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([VER, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

// —— 本章 milestone 的行为 ——

describe('connectViaRelay + startRelayServer：帧链路', () => {
  it('CONNECT 帧请远端代连并回执 00，之后数据帧双向搬运', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)

    const link = await connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: target.port })
    cleanups.push(() => link.destroy())

    const echoed = readUntil(link, 'RELAY-ALIVE')
    link.write('relay-alive\n') // 写进去的是裸字节，装帧由转接头代劳
    expect((await echoed).toString()).toContain('RELAY-ALIVE')
    expect(target.connections()).toBe(1) // 目标连接恰好一次：本用例里除远端外没人拨它——代连发生在远端侧
  })

  it('超过一帧上限的载荷自动切块：多帧送出，对端拼回原样', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const link = await connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: target.port })
    cleanups.push(() => link.destroy())

    const marker = 'END-MARKER'
    const echoed = readUntil(link, marker)
    link.write('x'.repeat(MAX_PAYLOAD + 100) + marker.toLowerCase() + '\n') // 一段超上限的裸字节
    const out = await echoed
    expect(out.toString()).toContain(marker) // 全须全尾回来了
    expect(out.length).toBeGreaterThanOrEqual(MAX_PAYLOAD + 100 + marker.length) // 一个字节没少
  })

  it('手拼字节直连远端：CONNECT 帧、整帧、半个第二帧同包到达也各归各位', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const raw = await connect(relay.port)

    // 一次 write：CONNECT 帧 + 完整第一帧 + 第二帧的头三个字节（长度头 + 首个载荷字节）
    const two = frame('ly\n')
    raw.write(Buffer.concat([connectFrameIPv4('127.0.0.1', target.port), frame('ear'), two.subarray(0, 3)]))
    raw.write(two.subarray(3)) // 半帧的下文随后到齐

    // 应回执 00 + 恰好一帧：00 06 'EARLY\n'（行目标整行回一次话）
    const out = await readExact(raw, 1 + 2 + 'EARLY\n'.length)
    expect(out.equals(Buffer.concat([Buffer.from([0x00]), frame('EARLY\n')]))).toBe(true)
  })

  it('域名形态（ATYP=03）的 CONNECT 帧：名字原样过境，远端照连', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const raw = await connect(relay.port)

    // 教学环境里远端与入口同机：名字就写本机的回环地址串，域名分支照样走通
    const echoed = readUntil(raw, 'BY-NAME')
    raw.write(Buffer.concat([connectFrameDomain('127.0.0.1', target.port), frame('by-name\n')]))
    expect((await echoed).toString()).toContain('BY-NAME')
  })

  it('目标接不通：回执 01，connectViaRelay 以错误收场', async () => {
    const gport = await deadPort()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    await expect(
      connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: gport }),
    ).rejects.toThrow('接不通')
  })

  it('坏帧（长度头越界）：载荷还没到齐，远端就露馅收线', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const raw = await connect(relay.port)

    const status = readExact(raw, 1)
    raw.write(connectFrameIPv4('127.0.0.1', target.port))
    expect((await status)[0]).toBe(0x00) // 目标接通在先
    raw.write(Buffer.from([0x40, 0x00])) // 谎报长度 0x4000（> 上限 0x3fff）：只发长度头
    await waitClose(raw) // 不等载荷到齐，远端按先验上限收线
  })
})

describe('两跳端到端：SOCKS5 入口经钩子接入', () => {
  it('请求的目标从未被直连，实际连接发生在远端侧', async () => {
    // A：浏览器点名要去的站——若入口偷懒直连，会在这里留下连接
    const a = await startEchoTarget()
    // B：钩子实际经远端代连的站
    const b = await startLineTarget()
    const relay = await startRelayServer({ port: 0 })
    closeRelay(relay)
    const seen: Array<{ host: string; port: number }> = []
    const entry = await startSocks5Server({
      port: 0,
      onConnect: (t) => {
        seen.push(t) // 拿到的应是浏览器点名的目标（A），一字不改
        return connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: b.port })
      },
    })
    closeSocks(entry)
    const client = await connect(entry.port)

    client.write(greeting())
    await readExact(client, 2)
    const rep = readExact(client, 10)
    client.write(connectIPv4('127.0.0.1', a.port)) // 浏览器说：带我去 A
    expect((await rep)[1]).toBe(0x00) // 两跳接通：REP 成功

    const echoed = readUntil(client, 'TWO-HOP')
    client.write('two-hop\n') // 载荷穿过入口与远端两跳，落在 B
    expect((await echoed).toString()).toContain('TWO-HOP') // 应答原路返回

    expect(seen).toEqual([{ host: '127.0.0.1', port: a.port }]) // 入口拿到的是点名的目标
    expect(a.connections()).toBe(0) // A 一次也没被拨：入口没有直连
    expect(b.connections()).toBe(1) // B 恰好被拨一次：这一下发生在远端侧
  })
})
