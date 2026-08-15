// 嵌入层：异步桥。原生耗时调用不能占住 JS 单线程——
// 调用立刻返回 Promise，活儿排进任务队列（nativeQueue）；
// 泵（pump/flush）转动时任务执行、结果回投、Promise 才兑现。
// runAsync 会自动安排一次泵（queueMicrotask），模拟「事件循环总会转」；
// 想手动控制时序（测试/按帧驱动）就显式 await flush()。
import type { Bridge } from './bridge'

export interface AsyncBridge {
  /** 发起原生调用，立刻返回；结果在泵转动后经微任务送达 */
  runAsync(name: string, ...args: unknown[]): Promise<unknown>
  /** 显式泵一次：把排队的原生任务全部执行完 */
  flush(): Promise<void>
  /** 还没兑现的任务数 */
  pending(): number
}

export function createAsyncBridge(bridge: Bridge): AsyncBridge {
  const nativeQueue: Array<() => void> = []
  let inFlight = 0

  const pump = () => {
    while (nativeQueue.length > 0) nativeQueue.shift()!()
  }

  return {
    runAsync(name, ...args) {
      inFlight++
      const p = new Promise((resolve, reject) => {
        nativeQueue.push(() => {
          inFlight--
          try {
            resolve(bridge.invoke(name, ...args))
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        })
      })
      Promise.resolve().then(pump) // 事件循环总会转：没人显式泵，也得兑现
      return p
    },
    async flush() {
      pump()
    },
    pending() {
      return inFlight
    },
  }
}
