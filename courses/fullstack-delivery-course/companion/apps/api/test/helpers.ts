// companion: apps/api/test/helpers.ts · 测试共用的 pg/redis 就绪检查、迁移执行与已登录应用
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import postgres from 'postgres'
import Redis from 'ioredis'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createApp } from '../src/app'
import { createAuthStore } from '../src/auth/session'
import { createPgStore } from '../src/db/store.pg'
import type { LinkStore } from '../src/store'
import { requireDatabaseUrl, requireRedisUrl } from '../src/config'

export const databaseUrl = requireDatabaseUrl()
export const redisUrl = requireRedisUrl()

/**
 * 教学基础设施就绪检查：pg 没起时给出「先跑哪个命令」的可读提示，
 * 而不是让每个测试各自淹死在一屏 ECONNREFUSED 里。
 */
export async function ensurePg(url: string = databaseUrl): Promise<void> {
  const client = postgres(url, { max: 1 })
  try {
    await client`select 1`
  } catch (err) {
    throw new Error(
      `连不上教学 Postgres（${url}）。\n` +
        '先在 companion 目录执行：node scripts/compose-infra.mjs up\n' +
        `原始错误：${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    await client.end({ timeout: 3 })
  }
}

export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/**
 * 教学基础设施就绪检查（Redis 侧）：连不上时给出「先跑哪个命令」的可读提示。
 * 专用客户端不重试、连不上立刻失败——测试要的是快速明确的红，不是挂着的等。
 */
export async function ensureRedis(url: string = redisUrl): Promise<void> {
  const redis = new Redis(url, {
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
  })
  try {
    await redis.connect()
    const pong = await redis.ping()
    if (pong !== 'PONG') throw new Error(`unexpected PING reply: ${String(pong)}`)
  } catch (err) {
    throw new Error(
      `连不上教学 Redis（${url}）。\n` +
        '先在 companion 目录执行：node scripts/compose-infra.mjs up\n' +
        `原始错误：${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    redis.disconnect()
  }
}

/**
 * 把迁移跑到最新：幂等（已应用的自动跳过），空库也能一键就绪。
 */
export async function migrateToLatest(url: string = databaseUrl): Promise<void> {
  if (!existsSync(migrationsFolder)) {
    throw new Error(
      `迁移目录不存在：${migrationsFolder}\n` +
        '先在 companion 目录执行：pnpm --filter @shortlink/api db:generate',
    )
  }
  const client = postgres(url, { max: 1 })
  try {
    await migrate(drizzle(client), { migrationsFolder })
  } finally {
    await client.end({ timeout: 3 })
  }
}

/** 一个「已登录的应用」：真实 HTTP 服务 + 一个注册好的账号 + 它的会话 Cookie */
export interface AuthedApp {
  base: string
  cookie: string
  postLink(body: unknown): Promise<Response>
  shutdown(): Promise<void>
}

/**
 * 起一个真实服务并用随机邮箱注册一个账号：
 * 返回它的 Cookie 串（形如 "sid=..."）与带 Cookie 的 postLink。
 * 第 4 章起创建短链需要登录——旧章测试都从这里拿「已登录的手」。
 */
export async function createAuthedApp(store?: LinkStore): Promise<AuthedApp> {
  const linkStore = store ?? createPgStore(databaseUrl)
  const auth = createAuthStore(databaseUrl)
  const server = serve({ fetch: createApp(linkStore, auth).fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await auth.end()
    throw new Error('expected the test server to listen on an ephemeral port')
  }
  const base = `http://127.0.0.1:${address.port}`

  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const register = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123' }),
  })
  if (register.status !== 201) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await auth.end()
    throw new Error(`注册测试账号失败：expected 201, got ${register.status}`)
  }
  const setCookie = register.headers.get('set-cookie') ?? ''
  const cookie = setCookie.split(';')[0]?.trim() ?? ''

  return {
    base,
    cookie,
    postLink: (body: unknown) =>
      fetch(`${base}/api/links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
      }),
    shutdown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const maybeEnd = (linkStore as { end?: () => Promise<void> }).end
      if (maybeEnd) await maybeEnd()
      await auth.end()
    },
  }
}
