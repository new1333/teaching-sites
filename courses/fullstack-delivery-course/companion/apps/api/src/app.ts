// companion: apps/api/src/app.ts · createApp——端点、契约与守卫的组装台
import { Hono, type MiddlewareHandler } from 'hono'
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

/** 请求体经过校验中间件后，解析结果放这里；守卫通过后，当前用户放这里 */
type AppEnv = AuthEnv & {
  Variables: AuthEnv['Variables'] & {
    linkInput: CreateLinkInput
  }
}

export function createApp(
  store: LinkStore = createMemoryStore(),
  auth: AuthStore = createAuthStore(requireDatabaseUrl()),
) {
  const app = new Hono<AppEnv>()
  const authGuard = createAuthGuard(auth)

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

  // 三段式按参数顺序执行：校验(422) → 守卫(401) → 业务(201)
  app.post('/api/links', validateLinkBody, authGuard, async (c) => {
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

  app.get('/:slug', async (c) => {
    const link = await store.get(c.req.param('slug'))
    if (!link) {
      return c.json({ error: 'not found' }, 404)
    }
    return c.redirect(link.url, 302)
  })

  return app
}
