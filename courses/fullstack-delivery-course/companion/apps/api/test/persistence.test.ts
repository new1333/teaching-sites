// companion: apps/api/test/persistence.test.ts · 重启模拟：旧 slug 在新一代进程里还能 302 吗
import { beforeAll, describe, expect, it } from 'vitest'
import { serve } from '@hono/node-server'
import { createApp } from '../src/app'
import { createMemoryStore, type MemoryStore } from '../src/store'
import { createPgStore, type PgStore } from '../src/db/store.pg'
import { databaseUrl, ensurePg, migrateToLatest } from './helpers'

await ensurePg()

type AnyStore = PgStore | MemoryStore

const makeStores: Record<'pg' | 'memory', () => AnyStore> = {
  pg: () => createPgStore(databaseUrl),
  memory: () => createMemoryStore(),
}

interface Booted {
  base: string
  shutdown: () => Promise<void>
}

/** 起一个「进程」：独立 store + 独立 HTTP 服务（临时端口） */
function boot(makeStore: () => AnyStore): Booted {
  const store = makeStore()
  const server = serve({ fetch: createApp(store).fetch, port: 0 })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('expected the test server to listen on an ephemeral port')
  }
  return {
    base: `http://127.0.0.1:${address.port}`,
    shutdown: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const maybeEnd = (store as { end?: () => Promise<void> }).end
      if (maybeEnd) await maybeEnd()
    },
  }
}

/** 重启剧本：第一代创建短链并退出；第二代全新 store+app 查同一条短链 */
async function playRestart(
  makeStore: () => AnyStore,
): Promise<{ slug: string; status: number; location: string | null }> {
  const gen1 = boot(makeStore)
  const created = await fetch(`${gen1.base}/api/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://example.com/survives-restart' }),
  })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { slug: string }
  await gen1.shutdown()

  // 第一代已被整体丢弃：如果数据还在，它只能在进程之外
  const gen2 = boot(makeStore)
  const redirect = await fetch(`${gen2.base}/${body.slug}`, { redirect: 'manual' })
  const outcome = {
    slug: body.slug,
    status: redirect.status,
    location: redirect.headers.get('location'),
  }
  await gen2.shutdown()
  return outcome
}

beforeAll(async () => {
  await migrateToLatest()
})

describe('持久化：重启之后数据还在', () => {
  it('模拟进程重启：丢弃第一代 app 与 store，同一数据库起第二代——旧 slug 仍是 302', async () => {
    const outcome = await playRestart(makeStores.pg)
    expect(outcome.status).toBe(302)
    expect(outcome.location).toBe('https://example.com/survives-restart')
  })

  it('对照组：同一剧本换内存 store，第二代拿到 404（重启即丢的机制性记录）', async () => {
    const outcome = await playRestart(makeStores.memory)
    expect(outcome.status).toBe(404)
  })
})
