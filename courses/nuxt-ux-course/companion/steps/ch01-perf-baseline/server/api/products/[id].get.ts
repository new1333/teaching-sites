// companion/server/api/products/[id].get.ts · GET /api/products/:id —— 单件商品（默认 500ms 延迟）
export default defineEventHandler(async (event) => {
  const id = Number(getRouterParam(event, 'id'))
  recordHit('/api/products/:id')
  if ((await applyChaos('/api/products/:id')) === 'fail')
    throw createError({ statusCode: 500, statusMessage: 'chaos: api500' })
  const product = getProduct(id)
  if (!product)
    throw createError({ statusCode: 404, statusMessage: `商品 ${id} 不存在` })
  return product
})
