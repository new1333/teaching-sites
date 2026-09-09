// companion: apps/api/src/auth/guard.ts · authGuard——业务逻辑之前的身份检查层
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { SESSION_COOKIE, type AuthStore, type SessionUser } from './session'

/** 挂在 Hono 上下文上的类型：守卫通过后，后续 handler 都能读到 currentUser */
export type AuthEnv = {
  Variables: {
    currentUser: SessionUser
  }
}

/**
 * 从 Cookie 里读 sid → 查会话 → 把用户挂进上下文；任何一步失败回 401。
 * 它是中间件：可以整段挂在路由参数里（POST /api/links 的三段式就是这么排的）。
 */
export function createAuthGuard(auth: AuthStore): MiddlewareHandler<AuthEnv> {
  return async function authGuard(c, next) {
    const token = getCookie(c, SESSION_COOKIE)
    const user = token ? await auth.getSession(token) : undefined
    if (!user) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    c.set('currentUser', user)
    await next()
  }
}
