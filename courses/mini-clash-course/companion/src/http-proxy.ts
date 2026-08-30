// src/http-proxy.ts —— HTTP 正向代理：明文请求改写转发 + CONNECT 隧道
import net from 'node:net'
import { connectTo } from './dial'

export interface ProxyTarget {
  host: string
  port: number
}

// 「客户端想去哪」→「实际连谁」的翻译钩子。缺省直连目标；
// 规则引擎接管分流时，在这里按目标判决改写出口。
export type ConnectTargetHook = (requested: ProxyTarget) => ProxyTarget | Promise<ProxyTarget>

export interface HttpProxyOptions {
  port: number // 0 = 请系统随手分一个空闲端口
  host?: string
  connectTarget?: ConnectTargetHook
}

export interface HttpProxyHandle {
  port: number
  close(): Promise<void>
}

const HEAD_END = '\r\n\r\n' // 头部的终点线：一个空行

interface RequestHead {
  method: string
  target: string // 请求行第二格：明文请求是完整 URL 或路径，CONNECT 是 host:port
  headers: string[] // 头部行原样保留
  bodyLength: number // Content-Length 报的字节数；没有正文就是 0
}

// 头部是文本协议，允许按 \r\n 拆行（二进制协议没有这个便宜）
function parseRequestHead(headText: string): RequestHead | null {
  const lines = headText.split('\r\n')
  const parts = lines[0].split(' ')
  if (parts.length !== 3 || !parts.every(Boolean)) return null
  let bodyLength = 0
  for (const line of lines.slice(1)) {
    const m = /^content-length:\s*(\d+)\s*$/i.exec(line)
    if (m) bodyLength = Number(m[1])
  }
  return { method: parts[0], target: parts[1], headers: lines.slice(1), bodyLength }
}

// absolute-form（GET http://host:port/path?x=1 HTTP/1.1）拆成：
// authority——去哪（host[:port]）；path——要什么（路径 + 查询串）
function splitAbsoluteForm(target: string): { authority: string; path: string } | null {
  const m = /^http:\/\/([^/?#]+)([^#\s]*)$/.exec(target)
  if (!m) return null
  return { authority: m[1], path: m[2] === '' ? '/' : m[2] }
}

// host[:port] → { host, port }。不写端口时，http 的默认房间号是 80
// （CONNECT 除外：RFC 9110 规定它必须写明端口，openTunnel 里另查）
function parseAuthority(authority: string): ProxyTarget {
  const i = authority.lastIndexOf(':')
  if (i < 0) return { host: authority, port: 80 }
  const port = Number(authority.slice(i + 1))
  return Number.isInteger(port) && port > 0 ? { host: authority.slice(0, i), port } : { host: authority, port: 80 }
}

export function startHttpProxy(opts: HttpProxyOptions): Promise<HttpProxyHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      handleClient(client, opts.connectTarget)
    })
    server.once('error', reject)
    server.listen(opts.port, opts.host ?? '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const s of sockets) s.destroy() // 先拆连接，close 才不必等它们自然结束
          return new Promise((res) => server.close(() => res()))
        },
      })
    })
  })
}

// 一条客户端连接的一生：攒字节 → 认头部 → （攒正文 → 转发）循环，或 CONNECT 后转纯搬运
function handleClient(client: net.Socket, hook?: ConnectTargetHook): void {
  let buffered = Buffer.alloc(0) // 还没消费的字节：TCP 只给字节流，到没到齐只能自己攒、自己判
  let upstream: net.Socket | null = null // 本连接对着的「上一程」目标
  let pending: RequestHead | null = null // 头已读全、正文没攒齐的那条请求
  let busy = false // 异步步骤进行中：新字节先攒着，结束后重跑 pump
  let tunnel = false // CONNECT 应答之后：只剩搬运，不再解读

  const fail = (msg: string) => {
    console.error(`[http-proxy] ${msg}`)
    client.destroy()
    upstream?.destroy()
  }

  // 上游的响应不解读、不改写，原样回流给客户端。
  // 同一连接的第二条请求会换新拨一条上游线（真代理会复用旧线，教学版不做）
  const relayUpstream = (remote: net.Socket) => {
    if (upstream && upstream !== remote) upstream.destroy() // 换线：旧上游收摊
    upstream = remote
    remote.on('data', (b) => client.write(b))
    remote.on('error', (e) => {
      if (remote === upstream) fail(`上游出错：${e.message}`)
    })
    remote.on('close', () => {
      if (remote !== upstream) return // 已换下岗的旧线：安静退场，不牵连客户端
      client.end() // 当前这根线收摊：把话尾送完，跟着收线
    })
  }

  // 明文请求：改写请求行（URL → 路径）、按请求行目标重建 Host（RFC 9112：不得照抄收到的 Host）
  const forwardPlain = async (head: RequestHead, body: Buffer): Promise<void> => {
    try {
      const abs = splitAbsoluteForm(head.target)
      let dest: ProxyTarget
      let path: string
      let authority: string
      if (abs) {
        authority = abs.authority
        dest = parseAuthority(abs.authority)
        path = abs.path
      } else {
        // origin-form（目标直接写路径）：去哪只能看 Host 头
        authority = head.headers.find((l) => /^host:/i.test(l))?.slice(5).trim() ?? ''
        dest = parseAuthority(authority)
        path = head.target
      }
      const use = (await hook?.(dest)) ?? dest
      const remote = await connectTo(use)
      relayUpstream(remote)
      const headers = [`Host: ${authority}`, ...head.headers.filter((l) => !/^host:/i.test(l))]
      remote.write([`${head.method} ${path} HTTP/1.1`, ...headers].join('\r\n') + HEAD_END)
      if (body.length > 0) remote.write(body)
    } catch (e) {
      // 连不上/发不出：按惯例回 502，让客户端知道这一跳断了
      client.write(`HTTP/1.1 502 Bad Gateway${HEAD_END}`)
      client.end()
      console.error(`[http-proxy] 转发失败：${(e as Error).message}`)
    } finally {
      busy = false
      pump()
    }
  }

  // CONNECT：拨通目标、应答 2xx，从此这条连接对代理只是一根管道
  const openTunnel = async (head: RequestHead, early: Buffer): Promise<void> => {
    try {
      if (!head.target.includes(':')) throw new Error('CONNECT 必须写明端口（RFC 9110：无默认端口）')
      const requested = parseAuthority(head.target)
      const use = (await hook?.(requested)) ?? requested
      const remote = await connectTo(use)
      relayUpstream(remote)
      client.write(`HTTP/1.1 200 Connection Established${HEAD_END}`) // 2xx = 隧道即刻开通
      if (early.length > 0) remote.write(early) // 头后面紧跟的字节：TLS 握手可能已经开始
      tunnel = true
    } catch (e) {
      // 连不上目标：不开隧道，回 502（RFC 只要求「非 2xx」）
      client.write(`HTTP/1.1 502 Bad Gateway${HEAD_END}`)
      client.end()
      console.error(`[http-proxy] 隧道开不起来：${(e as Error).message}`)
    } finally {
      busy = false
      pump()
    }
  }

  // 状态机：head（攒头部）→ body（攒正文）→ head → …；CONNECT 应答后进 tunnel
  const pump = () => {
    if (busy || tunnel) return
    if (pending === null) {
      const headEnd = buffered.indexOf(HEAD_END)
      if (headEnd < 0) return // 头部还没到齐
      const head = parseRequestHead(buffered.subarray(0, headEnd).toString('latin1'))
      if (!head) return fail('请求行看不懂')
      const rest = buffered.subarray(headEnd + HEAD_END.length)
      buffered = Buffer.alloc(0)
      if (head.method === 'CONNECT') {
        busy = true
        void openTunnel(head, rest)
        return
      }
      pending = head
      buffered = rest
    }
    const req = pending
    if (req && buffered.length >= req.bodyLength) {
      // 正文攒够 Content-Length 报的字节数：一条完整请求到齐，可以动身了
      const body = buffered.subarray(0, req.bodyLength)
      buffered = buffered.subarray(req.bodyLength)
      pending = null
      busy = true
      void forwardPlain(req, body)
    }
  }

  client.on('data', (chunk) => {
    if (tunnel) {
      upstream?.write(chunk) // 隧道态：一个字节都不看
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
  client.on('error', (e) => fail(`客户端连接出错：${e.message}`))
  client.on('close', () => upstream?.destroy())
}
