// scripts/drill-backup-restore.mjs · 第 7 章主门槛：备份→破坏→恢复→对账的完整演练
//
// 演练就是「消防演习」：平时证明不了备份可用，只有真的烧一次（破坏）、真的喷一次（恢复）、
// 真的清点一次（对账），备份才算被证明过。幕序：
//   1. 起库     —— 开发库容器就绪（已在跑则幂等通过）；
//   2. 迁移     —— 账本按序执行（已在最新则幂等跳过）；
//   3. 造数据   —— 种子 3 条 + 演练写入 1 条（共 4 条，id 1..4）；
//   4. 备份     —— pg_dump -Fc 归档（backup.mjs 同一函数，不另写一套）；
//   5. 对账 I   —— 行数 + 全表校验和 + 迁移账本条数，记为「备份时刻指纹」；
//   6. 破坏     —— drop 表、drop 枚举、drop 迁移账本：库回到空；
//      （断言「真的坏了」：指纹查询此刻必须失败——破坏没成功，恢复就测不出东西）
//   7. 恢复     —— pg_restore --clean --if-exists 回灌（restore.mjs 同一函数）；
//   8. 对账 II  —— 指纹必须与对账 I 完全相等（空库恢复）；
//   9. 再恢复   —— 对「刚恢复过的脏库」原样再灌一次，指纹仍须相等（幂等语义实测）；
//  10. 收尾     —— 开发库重置回 3 条种子（还一个干净起点）；备份文件保留在 .backups/
//      作为演练证据（.gitignore 已排除；何时清理由备份策略说了算，见正文）。
// 退出码即演练结论：0 = 备份被证明可恢复，非 0 = 失败（哪一幕失败输出里可见）。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import postgres from 'postgres'
import { seedDeploys } from './seed.mjs'
import { backupDatabase } from './backup.mjs'
import { restoreDatabase } from './restore.mjs'

const ROOT = join(import.meta.dirname, '..')
const COMPOSE_FILE = join(ROOT, 'compose.db.yaml')
const PROJECT = 'shiplog'
const CONTAINER = 'shiplog-db'
// 演练只打开发库：连接串与 compose.db.yaml / .env.example 的口径一致
const DB_URL = process.env.NUXT_DB_URL ?? 'postgres://ship_log:ship_log@127.0.0.1:54329/ship_log'
// 演练写入、且必须从备份里活着回来的那条记录（7 位十六进制，通过 POST 校验同款格式）
const DRILL_COMMIT = 'dr11bkr'

class DrillFailure extends Error {}

const fail = (msg) => {
  throw new DrillFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof DrillFailure) {
    console.error(`[drill] FAIL: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

function compose(args) {
  const res = run('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args])
  if (res.error) {
    fail(`找不到 docker 命令：${res.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
  }
  if (res.status !== 0) {
    fail(`docker compose ${args.join(' ')} 退出码 ${res.status}：${(res.stderr ?? '').slice(0, 400)}`)
  }
  return res
}

// 容器内跑 psql（宿主机没有客户端）；返回 { status, stdout, stderr }
function psql(sql) {
  return run('docker', ['exec', CONTAINER, 'psql', '-U', 'ship_log', '-d', 'ship_log', '-q', '-c', sql])
}

async function waitUntilAcceptingConnections(timeoutMs) {
  const sql = postgres(DB_URL, { max: 1, connect_timeout: 2 })
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      try {
        await sql`select 1`
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    return false
  } finally {
    await sql.end({ timeout: 1 })
  }
}

// 指纹 = deploys 行数 + 全表校验和（按 id 排序聚合后 md5）+ 迁移账本条数。
// 校验和按 id 排序：同一份数据不论物理顺序如何，指纹恒定，对账才可比
async function fingerprint() {
  const sql = postgres(DB_URL, { max: 1 })
  try {
    const [row] = await sql`
      SELECT count(*)::int AS rows,
             coalesce(md5(string_agg(id::text || '|' || env || '|' || status || '|' || commit || '|' || summary, E'\n' ORDER BY id)), 'EMPTY') AS checksum
      FROM deploys`
    const [ledger] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`
    return { rows: row.rows, checksum: row.checksum, ledger: ledger.n }
  } finally {
    await sql.end({ timeout: 1 })
  }
}

const fmt = (fp) => `${fp.rows} 行 / 校验和 ${fp.checksum.slice(0, 12)}… / 账本 ${fp.ledger} 条`

try {
  console.log('[drill] 第 7 章备份-恢复演练开始（Docker 需在运行）')

  // ── 1. 起库：已在跑则幂等通过 ───────────────────────────────────────────────
  compose(['up', '-d', '--wait'])
  if (!(await waitUntilAcceptingConnections(30_000))) {
    fail('开发库容器已起但 30s 内无法建立连接。诊断：docker logs shiplog-db')
  }
  console.log('[drill] 幕一：开发库就绪（幂等——已在跑就不动它）')

  // ── 2. 迁移：drizzle-kit 账本按序执行（已最新则跳过） ──────────────────────
  const migrate = run(process.execPath, ['--env-file-if-exists=.env', 'node_modules/drizzle-kit/bin.cjs', 'migrate'], {
    cwd: ROOT,
  })
  if (migrate.status !== 0) {
    fail(`drizzle-kit migrate 退出码 ${migrate.status}：${(migrate.stderr ?? '').slice(0, 400)}`)
  }
  console.log('[drill] 幕二：迁移账本已执行到最新（幂等）')

  // ── 3. 造数据：种子 3 条 + 演练写入 1 条 ───────────────────────────────────
  const seeded = await seedDeploys(DB_URL)
  const sql = postgres(DB_URL, { max: 1 })
  try {
    await sql`INSERT INTO deploys (env, status, commit, summary)
              VALUES ('production', 'success', ${DRILL_COMMIT}, '第 7 章演练：这条必须能从备份里活着回来')`
  } finally {
    await sql.end({ timeout: 1 })
  }
  console.log(`[drill] 幕三：种子 ${seeded} 条 + 演练写入 1 条（commit "${DRILL_COMMIT}"）`)

  // ── 4+5. 备份，然后记下「备份时刻指纹」 ────────────────────────────────────
  const { file, bytes } = backupDatabase()
  const before = await fingerprint()
  if (before.rows !== seeded + 1) fail(`备份时刻行数期望 ${seeded + 1}，实际 ${before.rows}。`)
  console.log(`[drill] 幕四：备份完成（${(bytes / 1024).toFixed(1)} KB），备份时刻指纹：${fmt(before)}`)

  // ── 6. 破坏：表、枚举、迁移账本全部 drop，库回到空 ─────────────────────────
  const drop = psql('DROP TABLE deploys CASCADE; DROP TYPE deploy_env, deploy_status; DROP SCHEMA drizzle CASCADE;')
  if (drop.status !== 0) {
    fail(`破坏动作本身失败（退出码 ${drop.status}）：${(drop.stderr ?? '').slice(0, 300)}`)
  }
  // 断言「真的坏了」：此刻指纹查询必须失败。破坏不成立，后面的恢复就什么都没证明
  let destroyed = false
  try {
    await fingerprint()
  } catch {
    destroyed = true
  }
  if (!destroyed) fail('破坏后指纹查询居然还能成功——库没真的坏，本次恢复测不出任何东西。')
  console.log('[drill] 幕五：破坏完成（表/枚举/迁移账本已 drop，指纹查询按预期失败）')

  // ── 7+8. 恢复到空库，对账 II 必须与对账 I 完全相等 ─────────────────────────
  restoreDatabase(file)
  const afterEmpty = await fingerprint()
  if (afterEmpty.rows !== before.rows || afterEmpty.checksum !== before.checksum) {
    fail(`空库恢复后对账失败：期望 ${fmt(before)}，实际 ${fmt(afterEmpty)}。`)
  }
  if (afterEmpty.ledger !== before.ledger) {
    fail(`迁移账本条数期望 ${before.ledger}，实际 ${afterEmpty.ledger}——备份里应含账本。`)
  }
  console.log(`[drill] 幕六：空库恢复完成，对账相等：${fmt(afterEmpty)}`)

  // ── 9. 再恢复到脏库：同一命令原样再灌一次，指纹仍须相等（幂等实测） ────────
  restoreDatabase(file)
  const afterDirty = await fingerprint()
  if (afterDirty.rows !== before.rows || afterDirty.checksum !== before.checksum) {
    fail(`脏库重复恢复后对账失败：期望 ${fmt(before)}，实际 ${fmt(afterDirty)}。`)
  }
  console.log(`[drill] 幕七：脏库重复恢复完成（--clean --if-exists），对账仍相等：${fmt(afterDirty)}`)

  console.log('[drill] 备份被证明可恢复：行数、全表校验和、迁移账本三项对账全部相等')
} catch (err) {
  markFailed(err)
} finally {
  // ── 10. 收尾：开发库重置回种子，还下一次运行一个干净起点（尽力而为，不掩盖断言结果）
  if (!(process.exitCode ?? 0)) {
    try {
      const left = await seedDeploys(DB_URL)
      console.log(`[drill] 收尾：开发库已重置回 ${left} 条种子；备份文件保留在 .backups/ 作演练证据`)
    } catch {
      console.error('[drill] 收尾重置失败（不影响演练结论）：docker exec shiplog-db psql -U ship_log -d ship_log -c \'DROP SCHEMA public CASCADE; CREATE SCHEMA public;\' 后重跑 pnpm db:migrate && pnpm db:seed')
    }
  }
}
