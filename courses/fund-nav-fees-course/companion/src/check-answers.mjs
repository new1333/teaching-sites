// 演算题答案核对器（worksheet 形态的门槛）：fixtures/*.json 每条 { fn, args, pick, round, answer|claim }
// 与求解器输出逐条比对；正文承重数字（fixtures/doc-claims.json）同规——漂移即红。
// 输出摘要行与 vitest 摘要同构，供 scripts/course-final-check.mjs 解析计数。
import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const registry = {}
const register = (m) => Object.assign(registry, m)
try {
  register(await import('./nav.mjs'))
  register(await import('./fees.mjs'))
  register(await import('./daily.mjs'))
  register(await import('./share-class.mjs'))
  register(await import('./money-fund.mjs'))
  register(await import('./statement.mjs'))
} catch (e) {
  console.error(`求解器缺失或损坏（先红阶段）：${e.message}`)
}

const round = (x, r) => Math.round(x * 10 ** r) / 10 ** r
const pick = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)

const files = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort()
let total = 0, passed = 0
const failed = []
const groups = []
for (const f of files) {
  const { chapter, entries } = JSON.parse(readFileSync(join(fixtureDir, f), 'utf8'))
  let ok = 0
  for (const e of entries) {
    total += 1
    const expected = e.answer ?? e.claim
    let actual
    if (!registry[e.fn]) actual = `<求解器 ${e.fn} 未实现>`
    else {
      try { const out = registry[e.fn](e.args); actual = round(e.pick ? pick(out, e.pick) : out, e.round ?? 2) } catch (err) { actual = `<计算失败: ${err.message}>` }
    }
    if (actual === expected) { passed += 1; ok += 1 } else failed.push(`${f} ${e.id}: 期望 ${expected}，实际 ${actual}`)
  }
  groups.push(`  ${chapter}: ${ok}/${entries.length}`)
}
console.log(['答案核对（演算题 + 正文承重数字）:', ...groups.map((g) => `✓${g}`)].join('\n'))
if (failed.length) console.log(failed.map((x) => `✗ ${x}`).join('\n'))
console.log(`Test Files  ${failed.length ? 0 : files.length} passed (${files.length})`)
console.log(`     Tests  ${passed} passed${failed.length ? ` | ${total - passed} failed` : ''} (${total})`)
process.exit(failed.length ? 1 : 0)
