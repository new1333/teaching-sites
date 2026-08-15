// 原生世界：窗口管理器。窗口本体住在这里（结构快照代替像素），OS 视角的资源表。
/** UI 树节点：纯数据。onClick 存动作名（字符串）——函数过不了边界 */
export interface UiNode {
  tag: string
  text?: string
  onClick?: string
  children?: UiNode[]
}

export interface NativeWindowRecord {
  id: number
  title: string
  visible: boolean
  x: number
  y: number
  width: number
  height: number
  /** 窗口当前的内容树（原生侧持有） */
  ui?: UiNode
}

export interface WindowCreateOptions {
  title?: string
  width?: number
  height?: number
}

export interface WindowManager {
  create(options?: WindowCreateOptions): number
  setTitle(id: number, title: string): void
  show(id: number): void
  hide(id: number): void
  destroy(id: number): void
  /** 设置窗口内容树（整棵替换，渲染由原生侧负责） */
  setUI(id: number, ui: UiNode): void
  /** 结构快照：返回纯数据副本，代替「画到屏幕上」 */
  snapshot(id: number): Omit<NativeWindowRecord, 'id'> & { id: number }
}

/** UiNode 树的深拷贝（原生侧工具：快照出关前复制一份） */
function structuredCloneLike<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => structuredCloneLike(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = structuredCloneLike(v)
    return out as unknown as T
  }
  return value
}

export function createWindowManager(): WindowManager {  const windows = new Map<number, NativeWindowRecord>()
  let nextId = 1
  const find = (id: number): NativeWindowRecord => {
    const w = windows.get(id)
    if (!w) throw new Error(`[windowManager] unknown window: ${id}`)
    return w
  }
  return {
    create(options) {
      const id = nextId++
      windows.set(id, {
        id,
        title: options?.title ?? 'untitled',
        visible: false,
        x: 100,
        y: 100,
        width: options?.width ?? 800,
        height: options?.height ?? 600,
      })
      return id
    },
    setTitle(id, title) { find(id).title = title },
    show(id) { find(id).visible = true },
    hide(id) { find(id).visible = false },
    destroy(id) {
      find(id) // 销毁不存在的窗口同样报错
      windows.delete(id)
    },
    setUI(id, ui) {
      find(id).ui = ui
    },
    snapshot(id) {
      const w = find(id)
      // 浅拷贝窗口 + 单独深拷贝 ui 树（结构快照要能安全出关）
      return { ...w, ui: w.ui ? (structuredCloneLike(w.ui) as UiNode) : undefined }
    },
  }
}
