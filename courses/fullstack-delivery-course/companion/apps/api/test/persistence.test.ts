// companion: apps/api/test/persistence.test.ts · 重启模拟：旧 slug 在新一代进程里还能 302 吗
import { beforeAll, describe, expect, it } from 'vitest'
import { createMemoryStore, type MemoryStore } from '../src/store'
import { createPgStore, type PgStore } from '../src/db/store.pg'
import { createAuthedApp, databaseUrl, ensurePg, migrateToLatest, type AuthedApp } from './helpers'

await ensurePg()

type AnyStore = PgStore | MemoryStore

const makeStores: Record<'pg' | 'memory', () => AnyStore> = {
  pg: () => createPgStore(databaseUrl),
  memory: () => createMemoryStore(),
}

/** 重启剧本：第一代创建短链并退出；第二代全新 store+app 查同一条短链 */
async function playRestart(
  makeStore: () => AnyStore,
): Promise<{ slug: string; status: number; location: string | null }> {
  const gen1: AuthedApp = await createAuthedApp(makeStore())
  const created = await gen1.postLink({ url: 'https://example.com/survives-restart' })
  expect(created.status).toBe(201)
  const body = (await created.json()) as { slug: string }
  await gen1.shutdown()

  // 第一代已被整体丢弃：如果数据还在，它只能在进程之外
  const gen2: AuthedApp = await createAuthedApp(makeStore())
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
