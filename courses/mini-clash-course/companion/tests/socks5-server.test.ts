// tests/socks5-server.test.ts —— 第 3 章：SOCKS5 服务端的行为测试
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
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

// 读满 n 个字节为止；超时兜底防挂死（中途多到的字节原样带回，不吞）
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

function waitClose(socket: net.Socket): Promise<void> {
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

// 给事件循环几拍，让「应当没有发生的事」有机会暴露
function settle(): Promise<void> {
  return new Promise((r) => setImmediate(() => setImmediate(() => setTimeout(r, 5))))
}

function closeServer(s: Socks5ServerHandle): void {
  cleanups.push(() => void s.close())
}

// —— SOCKS5 报文的手工拼装：测试自己当客户端，按 RFC 1928 的字节布局发话 ——

const VER = 0x05

// 握手：版本 5 + 方法个数 + 方法编号列表（0 = 无认证）
function greeting(...methods: number[]): Buffer {
  return Buffer.from([VER, methods.length, ...methods])
}

// CONNECT + IPv4 目标：地址段就是四个数字各占一字节，端口按大端序拆两字节
function connectIPv4(host: string, port: number): Buffer {
  const ip = host.split('.').map(Number)
  return Buffer.from([VER, 0x01, 0x00, 0x01, ...ip, port >> 8, port & 0xff])
}

// CONNECT + 域名目标：1 字节长度 + 域名原文，没有结尾符
function connectDomain(host: string, port: number): Buffer {
  const name = Buffer.from(host, 'latin1')
  return Buffer.from([VER, 0x01, 0x00, 0x03, name.length, ...name, port >> 8, port & 0xff])
}

// 「大写回声」目标站：客户端经中继送来的字节折返时变成大写——大写证明字节真的穿过入口走了一圈
function startEchoTarget(): Promise<{ port: number }> {
  return new Promise((resolve) => {
    const echo = net.createServer((s) => s.on('data', (b) => s.write(b.toString('latin1').toUpperCase())))
    void listen(echo).then((port) => resolve({ port }))
  })
}

// —— 本章 milestone 的行为 ——

describe('startSocks5Server：握手与 CONNECT', () => {
  it('greeting → 选定无认证 → CONNECT（IPv4）→ 成功应答十个字节一字不差 → 双向中继', async () => {
    const { port: tport } = await startEchoTarget()
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    const method = readExact(client, 2)
    client.write(greeting(0x00)) // 版本 5，我只会一种方法：无认证
    expect((await method).equals(Buffer.from([VER, 0x00]))).toBe(true) // 服务端选了无认证

    const rep = readExact(client, 10)
    client.write(connectIPv4('127.0.0.1', tport))
    // 成功应答：VER REP=00 RSV ATYP=IPv4 + BND.ADDR 0.0.0.0 + BND.PORT 0
    expect((await rep).equals(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))).toBe(true)

    const echoed = readUntil(client, 'RELAY-ALIVE')
    client.write('relay-alive') // 应答之后写的字节全部进中继
    expect((await echoed).toString()).toContain('RELAY-ALIVE') // 穿过入口、折返成大写
  })

  it('ATYP=3 域名：长度字节带出域名原文，钩子拿到「想去哪」，实际连钩子改写的目标', async () => {
    const { port: tport } = await startEchoTarget()
    const seen: Array<{ host: string; port: number }> = []
    const server = await startSocks5Server({
      port: 0,
      onConnect: (t) => {
        seen.push(t) // 拿到的应是域名原文，不是解析后的 IP
        return { host: '127.0.0.1', port: tport } // 教学桩：不管想去哪，都改连回声站
      },
    })
    closeServer(server)
    const client = await connect(server.port)

    client.write(greeting(0x00))
    await readExact(client, 2)
    const rep = readExact(client, 10)
    client.write(connectDomain('mini.example', 80))
    expect((await rep)[1]).toBe(0x00) // 成功——实际落在钩子改写的目标上

    const echoed = readUntil(client, 'BY-DOMAIN')
    client.write('by-domain')
    expect((await echoed).toString()).toContain('BY-DOMAIN')
    expect(seen).toEqual([{ host: 'mini.example', port: 80 }]) // 域名原样到达钩子
  })
})

describe('startSocks5Server：字节流没有边界', () => {
  it('握手、CONNECT、首批载荷挤在同一次 write 里，也各归各位、一个不丢', async () => {
    const { port: tport } = await startEchoTarget()
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    // TCP 不保证按「消息」到：三段挤一包是最常见的真实长相
    const echoed = readUntil(client, 'EARLY')
    client.write(Buffer.concat([greeting(0x00), connectIPv4('127.0.0.1', tport), Buffer.from('early')]))

    const out = await echoed
    expect(out.subarray(0, 12).equals(Buffer.from([0x05, 0x00, 0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))).toBe(true) // 先握手应答、再成功应答
    expect(out.toString().endsWith('EARLY')).toBe(true) // 载荷经中继折返成大写
  })

  it('半个请求：连域名长度那一格都没到——按兵不动，下文到了再接着走', async () => {
    const { port: tport } = await startEchoTarget()
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    client.write(greeting(0x00))
    await readExact(client, 2) // 先收下握手应答

    const idle: Buffer[] = []
    client.on('data', (b) => idle.push(b)) // 侦查：半截请求期间不应有任何新字节
    client.write(connectDomain('127.0.0.1', tport).subarray(0, 4)) // VER CMD RSV ATYP——到此为止
    await settle()
    expect(idle).toHaveLength(0) // 服务器在等下文，没有话可回

    const echoed = readUntil(client, 'LATE')
    client.write(Buffer.concat([connectDomain('127.0.0.1', tport).subarray(4), Buffer.from('late')]))
    expect((await echoed).toString()).toContain('LATE') // 下文到齐：照常接通、照常中继
  })
})

describe('startSocks5Server：回话与收线', () => {
  it('谈不拢的方法：应答 FF（没有可接受的方法）后收线', async () => {
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    const resp = readExact(client, 2)
    client.write(greeting(0x01, 0x02)) // GSSAPI 与用户名密码：都不支持
    expect((await resp).equals(Buffer.from([VER, 0xff]))).toBe(true)
    await waitClose(client)
  })

  it('目标连不上：应答 REP=01（一般性失败），不开中继', async () => {
    // 占一个端口再关掉：得到一个确定没人监听的门牌
    const gone = net.createServer()
    const gport = await listen(gone)
    await new Promise<void>((r) => gone.close(() => r()))
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    client.write(greeting(0x00))
    await readExact(client, 2)
    const rep = readExact(client, 10)
    client.write(connectIPv4('127.0.0.1', gport))
    const buf = await rep
    expect(buf[0]).toBe(VER)
    expect(buf[1]).toBe(0x01) // REP=01：一般性失败
    await waitClose(client)
  })

  it('只做 CONNECT：BIND 命令应答 REP=07（命令不支持）', async () => {
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    client.write(greeting(0x00))
    await readExact(client, 2)
    const rep = readExact(client, 10)
    client.write(Buffer.from([VER, 0x02, 0x00, 0x01, 127, 0, 0, 1, 0x1f, 0x90])) // CMD=02 BIND，目标 127.0.0.1:8080
    expect((await rep)[1]).toBe(0x07)
    await waitClose(client)
  })

  it('版本号不是 5：一字不回，直接收线', async () => {
    const server = await startSocks5Server({ port: 0 })
    closeServer(server)
    const client = await connect(server.port)

    const idle: Buffer[] = []
    client.on('data', (b) => idle.push(b))
    client.write(Buffer.from([0x04, 0x01, 0x00])) // SOCKS4 的开场白：不是本协议的话
    await waitClose(client)
    expect(idle).toHaveLength(0)
  })
})
