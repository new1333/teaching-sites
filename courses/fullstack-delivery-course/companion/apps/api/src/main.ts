// companion: apps/api/src/main.ts
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { requireDatabaseUrl, requireRedisUrl } from './config'
import { createPgStore } from './db/store.pg'
import { createAuthStore } from './auth/session'
import { createRedisCache } from './cache/redis-cache'
import { createRateLimiter } from './cache/rate-limit'

const port = Number.parseInt(process.env.PORT ?? '4510', 10)
const store = createPgStore(requireDatabaseUrl())
const auth = createAuthStore(requireDatabaseUrl())
// 生产装配：一个 Redis 客户端同时当缓存的读写面与限流的计数面（同一条连接）
const redis = createRedisCache(requireRedisUrl())

serve(
  {
    fetch: createApp(store, auth, {
      cache: redis,
      rateLimiter: createRateLimiter(redis),
    }).fetch,
    port,
  },
  (info) => {
    console.log(`api listening on http://localhost:${info.port}`)
  },
)
