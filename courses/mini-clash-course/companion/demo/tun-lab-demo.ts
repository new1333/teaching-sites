// companion/demo/tun-lab-demo.ts —— 亲手开机：TUN 视角三幕（全程在自造样本上，不碰真实网卡）
// 第一幕：一包进五元组出——把 SYN 包的十六进制喂给解析器，逐字段打印
// 第二幕：全机混流归组——15 个包（两路对话交错 + 一包 UDP）→ 2 条连接；乱序到达的段按序号拼回
// 第三幕：假门牌人人可还——发往 198.18.0.5 的连接在 TUN 位置同样被归组，账本一翻就有主（第 8 章的代价在此根治）
// 跑法：cd companion && npm run demo:tun-lab
import { FakeIpPool } from '../src/fakeip'
import { groupSessions, parseIpv4Packet, parseTcpSegment, type TcpFlags, type TcpSegment } from '../src/tun'
import { FAKE_IP_STREAM, SAMPLE_STREAM, SYN_HEX } from '../tests/fixtures/tun-sample'

// 十六进制排版：两字节一组，方便跟读
function hex(buf: Buffer): string {
  return buf.toString('hex').replace(/(..)/g, '$1 ').trim()
}

// —— 第一幕：一包进，五元组出 ——

console.log('—— 第一幕：一包原始报文进，五元组出 ——')
const synBuf = Buffer.from(SYN_HEX, 'hex')
const ip = parseIpv4Packet(synBuf)!
const seg = parseTcpSegment(ip.payload)!
console.log(`  喂进 40 个字节: ${hex(synBuf)}`)
console.log(`  IP 头: 版本 ${ip.version}  头长 ${ip.headerLength}  总长 ${ip.totalLength}  协议 ${ip.protocol}（6 = TCP）`)
console.log(`        ${ip.srcIp} → ${ip.dstIp}`)
console.log(`  TCP 头: ${seg.srcPort} → ${seg.dstPort}  seq=${seg.seq}  ack=${seg.ack}  标志 ${demoFlags(seg)}  载荷 ${seg.payload.length} 字节`)
console.log('  （同样的 40 个字节喂给 REPL 也一样——本章全部实验都在这种自造样本上，不动真实网卡。）')

// —— 第二幕：全机混流归组 ——

console.log('')
console.log('—— 第二幕：15 个包（两路对话交错 + 一包 UDP）归回连接 ——')
const { sessions, skipped } = groupSessions(SAMPLE_STREAM)
SAMPLE_STREAM.forEach((buf, i) => {
  const p = parseIpv4Packet(buf)
  if (p === null || p.protocol !== 6) {
    console.log(`  #${String(i + 1).padStart(2, '0')} ···· 非 TCP 包（协议 ${p?.protocol ?? '?'}）：教学版不硬拆，如实计数`)
    return
  }
  const s = parseTcpSegment(p.payload)!
  const arrow = s.srcPort >= 50000 ? 'C→S' : 'S→C'
  console.log(
    `  #${String(i + 1).padStart(2, '0')} ${arrow} ${p.srcIp}:${s.srcPort} → ${p.dstIp}:${s.dstPort}` +
      `  ${demoFlags(s).padEnd(8)} seq=${String(s.seq).padEnd(5)} ack=${String(s.ack).padEnd(5)} 载荷 ${s.payload.length} 字节` +
      (s.payload.length > 0 ? `  ${JSON.stringify(s.payload.toString('latin1'))}` : '')
  )
})
console.log(`  归组结果：${sessions.length} 条 TCP 连接 + ${skipped} 包非 TCP（skipped）`)
for (const [i, s] of sessions.entries()) {
  console.log(`  连接 ${i + 1}  ${s.key}  共 ${s.segments.length} 段（首包发送方记作 client）`)
  console.log(`    C→S 字节流（按序号拼回，${s.toServer.length} 字节）: ${JSON.stringify(s.toServer.toString('latin1'))}`)
  console.log(`    S→C 字节流（按序号拼回，${s.toClient.length} 字节）: ${JSON.stringify(s.toClient.toString('latin1'))}`)
}
console.log('  （连接 A 的两段数据「先 world 后 hello 」乱序到达——序号 1007 先来、1001 后到，拼回后仍是 hello world。）')

// —— 第三幕：假门牌人人可还 ——

console.log('')
console.log('—— 第三幕：TUN 位置，假门牌人人可还 ——')
const pool = new FakeIpPool()
for (const filler of ['a.example', 'b.example', 'c.example', 'd.example']) pool.allocate(filler)
pool.allocate('www.example.com') // 排到第 5 个号：198.18.0.5
const fake = groupSessions(FAKE_IP_STREAM).sessions[0]
console.log(`  全机混流里出现一条连接: ${fake.client} → ${fake.server}（三拍握手，${fake.segments.length} 段）`)
const domain = pool.restore(fake.server.split(':')[0])
console.log(`  目的 IP ${fake.server.split(':')[0]} 翻 fake-ip 账本 → ${domain}`)
console.log('  （第 8 章的遗留账：不经入口的应用拿假门牌无人还原——TUN 看得见全机每一条连接，账本在这里人人可还。）')
console.log('')
console.log('收摊。TUN 解析件与 fake-ip 账本的这次合演长在 demo 里；真实 TUN 设备与用户态栈的差异见差异清单。')

// —— 小工具 ——

function demoFlags(seg: TcpSegment): string {
  const names: Array<[keyof TcpFlags, string]> = [
    ['syn', 'SYN'],
    ['fin', 'FIN'],
    ['rst', 'RST'],
    ['psh', 'PSH'],
    ['ack', 'ACK'],
  ]
  const on = names.filter(([k]) => seg.flags[k]).map(([, n]) => n)
  return on.length > 0 ? on.join('|') : '·'
}
