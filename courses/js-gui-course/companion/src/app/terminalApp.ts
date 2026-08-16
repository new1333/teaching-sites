// 真机篇：把自制内核接到真实世界。窗口渲染成字符画（终端就是我们的屏幕），
// 键盘按键变成队列里的消息（stdin 就是我们的 OS 输入源）——
// 每一步走的仍是前十章的零件：manager 快照、simulateClick、runLoop。
import { createApp, simulateClick, type App } from './miniElectron'
import { emitNative } from '../events/dispatch'
import type { UiNode } from '../native/windowManager'

/** UI 树 → 文本行（text 一行，button 渲染成可点击的样子） */
function uiLines(ui: UiNode | undefined): string[] {
  if (!ui) return ['(empty)']
  if (ui.tag === 'text') return [ui.text ?? '']
  if (ui.tag === 'button') return [`[ ${ui.text ?? ''} ]`]
  if (ui.children) return ui.children.flatMap(uiLines)
  return []
}

/** 把窗口快照画成带边框的字符窗口——这就是我们的「屏幕」 */
export function renderWindow(app: App, winId: number): string {
  const snap = app.manager.snapshot(winId)
  const lines = uiLines(snap.ui)
  const width = Math.max(snap.title.length + 4, ...lines.map((l) => l.length), 12)
  const top = `┌─ ${snap.title} ${'─'.repeat(Math.max(0, width - snap.title.length - 4))}┐`
  const body = lines.map((l) => `│ ${l.padEnd(width - 2, ' ')} │`)
  const bottom = `└${'─'.repeat(width)}┘`
  return [top, ...body, bottom].join('\n')
}

/** 一次按键 = 一条消息进队列 + 泵一次；返回 running / quit */
export function step(app: App, key: string, winId = 1): 'running' | 'quit' {
  if (key === 'q' || key === '\u0003') {
    emitNative(app.loop, { type: 'quit' })
    app.loop.pumpOnce()
    return 'quit'
  }
  if (key === '+' || key === ' ' || key === '\r') {
    simulateClick(app, winId, '1') // 第 1 个子节点 = 按钮
  }
  return 'running'
}

/** 计数器 App 的完整启动（与第 10 章同一形态，只是可从终端驱动） */
export function bootCounterApp(): App {
  return createApp({
    main(desktop) {
      const win = desktop.createWindow({ title: 'Counter' })
      win.show()
      let count = 0
      const render = () =>
        desktop.renderUI(win, {
          tag: 'column',
          children: [
            { tag: 'text', text: String(count) },
            { tag: 'button', text: '+1', onClick: 'inc' },
          ],
        })
      render()
      desktop.onAction('inc', () => {
        count++
        render()
      })
    },
  })
}
