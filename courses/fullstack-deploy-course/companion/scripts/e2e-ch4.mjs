// scripts/e2e-ch4.mjs · 第 4 章 e2e：数据活在数据库里，不活在进程里
//
// 前置：pnpm build 已产出 .output；开发库在跑且表已建（本脚本起进程前重置回 3 条种子）。
// 两幕断言（同一份产物，起两次进程）：
//   幕一（写入）：进程 A 启动 → GET 3 条种子；POST 合法记录 → 201 且 id=4（identity 接着种子计数）；
//     杀掉进程 A，端口不再监听。
//   幕二（复活）：同一产物再启进程 B → GET 恰好 4 条、新记录在最前（数据活过了进程死亡）；
//     首页裸 HTML 含新记录（SSR 读的是数据库，不是进程内存）；进程 B 收尾后端口不再监听。
// 这组断言在内存数据源时代不可能通过：进程一死，数组就没了——它就是「数据源换成 PostgreSQL」的产物级证据。
//
// 控制流约定与前三章相同：断言失败抛 E2eFailure，catch 记录并置退出码，finally 杀进程、验端口；
// 收尾顺带把开发库重置回种子状态（给下一次运行留干净的起点）。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { seedDeploys } from './seed.mjs'

const ROOT = join(import.meta.dirname, '..')
const SERVER = join(ROOT, '.output', 'server', 'index.mjs')
const PORT = 4174
const BASE = `http://127.0.0.1:${PORT}`
const API = `${BASE}/api/deploys`

// 幕一写入、幕二必须还能读到的记录：7 位十六进制，通过 POST 校验
const SURVIVOR_COMMIT = 'e2e40fa'

class E2eFailure extends Error {}

const fail = (msg) => {
  throw new E2eFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof E2eFailure) {
    console.error(`[e2e:ch4] FAIL: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
}

let child = null
let dbUrl = process.env.NUXT_DB_URL ?? ''

const killChild = () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill()
}
process.on('exit', killChild)

function startServer() {
  const spawned = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  spawned.stdout.on('data', (d) => { log += d.toString() })
  spawned.stderr.on('data', (d) => { log += d.toString() })
  const exited = new Promise((resolve) => spawned.on('exit', (code, signal) => resolve({ code, signal })))
  return { spawned, exited, getLog: () => log }
}

async function waitUntilReady(spawned, getLog, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (spawned.exitCode !== null) {
      fail(`生产进程提前退出（code=${spawned.exitCode}）。服务端输出：\n${getLog().slice(-1500)}`)
    }
    try {
      return await fetch(API, { redirect: 'manual' })
    } catch { /* ECONNREFUSED: 还没监听，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  fail(`等待 ${API} 就绪超时（${timeoutMs}ms）。服务端输出尾部：\n${getLog().slice(-1500)}`)
}

async function portReleased(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(BASE)
      await new Promise((r) => setTimeout(r, 300))
    } catch {
      return true
    }
  }
  return false
}

let passed = 0
let failed = false

try {
  if (!existsSync(SERVER)) {
    fail(`未找到 ${SERVER} —— 生产产物不存在。先运行 pnpm build。`)
  }
  if (!dbUrl) {
    fail('缺少 NUXT_DB_URL —— 复制 .env.example 为 .env（开发库地址），或先 pnpm db:up。')
  }
  try {
    const seeded = await seedDeploys(dbUrl)
    console.log(`[e2e:ch4] 开发库已重置为 ${seeded} 条种子记录`)
  } catch (err) {
    fail(`重置开发库失败（${err.message}）—— 先 pnpm db:up 起库、pnpm db:migrate 建表。`)
  }

  // ── 幕一：进程 A 写入，然后杀死它 ────────────────────────────────────────────
  console.log(`[e2e:ch4] 幕一：启动进程 A，写入一条记录后杀死它`)
  const actA = startServer()
  child = actA.spawned
  try {
    let res = await waitUntilReady(child, actA.getLog, 30_000)
    const list = await res.json()
    if (!(Array.isArray(list) && list.length === 3)) {
      fail(`幕一期望 3 条种子，实际：${JSON.stringify(list).slice(0, 200)}`)
    }

    res = await fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: 'production', status: 'success', commit: SURVIVOR_COMMIT, summary: 'e2e 第 4 章：数据必须活过进程死亡' }),
    })
    if (res.status !== 201) fail(`POST 期望 201，实际 ${res.status}。服务端输出尾部：\n${actA.getLog().slice(-1000)}`)
    const created = await res.json()
    const idByDb = created.id === 4
    console.log(`[e2e:ch4] 进程 A 写入 {id: ${created.id}, commit: "${SURVIVOR_COMMIT}"} → id 接着种子计数 ${idByDb ? 'PASS' : 'FAIL'}`)
    if (!idByDb) fail(`期望 id=4（identity 接着种子计数），实际 ${created.id}。`)
    passed++
  } finally {
    killChild()
    const gone = await actA.exited
    console.log(`[e2e:ch4] 进程 A 已被杀死 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch4] 端口 ${PORT} 不再监听 → PASS`)
    } else {
      console.error(`[e2e:ch4] FAIL: 进程 A 退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }

  // ── 幕二：同一产物再启进程 B，数据必须还在 ──────────────────────────────────
  console.log(`[e2e:ch4] 幕二：同一产物再启进程 B（进程 A 已死，数据只能活在数据库里）`)
  const actB = startServer()
  child = actB.spawned
  try {
    let res = await waitUntilReady(child, actB.getLog, 30_000)
    const list = await res.json()
    const survived = Array.isArray(list) && list.length === 4 && list[0]?.commit === SURVIVOR_COMMIT
    console.log(`[e2e:ch4] 进程 B GET 读回 ${Array.isArray(list) ? list.length : '?'} 条，新记录在最前 → ${survived ? 'PASS' : 'FAIL'}`)
    if (!survived) fail(`进程 B 应读到 4 条且 "${SURVIVOR_COMMIT}" 在最前，实际：${JSON.stringify(list).slice(0, 200)}`)
    passed++

    res = await fetch(BASE, { redirect: 'manual' })
    const html = await res.text()
    const rendered = res.status === 200 && html.includes(SURVIVOR_COMMIT)
    console.log(`[e2e:ch4] 首页裸 HTML 含幸存记录 "${SURVIVOR_COMMIT}" → ${rendered ? 'PASS' : 'FAIL'}`)
    if (!rendered) fail(`进程 B 渲染的裸 HTML 里找不到 "${SURVIVOR_COMMIT}" —— SSR 读的不是数据库。`)
    passed++
  } finally {
    killChild()
    const gone = await actB.exited
    console.log(`[e2e:ch4] 进程 B 已退出 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch4] 端口 ${PORT} 不再监听 → PASS`)
    } else {
      console.error(`[e2e:ch4] FAIL: 进程 B 退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }

  if (!failed) console.log(`[e2e:ch4] 全部断言通过 (${passed}/${passed})`)
} catch (err) {
  markFailed(err)
  failed = true
  if (child && child.exitCode === null && child.signalCode === null) {
    killChild()
    await new Promise((resolve) => child.on('exit', resolve))
    await portReleased(10_000)
  }
} finally {
  // 给下一次运行留干净的起点：开发库重置回种子（尽力而为，不掩盖断言结果）
  if (dbUrl) {
    await seedDeploys(dbUrl).catch(() => {})
  }
}
