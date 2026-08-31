// 反例服务器（教学对照）：「最笨版」——接进一个连接就从头到尾只伺候它，
// 它不离场，后面的连接一个都不碰。专门用来亲眼看见「一个不敲字的客户端冻结全场」。
// 正式版在 server.ts（事件驱动，谁的 data 到了伺候谁）——两份对照着读。
import net from 'node:net'
import type { MiniRedis } from './db.ts'
import { RespDecoder, encodeError } from './resp.ts'
import type { MiniRedisServer } from './server.ts'

// 伺候一个连接直到它离场：数据到就解、解出就答；连接关闭时 Promise 才 resolve。
function serveClient(socket: net.Socket, db: MiniRedis): Promise<void> {
  return new Promise((done) => {
    const decoder = new RespDecoder() // 同款解码器：反例笨在并发模型，不在协议
    socket.on('data', (chunk) => {
      try {
        for (const args of decoder.feed(chunk.toString('utf8'))) socket.write(db.execute(args))
      } catch (err) {
        socket.end(encodeError(err instanceof Error ? err.message : 'ERR protocol error'))
      }
    })
    socket.on('close', () => done()) // 离场 = 连接关闭；半路断掉也一样
    socket.on('error', () => done())
  })
}

export function createNaiveMiniRedisServer(db: MiniRedis, port = 6379): Promise<MiniRedisServer> {
  return new Promise((resolve) => {
    const server = net.createServer()
    const queue: net.Socket[] = [] // 还没轮到的连接：数据躺在内核缓冲里，没人读
    const sockets = new Set<net.Socket>()
    let busy = false // 一次只伺候一个连接——「最笨」的全部含义就在这个标志位

    // 从队列领一个连接，伺候到它离场，再领下一个——教科书阻塞版 accept 循环的直译
    async function takeNext(): Promise<void> {
      if (busy) return
      const socket = queue.shift()
      if (socket === undefined) return
      busy = true
      await serveClient(socket, db)
      busy = false
      await takeNext()
    }

    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      queue.push(socket)
      void takeNext()
    })
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => {
          for (const s of sockets) s.destroy() // 清场：没伺候完的一并断掉
          return new Promise((done) => server.close(() => done()))
        },
      })
    })
  })
}
