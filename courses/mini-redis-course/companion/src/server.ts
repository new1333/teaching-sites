// 最小 TCP 挂接：net 事件回调 + 每连接一份解码缓冲。
// 事件驱动：谁的数据到了就伺候谁——静默连接不占线程、不占 CPU，第 3 章用测试钉死这条语义。
import net from 'node:net'
import type { MiniRedis } from './db.ts'
import { RespDecoder, encodeError } from './resp.ts'

export interface MiniRedisServer {
  port: number
  close: () => Promise<void>
}

export function createMiniRedisServer(db: MiniRedis, port = 6379): Promise<MiniRedisServer> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      const decoder = new RespDecoder() // 每个连接各一份缓冲：命令不会跨连接串门
      socket.on('data', (chunk) => {
        let commands: string[][]
        try {
          commands = decoder.feed(chunk.toString('utf8'))
        } catch (err) {
          // 协议错误：回一条错误应答，然后送客
          socket.end(encodeError(err instanceof Error ? err.message : 'ERR protocol error'))
          return
        }
        for (const args of commands) socket.write(db.execute(args)) // 到齐几条答几条，天然支持管道
      })
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}
