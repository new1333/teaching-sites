#!/usr/bin/env node
// companion/scripts/snapshot.mjs · 章末快照：把 companion 当前源码树复制到 steps/<name>/
// 用法：node scripts/snapshot.mjs ch01-perf-baseline
// 排除 node_modules/.nuxt/.output 与 steps 自身；pnpm-lock、reports、tests 一并快照。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2]
if (!name) {
  console.error('用法：node scripts/snapshot.mjs <chNN-slug>')
  process.exit(2)
}

const dest = join(ROOT, 'steps', name)
const EXCLUDED = new Set(['node_modules', '.nuxt', '.output', 'steps'])
mkdirSync(dest, { recursive: true })
if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
// 逐个顶层条目复制：fs.cpSync 不允许整体复制到自己的子目录里
for (const entry of readdirSync(ROOT)) {
  if (EXCLUDED.has(entry)) continue
  cpSync(join(ROOT, entry), join(dest, entry), { recursive: true })
}
console.log(`快照已写入：steps/${name}`)
