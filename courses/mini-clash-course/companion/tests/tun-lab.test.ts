// tests/tun-lab.test.ts —— 第 9 章：TUN 视角的报文解析（IP 头 / TCP 段 / 五元组归组）
// 纪律：纯字节解析，零网络、零等待；样本全部来自 tests/fixtures/tun-sample.ts 的自造教学值。
// 断言的不是实现，而是「字节布局的真相」：版本、头长、总长、协议、端口、序号、标志位——
// 每个期望值都在 fixture 的教学值里一眼可核，与 RFC 791 / RFC 9293 的字段位对得上。
import { describe, expect, it } from 'vitest'
import { FakeIpPool } from '../src/fakeip'
import { groupSessions, parseIpv4Packet, parseTcpSegment } from '../src/tun'
import {
  CLIENT_IP,
  DATA_HEX,
  DATA_PACKET,
  FAKE_IP_STREAM,
  F,
  SERVER_IP,
  SAMPLE_STREAM,
  SYN_HEX,
  SYN_PACKET,
  buildTcpPacket,
  buildUdpPacket,
} from './fixtures/tun-sample'

// —— 单元：拆 IP 信封（parseIpv4Packet） ——

describe('parseIpv4Packet：一包包字节里拆出 IP 头', () => {
  it('SYN 包逐字段：版本 4、头长 20、总长 40、协议 6（TCP）、源/目的 IP；载荷正好是 20 字节 TCP 头', () => {
    expect(SYN_PACKET[0]).toBe(0x45) // 字节 0 的位布局：高 4 位版本 4，低 4 位 IHL 5——「45」就是这么来的
    const p = parseIpv4Packet(SYN_PACKET)!
    expect(p).not.toBeNull()
    expect(p.version).toBe(4)
    expect(p.headerLength).toBe(20)
    expect(p.totalLength).toBe(40) // 20 字节 IP 头 + 20 字节 TCP 头，无载荷
    expect(p.protocol).toBe(6) // 6 = TCP：五元组的「协议」元就住在这一个字节
    expect(p.srcIp).toBe(CLIENT_IP)
    expect(p.dstIp).toBe(SERVER_IP)
    expect(p.payload.length).toBe(20) // IP 层看 TCP：整个 TCP 头就是它的载荷
  })

  it('REPL 十六进制与拼装的字节是同一包：SYN_HEX 喂回去，字段一字不差', () => {
    const p = parseIpv4Packet(Buffer.from(SYN_HEX, 'hex'))!
    expect(p.srcIp).toBe(CLIENT_IP)
    expect(p.dstIp).toBe(SERVER_IP)
    expect(p.payload.readUInt16BE(0)).toBe(53000) // 载荷头两字节就是源端口
    const d = parseIpv4Packet(Buffer.from(DATA_HEX, 'hex'))!
    expect(d.totalLength).toBe(46) // 20 + 20 + 6（'hello ' 六字节）
  })

  it('UDP 包：协议 17，载荷 = 8 字节 UDP 头 + 16 字节 UDP 载荷', () => {
    const udp = buildUdpPacket({ srcIp: CLIENT_IP, srcPort: 53002, dstIp: '198.51.100.7', dstPort: 53, payload: 'udp-demo-payload' })
    const p = parseIpv4Packet(udp)!
    expect(p.protocol).toBe(17)
    expect(p.payload.length).toBe(8 + 16)
  })

  it('残缺与非法还原不出（null）：不足 20 字节、版本不是 4、总长超过实际长度；以太网填充的尾巴不算数', () => {
    expect(parseIpv4Packet(Buffer.alloc(19))).toBeNull() // 连固定头都不齐
    const v6 = Buffer.from(SYN_PACKET)
    v6[0] = 0x60
    expect(parseIpv4Packet(v6)).toBeNull() // 版本 6 的包不是本实验的对象
    expect(parseIpv4Packet(SYN_PACKET.subarray(0, 30))).toBeNull() // 总长 40 > 实际 30：半截包
    const padded = parseIpv4Packet(Buffer.concat([SYN_PACKET, Buffer.alloc(6)]))! // 链路层填充
    expect(padded.totalLength).toBe(40) // 总长说了算：尾巴 6 个 0 不是这份报文的
    expect(padded.payload.length).toBe(20)
  })

  it('IHL=6：按头长跳过 4 字节 IP 选项，TCP 段照常拆得出', () => {
    const withOpts = buildTcpPacket({
      srcIp: SERVER_IP,
      srcPort: 80,
      dstIp: CLIENT_IP,
      dstPort: 53001,
      seq: 7000,
      ack: 2001,
      flags: F.synAck,
      ipOptions: Buffer.from([0x01, 0x01, 0x01, 0x00]), // NOP NOP NOP EOL：真实报文常见的选项填充
    })
    const p = parseIpv4Packet(withOpts)!
    expect(p.headerLength).toBe(24) // 5 + 选项 1 字（4 字节）
    expect(p.totalLength).toBe(44) // 24 + 20
    const seg = parseTcpSegment(p.payload)!
    expect(seg.srcPort).toBe(80) // 选项被跳过，端口才拆得对
    expect(seg.dstPort).toBe(53001)
    expect(seg.seq).toBe(7000)
  })
})

// —— 单元：拆 TCP 段头（parseTcpSegment） ——

describe('parseTcpSegment：从段头里拆出端口、序号与标志位', () => {
  it('握手前两拍：SYN 与 SYN|ACK 的序号、确认号、标志位', () => {
    const syn = parseTcpSegment(parseIpv4Packet(SYN_PACKET)!.payload)!
    expect(syn.srcPort).toBe(53000)
    expect(syn.dstPort).toBe(443)
    expect(syn.seq).toBe(1000) // 客户端起始序号：教学值
    expect(syn.ack).toBe(0) // SYN 不带确认号
    expect(syn.dataOffset).toBe(20)
    expect(syn.flags.syn).toBe(true)
    expect(syn.flags.ack).toBe(false)
    expect(syn.payload.length).toBe(0)

    const synAck = buildTcpPacket({ srcIp: SERVER_IP, srcPort: 443, dstIp: CLIENT_IP, dstPort: 53000, seq: 5000, ack: 1001, flags: F.synAck })
    const s = parseTcpSegment(parseIpv4Packet(synAck)!.payload)!
    expect(s.seq).toBe(5000) // 服务器自己的起始序号
    expect(s.ack).toBe(1001) // 「你的 1000 我收到了，下一字节从 1001 数」
    expect(s.flags.syn).toBe(true)
    expect(s.flags.ack).toBe(true)
  })

  it('数据段：载荷逐字节、PSH|ACK 两位同亮、dataOffset 20', () => {
    const seg = parseTcpSegment(parseIpv4Packet(DATA_PACKET)!.payload)!
    expect(seg.seq).toBe(1001)
    expect(seg.ack).toBe(5001)
    expect(seg.dataOffset).toBe(20)
    expect(seg.flags.psh).toBe(true) // 标志字节 0x18 = 0001 1000：PSH 与 ACK 两位
    expect(seg.flags.ack).toBe(true)
    expect(seg.payload.toString('latin1')).toBe('hello ')
  })

  it('残缺与非法还原不出（null）：不足 20 字节、数据偏移小于 5', () => {
    expect(parseTcpSegment(Buffer.alloc(19))).toBeNull()
    const bad = Buffer.alloc(20)
    bad.writeUInt8(0x40, 12) // 数据偏移 4×4=16 字节 < 20：非法段头
    expect(parseTcpSegment(bad)).toBeNull()
  })
})

// —— 单元：五元组归组（groupSessions） ——

describe('groupSessions：把混流归回连接，按序号拼回字节流', () => {
  it('15 个包（两路对话交错 + 一包 UDP）→ 恰好 2 条连接，UDP 计入 skipped', () => {
    const { sessions, skipped } = groupSessions(SAMPLE_STREAM)
    expect(skipped).toBe(1) // 那包 UDP：协议号不是 6，教学版只如实计数、不硬拆
    expect(sessions.length).toBe(2)
    expect(sessions[0].client).toBe(`${CLIENT_IP}:53000`) // 首包发送方记作客户端
    expect(sessions[0].server).toBe(`${SERVER_IP}:443`)
    expect(sessions[0].key).toBe(`tcp|${CLIENT_IP}:53000|${SERVER_IP}:443`)
    expect(sessions[0].segments.length).toBe(10) // 3 握手 + 3 数据 + 4 挥手
    expect(sessions[0].segments[0].flags).toBe('SYN')
    expect(sessions[1].client).toBe(`${CLIENT_IP}:53001`)
    expect(sessions[1].server).toBe(`${SERVER_IP}:80`) // 同一对 IP、换一个端口：另一条连接
    expect(sessions[1].key).toBe(`tcp|${CLIENT_IP}:53001|${SERVER_IP}:80`)
    expect(sessions[1].segments.length).toBe(4) // 含那包 IHL=6 带 IP 选项的 SYN|ACK——照样归得进
  })

  it('乱序到达仍按序号拼回：world 先到、hello 后到，字节流是 hello world', () => {
    const { sessions } = groupSessions(SAMPLE_STREAM)
    expect(sessions[0].toServer.toString('latin1')).toBe('hello world') // #08（1007）先到、#10（1001）后到
    expect(sessions[0].toClient.toString('latin1')).toBe('HELLO WORLD!')
    expect(sessions[1].toServer.toString('latin1')).toBe('GET / HTTP/1.1\r\n\r\n')
  })

  it('TUN 位置假门牌人人可还：发往 198.18.0.5 的连接一翻账本就是域名', () => {
    // 第 8 章的遗留账在此收口：不经入口的应用拿假门牌连接，在 TUN 位置同样看得见——
    // 归出连接后按目的 IP 翻 fake-ip 账本，门牌当场有主
    const pool = new FakeIpPool()
    for (const filler of ['a.example', 'b.example', 'c.example', 'd.example']) pool.allocate(filler)
    expect(pool.allocate('www.example.com')).toBe('198.18.0.5') // 排到第 5 个号，正是样本流的目的地
    const { sessions } = groupSessions(FAKE_IP_STREAM)
    expect(sessions.length).toBe(1)
    expect(sessions[0].server).toBe('198.18.0.5:443')
    expect(pool.restore(sessions[0].server.split(':')[0])).toBe('www.example.com')
  })
})
