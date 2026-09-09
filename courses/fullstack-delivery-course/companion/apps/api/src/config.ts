// companion: apps/api/src/config.ts · 连接串的读法：数据库与 Redis 同一套纪律
const DEV_DATABASE_URL = 'postgres://postgres:postgres@localhost:5544/shortlink'
const DEV_REDIS_URL = 'redis://localhost:6639'

/**
 * 读取 DATABASE_URL。
 * 开发环境给一个指向教学 Postgres 的默认值；生产环境（NODE_ENV=production）缺失时当场报错——
 * 与其带着空配置起一个必坏的服务，不如启动即失败（fail-fast）。
 */
export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim()
  if (url) return url
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL 未设置：生产环境必须显式提供数据库连接串（开发默认值只在开发环境生效）',
    )
  }
  return DEV_DATABASE_URL
}

/**
 * 读取 REDIS_URL，纪律与 DATABASE_URL 相同：开发默认指向教学 Redis（6639），生产缺失即报错。
 */
export function requireRedisUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.REDIS_URL?.trim()
  if (url) return url
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'REDIS_URL 未设置：生产环境必须显式提供 Redis 连接串（开发默认值只在开发环境生效）',
    )
  }
  return DEV_REDIS_URL
}
