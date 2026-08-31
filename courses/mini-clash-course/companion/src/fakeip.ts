// src/fakeip.ts —— fake-ip：假门牌池 + DNS 应答器（名字这一关的本地接管）
// 思路：DNS 查询不真去查——当场发一个保留网段里的假 IP 应付客户端，把真名字记在账上；
// 客户端拿假 IP 来连接时，入口按账本换回真名字送规则引擎。真解析推迟到出站点做。
import dgram from 'node:dgram'

// RFC 2544 划给网络设备基准测试的保留网段：IANA 不会把它分给真实主机——假门牌永不撞真门牌
export const FAKE_IP_CIDR = '198.18.0.0/15'

// —— 取号池 ——

export interface FakeIpPoolOptions {
  capacity?: number // 在册映射的上限；默认 131071 = 198.18.0.1 ～ 198.19.255.255（/15 全段，越过 .0 起点）
}

// 名字 ↔ 假门牌的双向账本。同名同号（问几遍答案一致）；池满让位用 FIFO——最老的映射交出号码。
// 让位若选 LRU（最久没用的先让），「还在用的映射不被拆」更贴切，但每次查询都要记账；
// 教学版取简单，取舍登记差异清单
export class FakeIpPool {
  private readonly capacity: number
  private nextIndex = 0 // 下一张新号的偏移（相对 198.18.0.1）
  private readonly domainOf = new Map<string, string>() // 名字 → 假门牌（取号走这张）
  private readonly ipOf = new Map<string, string>() // 假门牌 → 名字（还原走这张）
  private readonly order: string[] = [] // 在册名字的到达顺序：FIFO 让位的队

  constructor(opts: FakeIpPoolOptions = {}) {
    this.capacity = opts.capacity ?? 131071
    if (this.capacity < 1) throw new Error('池容量至少得是 1')
  }

  // 名字来取号：在册的直接回旧号；池满则队首让位，腾出的号给新名字
  allocate(domain: string): string {
    const key = domain.toLowerCase() // 域名大小写不敏感，与规则引擎同一纪律
    const known = this.domainOf.get(key)
    if (known !== undefined) return known
    let ip: string
    if (this.domainOf.size >= this.capacity) {
      const evicted = this.order.shift()
      if (evicted === undefined) throw new Error('池容量至少得是 1') // capacity ≥ 1 时不可能走到这
      ip = this.domainOf.get(evicted) as string // 队首的号腾出来——旧号易主，旧映射就此消失
      this.domainOf.delete(evicted)
      this.ipOf.delete(ip)
    } else {
      ip = ipAt(this.nextIndex++)
    }
    this.domainOf.set(key, ip)
    this.ipOf.set(ip, key)
    this.order.push(key)
    return ip
  }

  // 假门牌还原回名字：不是本池在册的号（含已让位的旧号）→ null，调用方按普通目标处理
  restore(ip: string): string | null {
    return this.ipOf.get(ip) ?? null
  }

  get size(): number {
    return this.domainOf.size // 在册映射数——demo 打印池况用
  }
}

// 198.18.0.1 起的第 i 个号：0xC6120000 正是 198.18.0.0，+1 越过「.0」这个像网络号的起点
function ipAt(i: number): string {
  const n = (0xc6120000 + i + 1) >>> 0
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.')
}

// —— DNS 报文（裁判是 RFC 1035）：12 字节头 + 问题区，应答再跟答案区 ——

const QTYPE_A = 0x0001 // 问题类型：A = 「这个名的 IPv4 地址是多少」
const CLASS_IN = 0x0001 // 类别：IN（互联网）——教科书世界只有这一类
const FLAGS_QR = 0x8000 // QR 位：1 = 这是应答，0 = 这是查询
const FLAGS_AA = 0x0400 // AA 位：宣称「权威答案」——我们并不真权威，戏服而已（差异登记附录）
const FLAGS_RD = 0x0100 // RD 位：查询里的「请递归」——应答原样抄回
const FLAGS_RA = 0x0080 // RA 位：宣称「可递归」——我们其实压根不递归，fake-ip 不真查（差异登记附录）
const PTR_MASK = 0xc000 // 压缩指针：最高两 bits 为 11，余下 14 bits 是「指回消息开头数起的偏移」

// 解析一份查询。三样结局：太短（残缺）/ 解不开（不是教学版认的形状）/ 拿到问题
type ParsedQuery =
  | { kind: 'short' }
  | { kind: 'bad'; why: string }
  | { kind: 'ask'; id: number; rd: boolean; name: string; qtype: number; questionEnd: number }

function parseQuery(buf: Buffer): ParsedQuery {
  if (buf.length < 12) return { kind: 'short' } // 头都不齐
  const flags = buf.readUInt16BE(2)
  if (flags & FLAGS_QR) return { kind: 'bad', why: 'QR 位是 1：这是应答不是查询' }
  if (buf.readUInt16BE(4) !== 1) return { kind: 'bad', why: '问题数不是 1（教学版只回单个问题）' }
  let o = 12
  const labels: string[] = []
  for (;;) {
    if (o >= buf.length) return { kind: 'short' }
    const len = buf[o]
    if (len === 0) {
      o += 1 // 0 长度标签 = 名字写完了
      break
    }
    if (len & 0xc0) return { kind: 'bad', why: '问题名里出现压缩指针/超长标签（正常查询不该有）' }
    if (o + 1 + len > buf.length) return { kind: 'short' }
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('latin1'))
    o += 1 + len
  }
  if (buf.length < o + 4) return { kind: 'short' } // 名字后还有 QTYPE/QCLASS 四字节
  const qtype = buf.readUInt16BE(o)
  const qclass = buf.readUInt16BE(o + 2)
  if (qclass !== CLASS_IN) return { kind: 'bad', why: 'QCLASS 不是 IN' }
  return { kind: 'ask', id: buf.readUInt16BE(0), rd: (flags & FLAGS_RD) !== 0, name: labels.join('.').toLowerCase(), qtype, questionEnd: o + 4 }
}

// 应答 = 头 + 原样抄回的问题 + （A 查询时）一条答案。答案的 NAME 用压缩指针 0xC00C 指回偏移 12
// 的问题名——教学版唯一一处指针，不做通用压缩（差异登记附录）。解不开/太短 → null（不回话）
function answerQuery(msg: Buffer, pool: FakeIpPool): Buffer | null {
  const parsed = parseQuery(msg)
  if (parsed.kind === 'short') return null
  if (parsed.kind === 'bad') {
    console.error(`[fake-dns] 丢弃一份看不懂的查询：${parsed.why}`)
    return null
  }
  const question = msg.subarray(12, parsed.questionEnd) // 问题段原样抄回——客户端靠它对上号
  const head = Buffer.alloc(12)
  head.writeUInt16BE(parsed.id, 0)
  head.writeUInt16BE(FLAGS_QR | FLAGS_AA | FLAGS_RA | (parsed.rd ? FLAGS_RD : 0), 2)
  head.writeUInt16BE(1, 4) // 问题数 1
  head.writeUInt16BE(0, 8) // 权威区 0
  head.writeUInt16BE(0, 10) // 附加区 0
  if (parsed.qtype !== QTYPE_A) {
    head.writeUInt16BE(0, 6) // 答案数 0：AAAA 等非 A 查询回「查无此录」的空答案，别让客户端干等
    return Buffer.concat([head, question])
  }
  const ip = pool.allocate(parsed.name) // A 查询才取号——应答里的假门牌从此有了主人
  head.writeUInt16BE(1, 6) // 答案数 1
  const answer = Buffer.alloc(16) // NAME(2 指针) + TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2) + RDATA(4)
  answer.writeUInt16BE(PTR_MASK | 12, 0) // 指回偏移 12：答案的名字就是问题里那个名字，一字不重写
  answer.writeUInt16BE(QTYPE_A, 2)
  answer.writeUInt16BE(CLASS_IN, 4)
  answer.writeUInt32BE(1, 6) // TTL=1 秒：假答案不配被久缓存，过期了就再来问（差异登记附录）
  answer.writeUInt16BE(4, 10) // RDLENGTH：IPv4 地址四字节
  ip.split('.').forEach((seg, i) => answer.writeUInt8(Number(seg), 12 + i))
  return Buffer.concat([head, question, answer])
}

// —— UDP 应答器 ——

export interface FakeDnsOptions {
  port: number // 0 = 请系统随手分一个空闲端口（真 DNS 的 53 在 Unix 系要管理员权限；教学版不占）
  pool: FakeIpPool // 查到的名字在这里登记与取号
  host?: string
}

export interface FakeDnsHandle {
  port: number
  close(): Promise<void>
}

export function startFakeDns(opts: FakeDnsOptions): Promise<FakeDnsHandle> {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4')
    sock.once('error', reject)
    sock.on('error', (e) => console.error(`[fake-dns] socket 出错：${e.message}`)) // 绑定后的事故只记日志，不让进程崩
    sock.on('message', (msg, rinfo) => {
      try {
        const reply = answerQuery(msg, opts.pool)
        if (reply !== null) sock.send(reply, rinfo.port, rinfo.address) // UDP 无连接：从哪来，回哪去
      } catch (e) {
        console.error(`[fake-dns] 应答失败：${(e as Error).message}`)
      }
    })
    sock.bind(opts.port, opts.host ?? '127.0.0.1', () => {
      resolve({
        port: sock.address().port,
        close: () =>
          new Promise((res) => {
            sock.close(() => res())
          }),
      })
    })
  })
}
