import type { UpstreamServer } from './types.js'

export interface UpstreamPool {
  /** 按轮询序列取下一台未排除的实例；全部排除时返回 null */
  next(exclude: Set<string>): UpstreamServer | null
}

/**
 * 轮询 + 权重的 upstream 池。
 * 权重用「展开序列」实现：weight 2 与 1 展开成 [a,a,b,a,a,b,...]——朴素但确定，
 * 真实 Nginx 用的是平滑加权轮询（调度更均匀），差异在第 12 章成表。
 */
export function createUpstreamPool(servers: UpstreamServer[]): UpstreamPool {
  const active = servers.filter((s) => !s.down)
  const seq: UpstreamServer[] = []
  const remaining = active.map((s) => Math.max(1, s.weight ?? 1))
  while (remaining.some((r) => r > 0)) {
    for (let i = 0; i < active.length; i++) {
      if (remaining[i] > 0) {
        seq.push(active[i])
        remaining[i]--
      }
    }
  }
  let cursor = 0
  return {
    next(exclude: Set<string>): UpstreamServer | null {
      for (let i = 0; i < seq.length; i++) {
        const server = seq[cursor++ % seq.length]
        if (!exclude.has(server.host)) return server
      }
      return null
    },
  }
}
