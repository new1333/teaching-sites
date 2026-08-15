// JS 世界：窗口 API 的安装与句柄。本体在 windowManager（原生），JS 拿到的是遥控器。
import type { Runtime } from './runtime/host'
import type { Bridge } from './runtime/bridge'
import type { WindowManager, WindowCreateOptions, UiNode } from './native/windowManager'

export class WindowHandle {
  constructor(
    readonly id: number,
    private readonly bridge: Bridge,
  ) {}

  setTitle(title: string): void {
    this.bridge.invoke('win.setTitle', this.id, title)
  }

  show(): void {
    this.bridge.invoke('win.show', this.id)
  }

  hide(): void {
    this.bridge.invoke('win.hide', this.id)
  }

  destroy(): void {
    this.bridge.invoke('win.destroy', this.id)
  }

  /** 整棵设置窗口内容树（渲染是原生侧的事） */
  setUI(ui: UiNode): void {
    this.bridge.invoke('win.setUI', this.id, ui)
  }

  /** 走桥取回结构快照（纯数据副本） */
  snapshot() {
    return this.bridge.invoke('win.snapshot', this.id) as ReturnType<WindowManager['snapshot']>
  }
}

/** 宿主动作：注册原生实现 + 往 JS 世界注入 createWindow */
export function installWindowApi(
  runtime: Runtime,
  bridge: Bridge,
  manager: WindowManager,
): void {
  bridge.register('win.create', (options?: WindowCreateOptions) => manager.create(options))
  bridge.register('win.setTitle', (id: number, title: string) => manager.setTitle(id, title))
  bridge.register('win.show', (id: number) => manager.show(id))
  bridge.register('win.hide', (id: number) => manager.hide(id))
  bridge.register('win.destroy', (id: number) => manager.destroy(id))
  bridge.register('win.setUI', (id: number, ui: UiNode) => manager.setUI(id, ui))
  bridge.register('win.snapshot', (id: number) => manager.snapshot(id))

  const createWindow = (options?: WindowCreateOptions): WindowHandle => {
    const id = bridge.invoke('win.create', options ?? {}) as number
    return new WindowHandle(id, bridge)
  }
  runtime.inject('createWindow', createWindow)
}
