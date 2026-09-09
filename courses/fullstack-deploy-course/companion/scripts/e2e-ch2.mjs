// scripts/e2e-ch2.mjs · 第 2 章 e2e：起生产进程 → 断言 /api/deploys 行为 → 收尾退出
//
// 前置：pnpm build 已产出 .output（缺产物时本脚本会以「先构建」的明确理由失败）；
//       开发数据库在跑且表已建（第 4 章起数据源是 PostgreSQL——本脚本起进程前会把
//       deploys 表重置回 3 条种子，让「恰好 3 条 + 下一条 id 是 4」每次运行都成立）。
// 断言六件事：
//   1) GET /api/deploys 返回 200，且是含 3 条种子记录的 JSON 数组（形状与共享类型一致）；
//   2) POST 合法输入返回 201，id 由服务端分配（4 = 种子最大 id + 1）；
//   3) POST 之后 GET 能读回新记录（同一进程内的数据源生效）；
//   4) 新记录出现在首页裸 HTML 里（页面 SSR 与 server API 由同一个进程承载）；
//   5) POST 缺字段返回 400，响应体携带指向缺失字段的错误信息（校验在边界拦截）；
//   6) 进程被结束后端口不再监听。
//
// 控制流约定与 e2e-ch1 相同：断言失败不直接 process.exit——那会跳过 finally，留下占着端口的孤儿进程；
// 而是抛 E2eFailure 交给 catch 记录，统一收尾（finally）杀进程、验端口之后再以退出码 1 结束。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { seedDeploys } from './seed.mjs'

const ROOT = join(import.meta.dirname, '..')
const SERVER = join(ROOT, '.output', 'server', 'index.mjs')
const PORT = 4172
const BASE = `http://127.0.0.1:${PORT}`
const API = `${BASE}/api/deploys`

// 种子数据里的两个 commit（与 scripts/seed.mjs 的种子一致）：出现在 GET 结果里 = 数据源就位
const SEED_COMMITS = ['9f3c2ab', '77aa01f']
// 本章 POST 的测试记录：出现在首页裸 HTML 里 = API 写入的数据被 SSR 渲染
const POSTED_COMMIT = 'a1b2c3d'

class E2eFailure extends Error {}

const fail = (msg) => {
  throw new E2eFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof E2eFailure) {
    console.error(`[e2e:ch2] FAIL: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
}

let child = null

const killChild = () => {
  if (child && child.exitCode === null && child.signalCode === null) child.kill()
}
process.on('exit', killChild)

try {
  if (!existsSync(SERVER)) {
    fail(`未找到 ${SERVER} —— 生产产物不存在。先运行 pnpm build，再用 node 直接启动产物。`)
  }

  // 数据源是 PostgreSQL 后，断言一的「恰好 3 条种子」要求每次运行从同一状态出发：
  // 起进程前重置开发库的 deploys 表（当年 resetDeploys 测试缝的门槛版）
  const dbUrl = process.env.NUXT_DB_URL
  if (!dbUrl) fail('缺少 NUXT_DB_URL —— 复制 .env.example 为 .env（开发库地址），或先 pnpm db:up。')
  try {
    const seeded = await seedDeploys(dbUrl)
    console.log(`[e2e:ch2] 开发库已重置为 ${seeded} 条种子记录`)
  } catch (err) {
    fail(`重置开发库失败（${err.message}）—— 先 pnpm db:up 起库、pnpm db:migrate 建表，再跑本章门槛。`)
  }

  console.log(`[e2e:ch2] 启动生产进程: node .output/server/index.mjs (PORT=${PORT})`)
  const startedAt = Date.now()
  child = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let serverLog = ''
  child.stdout.on('data', (d) => { serverLog += d.toString() })
  child.stderr.on('data', (d) => { serverLog += d.toString() })
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))

  async function waitUntilReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        fail(`生产进程提前退出（code=${child.exitCode}）。服务端输出尾部：\n${serverLog.slice(-1500)}`)
      }
      try {
        const res = await fetch(API, { redirect: 'manual' })
        return res
      } catch { /* ECONNREFUSED: 还没监听，继续轮询 */ }
      await new Promise((r) => setTimeout(r, 200))
    }
    fail(`等待 ${API} 就绪超时（${timeoutMs}ms）。服务端输出尾部：\n${serverLog.slice(-1500)}`)
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

  const post = (body) => fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  let passed = 0
  let failed = false
  try {
    // 断言一：GET 返回种子数据
    let res = await waitUntilReady(30_000)
    console.log(`[e2e:ch2] 进程就绪 (耗时 ${Date.now() - startedAt}ms)`)
    console.log(`[e2e:ch2] GET /api/deploys → ${res.status}`)
    if (res.status !== 200) fail(`期望 200，实际 ${res.status}`)
    const list = await res.json()
    if (!Array.isArray(list) || list.length !== 3) {
      fail(`期望 3 条种子记录的数组，实际：${JSON.stringify(list).slice(0, 200)}`)
    }
    for (const commit of SEED_COMMITS) {
      const hit = list.some((d) => d.commit === commit)
      console.log(`[e2e:ch2] 种子记录含 "${commit}" → ${hit ? 'PASS' : 'FAIL'}`)
      if (!hit) fail(`GET /api/deploys 结果里找不到种子 commit "${commit}"。`)
    }
    for (const key of ['id', 'env', 'status', 'commit', 'summary']) {
      if (!(key in (list[0] ?? {}))) fail(`返回记录缺少共享类型约定的字段 "${key}"。`)
    }
    passed++

    // 断言二：合法 POST → 201，id 服务端分配
    res = await post({ env: 'staging', status: 'success', commit: POSTED_COMMIT, summary: 'e2e 第 2 章：新增一条部署记录' })
    console.log(`[e2e:ch2] POST 合法输入 → ${res.status}`)
    if (res.status !== 201) fail(`期望 201，实际 ${res.status}`)
    const created = await res.json()
    if (created.id !== 4 || created.commit !== POSTED_COMMIT) {
      fail(`期望 {id: 4, commit: "${POSTED_COMMIT}"}，实际：${JSON.stringify(created)}`)
    }
    passed++

    // 断言三：GET 读回新记录（4 条，新记录在最前）
    res = await fetch(API)
    const after = await res.json()
    const readBack = Array.isArray(after) && after.length === 4 && after[0]?.commit === POSTED_COMMIT
    console.log(`[e2e:ch2] POST 后 GET 读回新记录 (共 ${Array.isArray(after) ? after.length : '?'} 条) → ${readBack ? 'PASS' : 'FAIL'}`)
    if (!readBack) fail(`POST 后 GET 应为 4 条且新记录在最前，实际：${JSON.stringify(after).slice(0, 200)}`)
    passed++

    // 断言四：新记录出现在首页裸 HTML（fetch 不执行 JS，出现即 SSR 渲染——API 与页面同进程）
    res = await fetch(BASE, { redirect: 'manual' })
    const html = await res.text()
    const rendered = res.status === 200 && html.includes(POSTED_COMMIT)
    console.log(`[e2e:ch2] 首页裸 HTML 含新记录 "${POSTED_COMMIT}" → ${rendered ? 'PASS' : 'FAIL'}`)
    if (!rendered) fail(`首页 HTML 里找不到 POST 写入的 "${POSTED_COMMIT}" —— server API 与页面渲染不在同一数据源。`)
    passed++

    // 断言五：缺字段 POST → 400，错误指向缺失字段
    res = await post({ env: 'production', status: 'success', commit: POSTED_COMMIT })
    console.log(`[e2e:ch2] POST 缺 summary → ${res.status}`)
    if (res.status !== 400) fail(`期望 400，实际 ${res.status} —— 非法输入没有在边界被拦截。`)
    const errBody = await res.json()
    const pointsToField = errBody?.error === true && JSON.stringify(errBody).includes('summary')
    console.log(`[e2e:ch2] 400 响应体指向缺失字段 summary → ${pointsToField ? 'PASS' : 'FAIL'}`)
    if (!pointsToField) fail(`400 响应体应携带指向 summary 的校验错误，实际：${JSON.stringify(errBody).slice(0, 300)}`)
    passed++
  } catch (err) {
    markFailed(err)
    failed = true
  } finally {
    // 统一收尾：无论断言成败，都杀掉进程、等退出事件落地，并确认端口不再监听
    killChild()
    const gone = await exited
    console.log(`[e2e:ch2] 生产进程已退出 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch2] 端口 ${PORT} 不再监听 → PASS`)
    } else {
      console.error(`[e2e:ch2] FAIL: 进程退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }

  if (!failed) console.log(`[e2e:ch2] 全部断言通过 (${passed + 1}/${passed + 1})`)
} catch (err) {
  // 走到这里的是 spawn 之前的失败（如产物不存在）：没有进程要收尾，记录后以退出码 1 结束
  markFailed(err)
}
