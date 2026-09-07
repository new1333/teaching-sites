// scripts/e2e-ch3.mjs · 第 3 章 e2e：环境变量在生产产物上生效 + 缺配置启动即失败
//
// 前置：pnpm build 已产出 .output（缺产物时本脚本会以「先构建」的明确理由失败）。
// 两幕断言：
//   幕一（注入生效）：不重建、不读 .env，仅靠环境变量以 NUXT_PUBLIC_APP_ENV=staging 启动同一产物：
//     1) GET / 返回 200，且裸 HTML 含 <code>staging</code>（公有运行期配置注入并被 SSR 渲染）；
//     2) 裸 HTML 不含数据库连接串（私有键只存在于服务端，永不进浏览器）；
//     3) GET /api/deploys 返回 200（前两章的能力在配置体系下不回退）；
//     4) 进程被结束后端口不再监听。
//   幕二（fail-fast）：把两个必需变量清空（置空串）再启动同一产物：
//     5) 进程必须自己退出且退出码非 0（不带病上岗）；
//     6) 退出前的输出含校验失败清单，且一次列出全部问题键（NUXT_DB_URL 与 NUXT_PUBLIC_APP_ENV）；
//     7) 端口从头到尾没有被服务。
//
// 控制流约定与 e2e-ch1/ch2 相同：断言失败不直接 process.exit——那会跳过 finally，留下占着端口的孤儿进程；
// 而是抛 E2eFailure 交给 catch 记录，统一收尾（finally）杀进程、验端口之后再以退出码 1 结束。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SERVER = join(ROOT, '.output', 'server', 'index.mjs')
const PORT = 4173
const BASE = `http://127.0.0.1:${PORT}`

// 幕一专用连接串：只验证「值到达服务端」，不真连库（第 4 章起才真正使用）
const ACT1_DB_URL = 'postgres://e2e_ch3:e2e_ch3@127.0.0.1:5432/e2e_ch3'

class E2eFailure extends Error {}

const fail = (msg) => {
  throw new E2eFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof E2eFailure) {
    console.error(`[e2e:ch3] FAIL: ${err.message}`)
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

// 起一个产物进程：本章变量由 extraEnv 显式给足或清空，断言不依赖 .env
function startServer(extraEnv) {
  const spawned = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ...extraEnv },
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
      return await fetch(BASE, { redirect: 'manual' })
    } catch { /* ECONNREFUSED: 还没监听，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  fail(`等待 ${BASE} 就绪超时（${timeoutMs}ms）。服务端输出尾部：\n${getLog().slice(-1500)}`)
}

// 等「进程自己退出」而不是等服务就绪：fail-fast 的产物进程应当自己结束
async function waitUntilExit(exited, timeoutMs) {
  const timer = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs))
  const result = await Promise.race([exited.then((r) => ({ kind: 'exit', ...r })), timer.then(() => ({ kind: 'timeout' }))])
  return result
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
    fail(`未找到 ${SERVER} —— 生产产物不存在。先运行 pnpm build，再用 node 直接启动产物。`)
  }

  // ── 幕一：同一产物 + NUXT_PUBLIC_APP_ENV=staging，零重建 ──────────────────────
  console.log(`[e2e:ch3] 幕一：以 NUXT_PUBLIC_APP_ENV=staging 启动同一产物（不重建、不读 .env）`)
  const act1 = startServer({ NUXT_DB_URL: ACT1_DB_URL, NUXT_PUBLIC_APP_ENV: 'staging' })
  child = act1.spawned
  try {
    const res = await waitUntilReady(child, act1.getLog, 30_000)
    console.log(`[e2e:ch3] GET / → ${res.status}`)
    if (res.status !== 200) fail(`期望 200，实际 ${res.status}`)
    const html = await res.text()

    const stagingShown = html.includes('<code>staging</code>')
    console.log(`[e2e:ch3] 裸 HTML 含环境标识 staging → ${stagingShown ? 'PASS' : 'FAIL'}`)
    if (!stagingShown) fail('裸 HTML 里找不到 <code>staging</code> —— 公有运行期配置没有经环境变量注入并被 SSR 渲染。')
    passed++

    const leaked = html.includes(ACT1_DB_URL)
    console.log(`[e2e:ch3] 私有键 dbUrl 不出现在 HTML → ${leaked ? 'FAIL' : 'PASS'}`)
    if (leaked) fail(`数据库连接串出现在了页面 HTML 里 —— 私有配置泄漏进了公有面。`)
    passed++

    const apiRes = await fetch(`${BASE}/api/deploys`)
    console.log(`[e2e:ch3] GET /api/deploys → ${apiRes.status}`)
    if (apiRes.status !== 200) fail(`期望 200，实际 ${apiRes.status} —— 前两章的 API 能力回退了。`)
    passed++
  } finally {
    killChild()
    const gone = await act1.exited
    console.log(`[e2e:ch3] 幕一进程已退出 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch3] 端口 ${PORT} 不再监听 → PASS`)
      passed++
    } else {
      console.error(`[e2e:ch3] FAIL: 进程退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }

  // ── 幕二：清空两个必需变量 → 进程必须自己带非 0 退出码退出 ─────────────────────
  console.log(`[e2e:ch3] 幕二：清空 NUXT_DB_URL 与 NUXT_PUBLIC_APP_ENV 再启动同一产物`)
  const act2 = startServer({ NUXT_DB_URL: '', NUXT_PUBLIC_APP_ENV: '' })
  child = act2.spawned
  try {
    const outcome = await waitUntilExit(act2.exited, 30_000)
    if (outcome.kind === 'timeout') {
      killChild()
      fail(`清空必需变量后进程 30s 内没有自行退出 —— fail-fast 没有生效。服务端输出尾部：\n${act2.getLog().slice(-1500)}`)
    }
    const nonZero = outcome.code !== null && outcome.code !== 0
    console.log(`[e2e:ch3] 进程自行退出 (code=${outcome.code}) → 非 0 退出码 ${nonZero ? 'PASS' : 'FAIL'}`)
    if (!nonZero) fail(`期望非 0 退出码，实际 code=${outcome.code} —— 带病上岗的进程没人看得见。`)
    passed++

    const log = act2.getLog()
    const listedBoth = log.includes('NUXT_DB_URL') && log.includes('NUXT_PUBLIC_APP_ENV') && log.includes('必需环境变量校验失败')
    console.log(`[e2e:ch3] 输出含清单且一次列出全部问题键 → ${listedBoth ? 'PASS' : 'FAIL'}`)
    if (!listedBoth) fail(`退出前的输出应含校验失败清单（一次列出 NUXT_DB_URL 与 NUXT_PUBLIC_APP_ENV），实际：\n${log.slice(-1500)}`)
    passed++
  } finally {
    killChild()
    await act2.exited
    if (await portReleased(10_000)) {
      console.log(`[e2e:ch3] 端口 ${PORT} 从未被服务且已释放 → PASS`)
      passed++
    } else {
      console.error(`[e2e:ch3] FAIL: 进程退出后 ${BASE} 仍可访问 —— 端口未释放`)
      process.exitCode = 1
      failed = true
    }
  }

  if (!failed) console.log(`[e2e:ch3] 全部断言通过 (${passed}/${passed})`)
} catch (err) {
  markFailed(err)
  failed = true
  // 抛出点可能在幕一/幕二的 finally 之前：确保当前子进程被收尾
  if (child && child.exitCode === null && child.signalCode === null) {
    killChild()
    await new Promise((resolve) => child.on('exit', resolve))
    await portReleased(10_000)
  }
}
