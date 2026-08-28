// 正文承重数字再导出（worksheet 形态的 export-docs 守门）：从同一套求解器重算 doc-claims，
// 写 .course/verified-numbers.json。正文数字与本文件输出不一致时，check-answers 先红。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const registry = {}
Object.assign(registry, await import('./nav.mjs'), await import('./fees.mjs'), await import('./daily.mjs'), await import('./share-class.mjs'), await import('./money-fund.mjs'), await import('./statement.mjs'))
const round = (x, r) => Math.round(x * 10 ** r) / 10 ** r
const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

const { entries } = JSON.parse(readFileSync(join(root, 'companion', 'fixtures', 'doc-claims.json'), 'utf8'))
const out = {}
for (const e of entries) {
  const v = registry[e.fn](e.args)
  out[e.id] = round(e.pick ? pick(v, e.pick) : v, e.round ?? 2)
}
mkdirSync(join(root, '.course'), { recursive: true })
writeFileSync(join(root, '.course', 'verified-numbers.json'), JSON.stringify(out, null, 1) + '\n')
console.log(`已导出 ${entries.length} 条承重数字 → .course/verified-numbers.json（正文数字与此处不一致视为待核对占位）`)
