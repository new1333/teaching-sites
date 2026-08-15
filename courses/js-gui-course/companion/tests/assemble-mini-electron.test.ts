import { describe, it, expect } from 'vitest'
import { createApp, simulateClick } from '../src/app/miniElectron'
import type { UiNode } from '../src/native/windowManager'

/** 计数器 App：纯 JS 声明 UI + 动作，窗口与 UI 树全在原生侧 */
function counterUi(count: number): UiNode {
  return {
    tag: 'column',
    children: [
      { tag: 'text', text: String(count) },
      { tag: 'button', text: '+1', onClick: 'inc' },
    ],
  }
}

function bootCounter() {
  const clicks: number[] = []
  const app = createApp({
    main(app2) {
      const win = app2.createWindow({ title: 'Counter' })
      win.show()
      let count = 0
      app2.renderUI(win, counterUi(count))
      app2.onAction('inc', () => {
        count++
        clicks.push(count)
        app2.renderUI(win, counterUi(count))
      })
    },
  })
  return { app, clicks }
}

describe('mini-Electron 组装', () => {
  it('main 在宿主世界里跑起来：窗口已创建并显示', () => {
    const { app } = bootCounter()
    expect(app.manager.snapshot(1)).toMatchObject({ title: 'Counter', visible: true })
  })

  it('renderUI 走桥落到原生：快照里有初始 UI 树（文本 0）', () => {
    const { app } = bootCounter()
    expect(app.manager.snapshot(1).ui).toMatchObject({
      tag: 'column',
      children: [
        { tag: 'text', text: '0' },
        { tag: 'button', text: '+1', onClick: 'inc' },
      ],
    })
  })

  it('完整回路：模拟点击 → 动作执行 → 重渲染 → 原生文本 +1', () => {
    const { app, clicks } = bootCounter()
    simulateClick(app, 1, '1') // 第 1 个子节点 = 按钮
    expect(clicks).toEqual([1])
    expect(app.manager.snapshot(1).ui?.children?.[0]?.text).toBe('1')
  })

  it('连点三次：事件按序处理，文本到 3', () => {
    const { app } = bootCounter()
    simulateClick(app, 1, '1')
    simulateClick(app, 1, '1')
    simulateClick(app, 1, '1')
    expect(app.manager.snapshot(1).ui?.children?.[0]?.text).toBe('3')
  })

  it('没有动作的节点（文本）点击无效果', () => {
    const { app, clicks } = bootCounter()
    simulateClick(app, 1, '0')
    expect(clicks).toEqual([])
    expect(app.manager.snapshot(1).ui?.children?.[0]?.text).toBe('0')
  })

  it('重渲染整棵替换：改了结构的 UI 快照同步变化', () => {
    const app = createApp({
      main(a) {
        const win = a.createWindow({ title: 'Swap' })
        win.show()
        a.renderUI(win, { tag: 'text', text: 'v1' })
        a.renderUI(win, {
          tag: 'column',
          children: [{ tag: 'text', text: 'v2' }, { tag: 'button', text: 'go', onClick: 'go' }],
        })
        a.onAction('go', () => a.renderUI(win, { tag: 'text', text: 'gone' }))
      },
    })
    expect(app.manager.snapshot(1).ui).toMatchObject({
      tag: 'column',
      children: [{ tag: 'text', text: 'v2' }, expect.objectContaining({ tag: 'button' })],
    })
    simulateClick(app, 1, '1')
    expect(app.manager.snapshot(1).ui).toMatchObject({ tag: 'text', text: 'gone' })
  })
})
