// scripts/e2e-ch1.mjs · 第 1 章 e2e：起生产进程 → 断言 200 + SSR 内容 → 收尾退出
//
// 前置：pnpm build 已产出 .output（缺产物时本脚本会以「先构建」的明确理由失败）。
// 断言四件事：
//   1) node .output/server/index.mjs 能作为生产进程启动并监听端口；
//   2) GET / 返回 200；
//   3) 返回的 HTML 里含页面内联数据中的文本（fetch 不执行 JS，出现即服务端渲染）；
//   4) 进程被结束后端口不再监听。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const SERVER = join(ROOT, '.output', 'server', 'index.mjs')
const PORT = 4171
const BASE = `http://127.0.0.1:${PORT}`

// 页面 app/pages/index.vue 内联数据中的两行记录：出现在裸 HTML 里 = SSR 渲染的证据
const SSR_MARKERS = ['9f3c2ab', '77aa01f']

const fail = (msg) => {
  console.error(`[e2e:ch1] FAIL: ${msg}`)
  process.exit(1)
}

if (!existsSync(SERVER)) {
  fail(`未找到 ${SERVER} —— 生产产物不存在。先运行 pnpm build，再用 node 直接启动产物。`)
}

console.log(`[e2e:ch1] 启动生产进程: node .output/server/index.mjs (PORT=${PORT})`)
const startedAt = Date.now()
const child = spawn(process.execPath, [SERVER], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
child.stdout.on('data', (d) => { serverLog += d.toString() })
child.stderr.on('data', (d) => { serverLog += d.toString() })
const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })))

// 轮询直到响应或超时；连接被拒 = 进程还在启动，继续等
async function waitUntilReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      fail(`生产进程提前退出（code=${child.exitCode}）。服务端输出尾部：\n${serverLog.slice(-1500)}`)
    }
    try {
      const res = await fetch(BASE, { redirect: 'manual' })
      return res
    } catch { /* ECONNREFUSED: 还没监听，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 200))
  }
  fail(`等待 ${BASE} 就绪超时（${timeoutMs}ms）。服务端输出尾部：\n${serverLog.slice(-1500)}`)
}

let passed = 0
try {
  const res = await waitUntilReady(30_000)
  console.log(`[e2e:ch1] 进程就绪 (耗时 ${Date.now() - startedAt}ms)`)
  console.log(`[e2e:ch1] GET / → ${res.status}`)
  if (res.status !== 200) fail(`期望 200，实际 ${res.status}`)

  const html = await res.text()
  for (const marker of SSR_MARKERS) {
    const hit = html.includes(marker)
    console.log(`[e2e:ch1] HTML 含 SSR 数据文本 "${marker}" → ${hit ? 'PASS' : 'FAIL'}`)
    if (!hit) {
      fail(`裸 HTML（未执行任何 JS）中找不到 "${marker}" —— 页面数据不是服务端渲染出来的。`)
    }
    passed++
  }
  passed++ // 200 断言计入
} finally {
  // 端口用完必须释放：无论断言成败都杀掉进程并等它退出
  child.kill()
  const gone = await exited
  console.log(`[e2e:ch1] 生产进程已退出 (pid ${child.pid}, code=${gone.code}, signal=${gone.signal ?? '无'})`)
}

// 断言 4：端口不再监听 —— fetch 应当连不上
const portFreeDeadline = Date.now() + 10_000
let stillListening = false
while (Date.now() < portFreeDeadline) {
  try {
    await fetch(BASE)
    stillListening = true
    await new Promise((r) => setTimeout(r, 300))
  } catch {
    stillListening = false
    break
  }
}
if (stillListening) fail(`进程退出后 ${BASE} 仍可访问 —— 端口未释放`)
console.log(`[e2e:ch1] 端口 ${PORT} 不再监听 → PASS`)

console.log(`[e2e:ch1] 全部断言通过 (${passed + 1}/${passed + 1})`)
