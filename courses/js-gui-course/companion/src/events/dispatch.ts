// 事件层：反方向的桥——native 消息如何变成 JS 回调。
// OS/原生世界的事件进 runLoop 队列；这里在 JS 世界按 (targetId, type) 订阅分发。
import type { RunLoop } from '../native/runLoop'
import type { NativeEvent } from '../native/eventQueue'

export type JSCallback = (payload: unknown, event: NativeEvent) => void

export interface EventDispatch {
  /** 订阅某个窗口/控件上的某类事件，返回解绑函数 */
  onWindowEvent(targetId: number, type: string, cb: JSCallback): () => void
}

/** 模拟「OS 又投了一条消息」（用户点击、窗口缩放……） */
export function emitNative(loop: RunLoop, e: NativeEvent): void {
  loop.queue.push(e)
}

export function createEventDispatch(loop: RunLoop): EventDispatch {
  // key = `${targetId}::${type}` → 回调列表
  const subscribers = new Map<string, JSCallback[]>()
  // 对每种事件类型只在 runLoop 上挂一次，转发给精确订阅者
  const hookedTypes = new Set<string>()

  const hook = (type: string) => {
    if (hookedTypes.has(type)) return
    hookedTypes.add(type)
    loop.on(type, (e) => {
      if (e.targetId === undefined) return
      for (const cb of subscribers.get(`${e.targetId}::${type}`) ?? []) cb(e.payload, e)
    })
  }

  return {
    onWindowEvent(targetId, type, cb) {
      hook(type)
      const key = `${targetId}::${type}`
      const list = subscribers.get(key) ?? []
      list.push(cb)
      subscribers.set(key, list)
      return () => {
        subscribers.set(key, (subscribers.get(key) ?? []).filter((f) => f !== cb))
      }
    },
  }
}
