// companion/server/api/search.get.ts · GET /api/search?q= —— 目录内搜索（默认 600ms 延迟）
export default defineEventHandler(async (event) => {
  const q = String(getQuery(event).q ?? '')
  recordHit('/api/search')
  if ((await applyChaos('/api/search')) === 'fail')
    throw createError({ statusCode: 500, statusMessage: 'chaos: api500' })
  return searchCatalog(q)
})
