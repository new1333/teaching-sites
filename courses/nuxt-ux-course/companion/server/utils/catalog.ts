// companion/server/utils/catalog.ts · 24 件商品的确定性目录
// 名字与类别写死，价格/评分/简介由 id 经固定公式推导——同一份代码永远生成同一份目录，
// 测量与测试因此可重复（性能基线的口径前提）。
import type { Product } from '../../shared/types'

const RAW_ITEMS: Array<[name: string, category: string]> = [
  ['云朵雨伞', '雨具'],
  ['竹柄油纸伞', '雨具'],
  ['蜗牛纹雨披', '雨具'],
  ['青苔色雨靴', '雨具'],
  ['折叠晴雨伞', '雨具'],
  ['檐滴伞架', '雨具'],
  ['苔藓微景观', '园艺'],
  ['蕨类盆栽', '园艺'],
  ['蜗牛陶偶', '园艺'],
  ['雨水收集壶', '园艺'],
  ['多肉拼盘', '园艺'],
  ['木柄小铲', '园艺'],
  ['慢炖陶锅', '厨房'],
  ['手冲滤杯', '厨房'],
  ['粗陶茶壶', '厨房'],
  ['亚麻餐垫', '厨房'],
  ['蜂蜜搅拌棒', '厨房'],
  ['竹蒸笼', '厨房'],
  ['牛皮笔记本', '书房'],
  ['黄铜书签', '书房'],
  ['纸镇石', '书房'],
  ['墨绿色毛毯', '书房'],
  ['木头阅读架', '书房'],
  ['黄铜台灯', '书房'],
]

const SUMMARY_BY_CATEGORY: Record<string, string> = {
  雨具: '{name}——雨天出门的第一道防线，雨具区第 {id} 号慢销款。',
  园艺: '{name}——养得慢、活得久，园艺区第 {id} 号常青款。',
  厨房: '{name}——慢火出好味，厨房区第 {id} 号炖煮搭档。',
  书房: '{name}——陪人坐得住，书房区第 {id} 号。',
}

export const CATALOG_SIZE = RAW_ITEMS.length

export function listCatalog(): Product[] {
  return RAW_ITEMS.map(([name, category], index) => {
    const id = index + 1
    return {
      id,
      name,
      category,
      priceYuan: 39 + ((id * 37) % 90) * 3,
      rating: Math.round((3.6 + (id % 14) / 10) * 10) / 10,
      summary: SUMMARY_BY_CATEGORY[category]
        .replaceAll('{name}', name)
        .replaceAll('{id}', String(id)),
    }
  })
}

export function getProduct(id: number): Product | undefined {
  if (!Number.isInteger(id) || id < 1 || id > CATALOG_SIZE) return undefined
  return listCatalog()[id - 1]
}

export function searchCatalog(query: string): Product[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return listCatalog().filter(
    (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  )
}

// 收藏清单：固定 3 件（第 9 章才把它变成可交互的写入）
export function favorites(): Product[] {
  return [2, 8, 15]
    .map((id) => getProduct(id))
    .filter((p): p is Product => p !== undefined)
}
