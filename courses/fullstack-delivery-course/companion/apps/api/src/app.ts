// companion: apps/api/src/app.ts · createApp——端点、契约与守卫的组装台
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { getCookie } from 'hono/cookie'
import { nanoid } from 'nanoid'
import {
  createLinkSchema,
  loginSchema,
  registerSchema,
  type CreateLinkInput,
  type LinkResponse,
} from '@shortlink/shared'
import { createMemoryStore, type LinkStore } from './store'
import { requireDatabaseUrl } from './config'
import {
  clearSessionCookie,
  createAuthStore,
  SESSION_COOKIE,
  setSessionCookie,
  type AuthStore,
} from './auth/session'
import { createAuthGuard, type AuthEnv } from './auth/guard'
import type { LinkCache } from './cache/redis-cache'
import type { RateLimiter } from './cache/rate-limit'

/** 请求体经过校验中间件后，解析结果放这里；守卫通过后，当前用户放这里 */
type AppEnv = AuthEnv & {
  Variables: AuthEnv['Variables'] & {
    linkInput: CreateLinkInput
  }
}

/**
 * 可选注入：缓存与限流。缺省时一概不启用——旧调用方（createApp(store, auth)）零改动。
 * 与 store、auth 是同一套注入思路：端点只认接口，给不给、给哪个实现，由装配处决定。
 */
export interface AppOptions {
  /** 读路径缓存（get/setEx）。给了才启用 cache-aside */
  cache?: LinkCache
  /** 命中库后回填缓存的存活秒数——按「能容忍多久的陈旧」定，默认 60 */
  cacheTtlSeconds?: number
  /** 「查过、库里没有」null 标记的存活秒数，应短于 cacheTtlSeconds，默认 10 */
  nullCacheTtlSeconds?: number
  /** 写路径限流。给了才启用 */
  rateLimiter?: RateLimiter
  /** 限流 key 的取法，默认按请求来源 IP 分桶 */
  rateLimitKeyFn?: (c: Context) => string
}

export function createApp(
  store: LinkStore = createMemoryStore(),
  auth: AuthStore = createAuthStore(requireDatabaseUrl()),
  opts: AppOptions = {},
) {
  const app = new Hono<AppEnv>()
  const authGuard = createAuthGuard(auth)
  const cache = opts.cache
  const rateLimiter = opts.rateLimiter

  // 浅检查：进程活着就答 ok
  app.get('/healthz', (c) => c.json({ status: 'ok' }))

  // ---- 身份四端点 ----

  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = registerSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    const result = await auth.register(parsed.data.email, parsed.data.password)
    if (result.status === 'conflict') {
      return c.json({ error: { field: 'email', message: '该邮箱已注册' } }, 409)
    }
    // 建用户即登录：注册成功当场发一场会话
    const session = await auth.createSession(result.user.id)
    setSessionCookie(c, session.token)
    return c.json(result.user, 201)
  })

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => null)
    const parsed = loginSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    const user = await auth.verify(parsed.data.email, parsed.data.password)
    if (!user) {
      // 邮箱不存在与密码错误回同一句话：不给「这个邮箱 registered 没」的免费探测
      return c.json({ error: { field: 'credentials', message: '邮箱或密码不正确' } }, 401)
    }
    const session = await auth.createSession(user.id)
    setSessionCookie(c, session.token)
    return c.json(user, 200)
  })

  app.post('/api/auth/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE)
    if (token) {
      await auth.deleteSession(token)
    }
    clearSessionCookie(c)
    return c.body(null, 204)
  })

  app.get('/api/auth/me', authGuard, (c) => {
    return c.json(c.get('currentUser'))
  })

  // ---- 短链端点 ----

  /** 第一段：请求校验。无状态的纯检查先挡畸形请求——422 在身份之前 */
  const validateLinkBody: MiddlewareHandler<AppEnv> = async (c, next) => {
    const body = await c.req.json().catch(() => null)
    const parsed = createLinkSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const field = issue?.path.join('.') || 'body'
      return c.json(
        { error: { field, message: issue?.message ?? '请求体不合法' } },
        422,
      )
    }
    c.set('linkInput', parsed.data)
    await next()
  }

  /** 限流 key 默认按请求来源 IP：直接连接时它是真 IP，躲在反代后面时全是反代的 IP（信任边界见正文） */
  const defaultRateLimitKey = (c: Context): string => {
    return `ip:${getConnInfo(c).remote.address ?? 'unknown'}`
  }
  const rateLimitKeyFn = opts.rateLimitKeyFn ?? defaultRateLimitKey

  /** 第二段：限流闸。超配额回 429 + Retry-After；挂在守卫之前——未登录的洪水也挡在门外 */
  const rateLimitGate: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (!rateLimiter) {
      await next()
      return
    }
    const result = await rateLimiter.checkLimit(rateLimitKeyFn(c))
    if (!result.allowed) {
      c.header('Retry-After', String(result.retryAfter), { append: false })
      return c.json({ error: 'rate limited' }, 429)
    }
    await next()
  }

  // 四段式按参数顺序执行：校验(422) → 限流(429) → 守卫(401) → 业务(201)
  app.post('/api/links', validateLinkBody, rateLimitGate, authGuard, async (c) => {
    const { url } = c.get('linkInput')
    const user = c.get('currentUser')
    const link: LinkResponse = {
      slug: nanoid(7),
      url,
      createdAt: new Date().toISOString(),
    }
    // 归属：这条短链记在当前用户的 user_id 名下
    await store.put(link, user.id)
    return c.json(link, 201)
  })

  // cache-aside：缓存键空间里只放 JSON 文本；'null' 是 JSON 的 null——「查过了，库里没有」
  const linkKey = (slug: string) => `link:${slug}`
  const cacheTtl = opts.cacheTtlSeconds ?? 60
  const nullTtl = opts.nullCacheTtlSeconds ?? 10

  app.get('/:slug', async (c) => {
    const slug = c.req.param('slug')
    if (cache) {
      const cached = await cache.get(linkKey(slug))
      // Redis 的 null = 键不存在 = 未命中；拿到 'null' 或 JSON 对象才算命中
      if (cached !== null) {
        if (cached === 'null') {
          return c.json({ error: 'not found' }, 404)
        }
        const link = JSON.parse(cached) as LinkResponse
        return c.redirect(link.url, 302)
      }
    }
    const link = await store.get(slug)
    if (cache) {
      // 命中库：回填 JSON；库里也没有：写短 TTL 的 null 标记，挡住同一 slug 的重复未命中
      await cache.setEx(
        linkKey(slug),
        link ? cacheTtl : nullTtl,
        link ? JSON.stringify(link) : 'null',
      )
    }
    if (!link) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.redirect(link.url, 302)
  })

  return app
}
