// companion: apps/api/test/helpers.ts · 测试共用的 pg 就绪检查与迁移执行
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { requireDatabaseUrl } from '../src/config'

export const databaseUrl = requireDatabaseUrl()

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
