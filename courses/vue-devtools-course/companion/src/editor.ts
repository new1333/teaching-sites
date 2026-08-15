import type { InstanceLike } from './types'

/**
 * 状态回写：把面板上的修改沿属性路径逐层下行，写回页面里活着的实例本体。
 *
 * 路径约定：第一段选择来源（'props' | 'setupState' | 'data'），
 * 之后各段逐层下钻；最后一段是赋值目标键。数组下标用数字段。
 */
export function editState(instance: InstanceLike, path: Array<string | number>, value: unknown): boolean {
  if (path.length === 0)
    return false

  let cursor: unknown = instance
  for (let i = 0; i < path.length - 1; i++) {
    if (cursor === null || typeof cursor !== 'object')
      return false
    try {
      cursor = (cursor as Record<string | number, unknown>)[path[i]]
    }
    catch {
      return false                    // 读取即抛错的属性：与快照同款容错
    }
    if (cursor === null || typeof cursor !== 'object')
      return false                    // 中途是非对象：路径走不通
  }

  try {
    ;(cursor as Record<string | number, unknown>)[path[path.length - 1]] = value
    return true
  }
  catch {
    return false                      // 冻结/只读对象：写入被拒不升级为异常
  }
}
