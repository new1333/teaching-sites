// companion/server/api/favorites.get.ts · GET /api/favorites —— 收藏清单（默认 300ms 延迟）
export default defineEventHandler(async () => {
  recordHit('/api/favorites')
  if ((await applyChaos('/api/favorites')) === 'fail')
    throw createError({ statusCode: 500, statusMessage: 'chaos: api500' })
  return favorites()
})
