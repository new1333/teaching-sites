// scripts/restore.mjs · pnpm db:restore <file>：pg_restore 把归档备份回灌开发库
//
// 恢复语义是本脚本的核心设计：--clean --if-exists 让同一份备份
//   · 恢复到空库 —— DROP IF EXISTS 全部静默跳过，照常建表灌数据；
//   · 恢复到脏库（结构已在）—— 先 DROP 再重建，不用先手工清库。
// 两种目标库同一条命令、同一退出码语义（0 = 成功）。
// 少了 --clean：脏库上 CREATE 全线报 already exists，退出码 1（正文有实测输出）；
// 少了 --if-exists：空库上 DROP 全线报 does not exist，退出码 1。
// 恢复不做「静默部分成功」：pg_restore 非 0 即失败，错误原文透传给调用者。
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const ROOT = join(import.meta.dirname, '..')
const BACKUPS_DIR = join(ROOT, '.backups')
const CONTAINER = 'shiplog-db'
const PG = { user: 'ship_log', db: 'ship_log' }
const STAGING = '/tmp/shiplog-restore.dump'

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8' })
}

// 恢复后的读数：行数 + 全表校验和。恢复成功不等于恢复对——
// 「对」要拿恢复前后的校验和对比（对账由 drill 与人工演练负责，这里给原料）
function readout() {
  const res = run('docker', [
    'exec', CONTAINER, 'psql', '-U', PG.user, '-d', PG.db, '-t', '-A', '-c',
    "SELECT count(*) || ' 行 / 校验和 ' || coalesce(md5(string_agg(id::text || '|' || env || '|' || status || '|' || commit || '|' || summary, E'\\n' ORDER BY id)), 'EMPTY') FROM deploys;",
  ])
  if (res.status !== 0) return null
  return (res.stdout ?? '').trim()
}

// 把备份文件回灌开发库；成功返回恢复后读数，失败抛 Error（含 pg_restore 原始输出）
export function restoreDatabase(backupFile) {
  const file = isAbsolute(backupFile) ? backupFile : resolve(process.cwd(), backupFile)
  if (!existsSync(file)) {
    throw new Error(`备份文件不存在：${file}`)
  }
  if (statSync(file).size === 0) {
    throw new Error(`备份文件是空的：${file} —— 空文件恢复不出任何东西。`)
  }

  // 1. 备份送进容器（pg_restore 也在容器内跑，理由同 backup：宿主机没有客户端）
  const cp = run('docker', ['cp', file, `${CONTAINER}:${STAGING}`])
  if (cp.status !== 0) {
    const stderr = (cp.stderr ?? '').trim()
    if (/No such container/.test(stderr)) {
      throw new Error(`容器 ${CONTAINER} 不在运行 —— 先 pnpm db:up 起开发库。`)
    }
    throw new Error(`docker cp 送入备份失败（退出码 ${cp.status}）：${stderr.slice(0, 300)}`)
  }

  // 2. pg_restore --clean --if-exists：先删后建，空库脏库通吃
  const restore = run('docker', [
    'exec', CONTAINER, 'pg_restore',
    '-U', PG.user, '-d', PG.db, '--clean', '--if-exists', STAGING,
  ])
  // 3. 清掉容器内中转文件（无论成败都清）
  run('docker', ['exec', CONTAINER, 'rm', '-f', STAGING])

  if (restore.error) {
    throw new Error(`找不到 docker 命令：${restore.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
  }
  if (restore.status !== 0) {
    throw new Error(`pg_restore 退出码 ${restore.status}（${file}）：\n${(restore.stderr ?? '').trim().slice(0, 2000)}`)
  }
  return readout()
}

// 直接运行（pnpm db:restore <file>）时执行；被 drill 脚本 import 时不执行
const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (invokedDirectly) {
  const arg = process.argv[2]
  if (!arg) {
    console.error('用法: pnpm db:restore <备份文件路径>')
    if (existsSync(BACKUPS_DIR)) {
      const dumps = readdirSync(BACKUPS_DIR).filter((f) => f.endsWith('.dump')).sort()
      if (dumps.length > 0) {
        console.error(`[restore] .backups/ 里现有 ${dumps.length} 份备份，最新的一份：`)
        console.error(`        pnpm db:restore .backups/${dumps[dumps.length - 1]}`)
      } else {
        console.error('[restore] .backups/ 目前是空的 —— 先 pnpm db:backup。')
      }
    }
    process.exit(2)
  }
  try {
    const summary = restoreDatabase(arg)
    console.log(`[restore] 恢复完成: ${arg}`)
    console.log(`[restore] ${summary ?? '（deploys 表读数不可用）'}`)
    console.log('[restore] 「恢复对不对」要靠对账：拿恢复前后的行数与校验和对比，恢复脚本只报「恢复成功」。')
  } catch (err) {
    console.error(`[restore] 失败：${err.message}`)
    process.exit(1)
  }
}
