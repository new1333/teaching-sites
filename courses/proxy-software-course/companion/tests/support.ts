// tests/support.ts —— 测试专用小工具：起停 server、读写裸 socket；不对应任何独立章节
// 全部测试只连 127.0.0.1，不出网。

import net from 'node:net'

export function getPort(server: net.Server): number {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') throw new Error('server has no TCP address')
  return addr.port
}

export function listenAsync(server: net.Server, host = '127.0.0.1', port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve(getPort(server)))
  })
}

export function closeAsync(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

export function connectAsync(host: string, port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    // allowHalfOpen: true 让测试能真实验证半关闭语义，而不是被 Node 默认行为提前收尾。
    const socket = net.connect({ host, port, allowHalfOpen: true })
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

/** 读到对端自然关闭（'end'/'close'）为止，拼出完整响应。调用方要保证对端最终会关闭连接。*/
export function readUntilClose(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => resolve(Buffer.concat(chunks)))
    socket.on('close', () => resolve(Buffer.concat(chunks)))
    socket.on('error', reject)
    // 如果这个 socket 之前被 SocketReader.release() 显式 pause() 过，flowing 会停在 false，
    // 光加 'data' 监听器不会自动恢复流动，必须手动 resume 一下。
    socket.resume()
  })
}

/** 读到累计字节数达到 n（或超时）为止；用于连接不会主动关闭、只需要读一段前缀的场景。*/
export function readAtLeast(socket: net.Socket, n: number, timeoutMs = 3000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = Buffer.alloc(0)
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`readAtLeast timed out waiting for ${n} bytes, got ${total.length}`))
    }, timeoutMs)
    function onData(chunk: Buffer): void {
      total = Buffer.concat([total, chunk])
      if (total.length >= n) {
        cleanup()
        resolve(total)
      }
    }
    function onError(err: Error): void {
      cleanup()
      reject(err)
    }
    function cleanup(): void {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.on('error', onError)
    socket.resume()
  })
}

export function destroyAll(...sockets: readonly (net.Socket | undefined)[]): void {
  for (const socket of sockets) {
    if (socket && !socket.destroyed) socket.destroy()
  }
}

/** 起一个原样回显的 TCP server，供 relay / CONNECT 隧道 / SOCKS5 CONNECT 测试复用。*/
export function createEchoServer(): net.Server {
  return net.createServer({ allowHalfOpen: true }, (socket) => {
    socket.pipe(socket)
  })
}
