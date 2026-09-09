// companion/tests/integration/global-setup.ts · 集成测试的库管家：造一次性库 → 迁移 → 测试后销毁
// 全程不碰开发库 ship_log：集成测试跑在与开发库同一实例里的独立 database（shiplog_test）上，
// 每次运行先删旧建新、跑完即弃——「测试可以在任何机器重放，且永远不动开发数据」
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

const ROOT = join(import.meta.dirname, '..', '..')
const TEST_DB = 'shiplog_test'
// 与 drizzle.config.ts 的 out 指向同一份账本：测试库的结构复现走同一条迁移路径
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../server/db/migrations', import.meta.url))

// 兜底解析 .env 里的 NUXT_DB_URL（pnpm test 不带 --env-file；shell 里已 export 时优先用 shell 的）
function readDevDbUrl(): string | undefined {
  if (process.env.NUXT_DB_URL) return process.env.NUXT_DB_URL
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return undefined
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('NUXT_DB_URL='))
  return line?.slice('NUXT_DB_URL='.length).trim() || undefined
}

// 同一实例的三种身份：开发库（只读它的地址，不碰它的数据）、维护库 postgres（建/删库用）、一次性库
function resolveUrls() {
  const devUrl = readDevDbUrl()
  if (!devUrl) {
    throw new Error('[global-setup] 找不到数据库实例地址：设置 NUXT_DB_URL，或在 companion/.env 里填 NUXT_DB_URL（模板见 .env.example）。')
  }
  const admin = new URL(devUrl)
  admin.pathname = '/postgres'
  const test = new URL(devUrl)
  test.pathname = `/${TEST_DB}`
  return { adminUrl: admin.toString(), testUrl: test.toString() }
}

export default async function setup() {
  const { adminUrl, testUrl } = resolveUrls()

  // 实例可达性先行：连不上就说人话，而不是让每个测试各自炸一遍连接错误
  const probe = postgres(adminUrl, { max: 1, connect_timeout: 3 })
  try {
    await probe`select 1`
  } catch (err) {
    await probe.end({ timeout: 1 }).catch(() => {})
    throw new Error(
      `[global-setup] PostgreSQL 实例不可达（${adminUrl.replace(/\/\/[^@]*@/, '//***@')}）：${err.message}\n先 pnpm db:up 起开发库实例，再 pnpm db:migrate 生成表。`,
    )
  }
  await probe.end({ timeout: 1 })

  // 一次性库：删旧（FORCE 踢掉可能残留的连接；先探存在，免得 NOTICE 刷屏）→ 建新 → 按账本迁移到最新
  const admin = postgres(adminUrl, { max: 1 })
  const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
  if (existing.length > 0) {
    await admin.unsafe(`DROP DATABASE ${TEST_DB} WITH (FORCE)`)
  }
  await admin.unsafe(`CREATE DATABASE ${TEST_DB}`)
  await admin.end({ timeout: 1 })

  const sql = postgres(testUrl, { max: 1 })
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER })
  await sql.end({ timeout: 1 })

  // 一次性库地址放进环境：vitest 的测试 worker 在 globalSetup 之后 fork，能继承到这份进程环境
  process.env.SHIPLOG_TEST_DB_URL = testUrl

  // teardown：测试全绿/全红都执行——一次性库不留尸体
  return async () => {
    const cleaner = postgres(adminUrl, { max: 1 })
    const existing = await cleaner`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
    if (existing.length > 0) {
      await cleaner.unsafe(`DROP DATABASE ${TEST_DB} WITH (FORCE)`)
    }
    await cleaner.end({ timeout: 1 })
  }
}
