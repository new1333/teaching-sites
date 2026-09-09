#!/usr/bin/env node
// companion/scripts/start.mjs · pnpm start 入口——让「默认 4311」对读者成立
// Nitro 产物服务器自身默认监听 3000；scripts/lib/server.mjs 的 startServer() 起服时注入 4311，
// 但读者直接 pnpm start 不经过它。此处保持同一口径：仅在用户未显式设置 PORT 时注入 PORT=4311，
// 再 spawn .output/server/index.mjs（stdio 直通、信号转发、退出码透传，Windows 兼容）。
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = join(ROOT, '.output', 'server', 'index.mjs')

if (!existsSync(ENTRY)) {
  console.error(`未找到构建产物 ${ENTRY}——先跑 pnpm build`)
  process.exit(1)
}

const env = { ...process.env }
// 未显式设置 PORT（缺省或空串）才注入默认值；读者 export PORT=xxxx 时原样尊重
if (env.PORT === undefined || env.PORT === '') env.PORT = '4311'

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
})

child.on('error', (err) => {
  console.error('start 启动失败：', err)
  process.exitCode = 1
})

// 退出码透传：被信号杀掉（code 为 null）按非正常退出记 1
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})

// 信号转发：把 Ctrl+C / 终止信号传给子进程，避免留下残留的监听进程
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (child.exitCode === null) child.kill(sig)
  })
}
