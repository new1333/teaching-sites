import type { Channel } from './channel'

/**
 * 双向 RPC：通信双方互为客户端与服务端。
 *
 * 消息信封只有两种：
 * - 请求：{ type: 'request', id, method, args }
 * - 响应：{ type: 'response', id, result } 或 { type: 'response', id, error }
 *
 * id 自增配对；没有超时——调试器的对端可能正在忙（大应用遍历），
 * 一条请求等多久都不该被本地放弃。
 */

type RpcRequest = { type: 'request', id: number, method: string, args: unknown[] }
type RpcResponse = { type: 'response', id: number, result?: unknown, error?: string }
type RpcMessage = RpcRequest | RpcResponse

export type RpcFunctions = Record<string, (...args: any[]) => unknown>

export interface RpcClient {
  call(method: string, ...args: unknown[]): Promise<unknown>
}

export function createRpc(functions: RpcFunctions, channel: Channel): RpcClient {
  const pending = new Map<number, { resolve: (value: unknown) => void, reject: (reason: Error) => void }>()
  let seq = 0

  channel.on((data) => {
    const message = data as RpcMessage
    if (message.type === 'request') {
      const fn = functions[message.method]
      if (!fn) {
        channel.post({ type: 'response', id: message.id, error: `unknown method: ${message.method}` } satisfies RpcResponse)
        return
      }
      Promise.resolve()
        .then(() => fn(...message.args))
        .then(result => channel.post({ type: 'response', id: message.id, result } satisfies RpcResponse))
        .catch(error => channel.post({ type: 'response', id: message.id, error: error instanceof Error ? error.message : String(error) } satisfies RpcResponse))
      return
    }

    if (message.type === 'response') {
      const entry = pending.get(message.id)
      if (!entry)
        return                            // 迟到的响应：无人认领，丢弃即可
      pending.delete(message.id)
      if (message.error !== undefined)
        entry.reject(new Error(message.error))
      else
        entry.resolve(message.result)
    }
  })

  return {
    call(method, ...args) {
      seq += 1
      const id = seq
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        channel.post({ type: 'request', id, method, args } satisfies RpcRequest)
      })
    },
  }
}
