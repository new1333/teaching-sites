// companion: apps/api/test/index-experiment.test.ts · EXPLAIN 三段实验：唯一索引 / 无索引 / 补索引
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { databaseUrl, ensurePg, migrateToLatest, migrationsFolder } from './helpers'
import { links } from '../src/db/schema'

await ensurePg()

const ROWS = 30_000
const PROBE_SLUG = 'seed-012345'
const PROBE_URL = `https://example.com/${PROBE_SLUG}`

const client = postgres(databaseUrl)
const db = drizzle(client)

/** 跑 EXPLAIN（文本格式），把计划原文打进测试输出，并返回整段文本供断言 */
async function explain(label: string, query: string): Promise<string> {
  const rows = (await client.unsafe(`EXPLAIN ${query}`)) as Record<string, unknown>[]
  const plan = rows.map((row) => String(Object.values(row)[0])).join('\n')
  console.log(`\n===== ${label} =====\n${plan}\n`)
  return plan
}

beforeAll(async () => {
  await migrateToLatest()
  // 回到「url 还没有索引」的起点：0001 号迁移建过就先删掉，保证本文件从确定状态出发
  await client`DROP INDEX IF EXISTS links_url_idx`
  await client`TRUNCATE TABLE links`

  // 播种 30000 行：slug 与 url 一一对应、各不相同
  const batchSize = 1_000
  for (let start = 0; start < ROWS; start += batchSize) {
    const batch = Array.from({ length: batchSize }, (_, i) => {
      const n = String(start + i + 1).padStart(6, '0')
      return {
        slug: `seed-${n}`,
        url: `https://example.com/seed-${n}`,
        createdAt: new Date(),
      }
    })
    await db.insert(links).values(batch)
  }
  // 让规划器拿到新鲜统计信息，计划选择才稳定可断言
  await client`ANALYZE links`
}, 180_000)

afterAll(async () => {
  await client.end({ timeout: 5 })
})

describe('索引实验：30000 行上的两种查询计划', () => {
  it('WHERE slug = 走 Index Scan（slug 的唯一约束自带唯一索引）', async () => {
    const plan = await explain(
      'slug 等值查询（唯一索引）',
      `SELECT id, slug, url, created_at FROM links WHERE slug = '${PROBE_SLUG}' LIMIT 1`,
    )
    expect(plan).toContain('Index Scan')
  })

  it('WHERE url = 是 Seq Scan（url 列没有索引，30000 行逐行扫）', async () => {
    const plan = await explain(
      'url 等值查询（未建索引）',
      `SELECT id, slug, url, created_at FROM links WHERE url = '${PROBE_URL}' LIMIT 1`,
    )
    expect(plan).toContain('Seq Scan')
  })

  it('重放 0001 号迁移（为 url 建索引）后，同一查询回到 Index Scan', async () => {
    const migrationFiles = readdirSync(migrationsFolder).filter((f) => f.startsWith('0001'))
    if (!migrationFiles.length) {
      throw new Error(
        'drizzle/ 里找不到 0001 号迁移——先在 companion 目录执行：pnpm --filter @shortlink/api db:generate',
      )
    }
    // 读迁移文件原文并逐条执行——恢复动作就是重放迁移本身
    const migration = readFileSync(join(migrationsFolder, migrationFiles[0]), 'utf8')
    const statements = migration
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
    for (const statement of statements) {
      await client.unsafe(statement)
    }
    await client`ANALYZE links`

    const plan = await explain(
      'url 等值查询（重放 0001 号迁移后）',
      `SELECT id, slug, url, created_at FROM links WHERE url = '${PROBE_URL}' LIMIT 1`,
    )
    expect(plan).toContain('Index Scan')

    // 空间账：表、唯一索引、url 索引各占多少，顺手打进输出
    const sizes = (await client`
      select
        pg_size_pretty(pg_relation_size('links')) as heap,
        pg_size_pretty(pg_relation_size('links_slug_unique')) as slug_index,
        pg_size_pretty(pg_relation_size('links_url_idx')) as url_index,
        pg_relation_size('links_url_idx') as url_index_bytes
    `) as Record<string, unknown>[]
    console.log('\n===== 空间账 =====\n', sizes[0])
    expect(Number(sizes[0]?.url_index_bytes)).toBeGreaterThan(0)
  })
})
