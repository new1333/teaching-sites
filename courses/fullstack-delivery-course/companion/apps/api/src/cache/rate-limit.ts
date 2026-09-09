// companion: apps/api/src/cache/rate-limit.ts · checkLimit——INCR + EXPIRE 的固定窗口限流

/** 限流缝的最小依赖：只要原子自增与设过期两件事（RedisCache 满足它，测试也可以换假实现） */
export interface CounterStore {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
}

export interface RateLimitResult {
  allowed: boolean
  /** 被拒时建议客户端等待的秒数：整个窗口长度，保守上界 */
  retryAfter: number
}

export interface RateLimiter {
  checkLimit(key: string): Promise<RateLimitResult>
}

/**
 * 固定窗口计数限流：窗口内的第 1 次请求 INCR 得 1，顺手 EXPIRE 设窗口长度；
 * 之后每次 INCR 拿到「本窗口第 N 次」，超过 limit 即拒。
 * 计数放在 Redis 而不是进程内存——多实例共享同一把尺，靠的是无状态服务的同一条判据。
 */
export function createRateLimiter(
  counter: CounterStore,
  options: { limit?: number; windowSeconds?: number } = {},
): RateLimiter {
  const limit = options.limit ?? 5
  const windowSeconds = options.windowSeconds ?? 60
  return {
    async checkLimit(key) {
      const count = await counter.incr(key)
      if (count === 1) {
        await counter.expire(key, windowSeconds)
      }
      return count > limit
        ? { allowed: false, retryAfter: windowSeconds }
        : { allowed: true, retryAfter: 0 }
    },
  }
}
