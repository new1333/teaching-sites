// tests/http-proxy.test.ts —— 第 2 章：HTTP 正向代理的行为测试
// 纪律：127.0.0.1 回环 + listen(0) 临时端口；事件驱动等待；不碰外网；只断言行为。
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { startHttpProxy, type HttpProxyHandle, type ProxyTarget } from '../src/http-proxy'

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

// 给事件循环几拍，让「应当没有发生的事」有机会暴露
function settle(): Promise<void> {
  return new Promise((r) => setImmediate(() => setImmediate(() => setTimeout(r, 5))))
}

// 最小目标站：攒到一条完整请求（头 + Content-Length 报的正文）就记录并回固定应答
async function startHttpTarget(reply: string): Promise<{ port: number; seen: Buffer[] }> {
  const seen: Buffer[] = []
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0)
    socket.on('data', (b) => {
      buf = Buffer.concat([buf, b])
      const headEnd = buf.indexOf('\r\n\r\n')
      if (headEnd < 0) return
      const head = buf.subarray(0, headEnd).toString()
      const len = Number(/^content-length:\s*(\d+)/im.exec(head)?.[1] ?? 0)
      if (buf.length < headEnd + 4 + len) return
      seen.push(buf.subarray(0, headEnd + 4 + len))
      socket.end(reply)
    })
  })
  const port = await listen(server)
  return { port, seen }
}

function closeProxy(p: HttpProxyHandle): void {
  cleanups.push(() => void p.close())
}

// —— 本章 milestone 的行为 ——

describe('startHttpProxy：明文 HTTP', () => {
  it('识别 absolute-form：请求行改写成路径形式转发，Host 按目标重建，响应原路回流', async () => {
    const target = await startHttpTarget('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello')
    const proxy = await startHttpProxy({ port: 0 })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    const response = readUntil(client, 'hello')
    // 浏览器走代理时的说法：请求行里是完整 URL（absolute-form）
    client.write(`GET http://127.0.0.1:${target.port}/hello?x=1 HTTP/1.1\r\nHost: wrong.example\r\n\r\n`)

    expect((await response).toString()).toContain('hello')
    const req = target.seen[0].toString()
    expect(req.split('\r\n')[0]).toBe('GET /hello?x=1 HTTP/1.1') // 改写：URL 换成路径
    expect(req).toContain(`Host: 127.0.0.1:${target.port}`) // 重建：Host 来自请求行目标
    expect(req).not.toContain('wrong.example') // 不照抄收到的 Host
  })

  it('正文边界：按 Content-Length 攒齐才转发——少一个字节都不动身', async () => {
    const target = await startHttpTarget('HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nok!')
    const seen: ProxyTarget[] = []
    const proxy = await startHttpProxy({
      port: 0,
      connectTarget: (t) => {
        seen.push(t) // 转发开始的信号：钩子被问过了
        return t
      },
    })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    client.write(`POST http://127.0.0.1:${target.port}/echo HTTP/1.1\r\nHost: 127.0.0.1:${target.port}\r\nContent-Length: 10\r\n\r\n`)
    client.write('123456789') // 正文先到 9 个字节
    await settle()
    expect(seen).toHaveLength(0) // 没攒齐：连目标都还没去连

    const response = readUntil(client, 'ok!')
    client.write('0') // 第 10 个字节到齐
    expect((await response).toString()).toContain('ok!')
    expect(target.seen[0].toString().endsWith('1234567890')).toBe(true) // 正文一字节不丢
  })

  it('connectTarget 钩子：把「想去哪」翻译成「实际连谁」——分流决策的生长点', async () => {
    const real = await startHttpTarget('HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nreal')
    const proxy = await startHttpProxy({
      port: 0,
      connectTarget: async () => ({ host: '127.0.0.1', port: real.port }), // 异步钩子同样支持
    })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    const response = readUntil(client, 'real')
    client.write(`GET http://127.0.0.1:9/x HTTP/1.1\r\nHost: 127.0.0.1:9\r\n\r\n`)

    expect((await response).toString()).toContain('real') // 请求行里的目标根本不存在，实际落在钩子改写的目标上
    expect(real.seen[0].toString().split('\r\n')[0]).toBe('GET /x HTTP/1.1')
  })
})

describe('startHttpProxy：CONNECT 隧道', () => {
  it('应答 200 后成为隧道：两个方向都只搬字节，一个都不改', async () => {
    // 目标是个「大写回声」：改写只发生在目标——客户端收到大写，证明字节穿过代理时没动过
    const echo = net.createServer((s) => s.on('data', (b) => s.write(b.toString('latin1').toUpperCase())))
    const tport = await listen(echo)
    const proxy = await startHttpProxy({ port: 0 })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    const greeting = readUntil(client, '\r\n\r\n')
    client.write(`CONNECT 127.0.0.1:${tport} HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\n\r\n`)
    expect((await greeting).toString().startsWith('HTTP/1.1 200')).toBe(true)

    const echoed = readUntil(client, 'TUNNEL-PING')
    client.write('tunnel-ping') // 应答之后写的任何字节都进隧道
    expect((await echoed).toString()).toContain('TUNNEL-PING')
  })

  it('握手与首批隧道字节同包到达（early data）也不丢', async () => {
    const echo = net.createServer((s) => s.on('data', (b) => s.write(b.toString('latin1').toUpperCase())))
    const tport = await listen(echo)
    const proxy = await startHttpProxy({ port: 0 })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    // 一次 write 把 CONNECT 头和隧道字节一起发出去——现实里 TLS ClientHello 常这么挤在同一包
    const echoed = readUntil(client, 'EARLY-DATA')
    client.write(`CONNECT 127.0.0.1:${tport} HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\n\r\nearly-data`)
    const out = (await echoed).toString()
    expect(out).toContain('HTTP/1.1 200') // 先收到开通应答
    expect(out).toContain('EARLY-DATA') // 紧跟的字节也进了隧道并原样折返（大写化）
  })

  it('目标连不上：回 502，不开隧道', async () => {
    // 占一个端口再关掉：得到一个确定没人监听的门牌
    const gone = net.createServer()
    const gport = await listen(gone)
    await new Promise<void>((r) => gone.close(() => r()))
    const proxy = await startHttpProxy({ port: 0 })
    closeProxy(proxy)
    const client = await connect(proxy.port)

    const resp = readUntil(client, '\r\n\r\n')
    client.write(`CONNECT 127.0.0.1:${gport} HTTP/1.1\r\nHost: 127.0.0.1:${gport}\r\n\r\n`)
    expect((await resp).toString().startsWith('HTTP/1.1 502')).toBe(true)
  })
})
