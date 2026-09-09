// companion/server/api/products/index.get.ts · GET /api/products —— 全量目录（默认 800ms 延迟）
export default defineEventHandler(async () => {
  recordHit('/api/products')
  if ((await applyChaos('/api/products')) === 'fail')
    throw createError({ statusCode: 500, statusMessage: 'chaos: api500' })
  return listCatalog()
})
