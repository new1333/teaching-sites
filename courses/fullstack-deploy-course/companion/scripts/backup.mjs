// scripts/backup.mjs · pnpm db:backup：pg_dump 归档格式备份开发库
//
// 现实约束：宿主机上没有 pg_dump 客户端（只有 Docker），所以备份经 docker exec
// 在 db 容器内执行——postgres:16-alpine 镜像自带整套客户端工具。
// 二进制产物（-Fc 归档格式）不走 stdout 管道回宿主（跨平台重定向可能改字节），
// 而是先落在容器 /tmp，再 docker cp 取回——docker cp 逐字节精确。
// 产物：companion/.backups/shiplog-<时间戳>.dump（.gitignore 已排除整个 .backups/）
import { spawnSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const BACKUPS_DIR = join(ROOT, '.backups')
// 与 compose.db.yaml 一致：容器名、引导用户与初始库
const CONTAINER = 'shiplog-db'
const PG = { user: 'ship_log', db: 'ship_log' }
// 容器内中转路径：pg_dump 在容器里跑，产物先落这里，取回后删除
const STAGING = '/tmp/shiplog-backup.dump'

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts })
}

// 本地时间戳 YYYYMMDD-HHmmss：文件名按时间排序即按新旧排序
function timestamp() {
  const p = (n) => String(n).padStart(2, '0')
  const d = new Date()
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// 备份一刻的行数读数：写在输出里，让「这份备份里有几条数据」可见——
// 事后翻备份时，第一眼要回答的就是「它是新的还是旧的」
function rowCountInBackup() {
  const res = run('docker', [
    'exec', CONTAINER, 'psql', '-U', PG.user, '-d', PG.db,
    '-t', '-A', '-c', 'SELECT count(*) FROM deploys;',
  ])
  if (res.status !== 0) return null
  return Number((res.stdout ?? '').trim())
}

// 备份开发库，返回 { file, bytes, rows }；失败抛 Error（错误信息含排查提示）
export function backupDatabase() {
  mkdirSync(BACKUPS_DIR, { recursive: true })
  const file = join(BACKUPS_DIR, `shiplog-${timestamp()}.dump`)

  // 1. 容器内 pg_dump -Fc：自定义归档格式，pg_restore 专用（可 --clean、可选择性恢复）
  const dump = run('docker', [
    'exec', CONTAINER, 'pg_dump', '-U', PG.user, '-d', PG.db, '-Fc', '-f', STAGING,
  ])
  if (dump.error) {
    throw new Error(`找不到 docker 命令：${dump.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
  }
  if (dump.status !== 0) {
    const stderr = (dump.stderr ?? '').trim()
    if (/No such container/.test(stderr)) {
      throw new Error(`容器 ${CONTAINER} 不在运行 —— 先 pnpm db:up 起开发库。`)
    }
    throw new Error(`pg_dump 退出码 ${dump.status}：\n${stderr}`)
  }

  // 2. docker cp 取回宿主（逐字节精确），随后删掉容器内的中转文件
  const cp = run('docker', ['cp', `${CONTAINER}:${STAGING}`, file])
  run('docker', ['exec', CONTAINER, 'rm', '-f', STAGING])
  if (cp.status !== 0) {
    throw new Error(`docker cp 取回复份失败（退出码 ${cp.status}）：${(cp.stderr ?? '').slice(0, 300)}`)
  }

  const bytes = statSync(file).size
  if (bytes === 0) throw new Error('备份文件是空的 —— pg_dump 没有产出内容，不要拿它当保险。')
  return { file, bytes, rows: rowCountInBackup() }
}

// 直接运行（pnpm db:backup）时执行；被 drill 脚本 import 时不执行
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (invokedDirectly) {
  try {
    const { file, bytes, rows } = backupDatabase()
    const kb = (bytes / 1024).toFixed(1)
    console.log(`[backup] 备份完成: ${file}`)
    console.log(`[backup] 归档格式 pg_dump -Fc，大小 ${(Number(kb) >= 1024 ? (bytes / 1024 / 1024).toFixed(2) + ' MB' : kb + ' KB')}${rows === null ? '' : `，备份时刻 deploys 表 ${rows} 行`}`)
    console.log('[backup] 恢复: pnpm db:restore <文件路径>')
  } catch (err) {
    console.error(`[backup] 失败：${err.message}`)
    process.exit(1)
  }
}
