// 组装层：mini-Electron。把前面九章的零件缝成一个 App 壳——
// 原生世界（窗口管理器 + 消息循环）+ 嵌入运行时 + binding 桥 + 事件分发。
// JS 侧脚本只看到注入的 createWindow / renderUI / onAction。
import { createRuntime, type Runtime } from '../runtime/host'
import { createBridge, type Bridge } from '../runtime/bridge'
import { createAsyncBridge, type AsyncBridge } from '../runtime/asyncBridge'
import { createWindowManager, type WindowManager, type UiNode } from '../native/windowManager'
import { createRunLoop, type RunLoop } from '../native/runLoop'
import { createEventDispatch, emitNative, type EventDispatch } from '../events/dispatch'
import { installWindowApi, type WindowHandle } from '../windows'

/** JS 侧脚本看到的全部世界：宿主注入的三样能力 */
export interface AppContext {
  createWindow(options?: { title?: string }): WindowHandle
  renderUI(win: WindowHandle, ui: UiNode): void
  onAction(name: string, fn: (payload: unknown) => void): void
}

export interface App {
  readonly runtime: Runtime
  readonly bridge: Bridge
  readonly asyncBridge: AsyncBridge
  readonly manager: WindowManager
  readonly loop: RunLoop
  readonly dispatch: EventDispatch
  /** 元素 id 注册表：`${winId}::${树路径}` → id（路径不变则 id 稳定） */
  readonly elIdByPath: Map<string, number>
}

export function createApp(options: { main(app: AppContext): void }): App {
  const manager = createWindowManager()
  const loop = createRunLoop()
  const bridge = createBridge()
  const runtime = createRuntime('main')
  const asyncBridge = createAsyncBridge(bridge)
  const dispatch = createEventDispatch(loop)
  installWindowApi(runtime, bridge, manager)

  // ---- 事件回流接线：元素 id 绑定「窗口 + 树位置」；动作名 → JS 回调 ----
  const elIdByPath = new Map<string, number>()
  const actionByEl = new Map<number, string>()
  const actionFns = new Map<string, (payload: unknown) => void>()
  const hookedEls = new Set<number>()
  let nextElId = 1

  const elIdFor = (winId: number, path: string): number => {
    const key = `${winId}::${path}`
    let id = elIdByPath.get(key)
    if (id === undefined) {
      id = nextElId++
      elIdByPath.set(key, id)
    }
    return id
  }

  // 渲染 = 给树上每个节点定稳定 id；有点击的节点接进事件分发；树本体走桥进原生
  const renderUI = (win: WindowHandle, ui: UiNode): void => {
    const walk = (node: UiNode, path: string): void => {
      const elId = elIdFor(win.id, path)
      if (node.onClick) {
        actionByEl.set(elId, node.onClick)
        if (!hookedEls.has(elId)) {
          hookedEls.add(elId)
          dispatch.onWindowEvent(elId, 'click', (payload) => {
            const action = actionByEl.get(elId)
            if (action) actionFns.get(action)?.(payload)
          })
        }
      } else {
        actionByEl.delete(elId)
      }
      node.children?.forEach((child, i) => walk(child, path === '' ? String(i) : `${path}/${i}`))
    }
    walk(ui, '')
    win.setUI(ui) // 整棵替换
  }

  const jsCreateWindow = runtime.globals['createWindow'] as (o?: { title?: string }) => WindowHandle
  const ctx: AppContext = {
    createWindow: jsCreateWindow,
    renderUI,
    onAction: (name, fn) => actionFns.set(name, fn),
  }

  runtime.run(() => options.main(ctx))

  return { runtime, bridge, asyncBridge, manager, loop, dispatch, elIdByPath }
}

/** 测试辅助：模拟「用户点了这个窗口的这个树位置的控件」，投消息并泵一次 */
export function simulateClick(app: App, winId: number, path: string): void {
  const id = app.elIdByPath.get(`${winId}::${path}`)
  if (id === undefined) throw new Error(`[miniElectron] no element at ${winId}::${path}`)
  emitNative(app.loop, { type: 'click', targetId: id, payload: {} })
  app.loop.pumpOnce()
}
