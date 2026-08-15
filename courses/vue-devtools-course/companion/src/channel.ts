/**
 * 通道抽象：post/on 两个函数就是跨世界传输的全部接口。
 * 内存通道对用于测试与同进程双端模拟——post 即达对端 on。
 */
export interface Channel {
  post(data: unknown): void
  on(handler: (data: unknown) => void): void
}

export function createMemoryChannelPair(): [Channel, Channel] {
  let handlerA: ((data: unknown) => void) | null = null
  let handlerB: ((data: unknown) => void) | null = null

  const a: Channel = {
    post: (data) => handlerB?.(data),
    on: (handler) => {
      handlerA = handler
    },
  }
  const b: Channel = {
    post: (data) => handlerA?.(data),
    on: (handler) => {
      handlerB = handler
    },
  }
  return [a, b]
}
