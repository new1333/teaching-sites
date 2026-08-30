// src/relay.ts —— 两跳链路：远端中继（代连目标）与入口侧的接法
// 链路语言（自定义明文帧）：
//   入口 → 远端：[ATYP][地址][端口]（CONNECT 帧，一条连接开局一条）→ 之后 [LEN:2 大端][载荷]（数据帧）
//   远端 → 入口：[STATUS:1]（00 = 代连成功）→ 之后数据帧同上
// 第 6 章起两端可指定 password：上述整段明文流骑在 aeadPipe 上过线（盐 + 密文块），不指定则照旧明文
import net from 'node:net'
import { Duplex } from 'node:stream'
import { connectTo } from './dial'
import { aeadPipe } from './crypto'
import type { ProxyTarget } from './http-proxy' // 只借「host + port」这个形状，type 引用不带运行时依赖

export interface RelayServerOptions {
  port: number // 0 = 请系统随手分一个空闲端口
  host?: string
  password?: string // 给了就上锁：这条链路的载荷逐块 AEAD 封缄（第 6 章）
}

export interface RelayServerHandle {
  port: number
  close(): Promise<void>
}

// 帧里的固定编号：ATYP 沿用 SOCKS5 的字典（01 IPv4 / 03 域名），双方不必再学新暗号
const ATYP_IPV4 = 0x01 // 地址形态：1 = IPv4，地址段定长 4 字节
const ATYP_DOMAIN = 0x03 // 地址形态：3 = 域名，地址段 = 1 字节长度 + 名字原文（解析留在远端做）
const STATUS_OK = 0x00 // 回执：目标接通，中继开始
const STATUS_FAIL = 0x01 // 回执：目标接不通，链路就此收摊
const MAX_PAYLOAD = 0x3fff // 一帧载荷的上限：长度头先验，越界即坏帧——不等载荷到齐就拒收

// —— 数据帧编解码：给字节流画边界的小工具，两端共用 ——

// 编码：2 字节大端长度 + 载荷。长度头就是边界——读的人数完这几个字节，就知道这条帧到哪结束
function encodeFrame(payload: Buffer): Buffer {
  const head = Buffer.alloc(2)
  head.writeUInt16BE(payload.length, 0)
  return Buffer.concat([head, payload])
}

// 帧读取器：一条连接一个。字节喂进来，凑齐一帧交一帧，凑不齐的留在肚里等下文
// ——与第 3 章的累积缓冲同一件手艺，只是这回按我们自己定的长度规矩切
function createFrameReader(onFrame: (payload: Buffer) => void) {
  let buffered = Buffer.alloc(0)
  return {
    push(chunk: Buffer) {
      buffered = Buffer.concat([buffered, chunk])
      for (;;) {
        if (buffered.length < 2) return // 长度头还没到齐
        const len = buffered.readUInt16BE(0)
        if (len === 0 || len > MAX_PAYLOAD)
          throw new Error(`帧长越界：${len}（合法范围 1..${MAX_PAYLOAD}）`) // 零长与超限都不认
        if (buffered.length < 2 + len) return // 载荷还没到齐
        onFrame(buffered.subarray(2, 2 + len))
        buffered = buffered.subarray(2 + len)
      }
    },
  }
}

// —— CONNECT 帧编解码：把「带我去 host:port」装上这条链路 ——

// 目标装进 CONNECT 帧：数字 IP 走 IPv4 形态；域名走 ATYP=03 原文过境——名字的解析交给远端
function encodeConnectFrame(t: ProxyTarget): Buffer {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t.host)) {
    const ip = t.host.split('.').map(Number)
    return Buffer.from([ATYP_IPV4, ...ip, t.port >> 8, t.port & 0xff])
  }
  const name = Buffer.from(t.host, 'latin1')
  return Buffer.from([ATYP_DOMAIN, name.length, ...name, t.port >> 8, t.port & 0xff])
}

// 解析 CONNECT 帧。三种结局与第 3 章的解析器同款：短（等下文）/ 坏（收线）/ 全（拿到目标）
type ParsedConnect =
  | { kind: 'short' }
  | { kind: 'bad' }
  | { kind: 'ok'; target: ProxyTarget; consumed: number }

function parseConnectFrame(buf: Buffer): ParsedConnect {
  if (buf.length < 1) return { kind: 'short' }
  const atyp = buf[0]
  let addrEnd: number // 地址段的终点：走到哪儿，端口那 2 字节才从哪儿开始
  if (atyp === ATYP_IPV4) {
    addrEnd = 5 // 1（ATYP）+ 4（四个数字各占一字节）
  } else if (atyp === ATYP_DOMAIN) {
    if (buf.length < 2) return { kind: 'short' } // 名字长度那一格自己还没到
    addrEnd = 2 + buf[1] // 1（ATYP）+ 1（长度）+ N（名字原文，没有结尾符）
  } else {
    return { kind: 'bad' }
  }
  const total = addrEnd + 2 // 尾上还有 2 字节端口
  if (buf.length < total) return { kind: 'short' }
  const host =
    atyp === ATYP_IPV4
      ? Array.from(buf.subarray(1, 5)).join('.')
      : buf.subarray(2, addrEnd).toString('latin1')
  const port = buf.readUInt16BE(addrEnd) // 大端序读回：高位字节在前
  return { kind: 'ok', target: { host, port }, consumed: total }
}

// —— 入口侧：接通远端、递上目标，拿回一根「读写都是裸字节」的管子 ——

// 双工转接头：外侧（入口）当它是普通管道——写进裸字节、读出裸字节；
// 内侧（中继线）跑的是帧。装帧拆帧都藏在里面，入口与中继的既有代码因此一字不改
// （第 6 章起内侧可能是 aeadPipe 交回的加密管道，参数随之从 net.Socket 加宽为 Duplex）
function attachFrameStream(relay: Duplex, early: Buffer): Duplex {
  const outer = new Duplex({
    read(_size) {
      // 数据是被推着来的（push），读侧不用主动拉——但这个钩子必须存在，缺了流一开工就报错
    },
    write(chunk, _enc, cb) {
      const buf = chunk as Buffer
      // 裸字节切块装帧：一块最多 MAX_PAYLOAD，超长的先切开再装
      for (let i = 0; i < buf.length; i += MAX_PAYLOAD) relay.write(encodeFrame(buf.subarray(i, i + MAX_PAYLOAD)))
      cb()
    },
  })
  const reader = createFrameReader((payload) => outer.push(payload)) // 帧 → 裸字节 → 外侧
  if (early.length > 0) reader.push(early) // 与回执同包到达的首帧
  relay.on('data', (b) => {
    try {
      reader.push(b)
    } catch (e) {
      outer.destroy(e as Error) // 坏帧：转接头整体收摊
    }
  })
  relay.on('close', () => outer.destroy()) // 中继线收线：外侧跟着收
  relay.on('error', (e) => outer.destroy(e))
  outer.on('close', () => relay.destroy()) // 外侧收线：中继线跟着收
  return outer
}

// 两跳的接法：先拨远端（第一跳的终点），再请它代连目标（第二跳的另一半）。
// 回执 00 才算成；返回的管子直连语义与 net.Socket 无异。
// 给了 password，第一跳整段先套上加密管道：CONNECT 帧起一切明文都被逐块封缄——「去哪儿」也上锁
export async function connectViaRelay(relayAddr: ProxyTarget, target: ProxyTarget, password?: string): Promise<Duplex> {
  const raw = await connectTo(relayAddr) // 第一跳：先把线接到远端
  const relay: Duplex = password === undefined ? raw : aeadPipe(raw, password)
  relay.write(encodeConnectFrame(target)) // 目标装进 CONNECT 帧，请远端代连
  return new Promise((resolve, reject) => {
    const onFirst = (b: Buffer) => {
      relay.off('error', onErr)
      relay.off('close', onClose)
      if (b[0] !== STATUS_OK) {
        relay.destroy()
        return reject(new Error('远端回执：目标接不通'))
      }
      resolve(attachFrameStream(relay, b.subarray(1))) // 回执字节后面可能紧跟首帧
    }
    const onErr = (e: Error) => {
      relay.off('data', onFirst)
      relay.off('close', onClose)
      reject(e)
    }
    const onClose = () => {
      relay.off('data', onFirst)
      relay.off('error', onErr)
      reject(new Error('远端在回执前收线'))
    }
    relay.once('data', onFirst)
    relay.once('error', onErr)
    relay.once('close', onClose)
  })
}

// —— 远端侧：听一个端口，替每个来客代连目标 ——

// 一条入口连接的一生：request（攒 CONNECT 帧）→ dialing（代连中）→ relay（帧↔字节双向搬运）；dead = 已收摊
// （第 6 章起 client 也可能是 aeadPipe 交回的加密管道：函数只当它是双工管，锁的事不归这里管）
function handleRelayClient(client: Duplex): void {
  let buffered = Buffer.alloc(0) // 累积缓冲：CONNECT 帧可能拆着到、也可能与首帧同包到
  let phase: 'request' | 'dialing' | 'relay' | 'dead' = 'request'
  let target: net.Socket | null = null
  let reader: ReturnType<typeof createFrameReader> | null = null

  const fail = (msg: string) => {
    console.error(`[relay] ${msg}`)
    client.destroy()
    target?.destroy()
    phase = 'dead'
  }

  const openConnect = async (t: ProxyTarget): Promise<void> => {
    try {
      const remote = await connectTo(t) // 「站在目标可达的位置」说的就是这一行：目标由远端拨
      client.write(Buffer.from([STATUS_OK])) // 回执：接通了
      target = remote
      reader = createFrameReader((payload) => target?.write(payload)) // 帧 → 裸字节 → 目标
      remote.on('data', (b) => {
        // 裸字节 → 切块装帧 → 入口（超一帧上限的先切开）
        for (let i = 0; i < b.length; i += MAX_PAYLOAD) client.write(encodeFrame(b.subarray(i, i + MAX_PAYLOAD)))
      })
      remote.on('error', (e) => fail(`目标连接出错：${e.message}`))
      remote.on('close', () => client.end())
      phase = 'relay'
      if (buffered.length > 0) {
        reader.push(buffered) // CONNECT 帧后紧跟的首帧：一并解，一个字节不丢
        buffered = Buffer.alloc(0)
      }
    } catch (e) {
      client.end(Buffer.from([STATUS_FAIL])) // 回执：接不通，这场代连到此为止
      phase = 'dead'
      console.error(`[relay] 接不通目标：${(e as Error).message}`)
    }
  }

  // 状态机泵：来一批字节问一次「以手头的缓冲能走到哪儿」——走不动就回来等下文
  const pump = () => {
    if (phase !== 'request') return
    const parsed = parseConnectFrame(buffered)
    if (parsed.kind === 'short') return // 半个 CONNECT 帧：留在缓冲里等下文
    if (parsed.kind === 'bad') return fail('CONNECT 帧看不懂')
    buffered = buffered.subarray(parsed.consumed) // 剩余字节可能是紧跟的首帧，代连后一并解
    phase = 'dialing'
    void openConnect(parsed.target)
  }

  client.on('data', (chunk) => {
    if (phase === 'relay') {
      try {
        reader?.push(chunk)
      } catch (e) {
        fail(`坏帧：${(e as Error).message}`)
      }
      return
    }
    if (phase === 'dead') return
    buffered = Buffer.concat([buffered, chunk])
    pump()
  })
  client.on('error', (e) => fail(`入口连接出错：${e.message}`))
  client.on('close', () => target?.destroy())
}

export function startRelayServer(opts: RelayServerOptions): Promise<RelayServerHandle> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((client) => {
      sockets.add(client)
      client.on('close', () => sockets.delete(client))
      // 有密码：这条连接整段先套上加密管道，帧世界照旧骑在上面；没收线记录的仍是裸 socket
      handleRelayClient(opts.password === undefined ? client : aeadPipe(client, opts.password))
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
