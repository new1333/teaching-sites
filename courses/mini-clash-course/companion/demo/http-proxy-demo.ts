// companion/demo/http-proxy-demo.ts —— 亲手开机：一条命令拉起「目标站 + 代理」，另开终端用 curl 走一遍
// 跑法：cd companion && npm run demo:http-proxy
import net from 'node:net'
import { startHttpProxy } from '../src/http-proxy'

// 最小目标站：收完一个 GET 的头部就回一页 HTML（回环上自己的「网站」）
const target = net.createServer((socket) => {
  let buf = Buffer.alloc(0)
  socket.on('data', (b) => {
    buf = Buffer.concat([buf, b])
    if (!buf.includes('\r\n\r\n')) return // 头没到齐：接着攒
    const body = '<html><body><h1>hello via proxy</h1></body></html>'
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
  void startHttpProxy({ port: 0 }).then((proxy) => {
    console.log('目标站已监听:  127.0.0.1:' + tport)
    console.log('代理已监听:    127.0.0.1:' + proxy.port)
    console.log('')
    console.log('另开一个终端，运行（-v 能看到发给代理的请求行长什么样）:')
    console.log(`  curl -v -x 127.0.0.1:${proxy.port} http://127.0.0.1:${tport}/`)
    console.log('')
    console.log('应看到 <h1>hello via proxy</h1>；Ctrl+C 收摊。')
  })
})
