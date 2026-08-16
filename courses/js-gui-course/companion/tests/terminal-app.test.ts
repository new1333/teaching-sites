import { describe, it, expect } from 'vitest'
import { bootCounterApp, renderWindow, step } from '../src/app/terminalApp'

describe('终端 App：内核渲染成字符窗口', () => {
  it('renderWindow 把原生快照画成带边框标题的窗口', () => {
    const app = bootCounterApp()
    const frame = renderWindow(app, 1)
    expect(frame).toContain('Counter')
    expect(frame).toContain('0')
    expect(frame).toContain('[ +1 ]')
    expect(frame.split('\n').some((l) => l.startsWith('├')) || frame.includes('─')).toBe(true)
  })

  it('按键 '+'：真实走一遍 点击→动作→重渲染，帧里数字变 1', () => {
    const app = bootCounterApp()
    expect(step(app, '+')).toBe('running')
    expect(renderWindow(app, 1)).toContain('1')
  })

  it('连按三次 '+' 帧里到 3（与快照一致）', () => {
    const app = bootCounterApp()
    step(app, '+')
    step(app, '+')
    step(app, '+')
    const frame = renderWindow(app, 1)
    expect(frame).toContain('3')
    expect(frame).not.toContain('2')
  })

  it('按键 q：投递 quit 消息并返回 quit', () => {
    const app = bootCounterApp()
    expect(step(app, 'q')).toBe('quit')
    expect(app.loop.queue.size()).toBe(0) // quit 已被泵掉
  })

  it('无关按键：无事发生', () => {
    const app = bootCounterApp()
    expect(step(app, 'x')).toBe('running')
    expect(renderWindow(app, 1)).toContain('0')
  })
})
