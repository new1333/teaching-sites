// scripts/seed.mjs · 开发库种子数据：pnpm db:seed，或被 e2e 脚本 import 复用（跑前重置）
// 结构（迁移管）与数据（本脚本管）分开：迁移可无限重放，种子是「回到已知的演示状态」
import { pathToFileURL } from 'node:url'
import postgres from 'postgres'

// 与第 2 章首页种子一致的三条记录（按 id 从小到大插入——identity 会依次分配 1、2、3）
const SEED_ROWS = [
  { env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
  { env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
]

// 重置 deploys 表回种子状态：清空数据并归零 identity 计数，再按序插入。
// e2e 断言「恰好 3 条种子 + 下一条 id 是 4」，靠它保证每次运行从同一状态出发
export async function seedDeploys(dbUrl) {
  const sql = postgres(dbUrl, { max: 1 })
  try {
    await sql`TRUNCATE TABLE deploys RESTART IDENTITY`
    for (const row of SEED_ROWS) {
      await sql`INSERT INTO deploys (env, status, commit, summary)
                VALUES (${row.env}, ${row.status}, ${row.commit}, ${row.summary})`
    }
    // 注意取 rows[0].count（聚合值）：postgres-js 的结果数组自带 .count 是「行数」，这里恒为 1
    const rows = await sql`SELECT count(*)::int AS count FROM deploys`
    return rows[0].count
  } finally {
    await sql.end({ timeout: 1 })
  }
}

// 直接运行（pnpm db:seed）时执行；被 import 时不执行
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (invokedDirectly) {
  const dbUrl = process.env.NUXT_DB_URL
  if (!dbUrl) {
    console.error('[seed] 缺少 NUXT_DB_URL：复制 .env.example 为 .env 并填好（或先 pnpm db:up 起库）。')
    process.exit(1)
  }
  try {
    const count = await seedDeploys(dbUrl)
    console.log(`[seed] deploys 已重置为 ${count} 条种子记录`)
  } catch (err) {
    console.error(`[seed] 失败：${err.message}`)
    console.error('[seed] 检查：开发库在跑吗（pnpm db:up）？表建好了吗（pnpm db:migrate）？')
    process.exit(1)
  }
}
