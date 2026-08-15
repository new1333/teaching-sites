import { describe, it, expect } from 'vitest'
import { createRuntime } from '../src/runtime/host'
import { createBridge } from '../src/runtime/bridge'
import { createWindowManager } from '../src/native/windowManager'
import { installWindowApi } from '../src/windows'

function setup() {
  const manager = createWindowManager()
  const bridge = createBridge()
  const runtime = createRuntime('main')
  installWindowApi(runtime, bridge, manager)
  return { manager, bridge, runtime }
}

describe('窗口：本体在原生世界', () => {
  it('JS 侧 createWindow 返回句柄，原生侧出现窗口记录', () => {
    const { manager, runtime } = setup()
    const g = runtime.globals as { createWindow: (o: { title: string }) => { id: number } }
    const win = g.createWindow({ title: 'Counter' })
    expect(typeof win.id).toBe('number')
    expect(manager.snapshot(win.id)).toMatchObject({ title: 'Counter', visible: false })
  })

  it('句柄方法是转发：setTitle/show/hide 后原生快照同步变化', () => {
    const { manager, runtime } = setup()
    const g = runtime.globals as {
      createWindow: (o: { title: string }) => {
        id: number
        setTitle(t: string): void
        show(): void
        hide(): void
      }
    }
    const win = g.createWindow({ title: 'A' })
    win.setTitle('B')
    win.show()
    expect(manager.snapshot(win.id)).toMatchObject({ title: 'B', visible: true })
    win.hide()
    expect(manager.snapshot(win.id)).toMatchObject({ visible: false })
  })

  it('两个窗口互不串扰（各自句柄各自的记录）', () => {
    const { manager, runtime } = setup()
    const g = runtime.globals as {
      createWindow: (o: { title: string }) => { id: number; setTitle(t: string): void }
    }
    const a = g.createWindow({ title: 'a' })
    const b = g.createWindow({ title: 'b' })
    expect(a.id).not.toBe(b.id)
    a.setTitle('a2')
    expect(manager.snapshot(b.id)).toMatchObject({ title: 'b' })
    expect(manager.snapshot(a.id)).toMatchObject({ title: 'a2' })
  })

  it('JS 拿到的 snapshot 是纯数据副本，改它不污染原生记录', () => {
    const { manager, runtime } = setup()
    const g = runtime.globals as {
      createWindow: (o: { title: string }) => { id: number; snapshot(): { title: string } }
    }
    const win = g.createWindow({ title: 'keep' })
    const snap = win.snapshot()
    snap.title = 'hacked'
    expect(manager.snapshot(win.id).title).toBe('keep')
  })

  it('失效句柄：窗口销毁后再操作，得到带前缀的错误而不是静默', () => {
    const { manager, runtime } = setup()
    const g = runtime.globals as {
      createWindow: (o: { title: string }) => {
        id: number
        setTitle(t: string): void
        destroy(): void
      }
    }
    const win = g.createWindow({ title: 'x' })
    win.destroy()
    expect(() => win.setTitle('y')).toThrowError(/\[windowManager\] unknown window/)
  })
})
