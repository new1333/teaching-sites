// 原生世界：消息循环。反复「取一条—按 type 分发」，quit 让它退出。
// 真实 OS 的循环在队列空时会休眠等待，测试里 run() 到空队列自然结束即可。
import { createEventQueue, type EventQueue, type NativeEvent } from './eventQueue'

export type NativeHandler = (e: NativeEvent) => void

export interface RunLoop {
  queue: EventQueue
  on(type: string, handler: NativeHandler): void
  /** 处理队列中所有消息，直到队列空或收到 quit */
  run(): void
  /** 只处理一条消息（后续章节按帧驱动时用） */
  pumpOnce(): void
}

export function createRunLoop(queue: EventQueue = createEventQueue()): RunLoop {
  const handlers = new Map<string, NativeHandler[]>()
  const dispatch = (e: NativeEvent) => {
    for (const h of handlers.get(e.type) ?? []) h(e)
  }
  return {
    queue,
    on(type, handler) {
      const list = handlers.get(type) ?? []
      list.push(handler)
      handlers.set(type, list)
    },
    run() {
      for (;;) {
        const e = queue.next()
        if (!e) return
        // quit 先给观察者一次机会，再终止循环
        dispatch(e)
        if (e.type === 'quit') return
      }
    },
    pumpOnce() {
      const e = queue.next()
      if (e) dispatch(e)
    },
  }
}
