// companion/demo/two-hop-demo.ts —— 亲手开机：一条命令拉起「目标站 + 远端中继 + SOCKS5 入口」，另开终端用 curl 走一遍两跳
// 跑法：cd companion && npm run demo:two-hop
import net from 'node:net'
import { connectViaRelay, startRelayServer } from '../src/relay'
import { startSocks5Server } from '../src/socks5'

// 最小目标站：收完一个 GET 的头部就回一页 HTML（与前两章 demo 同款）
const target = net.createServer((socket) => {
  let buf = Buffer.alloc(0)
  socket.on('data', (b) => {
    buf = Buffer.concat([buf, b])
    if (!buf.includes('\r\n\r\n')) return // 头没到齐：接着攒
    const body = '<html><body><h1>hello via two hops</h1></body></html>'
    socket.end(
      'HTTP/1.1 200 OK\r\n' +
        'Content-Type: text/html\r\n' +
        `Content-Length: ${body.length}\r\n` +
        'Connection: close\r\n' +
        `\r\n${body}`,
    )
  })
})

target.listen(0, '127.0.0.1', () => {
  const tport = (target.address() as net.AddressInfo).port
  void startRelayServer({ port: 0 }).then((relay) => {
    // 两跳的接法就在这个钩子里：入口不再直连目标，而是把目标装进 CONNECT 帧请远端代连
    void startSocks5Server({
      port: 0,
      onConnect: (t) => connectViaRelay({ host: '127.0.0.1', port: relay.port }, t),
    }).then((entry) => {
      console.log('目标站已监听:      127.0.0.1:' + tport)
      console.log('远端中继已监听:    127.0.0.1:' + relay.port)
      console.log('SOCKS5 入口已监听: 127.0.0.1:' + entry.port)
      console.log('')
      console.log('另开一个终端，运行:')
      console.log(`  curl --socks5-hostname 127.0.0.1:${entry.port} http://127.0.0.1:${tport}/`)
      console.log('')
      console.log('这条请求的完整路径（路径见证）:')
      console.log('  curl（浏览器侧）')
      console.log(`    │ 第一跳：SOCKS5 报目标`)
      console.log(`    ▼`)
      console.log(`  入口 127.0.0.1:${entry.port} —— CONNECT 帧递上目标、明文帧搬运`)
      console.log(`    │ 第二跳：自定义帧`)
      console.log(`    ▼`)
      console.log(`  远端中继 127.0.0.1:${relay.port} —— 代连目标`)
      console.log(`    ▼`)
      console.log(`  目标站 127.0.0.1:${tport}`)
      console.log('')
      console.log('应看到 <h1>hello via two hops</h1>；Ctrl+C 收摊。')
      console.log('（真实部署里远端中继在另一台机器上；教学版按第 1 章的约定把它搬进本机回环，链路形状不变。）')
    })
  })
})
