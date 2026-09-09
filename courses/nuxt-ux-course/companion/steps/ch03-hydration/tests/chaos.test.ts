// companion/tests/chaos.test.ts · 延迟/故障开关与命中计数的纯逻辑（不触网、不定时）
import { describe, expect, it } from 'vitest'
import {
  applyChaos,
  getChaos,
  getHits,
  recordHit,
  setChaos,
} from '../server/utils/chaos'

describe('故障注入与命中计数（内存态）', () => {
  it('默认态：delayMs 为 null（走各端点默认延迟）、fail 为 none', () => {
    expect(getChaos().delayMs).toBeNull()
    expect(getChaos().fail).toBe('none')
  })

  it('products 端点的默认延迟是 800ms——基线口径的一部分', () => {
    expect(getChaos().defaultDelays['/api/products']).toBe(800)
  })

  it('setChaos 覆盖后 getChaos 读到同一份状态', () => {
    setChaos(0, 'api500')
    expect(getChaos().delayMs).toBe(0)
    expect(getChaos().fail).toBe('api500')
    setChaos(null, 'none') // 还原默认态，避免影响其他用例
  })

  it('delayMs=0 时 applyChaos 立即返回；api500 只打在 /api/products 上', async () => {
    setChaos(0, 'api500')
    expect(await applyChaos('/api/products')).toBe('fail')
    expect(await applyChaos('/api/favorites')).toBe('ok')
    setChaos(0, 'none')
    expect(await applyChaos('/api/products')).toBe('ok')
    setChaos(null, 'none') // 还原默认（不在此调用 applyChaos，避免真睡 800ms）
  })

  it('recordHit 逐次累加，getHits 读到累计值', () => {
    recordHit('/api/products')
    recordHit('/api/products')
    expect(getHits()['/api/products']).toBeGreaterThanOrEqual(2)
    expect(getHits()['/api/nothing']).toBeUndefined()
  })
})
