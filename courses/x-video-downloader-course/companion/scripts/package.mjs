// scripts/package.mjs —— 打包：把扩展本体压成 dist/x-video-downloader.zip（Chrome Web Store 上传格式）
// 取舍规则在 audit-rules.mjs 的 selectZipFiles（纯函数，测试直接验证）：zip 只装 manifest.json 与 src/。
// 两条硬约束都来自商店的真实要求：manifest.json 必须在 zip 根；两次打包逐字节一致（固定 mtime，
// 可复现的包才谈得上核对）——打包完当场解包自检，清单对不上直接 throw。

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipSync, unzipSync } from 'fflate'
import { selectZipFiles } from './audit-rules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const ZIP_PATH = join(DIST, 'x-video-downloader.zip')

/** 递式收 companion 根下全部文件（'/' 分隔相对路径）；node_modules 与 dist 不进清单 */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const names = selectZipFiles(walk(ROOT).map((f) => f.slice(ROOT.length + 1).replaceAll('\\', '/'))).sort()
if (!names.includes('manifest.json')) throw new Error('打包清单里没有 manifest.json——商店只认 zip 根上的 manifest')

/** @type {Record<string, Uint8Array>} */
const bag = {}
for (const n of names) bag[n] = new Uint8Array(readFileSync(join(ROOT, n)))

// 固定修改时间：不固定的话 zip 元数据每次都变，两次打包不可能逐字节一致
const zipped = zipSync(bag, { level: 9, mtime: new Date(Date.UTC(2026, 0, 1)) })

mkdirSync(DIST, { recursive: true })
writeFileSync(ZIP_PATH, zipped)

// 打包自检：当场解包，核对清单与 manifest 位置
const back = unzipSync(zipped)
const got = Object.keys(back).sort()
if (JSON.stringify(got) !== JSON.stringify(names)) {
  throw new Error(`打包自检失败：zip 内容与文件清单不一致\n  清单：${names.join(', ')}\n  zip 里：${got.join(', ')}`)
}

console.log(`打包完成：dist/x-video-downloader.zip（${names.length} 个文件，${(zipped.length / 1024).toFixed(1)} KiB）`)
console.log('  zip 根上就是 manifest.json 与 src/——商店上传要求的形状：')
for (const n of names) console.log(`    ${n}（${(bag[n].length / 1024).toFixed(1)} KiB）`)
