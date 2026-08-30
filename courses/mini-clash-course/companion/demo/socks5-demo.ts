// companion/demo/socks5-demo.ts —— 亲手开机：一条命令拉起「目标站 + SOCKS5 入口」，另开终端用 curl 走一遍
// 跑法：cd companion && npm run demo:socks5
import net from 'node:net'
import { startSocks5Server } from '../src/socks5'

// 最小目标站：收完一个 GET 的头部就回一页 HTML（与第 2 章 demo 同款）
const target = net.createServer((socket) => {
  let buf = Buffer.alloc(0)
  socket.on('data', (b) => {
    buf = Buffer.concat([buf, b])
    if (!buf.includes('\r\n\r\n')) return // 头没到齐：接着攒
    const body = '<html><body><h1>hello via socks5</h1></body></html>'
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
  void startSocks5Server({ port: 0 }).then((server) => {
    console.log('目标站已监听:     127.0.0.1:' + tport)
    console.log('SOCKS5 入口已监听: 127.0.0.1:' + server.port)
    console.log('')
    console.log('另开一个终端，运行:')
    console.log(`  curl --socks5-hostname 127.0.0.1:${server.port} http://127.0.0.1:${tport}/`)
    console.log('')
    console.log('应看到 <h1>hello via socks5</h1>；Ctrl+C 收摊。')
  })
})
