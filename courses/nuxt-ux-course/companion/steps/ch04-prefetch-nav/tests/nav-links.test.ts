// companion/tests/nav-links.test.ts · 导航预取策略表（纯数据 + 纯映射，无网络无时间）
// 页头三个导航链接的预取策略是本章的核心设计决策——策略表自身先要被守住：
// 每条路由策略明确、三档策略各就各位、策略到 NuxtLink props 的映射不自相矛盾、
// 表不夹带文档字符串（这个模块进每个页面的共享分块，理由写在源码注释里，不进运行时）。
import { describe, expect, it } from 'vitest'
import {
  NAV_LINKS,
  prefetchPropsFor,
  type NavPrefetchMode,
} from '../app/utils/nav-links'

const MODES: NavPrefetchMode[] = ['viewport', 'interaction', 'none']

describe('导航预取策略表（NAV_LINKS）', () => {
  it('每条链接的 to/label/策略都非空且策略合法', () => {
    expect(NAV_LINKS.length).toBeGreaterThanOrEqual(3)
    for (const link of NAV_LINKS) {
      expect(link.to.startsWith('/')).toBe(true)
      expect(link.label.length).toBeGreaterThan(0)
      expect(MODES).toContain(link.prefetch)
    }
  })

  it('to 不重复（同一路由只有一条策略）', () => {
    const tos = NAV_LINKS.map((l) => l.to)
    expect(new Set(tos).size).toBe(tos.length)
  })

  it('表不夹带文档字段：每条链接只有 to/label/prefetch 三个键', () => {
    // 理由等说明文字写在 nav-links.ts 的注释里；进了表就会随共享分块发给每个页面
    for (const link of NAV_LINKS) {
      expect(Object.keys(link).sort()).toEqual(['label', 'prefetch', 'to'])
    }
  })

  it('核心动线 /products 保留视口预取：默认行为本身就是策略，不许静默丢失', () => {
    const products = NAV_LINKS.find((l) => l.to === '/products')
    expect(products?.prefetch).toBe('viewport')
  })

  it('三档策略各恰好一条：保留默认 / 交互触发 / 裁剪（教学覆盖完整）', () => {
    for (const mode of MODES) {
      expect(NAV_LINKS.filter((l) => l.prefetch === mode)).toHaveLength(1)
    }
  })

  it('被裁剪的恰是低频的收藏页（/favorites 为 none，与页面形态互相印证）', () => {
    const favorites = NAV_LINKS.find((l) => l.to === '/favorites')
    expect(favorites?.prefetch).toBe('none')
  })
})

describe('策略 → NuxtLink props 的映射（prefetchPropsFor）', () => {
  it('viewport：保持默认——空对象，不传任何预取 prop', () => {
    expect(prefetchPropsFor('viewport')).toEqual({})
  })

  it('none：只关不触——noPrefetch 关掉预取，不带 prefetchOn', () => {
    expect(prefetchPropsFor('none')).toEqual({ noPrefetch: true })
  })

  it('interaction：关视口、开交互——visibility 显式 false，interaction true', () => {
    // 关键细节：prefetchOn 是按触发器逐项回退默认值的，
    // 只写 { interaction: true } 会保留 visibility 默认 true，裁剪就不成立
    expect(prefetchPropsFor('interaction')).toEqual({
      prefetchOn: { visibility: false, interaction: true },
    })
  })

  it('映射是纯函数且不携带多余键（同输入同输出，可安全重复调用）', () => {
    for (const mode of MODES) {
      expect(prefetchPropsFor(mode)).toEqual(prefetchPropsFor(mode))
      const keys = Object.keys(prefetchPropsFor(mode))
      expect(keys.every((k) => k === 'noPrefetch' || k === 'prefetchOn')).toBe(true)
    }
  })
})
