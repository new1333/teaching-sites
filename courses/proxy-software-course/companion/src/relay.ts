// src/relay.ts —— 双向转发：pipe 处理背压、半关闭转发、error/close 统一清理
// 不手写 Buffer 拼接转发正文——Node 的 pipe() 本身就会在下游写不过来时暂停上游读取，
// 这正是这里要的背压。半关闭（一端只发不收，或者反过来）通过监听 'end' 转发对端 FIN 实现。

import type { Socket } from 'node:net'
import type { EventSink } from './types.js'

/**
 * 建立 a<->b 的双向转发，返回的 Promise 在两端都清理完毕后 resolve。
 * 不会抛错：任何一端出错都会被吞掉、记入 sink，并销毁两端 socket。
 */
export function relay(a: Socket, b: Socket, sink?: EventSink): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    function finish(message: string, detail?: Record<string, unknown>): void {
      if (settled) return
      settled = true
      a.destroy()
      b.destroy()
      sink?.({ type: 'relay-close', message, detail })
      resolve()
    }

    a.on('error', (err) => finish('relay-error', { side: 'a', error: err.message }))
    b.on('error', (err) => finish('relay-error', { side: 'b', error: err.message }))
    a.on('close', () => finish('relay-close', { side: 'a' }))
    b.on('close', () => finish('relay-close', { side: 'b' }))

    // 半关闭：一端收到 FIN（'end'）后，把 FIN 转发给另一端，而不是立刻整条连接砍掉
    a.on('end', () => {
      if (!b.destroyed) b.end()
    })
    b.on('end', () => {
      if (!a.destroyed) a.end()
    })

    a.pipe(b, { end: false })
    b.pipe(a, { end: false })
  })
}
