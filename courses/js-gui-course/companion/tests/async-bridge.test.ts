import { describe, it, expect } from 'vitest'
import { createBridge } from '../src/runtime/bridge'
import { createAsyncBridge } from '../src/runtime/asyncBridge'

function setup() {
  const bridge = createBridge()
  bridge.register('capture', () => 'shot-1')
  bridge.register('slow.add', (a: number, b: number) => a + b)
  bridge.register('boom', () => { throw new Error('[binding] native crashed') })
  return createAsyncBridge(bridge)
}

describe('async bridge：JS 单线程不被原生耗时调用阻塞', () => {
  it('runAsync 立即返回 Promise，同步代码先跑完', async () => {
    const async = setup()
    const order: string[] = []
    const p = async.runAsync('slow.add', 1, 2)
    order.push('after-call')            // 同步代码在 resolve 之前执行
    await p
    order.push('resolved')
    expect(order).toEqual(['after-call', 'resolved'])
  })

  it('未 flush 前 Promise 挂起（原生没干完，JS 不该拿到结果）', async () => {
    const async = setup()
    let resolved = false
    async.runAsync('capture').then(() => { resolved = true })
    expect(resolved).toBe(false)
    await async.flush()
    expect(resolved).toBe(true)
  })

  it('结果可用：resolve 的值就是原生实现的返回值', async () => {
    const async = setup()
    expect(await async.runAsync('slow.add', 20, 22)).toBe(42)
  })

  it('多个异步调用按完成顺序 resolve（任务队列 FIFO）', async () => {
    const async = setup()
    const got: number[] = []
    const jobs = [async.runAsync('slow.add', 1, 0), async.runAsync('slow.add', 2, 0), async.runAsync('slow.add', 3, 0)]
    for (const j of jobs) j.then((v) => got.push(v as number))
    await async.flush()
    // 微任务跑完再比对
    await Promise.resolve()
    expect(got).toEqual([1, 2, 3])
  })

  it('原生抛错 → Promise 拒绝，而不是炸掉 JS 线程', async () => {
    const async = setup()
    await expect(async.runAsync('boom')).rejects.toThrowError(/native crashed/)
  })

  it('flush 后再 runAsync 不残留旧任务（pending 归零）', async () => {
    const async = setup()
    await async.runAsync('capture')
    await async.flush()
    expect(async.pending()).toBe(0)
    const second = async.runAsync('slow.add', 5, 5)
    expect(async.pending()).toBe(1)
    await second
  })
})
