// tests/aead-tunnel.test.ts —— 第 6 章：盐 + HKDF 子密钥 + 长度前缀 AEAD 块的加密两跳（行为测试）
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
// 破坏用例两件（先猜后跑的靶子）：改一个密文字节 → 对端验漆失败拒收断开；整块换序 → nonce 与位置对不上，同样拒收断开。
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { deriveSubkey, openChunk, sealChunk, SALT_LEN } from '../src/crypto'
import { connectViaRelay, startRelayServer, type RelayServerHandle } from '../src/relay'
import { startSocks5Server, type Socks5ServerHandle } from '../src/socks5'

// —— 脚手架（与第 4 章同款） ——

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

type Pipe = net.Socket | Duplex // 能 write、能 on('data') 的就是一根管子

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

// —— 第 4 章的帧拼装（密文块里装的还是这套明文帧，第 6 章只换锁不换锁里的东西） ——

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

// —— 目标站桩 ——

// 行协议目标：攒到一行（\n 收尾）才回大写整行——应答次数与块的拆分方式解耦，断言才确定
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

// —— 中间人探针：透明转发两个方向，把「入口 → 远端」方向经过的字节全部抄录下来 ——

function startTap(downstream: { port: number }): Promise<{ port: number; seen: () => Buffer }> {
  let record = Buffer.alloc(0)
  const tap = net.createServer((front) => {
    void connect(downstream.port).then((back) => {
      front.on('data', (b: Buffer) => {
        record = Buffer.concat([record, b]) // 抄录：旁观者的全部功课
        back.write(b)
      })
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
  })
  return listen(tap).then((port) => ({ port, seen: () => record }))
}

function closeRelay(r: RelayServerHandle): void {
  cleanups.push(() => void r.close())
}

function closeSocks(s: Socks5ServerHandle): void {
  cleanups.push(() => void s.close())
}

// —— SOCKS5 报文拼装（端到端用例里测试当浏览器） ——

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
const FIXED_SALT = Buffer.from('0123456789abcdef0123456789abcdef') // 32 字节定值：单元用例可复算
const TAG_LEN = 16 // GCM 火漆 16 字节——块线上形状的算尺

// —— 单元：盐 + HKDF 子密钥 ——

describe('deriveSubkey：盐 + HKDF 派生本连接的子密钥', () => {
  it('同密码同盐同钥，异盐异钥，异密码异钥，钥长 32', () => {
    const k1 = deriveSubkey(PASSWORD, FIXED_SALT)
    const k2 = deriveSubkey(PASSWORD, FIXED_SALT)
    const k3 = deriveSubkey(PASSWORD, Buffer.alloc(SALT_LEN, 0x7f)) // 换盐：新连接的形态
    const k4 = deriveSubkey('another-password', FIXED_SALT)
    expect(k1.equals(k2)).toBe(true) // 确定性：两端各算各的，算得同一把
    expect(k1.equals(k3)).toBe(false) // 盐一换钥匙就换——计数器才敢每条连接归零重启
    expect(k1.equals(k4)).toBe(false) // 钥匙认密码
    expect(k1.length).toBe(32) // AES-256 的钥匙 32 字节
  })
})

// —— 单元：长度前缀 AEAD 块 ——

describe('sealChunk / openChunk：长度前缀 AEAD 块', () => {
  it('封了拆得回；线上形状 = 加密长度 2+16 + 加密载荷 len+16，长度自己也是密文', () => {
    const key = deriveSubkey(PASSWORD, FIXED_SALT)
    const plain = Buffer.from('GET / HTTP/1.1\r\nHost: news.example\r\n\r\n')
    const sealed = sealChunk(key, 0, plain)
    expect(sealed.length).toBe(2 + TAG_LEN + plain.length + TAG_LEN) // 两段各带一条火漆
    expect(sealed.subarray(0, 2).equals(Buffer.from([plain.length >> 8, plain.length & 0xff]))).toBe(false) // 中间人照面两字节读不出长度
    expect(openChunk(key, 0, sealed).equals(plain)).toBe(true) // 持钥拆封：一字不差
  })

  it('破坏用例：改载荷密文一个字节，拆封抛错拒收；改火漆一个字节，同样抛错', () => {
    const key = deriveSubkey(PASSWORD, FIXED_SALT)
    const sealed = sealChunk(key, 0, Buffer.from('order=5&amount=100'))
    const brokenPayload = Buffer.from(sealed)
    brokenPayload[2 + TAG_LEN + 2] ^= 0xff // 翻的是密文体里的一个字节
    const brokenTag = Buffer.from(sealed)
    brokenTag[sealed.length - 1] ^= 0x01 // 翻的是火漆末字节
    expect(() => openChunk(key, 0, brokenPayload)).toThrow()
    expect(() => openChunk(key, 0, brokenTag)).toThrow()
    expect(openChunk(key, 0, sealed).toString()).toBe('order=5&amount=100') // 原样对照：照常拆开
  })

  it('破坏用例：整块换序——用错位置的计数拆封，火漆必对不上', () => {
    const key = deriveSubkey(PASSWORD, FIXED_SALT)
    const sealedFirst = sealChunk(key, 0, frame('first-block\n')) // 第 0 块
    const sealedSecond = sealChunk(key, 1, frame('second-block\n')) // 第 1 块
    // 线上把两块对调：读的人按位置数 nonce，第 0 位的计数遇上第 1 位封的块
    expect(() => openChunk(key, 0, sealedSecond)).toThrow() // nonce 对不上 → 火漆必败
    expect(() => openChunk(key, 1, sealedFirst)).toThrow() // 反方向对调同理
    expect(openChunk(key, 0, sealedFirst).equals(frame('first-block\n'))).toBe(true) // 对照：各归各位就通
    expect(openChunk(key, 1, sealedSecond).equals(frame('second-block\n'))).toBe(true)
  })
})

// —— 集成：两跳接上加密管道 ——

describe('加密两跳：relay 挂上密码', () => {
  it('SOCKS5 入口经加密两跳代连：数据双向搬运，目标连接发生在远端侧', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const entry = await startSocks5Server({
      port: 0,
      onConnect: (t) => connectViaRelay({ host: '127.0.0.1', port: relay.port }, t, PASSWORD),
    })
    closeSocks(entry)
    const client = await connect(entry.port)

    client.write(greeting())
    await readExact(client, 2)
    const rep = readExact(client, 10)
    client.write(connectIPv4('127.0.0.1', target.port))
    expect((await rep)[1]).toBe(0x00) // 加密两跳接通：REP 成功

    const echoed = readUntil(client, 'SEALED-ECHO')
    client.write('sealed-echo\n') // 载荷逐块封缄过线，落在目标
    expect((await echoed).toString()).toContain('SEALED-ECHO') // 应答原路拆封回来
    expect(target.connections()).toBe(1) // 代连仍然发生在远端侧——加锁不改路径
  })

  it('中间人视角：同一探针，明文链路抄得到载荷与目标，密文链路一个字节也抄不到', async () => {
    const target = await startLineTarget()
    const plainRelay = await startRelayServer({ port: 0 }) // 对照组：第 4 章明文链路
    closeRelay(plainRelay)
    const cipherRelay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(cipherRelay)
    const plainTap = await startTap({ port: plainRelay.port })
    const cipherTap = await startTap({ port: cipherRelay.port })

    // 两张网各走一遍同样的请求
    const plain = await connectViaRelay({ host: '127.0.0.1', port: plainTap.port }, { host: '127.0.0.1', port: target.port })
    cleanups.push(() => plain.destroy())
    const echoedPlain = readUntil(plain, 'SECRET-MARKER')
    plain.write('secret-marker\n')
    expect((await echoedPlain).toString()).toContain('SECRET-MARKER')

    const secret = await connectViaRelay({ host: '127.0.0.1', port: cipherTap.port }, { host: '127.0.0.1', port: target.port }, PASSWORD)
    cleanups.push(() => secret.destroy())
    const echoedSecret = readUntil(secret, 'SECRET-MARKER')
    secret.write('secret-marker\n')
    expect((await echoedSecret).toString()).toContain('SECRET-MARKER') // 链路照常可用

    // 探针的抄录：明文帧原样可读；密文流里既没有载荷，也没有 CONNECT 帧里的目标
    const connectBytes = connectFrameIPv4('127.0.0.1', target.port)
    const plainSeen = plainTap.seen()
    expect(plainSeen.includes(Buffer.from('secret-marker'))).toBe(true) // 明文：载荷裸奔
    expect(plainSeen.includes(connectBytes)).toBe(true) // 明文：目标域名端口裸奔
    const cipherSeen = cipherTap.seen()
    expect(cipherSeen.includes(Buffer.from('secret-marker'))).toBe(false) // 密文：载荷抓不到
    expect(cipherSeen.includes(connectBytes)).toBe(false) // 密文：目标也抓不到——「去哪儿」一并上锁
    expect(cipherSeen.length).toBeGreaterThan(SALT_LEN) // 线上不是空的：盐 + 密文块都在
  })

  it('同密码两条连接先后建立都通：新盐让每条连接的计数器安心从 0 重启', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)

    for (let i = 0; i < 2; i++) {
      const link = await connectViaRelay({ host: '127.0.0.1', port: relay.port }, { host: '127.0.0.1', port: target.port }, PASSWORD)
      cleanups.push(() => link.destroy())
      const echoed = readUntil(link, 'RESTART-OK')
      link.write('restart-ok\n') // 第二条连接的第 0 块同样用计数 0——盐换了钥匙，撞不了车
      expect((await echoed).toString()).toContain('RESTART-OK')
    }
    expect(target.connections()).toBe(2) // 两条连接各自代连一次
  })

  it('手拼密文直连远端：改一个密文字节，远端验漆失败、拒收断开', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const raw = await connect(relay.port)

    // 第一步：先证明链路本来就是通的——发 盐 + 第 0 块（CONNECT 帧），读回远端的 盐 + 封着的回执块
    const key = deriveSubkey(PASSWORD, FIXED_SALT)
    raw.write(Buffer.concat([FIXED_SALT, sealChunk(key, 0, connectFrameIPv4('127.0.0.1', target.port))]))
    const head = await readExact(raw, SALT_LEN + 2 + TAG_LEN + 1 + TAG_LEN) // 远端侧：盐 + 回执块（载荷 1 字节）
    const serverKey = deriveSubkey(PASSWORD, head.subarray(0, SALT_LEN)) // 回执方向另有自己的盐
    expect(openChunk(serverKey, 0, head.subarray(SALT_LEN)).equals(Buffer.from([0x00]))).toBe(true) // 回执 00：代连成功
    expect(target.connections()).toBe(1)

    // 第二步：中间人翻密文体一个字节，发了下去
    const broken = Buffer.from(sealChunk(key, 1, frame('tampered\n')))
    broken[2 + TAG_LEN + 3] ^= 0xff
    raw.write(broken)
    await waitClose(raw) // 先猜后跑的靶子：远端拆到坏块即收线，连接不会活下去
  })

  it('手拼密文直连远端：整块换序，nonce 与位置对不上，远端同样拒收断开', async () => {
    const target = await startLineTarget()
    const relay = await startRelayServer({ port: 0, password: PASSWORD })
    closeRelay(relay)
    const raw = await connect(relay.port)

    // 第一步：同样先证明链路是通的（回执 00 到手，代连已发生）
    const key = deriveSubkey(PASSWORD, FIXED_SALT)
    raw.write(Buffer.concat([FIXED_SALT, sealChunk(key, 0, connectFrameIPv4('127.0.0.1', target.port))]))
    const head = await readExact(raw, SALT_LEN + 2 + TAG_LEN + 1 + TAG_LEN)
    const serverKey = deriveSubkey(PASSWORD, head.subarray(0, SALT_LEN))
    expect(openChunk(serverKey, 0, head.subarray(SALT_LEN)).equals(Buffer.from([0x00]))).toBe(true)

    // 第二步：把第 2 块抢到第 1 块前面发——中间人不需要读懂内容，只需调包顺序
    raw.write(
      Buffer.concat([
        sealChunk(key, 2, frame('third-block\n')), // 第 2 位的块抢在
        sealChunk(key, 1, frame('second-block\n')), // 第 1 位的块前面到达
      ]),
    )
    await waitClose(raw) // 读端按位置数 nonce：第 1 位遇上第 2 位封的火漆，必败即断
  })
})
