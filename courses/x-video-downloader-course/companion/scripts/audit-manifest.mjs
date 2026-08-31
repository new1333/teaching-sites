// scripts/audit-manifest.mjs —— 权限核对 CLI：manifest 每项能力对账「凭什么」，多余/缺失当场红
// 规则全在 audit-rules.mjs（纯函数，测试直接喂 fixture 验证）；本文件只读文件、拼源码、打印对账表。
// 退出码：全部对上号 0；有任何 finding 1——把它挂进 CI 或发布前自查，过度索权进不了包。

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PERMISSION_LEDGER, HOST_LEDGER, auditManifest } from './audit-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递式收 src/ 下全部文件（'/' 分隔的相对路径），排序保证两次运行清单一致 */
function walkSrc(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walkSrc(full))
    else out.push(full)
  }
  return out
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'))
const srcFiles = walkSrc(join(ROOT, 'src'))
const files = {}
for (const full of srcFiles) {
  const rel = full.slice(join(ROOT).length + 1).replaceAll('\\', '/')
  files[rel] = readFileSync(full, 'utf8')
}

const { findings, checked } = auditManifest(manifest, files)

console.log('manifest 权限核对 —— companion/manifest.json（证据：src/ 全部源码）')
console.log('  permissions:')
for (const p of manifest.permissions ?? []) {
  const ledger = PERMISSION_LEDGER[p]
  console.log(`    √ ${p.padEnd(12)} 第 ${ledger?.chapter ?? '?'} 章 · ${ledger?.why ?? '（规则表外——人工核对）'}`)
}
console.log('    · chrome.tabs / chrome.runtime 出现在代码里但不需要 permissions（sendMessage 不读标签页敏感信息）')
console.log('  host_permissions:')
for (const h of manifest.host_permissions ?? []) {
  console.log(`    √ ${h.padEnd(22)} 第 ${HOST_LEDGER[h]?.chapter ?? '?'} 章 · ${HOST_LEDGER[h]?.why ?? '（账本外——人工核对）'}`)
}
console.log('  action:')
console.log('    √ action 在册：第 4 章工具栏入口引入，第 5 章入口搬到推文按钮，sw.js 仍注册 onClicked 指路')
console.log('  web_accessible_resources:')
for (const res of manifest.web_accessible_resources?.[0]?.resources ?? []) {
  console.log(`    √ ${res}（装配链 import 闭包恰好这四个文件，只对 X 两域开）`)
}

if (findings.length > 0) {
  console.log(`\n核对 ${checked} 项，${findings.length} 条不对账：`)
  for (const f of findings) console.log(`  × [${f.kind}] ${f.item} —— ${f.detail}`)
  process.exit(1)
}
console.log(`\n核对 ${checked} 项全对上号，无多余项`)
