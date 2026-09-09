#!/usr/bin/env node
// companion: scripts/compose-infra.mjs —— 教学基础设施（pg + redis）的跨平台开关（Windows / macOS / Linux 通用）
// 用法（在 companion 目录）：
//   node scripts/compose-infra.mjs up       拉起教学 Postgres 与 Redis 并等它们健康
//   node scripts/compose-infra.mjs down     停掉容器（具名卷保留，pg 数据不丢）
//   node scripts/compose-infra.mjs status   看容器状态
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const companionRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const composeFile = join(companionRoot, 'docker', 'compose.infra.yml')

const command = process.argv[2]

function compose(args) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, ...args], {
    stdio: 'inherit',
  })
  if (result.error) {
    console.error('找不到 docker 命令：请先安装并启动 Docker Desktop（或本机等价的 docker + compose）。')
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (command === 'up') {
  compose(['up', '-d', '--wait'])
  console.log('教学 Postgres 已就绪：postgres://postgres:postgres@localhost:5544/shortlink')
  console.log('教学 Redis 已就绪：redis://localhost:6639')
} else if (command === 'down') {
  compose(['down'])
  console.log('教学基础设施已停止（具名卷保留：再次 up 后数据仍在）。')
} else if (command === 'status') {
  compose(['ps'])
} else {
  console.error('用法: node scripts/compose-infra.mjs up|down|status')
  process.exit(2)
}
