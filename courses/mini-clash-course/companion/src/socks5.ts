// src/socks5.ts —— SOCKS5 入口：握手 → CONNECT → 双向中继（直连，或交给 onConnect 钩子选路）
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { connectTo } from './dial'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

// 「客户端想去哪」→「实际连谁」的翻译钩子，与第 2 章的 connectTarget 同构；
// 规则引擎接管分流时，在这里按目标判决改写出口。
// 第 4 章起还允许交回一条已接通的流（两跳的中继转接头）：回地址 = 直连（旧语义不变），
// 交回流 = 入口直接拿它当上游线——「怎么连」也归钩子管。
export type SocksConnectHook = (requested: ProxyTarget) => ProxyTarget | Duplex | Promise<ProxyTarget | Duplex>

export interface Socks5ServerOptions {
  port: number // 0 = 请系统随手分一个空闲端口
  host?: string
  onConnect?: SocksConnectHook
}

export interface Socks5ServerHandle {
  port: number
  close(): Promise<void>
}

// 报文里的固定编号（裁判是 RFC 1928）
const VER = 0x05 // 版本号：每段报文的第一个字节，也是服务器的第一道关卡
const METHOD_NOAUTH = 0x00 // 认证方法编号：0 = 无认证（教学版只会这一种）
const CMD_CONNECT = 0x01 // 命令编号：1 = CONNECT（替我接通目标）
const ATYP_IPV4 = 0x01 // 目标地址类型：1 = IPv4，地址段定长 4 字节
const ATYP_DOMAIN = 0x03 // 目标地址类型：3 = 域名，地址段 = 1 字节长度 + 域名原文
const REP_SUCCESS = 0x00 // 回执：成功
const REP_GENERAL = 0x01 // 回执：一般性失败（目标接不通之类的统称）
const REP_COMMAND = 0x07 // 回执：命令不支持（BIND / UDP ASSOCIATE 教学版不做）
const REP_ATYP = 0x08 // 回执：地址类型不支持（IPv6 教学版不做）

// 应答骨架：VER REP RSV ATYP=IPv4 + BND.ADDR(0.0.0.0) + BND.PORT(0)，定长 10 字节。
// RFC 语义上 BND 两格应回报「实际接驳的门牌」，教学版固定回 0——主流客户端不检查（差异清单见附录）
function reply(rep: number): Buffer {
  return Buffer.from([VER, rep, 0x00, ATYP_IPV4, 0, 0, 0, 0, 0, 0])
}

// 解析 CONNECT 请求。三种结局：还不够长（等下一批字节）/ 协议错误（带回执码）/ 完整（拿到目标）
type ParsedRequest =
  | { kind: 'short' }
  | { kind: 'rep'; rep: number }
  | { kind: 'ok'; target: ProxyTarget; consumed: number }

function parseConnectRequest(buf: Buffer): ParsedRequest {
  if (buf.length < 4) return { kind: 'short' } // 连 ATYP 那格都没到，地址多长无从谈起
  if (buf[0] !== VER || buf[2] !== 0x00) return { kind: 'rep', rep: REP_GENERAL } // RSV 必须为 0
  if (buf[1] !== CMD_CONNECT) return { kind: 'rep', rep: REP_COMMAND }
  const atyp = buf[3]
  let addrEnd: number // 地址段的终点：走到哪儿，端口那 2 字节才从哪儿开始
  if (atyp === ATYP_IPV4) {
    addrEnd = 8 // 4（固定头）+ 4（四个数字各占一字节）
  } else if (atyp === ATYP_DOMAIN) {
    if (buf.length < 5) return { kind: 'short' } // 域名长度那一格自己还没到
    addrEnd = 5 + buf[4] // 4（固定头）+ 1（长度）+ N（域名原文，没有结尾符）
  } else {
    return { kind: 'rep', rep: REP_ATYP } // 含 IPv6（4）：教学版不做
  }
  const total = addrEnd + 2 // 尾上还有 2 字节端口
  if (buf.length < total) return { kind: 'short' }
  const host =
    atyp === ATYP_IPV4
      ? Array.from(buf.subarray(4, 8)).join('.') // 四个字节就是四个数字，拼回点分形式
      : buf.subarray(5, addrEnd).toString('latin1')
  const port = buf.readUInt16BE(addrEnd) // 大端序读回：高位字节在前
  return { kind: 'ok', target: { host, port }, consumed: total }
}

// 一条客户端连接的一生：greeting（谈方法）→ request（读 CONNECT）→ dialing（拨号中）→ relay（中继）；dead = 已收摊
type Phase = 'greeting' | 'request' | 'dialing' | 'relay' | 'dead'

function handleClient(client: net.Socket, hook?: SocksConnectHook): void {
  let buffered = Buffer.alloc(0) // 累积缓冲：还没认领的字节全在这，到齐一段消费一段
  let phase: Phase = 'greeting'
  let upstream: Duplex | null = null // 接通后的上游线：直连的 socket 或两跳的中继转接头，对入口都是一根管子

  const fail = (msg: string) => {
    console.error(`[socks5] ${msg}`)
    client.destroy()
    upstream?.destroy()
  }

  // 中继：两侧对接，双向只搬字节——与第 2 章 CONNECT 应答之后的隧道同一形态
  const openRelay = (remote: Duplex) => {
    upstream = remote
    remote.on('data', (b) => client.write(b))
    remote.on('error', (e) => fail(`目标连接出错：${e.message}`))
    remote.on('close', () => client.end())
    client.write(reply(REP_SUCCESS))
    if (buffered.length > 0) remote.write(buffered) // 拨号期间提前到的载荷：一并送去，一个不丢
    buffered = Buffer.alloc(0)
    phase = 'relay'
  }

  const openConnect = async (target: ProxyTarget): Promise<void> => {
    try {
      // 钩子的回话三选一：没装钩子（直连）/ 回一个地址（照它直连）/ 交回一条已接通的流（直接当上游线）
      const use = await hook?.(target)
      const remote =
        use === undefined
          ? await connectTo(target)
          : 'host' in use
            ? await connectTo(use)
            : use
      openRelay(remote)
    } catch (e) {
      client.end(reply(REP_GENERAL)) // 接不通：回「一般性失败」，不开中继
      phase = 'dead'
      console.error(`[socks5] 接不通目标：${(e as Error).message}`)
    }
  }

  // 状态机泵：每来一批字节问一次「以手头的缓冲，能往前走到哪儿」——走不动就回来等下文
  const pump = () => {
    if (phase === 'dead') return
    if (phase === 'greeting') {
      if (buffered.length < 2) return // 方法个数那一格还没到
      if (buffered[0] !== VER) return fail('不是 SOCKS5（版本号不是 5）')
      const n = buffered[1]
      if (buffered.length < 2 + n) return // 方法列表还没到齐
      const methods = buffered.subarray(2, 2 + n)
      buffered = buffered.subarray(2 + n)
      if (!methods.includes(METHOD_NOAUTH)) {
        client.end(Buffer.from([VER, 0xff])) // 谈不拢：FF = 没有可接受的方法
        phase = 'dead'
        return
      }
      client.write(Buffer.from([VER, METHOD_NOAUTH])) // 选定无认证
      phase = 'request'
    }
    if (phase === 'request') {
      const parsed = parseConnectRequest(buffered)
      if (parsed.kind === 'short') return // 半个请求：留在缓冲里等下文
      if (parsed.kind === 'rep') {
        client.end(reply(parsed.rep)) // 回执之后这场对话就结束了
        phase = 'dead'
        return
      }
      buffered = buffered.subarray(parsed.consumed) // 剩余字节可能是提前到的载荷，拨通后一并送
      phase = 'dialing'
      void openConnect(parsed.target)
    }
  }

  client.on('data', (chunk) => {
    if (phase === 'relay') {
      upstream?.write(chunk) // 中继态：一个字节都不看
      return
    }
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
  client.on('error', (e) => fail(`客户端连接出错：${e.message}`))
  client.on('close', () => upstream?.destroy())
}

export function startSocks5Server(opts: Socks5ServerOptions): Promise<Socks5ServerHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      handleClient(client, opts.onConnect)
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
