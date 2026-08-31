// src/tun.ts —— TUN 视角的报文解析实验：拆 IP 头、拆 TCP 段、按五元组归组连接
// 思路：TUN 虚拟网卡把全机 IP 包递到代理进程手里——进程拿到的不是现成的 socket，是一包包原始字节。
// 要把包变回连接，进程得自己当一回协议栈的读侧：拆 IP 头拿到地址与协议，拆 TCP 头拿到端口与序号，
// 用五元组把包归回各自的连接，再按序号把每条连接两个方向的字节流拼回来。
// 边界（差异登记附录）：不建真 TUN 设备、不碰路由表（实验全在自造样本上）；校验和一概不验；
// 重传重复、载荷重叠、序号回绕、IP 分片都不处理；非 TCP 包只计数不解析。

export interface Ipv4Packet {
  version: number // 恒为 4（IPv4）——字节 0 的高 4 位
  headerLength: number // IHL × 4：固定头 20 字节 + 选项；载荷从这里开始
  totalLength: number // 头 + 载荷的整包长度——链路层塞的填充尾巴不算在內
  protocol: number // 6 = TCP、17 = UDP……五元组的「协议」元就住在这一个字节
  srcIp: string
  dstIp: string
  payload: Buffer // 传输层视角的载荷 = subarray(headerLength, totalLength)
}

// 拆 IP 头（裁判是 RFC 791）。四样验收不过就还原不出（null）：太短、版本不是 4、
// IHL 非法、总长与实际字节对不上——真实 TUN 里混着各路包，看不懂的如实交白卷
export function parseIpv4Packet(buf: Buffer): Ipv4Packet | null {
  if (buf.length < 20) return null // 连 20 字节固定头都不齐
  const version = buf[0] >>> 4
  if (version !== 4) return null // IPv6 的包不是本实验的对象
  const ihl = buf[0] & 0x0f
  if (ihl < 5) return null // 固定头就要 5 字（20 字节），更短的 IHL 非法
  const headerLength = ihl * 4
  const totalLength = buf.readUInt16BE(2)
  if (totalLength < headerLength || totalLength > buf.length) return null // 半截包
  return {
    version,
    headerLength,
    totalLength,
    protocol: buf[9],
    srcIp: ipAt(buf, 12),
    dstIp: ipAt(buf, 16),
    payload: buf.subarray(headerLength, totalLength), // 选项字（若有）随头一起跳过
  }
}

// 四个字节拼回点分 IPv4
function ipAt(buf: Buffer, off: number): string {
  return `${buf[off]}.${buf[off + 1]}.${buf[off + 2]}.${buf[off + 3]}`
}

export interface TcpFlags {
  syn: boolean // 同步：握手第一拍/第二拍的记号
  ack: boolean // 确认：这段的确认号字段有效
  fin: boolean // 结束：我这边的字节流说完了（挥手）
  rst: boolean // 重置：立刻断线，异常收场
  psh: boolean // 推送：别攒了，赶紧交给应用
}

export interface TcpSegment {
  srcPort: number
  dstPort: number
  seq: number // 序号：这段载荷在字节流里的起点（第 3 章教过的大端序，这里是 4 字节版）
  ack: number // 确认号：下一字节该从哪数起（对方流的进度回执）
  dataOffset: number // 段头长 = 高 4 位 × 4：固定 20 字节 + TCP 选项
  flags: TcpFlags
  payload: Buffer
}

// 标志位字节（段内偏移 13，裁判是 RFC 9293）——一字节八个开关，低位到高位：
// FIN=0x01、SYN=0x02、RST=0x04、PSH=0x08、ACK=0x10、URG=0x20
const FLAG_FIN = 0x01
const FLAG_SYN = 0x02
const FLAG_RST = 0x04
const FLAG_PSH = 0x08
const FLAG_ACK = 0x10

// 拆 TCP 段头。太短、数据偏移非法都还原不出（null）
export function parseTcpSegment(buf: Buffer): TcpSegment | null {
  if (buf.length < 20) return null
  const dataOffset = (buf[12] >>> 4) * 4
  if (dataOffset < 20 || dataOffset > buf.length) return null // 偏移小于固定头即非法
  const bits = buf[13]
  return {
    srcPort: buf.readUInt16BE(0),
    dstPort: buf.readUInt16BE(2),
    seq: buf.readUInt32BE(4),
    ack: buf.readUInt32BE(8),
    dataOffset,
    flags: {
      syn: (bits & FLAG_SYN) !== 0,
      ack: (bits & FLAG_ACK) !== 0,
      fin: (bits & FLAG_FIN) !== 0,
      rst: (bits & FLAG_RST) !== 0,
      psh: (bits & FLAG_PSH) !== 0,
    },
    payload: buf.subarray(dataOffset), // TCP 选项在选项区里，随头跳过
  }
}

// —— 五元组归组 ——

export interface SessionSegment {
  from: 'client' | 'server' // 相对首包方向：首包发送方记作 client（发起方）
  flags: string // 'SYN' / 'SYN|ACK' / 'PSH|ACK' …——跟读一张连接的履历用
  seq: number
  ack: number
  dataBytes: number
}

export interface TunSession {
  key: string // 规范五元组：协议打头、两端点按字典序小者在前——一来一回两方向拼同一把钥匙
  client: string // 首包发送方 ip:port
  server: string // 首包接收方 ip:port
  segments: SessionSegment[] // 按到达顺序
  toServer: Buffer // client→server 的字节流：按序号升序拼回（教学版的重排）
  toClient: Buffer // server→client 同理
}

export interface GroupResult {
  sessions: TunSession[] // 按首包出现顺序
  skipped: number // 解不出 / 非 TCP 的包数：真实 TUN 里全机流量都会来，看不懂的如实计数
}

// 把一串到达的 IP 包归回各自的 TCP 连接。TUN 递过来的是「全机混流」——
// 归组的钥匙只有一把：五元组（源 IP:端口 + 目的 IP:端口 + 协议）。
// 字节流重排只按序号升序拼接：重传重复、载荷重叠、序号回绕都不处理（差异登记附录）
export function groupSessions(packets: readonly Buffer[]): GroupResult {
  const byKey = new Map<string, TunSession>()
  const pending = new Map<TunSession, { c2s: Array<{ seq: number; bytes: Buffer }>; s2c: Array<{ seq: number; bytes: Buffer }> }>()
  const sessions: TunSession[] = []
  let skipped = 0
  for (const buf of packets) {
    const ip = parseIpv4Packet(buf)
    const seg = ip !== null && ip.protocol === 6 ? parseTcpSegment(ip.payload) : null
    if (ip === null || seg === null) {
      skipped += 1
      continue
    }
    const a = `${ip.srcIp}:${seg.srcPort}`
    const b = `${ip.dstIp}:${seg.dstPort}`
    const key = `tcp|${a < b ? a : b}|${a < b ? b : a}` // 两端排序定钥匙：方向无关
    let s = byKey.get(key)
    if (s === undefined) {
      s = { key, client: a, server: b, segments: [], toServer: Buffer.alloc(0), toClient: Buffer.alloc(0) }
      byKey.set(key, s)
      pending.set(s, { c2s: [], s2c: [] })
      sessions.push(s)
    }
    const fromClient = a === s.client
    s.segments.push({ from: fromClient ? 'client' : 'server', flags: flagString(seg), seq: seg.seq, ack: seg.ack, dataBytes: seg.payload.length })
    const parts = pending.get(s)!
    if (seg.payload.length > 0) (fromClient ? parts.c2s : parts.s2c).push({ seq: seg.seq, bytes: seg.payload })
  }
  for (const s of sessions) {
    const parts = pending.get(s)!
    s.toServer = reassemble(parts.c2s)
    s.toClient = reassemble(parts.s2c)
  }
  return { sessions, skipped }
}

function flagString(seg: TcpSegment): string {
  const names: Array<[keyof TcpFlags, string]> = [
    ['syn', 'SYN'],
    ['fin', 'FIN'],
    ['rst', 'RST'],
    ['psh', 'PSH'],
    ['ack', 'ACK'],
  ]
  return names.filter(([k]) => seg.flags[k]).map(([, n]) => n).join('|')
}

// 按序号升序拼接——乱序到达的段在这里回到正确位置
function reassemble(parts: Array<{ seq: number; bytes: Buffer }>): Buffer {
  if (parts.length === 0) return Buffer.alloc(0)
  return Buffer.concat([...parts].sort((x, y) => x.seq - y.seq).map((p) => p.bytes))
}
