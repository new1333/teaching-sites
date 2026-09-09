// scripts/sim-prod.mjs · 第 6 章门槛：一键生产拓扑演练（起栈 → https e2e → 进程崩溃 → 断言自动恢复 → down）
//
// 演练的完整链路（与真实服务器的部署动作同构，差异只在端口与证书来源）：
//   1. 证书     —— 缺失则先跑 gen-cert.mjs（自签证书只服务本地演练，不入库）；
//   2. build    —— 复用第 5 章的多阶段镜像（app 出口 run 段；migrate 借 build 段）；
//   3. up db    —— 只起数据库，--wait 等 pg_isready 转绿；
//   4. migrate  —— 一次性容器在栈内网络重放迁移账本；
//   5. up --wait —— 起 app 与 nginx：app 健康探针转绿后 nginx 才起；
//   6. e2e      —— 全部走 https://127.0.0.1:8443：页面 200、SSR 文本、落库往返、
//                  自签证书握手细节（CN 与 SAN）、app 无宿主端口、80→443 跳转 301；
//   7. 幕二     —— 向 app 容器的 PID 1 发 SIGTERM（模拟进程自行崩溃），restart: unless-stopped
//                  必须把它拉起来，服务恢复应答、RestartCount 增加、卷中数据仍在；
//   8. down -v  —— 连卷拆除，验端口与容器清零（失败路径同样执行）。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import https from 'node:https'
import tls from 'node:tls'

const ROOT = join(import.meta.dirname, '..')
const COMPOSE_FILE = join(ROOT, 'compose.prod.yaml')
const PROJECT = 'shiplog-prod'
const HTTP_PORT = 4181
const HTTPS_PORT = 8443
const BASE = `https://127.0.0.1:${HTTPS_PORT}`
const API = `${BASE}/api/deploys`
const HEALTH = `${BASE}/api/health`
// 幕一写入、崩溃重启后必须还能读到的记录（7 位十六进制，通过 POST 校验）
const SURVIVOR_COMMIT = '502feed'

class SimFailure extends Error {}

const fail = (msg) => {
  throw new SimFailure(msg)
}

const markFailed = (err) => {
  if (err instanceof SimFailure) {
    console.error(`[prod] FAIL: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exitCode = 1
}

// 包一层 docker compose：固定编排文件与项目名；失败时以同一退出码结束演练
function compose(args) {
  const res = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args], {
    stdio: 'inherit',
  })
  if (res.error) {
    fail(`找不到 docker 命令：${res.error.message} —— 本机需要 Docker Desktop（或等价引擎）在运行。`)
  }
  if (res.status !== 0) {
    fail(`docker compose ${args.join(' ')} 退出码 ${res.status}。`)
  }
  return res
}

// 静默跑一条命令，拿 stdout（用于 inspect / port 断言）
function capture(cmd, args) {
  const res = spawnSync(cmd, args, { encoding: 'utf8' })
  if (res.status !== 0) {
    fail(`${cmd} ${args.join(' ')} 退出码 ${res.status}：${(res.stderr ?? '').slice(0, 500)}`)
  }
  return (res.stdout ?? '').trim()
}

// https 请求的最小实现：与 curl -k 同语义（rejectUnauthorized: false）。
// 不用全局 fetch 是因为它没有「跳过证书校验」的开关；演练的信任边界在
// 「反代与 TLS 链路对不对」，不在「本机临时证书是否被浏览器信任」。
function httpsRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      `${BASE}${path}`,
      {
        method,
        rejectUnauthorized: false, // 自签证书：放行握手（等价 curl -k）
        headers: body ? { 'content-type': 'application/json' } : undefined,
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text: async () => text,
            json: async () => JSON.parse(text),
          })
        })
      },
    )
    req.on('error', (err) => reject(err))
    // 单请求限时：崩溃窗口里 nginx 可能挂着连接等后端超时（返回 504），
    // 不能让一次挂起的请求吃掉整个轮询预算
    req.setTimeout(8_000, () => req.destroy(new Error('request timeout (8s)')))
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// 请求 + 失败翻译：网络层错误（连接被拒、重置）转成带线索的 SimFailure
async function httpsFetch(path, init = {}) {
  try {
    return await httpsRequest(init.method ?? 'GET', path, init.body)
  } catch (err) {
    throw new SimFailure(`https 请求失败（${init.method ?? 'GET'} ${path}）：${err.message}`)
  }
}

const sec = (ms) => `${(ms / 1000).toFixed(1)}s`
let passed = 0
const ok = (label) => {
  passed++
  console.log(`[prod] ${label} → PASS`)
}

// 宿主侧就绪等待：轮询到 https 入口真的能应答（Windows 端口代理在 up 后的瞬间可能仍拒绝连接）
async function waitReachable(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await httpsRequest('GET', path)
      return
    } catch {
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  fail(`等待 ${BASE}${path} 从宿主机可达超时（${timeoutMs}ms）—— docker ps / docker logs shiplog-prod-nginx 排查`)
}

// 端口释放检查：http 用 fetch 即可；https 必须放行自签证书再判断——
// 否则「端口还开着」会被证书错误误判成「连接被拒」
async function portRefuses(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  const tlsCheck = url.startsWith('https:')
  while (Date.now() < deadline) {
    if (tlsCheck) {
      const err = await new Promise((resolve) => {
        const socket = tls
          .connect({ host: '127.0.0.1', port: HTTPS_PORT, rejectUnauthorized: false }, () => {
            socket.destroy()
            resolve(null) // 连上了：端口未释放
          })
          .on('error', (e) => resolve(e))
        setTimeout(() => { socket.destroy(); resolve(new Error('timeout')) }, 3_000)
      })
      if (err && err.code === 'ECONNREFUSED') return true // 连接被拒：端口已释放
    } else {
      try {
        await fetch(url, { redirect: 'manual' })
      } catch {
        return true // 连接被拒：端口已释放
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

try {
  console.log('[prod] 第 6 章生产拓扑演练开始（Docker + Compose 需在运行）')

  // ── 0. 预清理：上次失败若留下栈，先连卷拆干净，保证每次演练从全新卷出发 ──────────
  spawnSync('docker', ['compose', '-f', COMPOSE_FILE, '-p', PROJECT, 'down', '--volumes'], {
    stdio: 'ignore',
  })

  // ── 1. 证书：缺失就生成（产物不入库，任何人 clone 后跑门槛都是自产自销） ──────────
  if (!existsSync(join(ROOT, 'nginx', 'certs', 'server.crt'))) {
    console.log('[prod] 未找到证书，先跑 pnpm gen:cert 同款生成……')
    const gen = spawnSync(process.execPath, [join(ROOT, 'scripts', 'gen-cert.mjs')], { stdio: 'inherit' })
    if (gen.status !== 0) fail('证书生成失败——openssl 可用吗？')
  }

  // ── 2. 构建：复用第 5 章的镜像体系（首次拉取 nginx:1.27-alpine 在 up 时进行） ────
  let t = Date.now()
  compose(['build'])
  console.log(`[prod] 镜像构建完成（${sec(Date.now() - t)}）——与 compose.yaml 共用同一份 Dockerfile`)

  // ── 3. 起库 → 迁移：与部署主线同序（先迁移、后起应用） ──────────────────────────
  t = Date.now()
  compose(['up', '-d', '--wait', 'db'])
  compose(['--profile', 'tools', 'run', '--rm', 'migrate'])
  console.log(`[prod] 数据库健康且账本已重放（${sec(Date.now() - t)}）`)

  // ── 4. 起整套栈：app 健康后 nginx 才起（depends_on: service_healthy） ────────────
  t = Date.now()
  compose(['up', '-d', '--wait'])
  console.log(`[prod] 栈已就绪（${sec(Date.now() - t)}）—— 入口 https://127.0.0.1:${HTTPS_PORT}，app 无宿主端口`)

  // ── 5. e2e 断言：全部走 https 入口 ────────────────────────────────────────────
  await waitReachable('/api/health', 30_000)

  {
    const res = await httpsFetch('/api/health')
    const body = await res.json().catch(() => null)
    if (res.status !== 200 || body?.status !== 'ok') {
      fail(`/api/health 期望 200 + {status:"ok"}，实际 ${res.status} ${JSON.stringify(body)}`)
    }
    if (body?.appEnv !== 'production') {
      fail(`健康端点的 appEnv 期望 production（prod 栈注入），实际 ${JSON.stringify(body?.appEnv)}`)
    }
    ok(`https /api/health → 200 {status:"ok", appEnv:"production"}（TLS 在 nginx 终止，明文进 app）`)
  }

  {
    const res = await httpsFetch('/')
    const html = await res.text()
    if (res.status !== 200 || !html.includes('Ship Log') || !html.includes('<code>production</code>')) {
      fail(`页面期望 200 且含 "Ship Log" 与 <code>production</code>，实际 ${res.status}`)
    }
    ok(`https GET / → 200，SSR 页面显示环境 production`)
  }

  {
    // 证书细节：握手放行但读回对端证书——CN 与 SAN 必须是生成脚本写进去的那两个名字
    const cert = await new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: '127.0.0.1', port: HTTPS_PORT, rejectUnauthorized: false },
        () => resolve(socket.getPeerCertificate()),
      )
      socket.on('error', reject)
      setTimeout(() => reject(new Error('tls 握手超时')), 10_000)
    })
    const san = cert.subjectaltname ?? ''
    // openssl 的 SAN 文本两种形态都认：IP:127.0.0.1（Node tls）与 IP Address:127.0.0.1（openssl x509 -text）
    const sanOk = san.includes('DNS:localhost') && /IP(?: Address)?:127\.0\.0\.1/.test(san)
    if (cert.subject?.CN !== 'localhost' || !sanOk) {
      fail(`证书 CN/SAN 期望 localhost + 127.0.0.1，实际 CN=${cert.subject?.CN} SAN=${san}`)
    }
    ok(`自签证书细节可验（CN=${cert.subject.CN}，SAN 含 localhost 与 127.0.0.1）`)
  }

  {
    // 拓扑断言：app 容器不映射任何宿主端口——「绕过反代」的路不存在
    const ports = capture('docker', ['port', 'shiplog-prod-app'])
    if (ports !== '') fail(`app 容器不应映射宿主端口，实际：${ports}`)
    ok(`app 无宿主端口映射（docker port 为空）——唯一入口是 nginx 的 ${HTTP_PORT}/${HTTPS_PORT}`)
  }

  {
    // 80 入口的唯一职责：301 跳 https（Location 以 https:// 开头即可——
    // 本地 https 在非标准端口 8443，跳转端口对不上是登记在案的本地差异）
    const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/`, { redirect: 'manual' })
    const loc = res.headers.get('location') ?? ''
    if (res.status !== 301 || !loc.startsWith('https://')) {
      fail(`http:${HTTP_PORT} 期望 301 且 Location 以 https:// 开头，实际 ${res.status} "${loc}"`)
    }
    ok(`http:${HTTP_PORT} → 301 ${loc}（明文入口只做跳转）`)
  }

  {
    const res = await httpsFetch('/api/deploys', {
      method: 'POST',
      body: { env: 'production', status: 'success', commit: SURVIVOR_COMMIT, summary: '第 6 章演练：经 https 反代落库' },
    })
    const body = await res.json().catch(() => null)
    if (res.status !== 201 || body?.commit !== SURVIVOR_COMMIT) {
      fail(`POST 期望 201 且回显 commit，实际 ${res.status} ${JSON.stringify(body)?.slice(0, 200)}`)
    }
    const html = await (await httpsFetch('/')).text()
    if (!html.includes(SURVIVOR_COMMIT)) fail(`首页裸 HTML 里找不到 "${SURVIVOR_COMMIT}" —— SSR 没读到库`)
    ok(`落库往返：POST → 201，首页裸 HTML 含 "${SURVIVOR_COMMIT}"（https 全链路 + 栈内 db）`)
  }

  // ── 6. 幕二：让 app 进程自行崩溃（exec 进容器向 PID 1 发 SIGTERM，Nitro 优雅退出），
  //      restart: unless-stopped 必须把它拉起来——「进程死了」与「人叫它停」是两件事，
  //      只有前者归重启策略管（docker stop/kill 是管理员动作，本引擎按手动停止对待，不复活）
  console.log('[prod] 幕二：向 app 容器的 PID 1 发 SIGTERM（模拟进程自行崩溃）→ 等自动重启恢复')
  const before = Number(capture('docker', ['inspect', '--format', '{{.RestartCount}}', 'shiplog-prod-app']))
  capture('docker', ['exec', 'shiplog-prod-app', 'kill', '-TERM', '1'])
  t = Date.now()
  let recovered = false
  {
    // 崩溃窗口里入口可能短暂返回 502/504（nginx 在、后端死）——这正是「入口在、后端死」的现象；
    // 演练断言的是恢复：restart 约定把容器拉起，https 入口回到 200
    const deadline = Date.now() + 90_000
    const seen = []
    while (Date.now() < deadline) {
      try {
        const res = await httpsFetch('/api/health')
        seen.push(res.status)
        if (res.status === 200) { recovered = true; break }
      } catch {
        seen.push('err')
      }
      await new Promise((r) => setTimeout(r, 200))
    }
    console.log(`[prod] 崩溃窗口内入口状态序列：${seen.slice(0, 12).join(' → ')}${seen.length > 12 ? ' → …' : ''}`)
    if (!recovered) fail(`进程退出后 ${sec(Date.now() - t)} 内 https 入口未恢复 200 —— restart 约定没生效？docker inspect shiplog-prod-app 看 RestartCount 与 State`)
  }
  const after = Number(capture('docker', ['inspect', '--format', '{{.RestartCount}}', 'shiplog-prod-app']))
  if (after <= before) fail(`RestartCount 期望增加（before=${before}, after=${after}）——容器是被策略拉起的，不是巧合`)
  {
    const body = await (await httpsFetch('/api/deploys')).json().catch(() => null)
    const survived = Array.isArray(body) && body.some((d) => d?.commit === SURVIVOR_COMMIT)
    if (!survived) fail(`崩溃重启后 "${SURVIVOR_COMMIT}" 不见了：${JSON.stringify(body)?.slice(0, 200)}`)
    ok(`崩溃 → 自动重启 → 服务恢复（RestartCount ${before}→${after}，${sec(Date.now() - t)}），卷中数据仍在`)
  }

  console.log(`[prod] 全部断言通过 (${passed}/${passed})`)
} catch (err) {
  markFailed(err)
} finally {
  // ── 7. 拆除：连卷清零，验证端口与容器确实还给系统（失败路径同样执行） ─────────────
  console.log('[prod] 收尾：docker compose down --volumes（还端口、还容器名、清卷）')
  compose(['down', '--volumes'])
  const httpFree = await portRefuses(`http://127.0.0.1:${HTTP_PORT}/`, 15_000)
  const httpsFree = await portRefuses(`${BASE}/`, 15_000)
  const left = spawnSync('docker', ['ps', '-a', '--filter', `name=shiplog-prod-`, '--format', '{{.Names}}'], {
    encoding: 'utf8',
  })
  const leftover = (left.stdout ?? '').trim()
  if (httpFree && httpsFree && !leftover) {
    console.log(`[prod] 端口 ${HTTP_PORT}/${HTTPS_PORT} 已释放，shiplog-prod-* 容器已清空 → 收尾 PASS`)
  } else {
    console.error(`[prod] FAIL: 收尾未清干净 —— ${HTTP_PORT} 释放: ${httpFree}，${HTTPS_PORT} 释放: ${httpsFree}，残留容器: [${leftover || '无'}]`)
    process.exitCode = 1
  }
}
