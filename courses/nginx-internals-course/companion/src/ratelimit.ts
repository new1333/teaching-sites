// src/ratelimit.ts —— 漏桶限流：请求如水入桶，恒速漏出；桶满即溢（拒绝）
// 语义对齐 nginx limit_req 的 nodelay 形态：桶内请求立即放行，占用未来额度。

export interface LeakyBucketOptions {
  ratePerSec: number // 漏出速率 = 长期允许的稳定速率（rate=10r/s）
  burst: number // 桶容量 = 瞬时容忍的突发额度
  now?: () => number
}

export interface RateLimitResult {
  ok: boolean
  queue: number // 本次判定后的桶内水位（拒绝时=满位）
}

export interface LeakyBucket {
  /** 一滴入桶：先按时间差漏水，再判断装不装得下 */
  allow(key: string): RateLimitResult
  /** 当前水位（供观测） */
  level(key: string): number
}

interface BucketState {
  water: number
  last: number // 上次漏水判定的时刻（ms）
}

export function createLeakyBucket(opts: LeakyBucketOptions): LeakyBucket {
  const now = opts.now ?? Date.now
  const buckets = new Map<string, BucketState>()

  function leak(state: BucketState, t: number): void {
    const elapsedSec = (t - state.last) / 1000
    state.water = Math.max(0, state.water - elapsedSec * opts.ratePerSec)
    state.last = t
  }

  return {
    allow(key) {
      const t = now()
      let state = buckets.get(key)
      if (!state) {
        state = { water: 0, last: t }
        buckets.set(key, state)
      }
      leak(state, t)
      if (state.water + 1 > opts.burst) {
        return { ok: false, queue: state.water } // 溢出：这一滴不进桶
      }
      state.water += 1
      return { ok: true, queue: state.water }
    },

    level(key) {
      const state = buckets.get(key)
      if (!state) return 0
      const copy = { ...state }
      leak(copy, now()) // 观测也按当前时刻折算
      return copy.water
    },
  }
}
