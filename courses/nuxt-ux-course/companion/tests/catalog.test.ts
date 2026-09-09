// companion/tests/catalog.test.ts · 商品目录的确定性（先红后绿：目录生成器尚未实现）
import { describe, expect, it } from 'vitest'
import {
  CATALOG_SIZE,
  favorites,
  getProduct,
  listCatalog,
  searchCatalog,
} from '../server/utils/catalog'

describe('商品目录（确定性）', () => {
  it('目录恰好 24 件，id 从 1 连续编号', () => {
    const items = listCatalog()
    expect(items).toHaveLength(CATALOG_SIZE)
    expect(CATALOG_SIZE).toBe(24)
    expect(items.map((p) => p.id)).toEqual(
      Array.from({ length: CATALOG_SIZE }, (_, i) => i + 1),
    )
  })

  it('两次生成的目录逐字段完全一致', () => {
    expect(listCatalog()).toEqual(listCatalog())
  })

  it('同一 id 永远映射同一件商品：getProduct(1) 与列表第 1 项相等', () => {
    const first = listCatalog()[0]
    expect(getProduct(1)).toEqual(first)
  })

  it('越界 id 返回 undefined（0、25、小数）', () => {
    expect(getProduct(0)).toBeUndefined()
    expect(getProduct(25)).toBeUndefined()
    expect(getProduct(1.5)).toBeUndefined()
  })

  it('搜索“伞”只命中名字或类别含“伞”的商品', () => {
    const hit = searchCatalog('伞')
    const expected = listCatalog().filter(
      (p) => p.name.includes('伞') || p.category.includes('伞'),
    )
    expect(hit.map((p) => p.id)).toEqual(expected.map((p) => p.id))
    expect(hit.length).toBeGreaterThan(0)
  })

  it('收藏清单是目录的固定子集（id 2、8、15）', () => {
    expect(favorites().map((p) => p.id)).toEqual([2, 8, 15])
    for (const p of favorites()) {
      expect(p).toEqual(getProduct(p.id))
    }
  })
})
