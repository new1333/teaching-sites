import { describe, it, expect } from 'vitest'
import { createIpcChannel } from '../src/ipc/channel'

describe('IPC：请求-响应（invoke/handle）', () => {
  it('渲染进程 invoke，主进程 handle 的返回值跨通道回来', async () => {
    const { main, renderer } = createIpcChannel()
    main.handle('fs:readFile', (payload) => `content-of-${(payload as { path: string }).path}`)
    const r = await renderer.invoke('fs:readFile', { path: 'a.txt' })
    expect(r).toBe('content-of-a.txt')
  })

  it('反方向也通：主进程也能 invoke 渲染进程（双向通道）', async () => {
    const { main, renderer } = createIpcChannel()
    renderer.handle('ui:getTitle', () => 'Counter')
    expect(await main.invoke('ui:getTitle', null)).toBe('Counter')
  })

  it('并发请求靠 id 配对，各回各的结果', async () => {
    const { main, renderer } = createIpcChannel()
    main.handle('math:double', (n) => (n as number) * 2)
    const [a, b, c] = await Promise.all([
      renderer.invoke('math:double', 1),
      renderer.invoke('math:double', 10),
      renderer.invoke('math:double', 100),
    ])
    expect([a, b, c]).toEqual([2, 20, 200])
  })

  it('处理方抛错 → 发起方拒绝（错误串过通道）', async () => {
    const { main, renderer } = createIpcChannel()
    main.handle('boom', () => { throw new Error('disk full') })
    await expect(renderer.invoke('boom', null)).rejects.toThrowError(/disk full/)
  })

  it('调没人 handle 的通道 → 拒绝并说明没有处理者', async () => {
    const { renderer } = createIpcChannel()
    await expect(renderer.invoke('nobody-home', null)).rejects.toThrowError(/\[ipc\] no handler/)
  })

  it('payload 是副本：处理方改它不影响发起方对象', async () => {
    const { main, renderer } = createIpcChannel()
    main.handle('mutate', (p) => { (p as Record<string, unknown>).hacked = true })
    const arg = { v: 1 }
    await renderer.invoke('mutate', arg)
    expect((arg as Record<string, unknown>).hacked).toBeUndefined()
  })
})

describe('IPC：事件推送（send/on）', () => {
  it('send 的 payload 只到对端的 on 订阅者', async () => {
    const { main, renderer } = createIpcChannel()
    const got: string[] = []
    renderer.on('menu:click', (p) => got.push((p as { item: string }).item))
    main.send('menu:click', { item: 'open' })
    await channelIdle()
    expect(got).toEqual(['open'])
  })

  it('解绑后不再收到推送', async () => {
    const { main, renderer } = createIpcChannel()
    const got: string[] = []
    const off = renderer.on('tick', () => got.push('x'))
    off()
    main.send('tick', 1)
    await channelIdle()
    expect(got).toEqual([])
  })

  it('函数藏进 payload 一样被拒（进程边界不许走私闭包）', () => {
    const { main, renderer } = createIpcChannel()
    expect(() => renderer.send('sneak', { cb: () => 1 })).toThrowError(/\[ipc\]/)
    expect(() => main.send('sneak2', () => 1)).toThrowError(/\[ipc\]/)
  })
})

/** 等通道里排队的投递全部落地 */
function channelIdle(): Promise<void> {
  return new Promise((r) => Promise.resolve().then(() => Promise.resolve()).then(r))
}
