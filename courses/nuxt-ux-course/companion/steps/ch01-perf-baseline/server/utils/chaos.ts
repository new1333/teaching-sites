// companion/server/utils/chaos.ts · 故障注入与命中计数（服务端内存态，进程重启即归零）
// 本章只负责把接口建好并启用默认延迟；故障开关留给后续章节做错误处理与弱网演练。
export type FailMode = 'none' | 'api500'

export interface ChaosState {
  /** null = 使用各端点默认延迟；数字 = 全端点统一覆盖（0 表示全部关延迟） */
  delayMs: number | null
  fail: FailMode
}

/** 各端点的默认服务端延迟——蜗牛商店“刻意做慢”的全部来源，measure 口径的一部分 */
export const DEFAULT_DELAYS: Record<string, number> = {
  '/api/products': 800,
  '/api/products/:id': 500,
  '/api/search': 600,
  '/api/favorites': 300,
}

const state: ChaosState = { delayMs: null, fail: 'none' }
const hits: Record<string, number> = {}

export function recordHit(endpoint: string): number {
  hits[endpoint] = (hits[endpoint] ?? 0) + 1
  return hits[endpoint]
}

export function getHits(): Record<string, number> {
  return { ...hits }
}

export function getChaos(): ChaosState & { defaultDelays: Record<string, number> } {
  return {
    delayMs: state.delayMs,
    fail: state.fail,
    defaultDelays: { ...DEFAULT_DELAYS },
  }
}

export function setChaos(delayMs: number | null, fail: FailMode): void {
  state.delayMs = delayMs
  state.fail = fail
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// 每个数据端点进入业务逻辑前调用：先睡出可观察的延迟，再报告本端点是否该失败。
// 返回值而不是直接抛错，是为了让本模块保持纯逻辑、可被 vitest 直接测试。
export async function applyChaos(endpoint: string): Promise<'ok' | 'fail'> {
  const delay = state.delayMs ?? DEFAULT_DELAYS[endpoint] ?? 0
  if (delay > 0) await sleep(delay)
  return state.fail === 'api500' && endpoint === '/api/products' ? 'fail' : 'ok'
}
