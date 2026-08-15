// 进程间：IPC 通道。两个互不可见的 runtime 靠消息交换序列化数据。
// 两种语义：invoke/handle = 请求-响应（带 id 配对）；send/on = 事件推送。
// 投递不走函数引用、不走共享内存——只有消息对象在两个收件箱之间旅行。
import { serialize } from '../runtime/bridge'

type Message =
  | { kind: 'event'; channel: string; payload: unknown }
  | { kind: 'request'; channel: string; payload: unknown; id: number }
  | { kind: 'response'; channel: string; id: number; ok: true; result: unknown }
  | { kind: 'response'; channel: string; id: number; ok: false; error: string }

export interface IpcEndpoint {
  /** 发起请求，等对端 handle 的结果（请求-响应） */
  invoke(channel: string, payload: unknown): Promise<unknown>
  /** 注册处理者，处理对端的 invoke（请求-响应的另一侧） */
  handle(channel: string, fn: (payload: unknown) => unknown): void
  /** 单向推送，不等结果（事件推送） */
  send(channel: string, payload: unknown): void
  /** 订阅对端推送，返回解绑函数（事件推送的另一侧） */
  on(channel: string, cb: (payload: unknown) => void): () => void
}

export interface IpcChannel {
  main: IpcEndpoint
  renderer: IpcEndpoint
}

/** 通道边界的序列化：报错也要报在通道名下 */
function serializePayload(value: unknown, where: string): unknown {
  try {
    return serialize(value, where)
  } catch (err) {
    throw new Error(`[ipc] payload is not serializable (${err instanceof Error ? err.message : String(err)})`)
  }
}

/** 端点 = 一组本地注册表 + 一个收件箱；sendTo 是「往对端投一条消息」 */
function makeEndpoint(sendTo: (m: Message) => void): { endpoint: IpcEndpoint; inbox: (m: Message) => void } {
  const handlers = new Map<string, (payload: unknown) => unknown>()
  const listeners = new Map<string, Array<(payload: unknown) => void>>()
  const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  const receive = (m: Message) => {
    if (m.kind === 'event') {
      for (const cb of listeners.get(m.channel) ?? []) cb(m.payload)
      return
    }
    if (m.kind === 'request') {
      const fn = handlers.get(m.channel)
      if (!fn) {
        sendTo({ kind: 'response', channel: m.channel, id: m.id, ok: false, error: `[ipc] no handler for: ${m.channel}` })
        return
      }
      // 处理者的活儿排成微任务：跨进程调用天然异步，不占住发起方
      Promise.resolve()
        .then(() => fn(m.payload))
        .then(
          (result) => sendTo({ kind: 'response', channel: m.channel, id: m.id, ok: true, result: serialize(result, 'ipc result') }),
          (err) => sendTo({ kind: 'response', channel: m.channel, id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
        )
      return
    }
    // response：按 id 找回等结果的 Promise
    const w = waiting.get(m.id)
    if (!w) return
    waiting.delete(m.id)
    if (m.ok) w.resolve(m.result)
    else w.reject(new Error(m.error))
  }

  const inbox = (m: Message) => {
    Promise.resolve().then(() => receive(m)) // 微任务落地 ≈ 跨进程时延
  }

  return {
    inbox,
    endpoint: {
      invoke(channel, payload) {
        const safe = serializePayload(payload, `ipc invoke ${channel}`)
        const id = nextRequestId()
        return new Promise((resolve, reject) => {
          waiting.set(id, { resolve, reject })
          sendTo({ kind: 'request', channel, payload: safe, id })
        })
      },
      handle(channel, fn) {
        handlers.set(channel, fn)
      },
      send(channel, payload) {
        sendTo({ kind: 'event', channel, payload: serializePayload(payload, `ipc send ${channel}`) })
      },
      on(channel, cb) {
        const list = listeners.get(channel) ?? []
        list.push(cb)
        listeners.set(channel, list)
        return () => {
          listeners.set(channel, (listeners.get(channel) ?? []).filter((f) => f !== cb))
        }
      },
    },
  }
}

let ipcId = 0
const nextRequestId = () => ++ipcId

export function createIpcChannel(): IpcChannel {
  // 对称接线：main 发出的消息进 renderer 的收件箱，反之亦然
  // （闭包在消息真正发送时才解引用，先声明变量后互指，避免循环引用）
  let mainInbox: (m: Message) => void
  let rendererInbox: (m: Message) => void
  const a = makeEndpoint((m) => rendererInbox(m))
  const b = makeEndpoint((m) => mainInbox(m))
  mainInbox = a.inbox
  rendererInbox = b.inbox
  return { main: a.endpoint, renderer: b.endpoint }
}
