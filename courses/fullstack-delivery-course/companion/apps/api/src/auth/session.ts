// companion: apps/api/src/auth/session.ts · 会话的生老病死 + 账户的读写，全在这一个池上
import { createHash, randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sessions, users } from '../db/schema'
import { hashPassword, verifyPassword } from './password'

/** 会话 Cookie 的名字：浏览器每次同源请求都会自动带上它 */
export const SESSION_COOKIE = 'sid'
/** 会话寿命：7 天（毫秒用于 expires_at，秒用于 Max-Age） */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60

/** 已登录用户的最小形状：守卫通过后挂进上下文的 currentUser */
export interface SessionUser {
  id: string
  email: string
}

export type RegisterResult = { status: 'created'; user: SessionUser } | { status: 'conflict' }

/**
 * 身份这一侧的存储缝：注册、验密、建会话、查会话、删会话。
 * 与 LinkStore 同构——端点只认这五个方法，底下是 PostgreSQL（无状态服务的判据：
 * 会话重启后该不该还在？该在，所以它住在表里，不住在进程内存里）。
 */
export interface AuthStore {
  register(email: string, password: string): Promise<RegisterResult>
  verify(email: string, password: string): Promise<SessionUser | undefined>
  createSession(userId: string): Promise<{ token: string; expiresAt: Date }>
  getSession(token: string): Promise<SessionUser | undefined>
  deleteSession(token: string): Promise<void>
  end(): Promise<void>
}

/** token 原文 → SHA-256 指纹：库里只存指纹，拖库也仿造不出合法 Cookie */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createAuthStore(databaseUrl: string): AuthStore {
  const pool = postgres(databaseUrl)
  const db = drizzle(pool, { schema: { sessions, users } })

  return {
    async register(email, password) {
      const passwordHash = await hashPassword(password)
      try {
        const rows = await db
          .insert(users)
          .values({ email, passwordHash })
          .returning({ id: users.id, email: users.email })
        return { status: 'created', user: rows[0] }
      } catch (err) {
        // 23505 = unique_violation：邮箱已被注册，数据库替我们把关。
        // drizzle 会把驱动错误包在 cause 里，两级都要看
        const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') {
          return { status: 'conflict' }
        }
        throw err
      }
    },

    async verify(email, password) {
      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
      const row = rows[0]
      if (!row) return undefined
      const ok = await verifyPassword(password, row.passwordHash)
      return ok ? { id: row.id, email: row.email } : undefined
    },

    async createSession(userId) {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt })
      return { token, expiresAt }
    },

    async getSession(token) {
      const tokenHash = hashToken(token)
      const rows = await db
        .select({ id: users.id, email: users.email, expiresAt: sessions.expiresAt })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1)
      const row = rows[0]
      if (!row) return undefined
      // 过期即作废：顺手删行，会话表不会攒下死行
      if (row.expiresAt.getTime() <= Date.now()) {
        await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
        return undefined
      }
      const { id, email } = row
      return { id, email }
    },

    async deleteSession(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)))
    },

    async end() {
      await pool.end({ timeout: 5 })
    },
  }
}

/**
 * 下发会话 Cookie：sid=<token>; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax。
 * dev 跑在本地 http 上，不加 Secure；生产走 HTTPS 后必须补上（浏览器只在 https 上接受它）。
 */
export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
  })
}

/** 登出时清 Cookie：同名空值 + Max-Age=0，浏览器立刻丢掉它 */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}
