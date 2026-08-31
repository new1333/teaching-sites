// tests/04-bidirectional-relay.test.ts —— 第 4 章：双向 relay
// 背压（大 payload 全量无损透传，读端故意变慢）、半关闭（一端 FIN 后另一端仍能继续通信）、
// error/close 清理（一端出错后两端都要销毁，relay() 的 Promise 要能收尾）。

import net from 'node:net'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { relay } from '../src/relay.js'
import { closeAsync, connectAsync, destroyAll, listenAsync } from './support.js'

function acceptOnce(server: net.Server): Promise<net.Socket> {
  return new Promise((resolve) => server.once('connection', resolve))
}

/** 搭一对「客户端 socket <-> 服务端接受到的 socket」，返回四个端点：
 * clientA/clientB 是测试脚本直接操作的两端，acceptedA/acceptedB 是要喂给 relay() 的两端。*/
async function buildBridgePair(): Promise<{
  serverA: net.Server
  serverB: net.Server
  clientA: net.Socket
  clientB: net.Socket
  acceptedA: net.Socket
  acceptedB: net.Socket
}> {
  const serverA = net.createServer({ allowHalfOpen: true })
  const serverB = net.createServer({ allowHalfOpen: true })
  const portA = await listenAsync(serverA)
  const portB = await listenAsync(serverB)

  const acceptedAPromise = acceptOnce(serverA)
  const clientA = await connectAsync('127.0.0.1', portA)
  const acceptedA = await acceptedAPromise

  const acceptedBPromise = acceptOnce(serverB)
  const clientB = await connectAsync('127.0.0.1', portB)
  const acceptedB = await acceptedBPromise

  return { serverA, serverB, clientA, clientB, acceptedA, acceptedB }
}

function waitForBytes(socket: net.Socket, n: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let total = Buffer.alloc(0)
    const onData = (chunk: Buffer): void => {
      total = Buffer.concat([total, chunk])
      if (total.length >= n) {
        cleanup()
        resolve(total)
      }
    }
    const onError = (err: Error): void => {
      cleanup()
      reject(err)
    }
    function cleanup(): void {
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.on('error', onError)
  })
}

describe('双向 relay', () => {
  it('大 payload 在慢速读端下依旧完整无损（背压不丢数据、不做字符串拼接）', async () => {
    const { serverA, serverB, clientA, clientB, acceptedA, acceptedB } = await buildBridgePair()
    const relayDone = relay(acceptedA, acceptedB)

    const payload = crypto.randomBytes(4 * 1024 * 1024) // 4MB 随机二进制，含所有字节值，字符串拼接会损坏它
    const expectedHash = crypto.createHash('sha256').update(payload).digest('hex')

    // 读端故意变慢：先 pause，定时小批量 resume，逼出内部缓冲，验证背压路径不丢字节
    clientB.pause()
    let resumed = false
    const slowResume = setInterval(() => {
      if (!resumed) {
        clientB.resume()
        resumed = true
      }
    }, 20)

    const receivedPromise = waitForBytes(clientB, payload.length)
    clientA.write(payload)
    const received = await receivedPromise
    clearInterval(slowResume)

    expect(received.length).toBe(payload.length)
    expect(crypto.createHash('sha256').update(received).digest('hex')).toBe(expectedHash)

    destroyAll(clientA, clientB, acceptedA, acceptedB)
    await relayDone
    await Promise.all([closeAsync(serverA), closeAsync(serverB)])
  })

  it('半关闭：一端 end() 之后，另一端仍能继续收发数据', async () => {
    const { serverA, serverB, clientA, clientB, acceptedA, acceptedB } = await buildBridgePair()
    const relayDone = relay(acceptedA, acceptedB)

    const firstHalf = waitForBytes(clientB, 'first-half'.length)
    clientA.write('first-half')
    expect((await firstHalf).toString('utf8')).toBe('first-half')

    const clientBEnded = new Promise<void>((resolve) => clientB.once('end', resolve))
    clientA.end() // 半关闭：A 不再发送，但 A 的读端应该还能收数据

    await clientBEnded // A 的 FIN 应该被转发到 B（clientB 侧收到 end）

    const replyAfterHalfClose = waitForBytes(clientA, 'reply-after-half-close'.length)
    clientB.write('reply-after-half-close') // B 的读端没关，仍可以往回写
    expect((await replyAfterHalfClose).toString('utf8')).toBe('reply-after-half-close')

    destroyAll(clientA, clientB, acceptedA, acceptedB)
    await relayDone
    await Promise.all([closeAsync(serverA), closeAsync(serverB)])
  })

  it('一端出错时两端都被清理，relay() 的 Promise 会 resolve 收尾', async () => {
    const { serverA, serverB, clientA, clientB, acceptedA, acceptedB } = await buildBridgePair()
    const relayDone = relay(acceptedA, acceptedB)

    acceptedA.destroy(new Error('simulated failure'))
    await relayDone

    expect(acceptedA.destroyed).toBe(true)
    expect(acceptedB.destroyed).toBe(true)

    destroyAll(clientA, clientB)
    await Promise.all([closeAsync(serverA), closeAsync(serverB)])
  })

  it('normal close：任一端正常关闭后 relay() 也会收尾，不留下悬挂 socket', async () => {
    const { serverA, serverB, clientA, clientB, acceptedA, acceptedB } = await buildBridgePair()
    const relayDone = relay(acceptedA, acceptedB)

    clientA.destroy()
    clientB.destroy()
    await relayDone

    expect(acceptedA.destroyed).toBe(true)
    expect(acceptedB.destroyed).toBe(true)

    await Promise.all([closeAsync(serverA), closeAsync(serverB)])
  })
})
