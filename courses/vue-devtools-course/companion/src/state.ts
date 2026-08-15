import type { InstanceLike } from './types'

export type InspectorStateType = 'props' | 'setup' | 'data'

export interface InspectorStateItem {
  type: InspectorStateType
  key: string
  value: unknown
  editable: boolean
}

/** 安全读取：应用侧任何取值都可能抛错，失败返回错误描述串而不是中断 */
function safeRead(read: () => unknown): unknown {
  try {
    return read()
  }
  catch (error) {
    return `[Error] ${error instanceof Error ? error.message : String(error)}`
  }
}

/** 过桥清洗：函数无法结构化克隆，占位串顶替；函数也不可编辑 */
function sanitize(value: unknown): { value: unknown, editable: boolean } {
  if (typeof value === 'function')
    return { value: '[Function]', editable: false }
  return { value, editable: true }
}

/** 把一份来源对象拍成快照项 */
function processSource(source: Record<string, unknown> | undefined, type: InspectorStateType): InspectorStateItem[] {
  if (!source)
    return []
  const items: InspectorStateItem[] = []
  for (const key of Object.keys(source)) {
    const raw = safeRead(() => source[key])
    const { value, editable } = sanitize(raw)
    items.push({ type, key, value, editable })
  }
  return items
}

/** 状态快照：把活实例的 props/setup/data 分类、清洗成可展示可传输的形态 */
export function getInstanceState(instance: InstanceLike): InspectorStateItem[] {
  return [
    ...processSource(instance.props, 'props'),
    ...processSource(instance.setupState, 'setup'),
    ...processSource(instance.data, 'data'),
  ]
}
