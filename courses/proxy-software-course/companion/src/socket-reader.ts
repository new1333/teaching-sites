// src/socket-reader.ts —— 在裸 TCP socket 上做「读到分隔符 / 读定长」的顺序化读取
// HTTP 请求头解析、SOCKS5 握手都需要面对 TCP 分片：数据可能一次到齐，也可能一字节一字节地来。
// release() 之后用 socket.unshift() 把多读到的字节塞回可读端，交还给 relay 做管道转发，
// 不需要调用方手动拼接遗留缓冲区。

import type { Socket } from 'node:net'

export interface SocketReader {
  /** 读到出现 delimiter 为止，返回 delimiter 之前的数据（不含 delimiter）。超过 maxBytes 未见分隔符则拒绝。*/
  readUntil(delimiter: Buffer, maxBytes: number): Promise<Buffer>
  /** 读满 n 字节后返回。*/
  readExact(n: number): Promise<Buffer>
  /** 停止消费 socket 数据，把已缓冲但未消费的字节退回可读端，交还给后续的管道/其他消费者。*/
  release(): void
}

type Pending =
  | { readonly kind: 'until'; readonly delimiter: Buffer; readonly maxBytes: number; readonly resolve: (buf: Buffer) => void; readonly reject: (err: Error) => void }
  | { readonly kind: 'exact'; readonly n: number; readonly resolve: (buf: Buffer) => void; readonly reject: (err: Error) => void }

export function createSocketReader(socket: Socket): SocketReader {
  let buffer = Buffer.alloc(0)
  let pending: Pending | null = null
  let released = false
  let terminated: Error | null = null

  function onData(chunk: Buffer): void {
    buffer = Buffer.concat([buffer, chunk])
    tryFulfill()
  }

  function onEnd(): void {
    terminated = new Error('socket ended before read completed')
    failPending()
  }

  function onError(err: Error): void {
    terminated = err
    failPending()
  }

  function failPending(): void {
    if (pending && terminated) {
      const err = terminated
      const p = pending
      pending = null
      p.reject(err)
    }
  }

  function tryFulfill(): void {
    if (!pending) return
    if (pending.kind === 'exact') {
      if (buffer.length >= pending.n) {
        const out = buffer.subarray(0, pending.n)
        buffer = buffer.subarray(pending.n)
        const resolve = pending.resolve
        pending = null
        resolve(out)
      }
      return
    }
    const idx = buffer.indexOf(pending.delimiter)
    if (idx >= 0) {
      const out = buffer.subarray(0, idx)
      buffer = buffer.subarray(idx + pending.delimiter.length)
      const resolve = pending.resolve
      pending = null
      resolve(out)
      return
    }
    if (buffer.length > pending.maxBytes) {
      const reject = pending.reject
      pending = null
      reject(new Error('read exceeded maxBytes before delimiter was found'))
    }
  }

  socket.on('data', onData)
  socket.on('end', onEnd)
  socket.on('close', onEnd)
  socket.on('error', onError)

  return {
    readUntil(delimiter, maxBytes) {
      if (released) return Promise.reject(new Error('socket reader already released'))
      if (pending) return Promise.reject(new Error('a read is already pending'))
      if (terminated) return Promise.reject(terminated)
      return new Promise<Buffer>((resolve, reject) => {
        pending = { kind: 'until', delimiter, maxBytes, resolve, reject }
        tryFulfill()
      })
    },
    readExact(n) {
      if (released) return Promise.reject(new Error('socket reader already released'))
      if (pending) return Promise.reject(new Error('a read is already pending'))
      if (terminated) return Promise.reject(terminated)
      return new Promise<Buffer>((resolve, reject) => {
        pending = { kind: 'exact', n, resolve, reject }
        tryFulfill()
      })
    },
    release() {
      if (released) return
      released = true
      socket.pause()
      socket.off('data', onData)
      socket.off('end', onEnd)
      socket.off('close', onEnd)
      socket.off('error', onError)
      if (buffer.length > 0) {
        socket.unshift(buffer)
        buffer = Buffer.alloc(0)
      }
    },
  }
}
