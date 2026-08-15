// 原生世界：模拟 OS 的事件队列。OS 把输入/绘制/生命周期都变成消息排进这里。
export interface NativeEvent {
  type: string
  targetId?: number
  payload?: unknown
}

export interface EventQueue {
  push(e: NativeEvent): void
  next(): NativeEvent | null
  size(): number
}

export function createEventQueue(): EventQueue {
  const items: NativeEvent[] = []
  return {
    push(e) {
      items.push(e)
    },
    next() {
      return items.length ? items.shift()! : null
    },
    size() {
      return items.length
    },
  }
}
