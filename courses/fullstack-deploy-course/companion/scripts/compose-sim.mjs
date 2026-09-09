// scripts/compose-sim.mjs · 第 5 章门槛：一键应用栈演练（build → up --wait → 迁移 → e2e → down）
//
// 演练的完整链路（与部署主线的顺序同构：起库 → 迁移 → 起应用 → 验证 → 拆除）：
//   1. build      —— 多阶段构建出 app（run 段）与 migrate（build 段借出的工具镜像）；
//   2. up db      —— 只起数据库，--wait 等 pg_isready 健康检查转绿；
//   3. run migrate —— 在栈内网络跑与宿主机同一条 drizzle-kit migrate（账本进卷）；
//   4. up --wait  —— 起 app，等 Dockerfile 的 HEALTHCHECK 探 /api/health 转绿；
//   5. e2e        —— 断言健康端点、非 root、镜像里没有 .env、页面 200、落库往返；
//   6. 幕二       —— down（保留卷）→ up：POST 过的记录仍在——数据活在卷里，不活在容器里；
//   7. down -v    —— 连卷拆除，还端口还容器名，给下一次运行留干净起点（失败路径也走这里）。
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const COMPOSE_FILE = join(ROOT, 'compose.yaml')
const PROJECT = 'shiplog-stack'
const PORT = 4180
const BASE = `http://127.0.0.1:${PORT}`
const API = `${BASE}/api/deploys`
const HEALTH = `${BASE}/api/health`
// 幕一写入、幕二必须还能读到的记录（7 位十六进制，通过 POST 校验）
const SURVIVOR_COMMIT = 'c0ffee5'

class SimFailure extends Error {}

const fail = (msg) => {
  throw new SimFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof SimFailure) {
    console.error(`[sim] FAIL: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
}

// 包一层 docker compose：固定编排文件与项目名；失败时以同一退出码结束演练
function compose(args, opts = {}) {
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], {
    stdio: 'inherit',
    ...opts,
  })
  if (res.error) {
    fail(`找不到 docker 命令：${res.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
  }
  if (res.status !== 0) {
    fail(`docker compose ${args.join(' ')} 退出码 ${res.status}。`)
  }
  return res
}

// 静默跑一条 compose 命令，拿 stdout（用于 exec 断言）
function composeCapture(args) {
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], {
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    fail(`docker compose ${args.join(' ')} 退出码 ${res.status}：${(res.stderr ?? '').slice(0, 500)}`)
  }
  return (res.stdout ?? '').trim()
}

async function portRefuses(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(BASE, { redirect: 'manual' })
      await new Promise((r) => setTimeout(r, 300))
    } catch {
      return true // 连接被拒：端口已释放
    }
  }
  return false
}

// 宿主侧就绪等待：容器 Healthy 只证明「容器内探针通」，Windows 上端口代理
// 在 up 后的瞬间可能还会 ECONNRESET——断言前先轮询到端口真的能应答
async function waitReachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fetch(url, { redirect: 'manual' })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  fail(`等待 ${url} 从宿主机可达超时（${timeoutMs}ms）—— docker ps / docker logs shiplog-stack-app 排查`)
}

async function fetchJson(url, init) {
  const res = await fetch(url, { redirect: 'manual', ...init })
  return { res, body: await res.json().catch(() => null) }
}

const sec = (ms) => `${(ms / 1000).toFixed(1)}s`
let passed = 0
const ok = (label) => {
  passed++
  console.log(`[sim] ${label} → PASS`)
}

try {
  console.log('[sim] 第 5 章应用栈演练开始（Docker + Compose 需在运行）')

  // ── 0. 预清理：上次失败若留下栈，先连卷拆干净，保证每次演练从全新卷出发 ──────
  spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, 'down', '--volumes'], {
    stdio: 'ignore',
  })

  // ── 1. 构建：多阶段镜像（第一次要装全部依赖，耐心；之后有层缓存） ────────────
  let t = Date.now()
  compose(['build'])
  console.log(`[sim] 镜像构建完成（${sec(Date.now() - t)}）——run 段只含 .output，build 段是工具镜像`)

  // ── 2. 起库：--wait 等 pg_isready 健康检查转绿 ─────────────────────────────
  t = Date.now()
  compose(['up', '-d', '--wait', 'db'])
  console.log(`[sim] 数据库健康（${sec(Date.now() - t)}）—— 栈内地址 db:5432，不映射宿主端口`)

  // ── 3. 迁移：一次性容器在栈内网络跑同一份账本（时机取舍的完整讨论在第 7 章） ──
  compose(['--profile', 'tools', 'run', '--rm', 'migrate'])

  // ── 4. 起应用：--wait 等 Dockerfile HEALTHCHECK 探 /api/health 转绿 ─────────
  t = Date.now()
  compose(['up', '-d', '--wait'])
  console.log(`[sim] 应用健康（${sec(Date.now() - t)}）—— HEALTHCHECK 已探明 /api/health 返回 200`)

  // ── 5. e2e 断言 ─────────────────────────────────────────────────────────────
  await waitReachable(HEALTH, 30_000)
  {
    const { res, body } = await fetchJson(HEALTH)
    if (res.status !== 200 || body?.status !== 'ok') {
      fail(`/api/health 期望 200 + {status:"ok"}，实际 ${res.status} ${JSON.stringify(body)}`)
    }
    if (body?.appEnv !== 'staging') {
      fail(`健康端点的 appEnv 期望 staging（compose 注入），实际 ${JSON.stringify(body?.appEnv)}`)
    }
    ok(`/api/health → 200 {status:"ok", appEnv:"staging"}（环境变量真的注入了容器）`)
  }

  {
    const who = composeCapture(['exec', '-T', 'app', 'whoami'])
    if (who !== 'node') fail(`容器内 whoami 期望 node（非 root），实际 "${who}"`)
    ok(`容器以非 root 运行（whoami = ${who}）`)
  }

  {
    const ls = composeCapture(['exec', '-T', 'app', 'sh', '-c', 'ls -a /app'])
    const entries = ls.split(/\s+/).filter(Boolean)
    if (!entries.includes('.output')) fail(`运行镜像 /app 里应有 .output，实际：${ls}`)
    if (entries.includes('.env')) fail(`运行镜像 /app 里出现了 .env —— .dockerignore 没拦住`)
    ok(`镜像里只有产物（/app = ${entries.filter((e) => !e.startsWith('.')).concat(entries.filter((e) => e.startsWith('.') && e !== '.' && e !== '..')).join(' ')}），无 .env、无源码`)
  }

  {
    const res = await fetch(BASE, { redirect: 'manual' })
    const html = await res.text()
    if (res.status !== 200 || !html.includes('Ship Log') || !html.includes('staging')) {
      fail(`页面期望 200 且含 "Ship Log" 与注入的 "staging"，实际 ${res.status}`)
    }
    ok(`GET / → 200，页面显示环境 staging（公有配置随容器注入）`)
  }

  let before = 0
  {
    const { body } = await fetchJson(API)
    if (!Array.isArray(body)) fail(`GET /api/deploys 期望数组（迁移后的空表），实际：${JSON.stringify(body)?.slice(0, 200)}`)
    before = body.length
    if (before !== 0) fail(`全新卷上期望空表（0 条），实际 ${before} 条 —— 预清理是否失效？`)
    ok('GET /api/deploys → []（迁移建好的空表，尚未种数据）')
  }

  {
    const { res, body } = await fetchJson(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ env: 'staging', status: 'success', commit: SURVIVOR_COMMIT, summary: '第 5 章演练：数据必须活过容器删除' }),
    })
    if (res.status !== 201 || body?.commit !== SURVIVOR_COMMIT) {
      fail(`POST 期望 201 且回显 commit，实际 ${res.status} ${JSON.stringify(body)?.slice(0, 200)}`)
    }
    ok(`POST /api/deploys → 201 {id:${body.id}}（容器内应用写进栈内数据库）`)
  }

  {
    const { body } = await fetchJson(API)
    const found = Array.isArray(body) && body.length === before + 1 && body[0]?.commit === SURVIVOR_COMMIT
    if (!found) fail(`GET 期望 ${before + 1} 条且新记录在最前，实际：${JSON.stringify(body)?.slice(0, 200)}`)
    const html = await (await fetch(BASE, { redirect: 'manual' })).text()
    if (!html.includes(SURVIVOR_COMMIT)) fail(`首页裸 HTML 里找不到 "${SURVIVOR_COMMIT}" —— 栈内 SSR 没读到库`)
    ok(`落库往返：GET 读回新记录，首页裸 HTML 含 "${SURVIVOR_COMMIT}"（SSR 走的栈内 db）`)
  }

  // ── 6. 幕二：删容器重建（保留卷），数据必须还在 ─────────────────────────────
  console.log('[sim] 幕二：down 拆除容器（保留卷）→ 重新 up，数据必须活过容器删除')
  compose(['down'])
  compose(['up', '-d', '--wait'])
  await waitReachable(API, 30_000)
  {
    const { body } = await fetchJson(API)
    const survived = Array.isArray(body) && body.some((d) => d?.commit === SURVIVOR_COMMIT)
    if (!survived) fail(`容器重建后 "${SURVIVOR_COMMIT}" 不见了 —— 数据没有活在卷里：${JSON.stringify(body)?.slice(0, 200)}`)
    ok(`容器删了重建，卷中数据仍在（${body.length} 条，含 "${SURVIVOR_COMMIT}"）`)
  }

  console.log(`[sim] 全部断言通过 (${passed}/${passed})`)
} catch (err) {
  markFailed(err)
} finally {
  // ── 7. 拆除：连卷清零，验证端口与容器确实还给系统（失败路径同样执行） ─────────
  console.log('[sim] 收尾：docker compose down --volumes（还端口、还容器名、清卷）')
  compose(['down', '--volumes'])
  const free = await portRefuses(15_000)
  const left = spawnSync('docker', ['ps', '-a', '--filter', `name=shiplog-stack-`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
  const leftover = (left.stdout ?? '').trim()
  if (free && !leftover) {
    console.log(`[sim] 端口 ${PORT} 已释放，shiplog-stack-* 容器已清空 → 收尾 PASS`)
  } else {
    console.error(`[sim] FAIL: 收尾未清干净 —— 端口释放: ${free}，残留容器: [${leftover || '无'}]`)
    process.exitCode = 1
  }
}
