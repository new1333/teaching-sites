// tests/fixtures/tun-sample.ts —— 第 9 章道具：自造的教学报文样本
// 纪律：不从真实网络抓包、不引入 pcap 依赖——全部字节由下面的拼装函数按教学值现场构造。
// 值全挑「好念好断言」的教学数：IP 用 RFC 5737 文档段（192.0.2.x / 203.0.113.x / 198.51.100.x，
// 不会分给真实主机），端口与序号取整数——测试断言的字段一眼可核，正文跟读的十六进制一字节一字节对得上。
// 拼装是解析的镜像：builder 从字段拼字节，src/tun.ts 从字节拆回字段——两边对上，字节布局就没有歧义。

// —— 教学值常量 ——

export const CLIENT_IP = '192.0.2.10' // 客户端：RFC 5737 文档段 TEST-NET-1
export const SERVER_IP = '203.0.113.20' // 服务器：文档段 TEST-NET-3
export const FAKE_IP = '198.18.0.5' // 第 8 章假门牌网段里的一个号（第三幕「人人可还」用）

// —— 拼装：IP + TCP ——
// flags 名字与 src/tun.ts 解析结果同形（syn/ack/fin/rst/psh），拼与拆说同一套词
export interface TcpPacketSpec {
  srcIp: string
  srcPort: number
  dstIp: string
  dstPort: number
  seq: number
  ack?: number // 不写就是 0
  flags?: { syn?: boolean; ack?: boolean; fin?: boolean; rst?: boolean; psh?: boolean }
  payload?: Buffer | string
  ipOptions?: Buffer // IHL > 5 时插在 20 字节固定头之后；长度须是 4 的倍数
}

// 常用标志组合的速记
export const F = {
  syn: { syn: true },
  synAck: { syn: true, ack: true },
  ack: { ack: true },
  pshAck: { psh: true, ack: true },
  finAck: { fin: true, ack: true },
} as const

export function buildTcpPacket(spec: TcpPacketSpec): Buffer {
  const payload = typeof spec.payload === 'string' ? Buffer.from(spec.payload, 'latin1') : (spec.payload ?? Buffer.alloc(0))
  const options = spec.ipOptions ?? Buffer.alloc(0)
  if (options.length % 4 !== 0) throw new Error('IP 选项长度须是 4 的倍数（IHL 按字数计）')

  // TCP 段头（裁判是 RFC 9293）：20 字节固定头，教学样本不带 TCP 选项
  const tcp = Buffer.alloc(20)
  tcp.writeUInt16BE(spec.srcPort, 0)
  tcp.writeUInt16BE(spec.dstPort, 2)
  tcp.writeUInt32BE(spec.seq, 4)
  tcp.writeUInt32BE(spec.ack ?? 0, 8)
  let bits = 0
  if (spec.flags?.fin) bits |= 0x01
  if (spec.flags?.syn) bits |= 0x02
  if (spec.flags?.rst) bits |= 0x04
  if (spec.flags?.psh) bits |= 0x08
  if (spec.flags?.ack) bits |= 0x10
  tcp.writeUInt8((5 << 4) | 0, 12) // 数据偏移 5×4=20 字节，保留位 0
  tcp.writeUInt8(bits, 13)
  tcp.writeUInt16BE(0x1000, 14) // 窗口：教学值 4096
  // 校验和（16-17）与紧急指针（18-19）：教学样本全 0，解析器也不验（差异登记附录）

  return Buffer.concat([ipv4Header(spec.srcIp, spec.dstIp, 6, options, tcp.length + payload.length), tcp, payload])
}

// —— 拼装：IP + UDP（流里那包「非 TCP」，证明协议号这元也在起作用） ——

export interface UdpPacketSpec {
  srcIp: string
  srcPort: number
  dstIp: string
  dstPort: number
  payload?: Buffer | string
}

export function buildUdpPacket(spec: UdpPacketSpec): Buffer {
  const payload = typeof spec.payload === 'string' ? Buffer.from(spec.payload, 'latin1') : (spec.payload ?? Buffer.alloc(0))
  const udp = Buffer.alloc(8) // UDP 头：源端口、目的端口、长度、校验和——教学样本校验和全 0
  udp.writeUInt16BE(spec.srcPort, 0)
  udp.writeUInt16BE(spec.dstPort, 2)
  udp.writeUInt16BE(8 + payload.length, 4)
  return Buffer.concat([ipv4Header(spec.srcIp, spec.dstIp, 17, Buffer.alloc(0), 8 + payload.length), udp, payload])
}

// IPv4 头（裁判是 RFC 791）：固定 20 字节 + 可选选项；校验和填 0（不启用、不验证）
function ipv4Header(srcIp: string, dstIp: string, protocol: number, options: Buffer, transportLength: number): Buffer {
  const ip = Buffer.alloc(20 + options.length)
  ip.writeUInt8((4 << 4) | (5 + options.length / 4), 0) // 高 4 位版本 4，低 4 位 IHL（单位：4 字节）
  ip.writeUInt16BE(20 + options.length + transportLength, 2) // 总长 = IP 头 + 传输层全部
  ip.writeUInt16BE(0x4000, 6) // 标志与分片偏移：DF（不许分片）；教学样本不分片
  ip.writeUInt8(64, 8) // TTL：教学值 64
  ip.writeUInt8(protocol, 9) // 协议：6 = TCP、17 = UDP——五元组的「协议」元就在这一个字节
  writeIp(ip, 12, srcIp)
  writeIp(ip, 16, dstIp)
  options.copy(ip, 20)
  return ip
}

function writeIp(buf: Buffer, off: number, ip: string): void {
  ip.split('.').forEach((seg, i) => buf.writeUInt8(Number(seg), off + i))
}

// —— 样本一：一次完整的 TCP 对话（三次握手 + 两段数据 + 挥手，双向） ——
// 剧情编好了教学点：客户端两段数据「先发 world 后发 hello 」——样本流里故意让它乱序到达，
// 归组后的重排能不能拼回 'hello world'，就是「按序号重组」的机械证据。
// 序号走位：客户端 1000(SYN) → 1001('hello ') → 1007('world') → 1012(FIN)；
//           服务器 5000(SYN|ACK) → 5001('HELLO WORLD!' 12 字节) → 5013(FIN)。

const toServer443 = (seq: number, ack: number, flags: TcpPacketSpec['flags'], payload?: string) =>
  buildTcpPacket({ srcIp: CLIENT_IP, srcPort: 53000, dstIp: SERVER_IP, dstPort: 443, seq, ack, flags, payload })
const toClient443 = (seq: number, ack: number, flags: TcpPacketSpec['flags'], payload?: string) =>
  buildTcpPacket({ srcIp: SERVER_IP, srcPort: 443, dstIp: CLIENT_IP, dstPort: 53000, seq, ack, flags, payload })

export const SYN_PACKET = toServer443(1000, 0, F.syn) // 第一拍：SYN，序号 1000
export const SYN_HEX = SYN_PACKET.toString('hex') // 正文 REPL 喂的就是这一串
export const DATA_PACKET = toServer443(1001, 5001, F.pshAck, 'hello ') // 数据段：序号 1001，载荷 6 字节（此刻只见过握手，ack 停在 5001）
export const DATA_HEX = DATA_PACKET.toString('hex')

// —— 样本二：同一台服务器的另一路对话（端口不同）——五元组「缺一不可」的活体证明 ——
// 服务器 SYN|ACK 那包带 4 字节 IP 选项（NOP NOP NOP EOL）：IHL=6，解析器必须按头长跳过选项再拆 TCP。

const toServer80 = (seq: number, ack: number, flags: TcpPacketSpec['flags'], payload?: string, ipOptions?: Buffer) =>
  buildTcpPacket({ srcIp: CLIENT_IP, srcPort: 53001, dstIp: SERVER_IP, dstPort: 80, seq, ack, flags, payload, ipOptions })
const toClient80 = (seq: number, ack: number, flags: TcpPacketSpec['flags'], ipOptions?: Buffer) =>
  buildTcpPacket({ srcIp: SERVER_IP, srcPort: 80, dstIp: CLIENT_IP, dstPort: 53001, seq, ack, flags, ipOptions })

// —— 样本流：15 个包，两路对话交错到达 + 一包 UDP 混在里面 ——
// 真实 TUN 递过来的就是这种「全机混流」；教学样本把交错做成常态，归组才有戏可做。
export const SAMPLE_STREAM: Buffer[] = [
  toServer443(1000, 0, F.syn), // #01 对话 A：SYN
  toServer80(2000, 0, F.syn), // #02 对话 B：SYN（同一个客户端、同一台服务器，端口 80）
  toClient443(5000, 1001, F.synAck), // #03 对话 A：SYN|ACK
  toClient80(7000, 2001, F.synAck, Buffer.from([0x01, 0x01, 0x01, 0x00])), // #04 对话 B：SYN|ACK（带 4 字节 IP 选项）
  toServer443(1001, 5001, F.ack), // #05 对话 A：ACK，握手完成
  buildUdpPacket({ srcIp: CLIENT_IP, srcPort: 53002, dstIp: '198.51.100.7', dstPort: 53, payload: 'udp-demo-payload' }), // #06 一包 UDP（协议 17）混在流里
  toServer80(2001, 7001, F.ack), // #07 对话 B：ACK，握手完成
  toServer443(1007, 5001, F.pshAck, 'world'), // #08 对话 A：第二段数据「先到」（序号 1007）
  toServer80(2001, 7001, F.pshAck, 'GET / HTTP/1.1\r\n\r\n'), // #09 对话 B：一段数据（第 2 章的老朋友）
  toServer443(1001, 5001, F.pshAck, 'hello '), // #10 对话 A：第一段数据「后到」（序号 1001）
  toClient443(5001, 1012, F.pshAck, 'HELLO WORLD!'), // #11 对话 A：服务器回话（12 字节）
  toServer443(1012, 5013, F.finAck), // #12 对话 A：客户端挥手 FIN|ACK
  toClient443(5013, 1013, F.ack), // #13 对话 A：服务器应答挥手
  toClient443(5013, 1013, F.finAck), // #14 对话 A：服务器也挥手
  toServer443(1013, 5014, F.ack), // #15 对话 A：客户端最后应答，连接收摊
]

// —— 样本三：发往假门牌的连接（第三幕「人人可还」用） ——
// 第 8 章的遗留账：不经入口的应用拿到假门牌无人还原。TUN 位置看得见全机每一条连接，
// 发往 198.18.0.5 的三拍握手在这里同样被归成一条连接——账本一翻，门牌就有主了。
export const FAKE_IP_STREAM: Buffer[] = [
  buildTcpPacket({ srcIp: CLIENT_IP, srcPort: 53003, dstIp: FAKE_IP, dstPort: 443, seq: 3000, flags: F.syn }),
  buildTcpPacket({ srcIp: FAKE_IP, srcPort: 443, dstIp: CLIENT_IP, dstPort: 53003, seq: 9000, ack: 3001, flags: F.synAck }),
  buildTcpPacket({ srcIp: CLIENT_IP, srcPort: 53003, dstIp: FAKE_IP, dstPort: 443, seq: 3001, ack: 9001, flags: F.ack }),
]
