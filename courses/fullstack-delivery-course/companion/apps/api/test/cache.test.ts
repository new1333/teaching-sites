// companion: apps/api/test/cache.test.ts · 缓存探针与限流——数据库被绕开了没有，第 6 次创建挡住了没有
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import type { Context } from 'hono'
import { createApp, type AppOptions } from '../src/app'
import { createAuthStore } from '../src/auth/session'
import { createPgStore } from '../src/db/store.pg'
import type { LinkStore } from '../src/store'
import { createRedisCache } from '../src/cache/redis-cache'
import { createRateLimiter } from '../src/cache/rate-limit'
import { databaseUrl, ensurePg, ensureRedis, migrateToLatest, redisUrl } from './helpers'

await ensurePg()
await ensureRedis()

beforeAll(async () => {
  await migrateToLatest()
})

const probe = postgres(databaseUrl, { max: 1 })

/** 直插一行短链：GET /:slug 是公开端点，探针只数 store.get，不需要走创建登录那一圈 */
async function insertLink(slug: string, url: string): Promise<void> {
  await probe`insert into links (slug, url) values (${slug}, ${url})`
}

/** 查库探针：包住 store.get 数调用次数——缓存挡住的查询，这个计数不该动 */
function countGets(inner: LinkStore): { store: LinkStore; calls: () => number } {
  let calls = 0
  return {
    store: {
      put: (link, ownerId) => inner.put(link, ownerId),
      async get(slug) {
        calls += 1
        return inner.get(slug)
      },
    },
    calls: () => calls,
  }
}

/** 一个带缓存/限流选项的真实服务：探针化的 store + 独立 redis 客户端 */
async function bootApp(opts: AppOptions): Promise<{ base: string; calls: () => number; shutdown(): Promise<void> }> {
  const pgStore = createPgStore(databaseUrl)
  const counted = countGets(pgStore)
  const auth = createAuthStore(databaseUrl)
  const redis = createRedisCache(redisUrl)
  const server = serve({ fetch: createApp(counted.store, auth, opts).fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('expected the test server to listen on an ephemeral port')
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    calls: counted.calls,
    shutdown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await pgStore.end()
      await auth.end()
      await redis.end()
    },
  }
}

/** 注册一个账号，返回它的 Cookie 串（限流测试里要发「已登录的创建」） */
async function registerCookie(base: string): Promise<string> {
  const email = `cache-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'cache-test-123' }),
  })
  if (res.status !== 201) {
    throw new Error(`注册测试账号失败：expected 201, got ${res.status}`)
  }
  return (res.headers.get('set-cookie') ?? '').split(';')[0]?.trim() ?? ''
}

const freshSlug = (label: string) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 测试用限流 key：按请求头分桶，每个用例拿自己的桶，互不串号 */
const bucketKey = (c: Context) => `test-bucket:${c.req.header('x-test-bucket') ?? 'default'}`

function bootRateLimitedApp(limit: number) {
  return bootApp({
    rateLimiter: createRateLimiter(createRedisCache(redisUrl), { limit, windowSeconds: 60 }),
    rateLimitKeyFn: bucketKey,
  })
}

const postLink = (base: string, bucket: string, cookie?: string) =>
  fetch(`${base}/api/links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-test-bucket': bucket,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ url: 'https://example.com/rate-limit-probe' }),
  })

// ---- 读路径：cache-aside 的三种时刻 ----

describe('GET /:slug 的缓存：查库探针为证', () => {
  it('同一 slug 连跳两次：第一次探针 1 次，第二次 0 次（SELECT 被缓存挡住）', async () => {
    const app = await bootApp({ cache: createRedisCache(redisUrl) })
    try {
      const slug = freshSlug('hit')
      await insertLink(slug, 'https://example.com/cache-hit')

      const first = await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(first.status).toBe(302)
      expect(app.calls()).toBe(1)

      const second = await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(second.status).toBe(302)
      expect(second.headers.get('location')).toBe('https://example.com/cache-hit')
      expect(app.calls()).toBe(1)
    } finally {
      await app.shutdown()
    }
  })

  it('TTL 过期后再跳：探针又 +1（缓存只借一阵子，新鲜度用 TTL 买）', async () => {
    const app = await bootApp({ cache: createRedisCache(redisUrl), cacheTtlSeconds: 1 })
    try {
      const slug = freshSlug('ttl')
      await insertLink(slug, 'https://example.com/ttl-expiry')

      await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(app.calls()).toBe(1)

      await sleep(1_600)
      const third = await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(third.status).toBe(302)
      expect(app.calls()).toBe(2)
    } finally {
      await app.shutdown()
    }
  }, 10_000)

  it('乱打不存在的 slug 两次：两次都 404，但只查库 1 次（null 标记挡住重复未命中）', async () => {
    const app = await bootApp({ cache: createRedisCache(redisUrl) })
    try {
      const slug = freshSlug('ghost')

      const first = await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(first.status).toBe(404)
      expect(app.calls()).toBe(1)

      const second = await fetch(`${app.base}/${slug}`, { redirect: 'manual' })
      expect(second.status).toBe(404)
      expect(app.calls()).toBe(1)
    } finally {
      await app.shutdown()
    }
  })
})

// ---- 写路径：限流的闸 ----

describe('POST /api/links 的限流：5 过 6 拒', () => {
  it('已登录连发 6 次：前 5 次 201，第 6 次 429 且 Retry-After 为窗口秒数', async () => {
    const app = await bootRateLimitedApp(5)
    try {
      const cookie = await registerCookie(app.base)
      const bucket = freshSlug('bucket')
      for (let i = 0; i < 5; i++) {
        const res = await postLink(app.base, bucket, cookie)
        expect(res.status).toBe(201)
      }
      const sixth = await postLink(app.base, bucket, cookie)
      expect(sixth.status).toBe(429)
      expect(sixth.headers.get('retry-after')).toBe('60')
      const body = (await sixth.json()) as Record<string, unknown>
      expect(body.error).toBe('rate limited')
    } finally {
      await app.shutdown()
    }
  })

  it('未登录的洪水也挡在门外：合法 body 不带 Cookie 连发 6 次，前 5 次 401，第 6 次 429（限流在守卫之前）', async () => {
    const app = await bootRateLimitedApp(5)
    try {
      const bucket = freshSlug('anon')
      for (let i = 0; i < 5; i++) {
        const res = await postLink(app.base, bucket)
        expect(res.status).toBe(401)
      }
      const sixth = await postLink(app.base, bucket)
      expect(sixth.status).toBe(429)
    } finally {
      await app.shutdown()
    }
  })

  it('不同 key 互不影响：A 桶打满后，B 桶仍 201', async () => {
    const app = await bootRateLimitedApp(5)
    try {
      const cookie = await registerCookie(app.base)
      const bucketA = freshSlug('bucket-a')
      const bucketB = freshSlug('bucket-b')
      for (let i = 0; i < 6; i++) {
        await postLink(app.base, bucketA, cookie)
      }
      const exhausted = await postLink(app.base, bucketA, cookie)
      expect(exhausted.status).toBe(429)

      const otherBucket = await postLink(app.base, bucketB, cookie)
      expect(otherBucket.status).toBe(201)
    } finally {
      await app.shutdown()
    }
  })
})

afterAll(async () => {
  await probe.end({ timeout: 3 })
})
