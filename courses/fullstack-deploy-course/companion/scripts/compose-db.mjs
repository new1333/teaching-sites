// scripts/compose-db.mjs · 开发数据库的起停：pnpm db:up / pnpm db:down 的落点
//
// 只做三件事：包一层 docker compose（固定编排文件与项目名）、等待数据库真的能接连接、
// 打印下一步提示。up 不靠 sleep 硬等——compose 的 --wait 先等 healthcheck 转绿，
// 再用 postgres 驱动发一条 select 1 做应用视角的 readiness probe（应用要的是「能建连接」，
// 不只是「容器健康」）。down 默认保留数据卷（开发数据跨重启保留）；
// 要连数据一起清零：node scripts/compose-db.mjs down --volumes。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const ROOT = join(import.meta.dirname, '..')
const COMPOSE_FILE = join(ROOT, 'compose.db.yaml')
const PROJECT = 'shiplog'
// 与 compose.db.yaml 的 ports 映射一致：宿主 54329。探测走维护库 postgres。
const PROBE_URL = 'postgres://ship_log:ship_log@127.0.0.1:54329/postgres'

const action = process.argv[2]
const passthrough = process.argv.slice(3) // down 时透传（如 --volumes）

function compose(args) {
  // stdio: 'inherit' 让 compose 的进度与错误原样进终端；失败时以同一退出码结束
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], {
    stdio: 'inherit',
  })
  if (res.error) {
    console.error(`[db] 找不到 docker 命令：${res.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error(`[db] docker compose ${args.join(' ')} 退出码 ${res.status}。`)
    process.exit(res.status ?? 1)
  }
}

// readiness probe：轮询发 select 1，直到成功或超时（不 sleep 硬等）
async function waitUntilAcceptingConnections(timeoutMs) {
  const sql = postgres(PROBE_URL, { max: 1, connect_timeout: 2 })
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

if (action === 'up') {
  if (!existsSync(COMPOSE_FILE)) {
    console.error(`[db] 缺少 ${COMPOSE_FILE}`)
    process.exit(1)
  }
  compose(['up', '-d', '--wait'])
  const ready = await waitUntilAcceptingConnections(30_000)
  if (!ready) {
    console.error('[db] 容器已起但 30s 内无法建立连接。诊断：docker logs shiplog-db')
    process.exit(1)
  }
  console.log('[db] 开发库就绪: postgres://ship_log:ship_log@127.0.0.1:54329/ship_log')
  console.log('[db] 下一步: pnpm db:migrate 建表, pnpm db:seed 种子数据')
} else if (action === 'down') {
  compose(['down', ...passthrough])
  if (passthrough.includes('--volumes')) {
    console.log('[db] 容器与数据卷已删除。下次 db:up 是全新实例: pnpm db:up && pnpm db:migrate && pnpm db:seed')
  } else {
    console.log('[db] 容器已停并移除，数据卷保留（数据不丢）。恢复: pnpm db:up')
  }
} else {
  console.error('用法: node scripts/compose-db.mjs up | down [--volumes]')
  process.exit(2)
}
