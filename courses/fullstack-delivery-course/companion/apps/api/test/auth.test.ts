// companion: apps/api/test/auth.test.ts · 密码哈希单测 + 四端点与会话守护 e2e
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import { createApp } from '../src/app'
import { hashPassword, verifyPassword } from '../src/auth/password'
import { createAuthedApp, databaseUrl, ensurePg, migrateToLatest, type AuthedApp } from './helpers'

await ensurePg()

/** 生成一次性邮箱：每个用例各用各的，互不串号 */
const freshEmail = () => `reader-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
const PASSWORD = 'correct-horse-battery'

const json = (res: Response) => res.json() as Promise<Record<string, any>>

// ---- 密码哈希：纯函数单测，不碰 HTTP 与数据库 ----

describe('password：加盐哈希与常数时间比对', () => {
  it('同一密码两次哈希得到不同串（随机盐）', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)])
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(0)
  })

  it('verifyPassword 对正确密码返回 true', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(await verifyPassword(PASSWORD, stored)).toBe(true)
  })

  it('verifyPassword 对错误密码返回 false', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(await verifyPassword('wrong-password', stored)).toBe(false)
  })

  it('哈希串里找不到明文密码', async () => {
    const stored = await hashPassword(PASSWORD)
    expect(stored).not.toContain(PASSWORD)
  })
})

// ---- 会话守护：不带 Cookie 的裸服务 ----

const bareServer = serve({ fetch: createApp().fetch, port: 0 })
const bareAddress = bareServer.address()
if (!bareAddress || typeof bareAddress === 'string') {
  throw new Error('expected the bare test server to listen on an ephemeral port')
}
const bareBase = `http://127.0.0.1:${bareAddress.port}`

const postLink = (base: string, body: unknown, cookie?: string) =>
  fetch(`${base}/api/links`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })

describe('POST /api/links 的会话守护', () => {
  it('未登录创建（合法 body）→ 401', async () => {
    const res = await postLink(bareBase, { url: 'https://example.com/no-session' })
    expect(res.status).toBe(401)
  })

  it('未登录且 body 缺 url → 422（校验先于身份）', async () => {
    const res = await postLink(bareBase, {})
    expect(res.status).toBe(422)
    const body = await json(res)
    expect(body.error?.field).toBe('url')
  })
})

// ---- 注册 / 登录 / 登出 / me + 归属 ----

const probe = postgres(databaseUrl, { max: 1 })

describe('注册、登录、登出与归属', () => {
  let authed: AuthedApp | undefined

  beforeAll(async () => {
    await migrateToLatest()
    authed = await createAuthedApp()
  })

  afterAll(async () => {
    if (authed) await authed.shutdown()
    await new Promise<void>((resolve) => bareServer.close(() => resolve()))
    await probe.end({ timeout: 3 })
  })

  it('注册返回 201，Set-Cookie 原文含 sid=、HttpOnly、SameSite=Lax、Path=/', async () => {
    const res = await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: freshEmail(), password: PASSWORD }),
    })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(typeof body.id).toBe('string')
    expect(typeof body.email).toBe('string')

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('sid=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).toContain('Path=/')
  })

  it('重复邮箱注册返回 409', async () => {
    const email = freshEmail()
    const first = await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    expect(first.status).toBe(201)

    const second = await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    expect(second.status).toBe(409)
  })

  it('带会话创建短链 → 201', async () => {
    const res = await authed!.postLink({ url: 'https://example.com/authed-create' })
    expect(res.status).toBe(201)
    const body = await json(res)
    expect(body.url).toBe('https://example.com/authed-create')
    expect(body.slug).toHaveLength(7)
  })

  it('me 返回 200 与 {id,email}', async () => {
    const res = await fetch(`${authed!.base}/api/auth/me`, { headers: { cookie: authed!.cookie } })
    expect(res.status).toBe(200)
    const body = await json(res)
    expect(typeof body.id).toBe('string')
    expect(body.email).toContain('@')
  })

  it('me 无会话返回 401', async () => {
    const res = await fetch(`${authed!.base}/api/auth/me`)
    expect(res.status).toBe(401)
  })

  it('创建的短链归属该用户：库里该 slug 的 user_id 等于 me 的 id', async () => {
    const created = await authed!.postLink({ url: 'https://example.com/ownership-probe' })
    const { slug } = await json(created)
    const me = await fetch(`${authed!.base}/api/auth/me`, { headers: { cookie: authed!.cookie } })
    const { id } = await json(me)

    const rows = (await probe`
      select user_id from links where slug = ${slug}
    `) as { user_id: string | null }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.user_id).toBe(id)
  })

  it('正确密码登录 200，且下发的 sid 与注册时不同', async () => {
    const email = freshEmail()
    const register = await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    const registerSid = (register.headers.get('set-cookie') ?? '').split(';')[0]

    const login = await fetch(`${authed!.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    expect(login.status).toBe(200)
    const loginSid = (login.headers.get('set-cookie') ?? '').split(';')[0]
    expect(loginSid).toContain('sid=')
    expect(loginSid).not.toBe(registerSid)
  })

  it('错误密码登录返回 401', async () => {
    const email = freshEmail()
    await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    const res = await fetch(`${authed!.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'not-the-password' }),
    })
    expect(res.status).toBe(401)
  })

  it('登出返回 204；同一 Cookie 再创建 → 401', async () => {
    const fresh = await createAuthedApp()
    try {
      const ok = await fresh.postLink({ url: 'https://example.com/before-logout' })
      expect(ok.status).toBe(201)

      const logout = await fetch(`${fresh.base}/api/auth/logout`, {
        method: 'POST',
        headers: { cookie: fresh.cookie },
      })
      expect(logout.status).toBe(204)

      const denied = await fresh.postLink({ url: 'https://example.com/after-logout' })
      expect(denied.status).toBe(401)
    } finally {
      await fresh.shutdown()
    }
  })

  it('过期的会话读不到身份，且过期行在读取时被清理', async () => {
    const email = freshEmail()
    const register = await fetch(`${authed!.base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    })
    const { id } = await json(register)

    // 直插一条已过期的会话行：token 原文自造，expires_at 落在过去
    const staleToken = 'stale-token-should-be-rejected-0123456789'
    const staleHash = (
      await probe`select encode(sha256(${staleToken}::bytea), 'hex') as hash`
    )[0] as { hash: string }
    await probe`
      insert into sessions (token_hash, user_id, expires_at)
      values (${staleHash.hash}, ${id}, now() - interval '1 hour')
    `

    const res = await fetch(`${authed!.base}/api/auth/me`, {
      headers: { cookie: `sid=${staleToken}` },
    })
    expect(res.status).toBe(401)

    const leftover = (await probe`
      select count(*)::int as n from sessions where token_hash = ${staleHash.hash}
    `)[0] as { n: number }
    expect(leftover.n).toBe(0)
  })
})
