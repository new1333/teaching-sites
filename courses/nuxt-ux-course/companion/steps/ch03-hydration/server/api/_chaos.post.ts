// companion/server/api/_chaos.post.ts · POST /api/_chaos —— 注入 { delayMs, fail } 故障开关
// delayMs：数字（全端点统一覆盖）或 null（回到各端点默认延迟）；fail：'none' | 'api500'。
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const delayMs = body?.delayMs
  const fail = body?.fail

  if (
    delayMs !== undefined &&
    delayMs !== null &&
    (typeof delayMs !== 'number' || delayMs < 0 || delayMs > 30_000)
  )
    throw createError({ statusCode: 400, statusMessage: 'delayMs 需为 0–30000 的毫秒数或 null' })
  if (fail !== undefined && fail !== 'none' && fail !== 'api500')
    throw createError({ statusCode: 400, statusMessage: "fail 需为 'none' 或 'api500'" })

  const current = getChaos()
  setChaos(
    delayMs === undefined ? current.delayMs : (delayMs as number | null),
    fail === undefined ? current.fail : (fail as 'none' | 'api500'),
  )
  return getChaos()
})
