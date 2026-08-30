#!/usr/bin/env node
// 课程终检 —— 仓库级共享脚本（issues/012 改造 E-1：final-check 仪器化，机械可查项全部入脚本）。
// 原则成文：凡能脚本化的对账不得留给自觉（issues/011：给了脚本的检查执行率 ~100%，没给的十几项终检只做了 3 项）。
//
// 用法：
//   node scripts/course-final-check.mjs <course_dir> [--skip-gates] [--lang zh|en]
//
//   --skip-gates   跳过伴生验证物门槛实跑（typecheck/test）与测试数断言比对（快速模式）
//   --lang         默认 zh；影响免责关键词等中文面检查的启用
//
// 机械项覆盖（对应 vitepress-assembly.md 终检清单的可脚本化子集）：
//   章文件数/序号/slug 与大纲一致；frontmatter title 对账；附录页一一对应；
//   hero 长度（text≤30、tagline≤50）与入口链接相对化且目标存在；
//   glossary 页 = bible 术语条目集；术语全书出现（容 3）；
//   src/ tests/ 标注代码块与验证物终态逐字 diff（剥注释行后须为文件的连续切片；「拼版」豁免）；
//   站内相对链接与资产死链；promises.json 全部核销；obligations 呈现面存在；
//   zero-trace 抽查（github blob/tree 链接、.course/repo 痕迹）/ walkthrough 档引用路径存在性；
//   降级章占位核验；伴生门槛实跑 + 正文/README/终章的测试数与行数断言比对（现实是事实源）。
//
// 退出码：有阻断问题 1，干净 0；「info:」前缀的行不阻断。

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { execSync } from 'node:child_process'

const argv = process.argv.slice(2)
if (!argv.length) { console.error('用法: node scripts/course-final-check.mjs <course_dir> [--skip-gates] [--lang zh|en]'); process.exit(2) }
const courseDir = argv[0]
const skipGates = argv.includes('--skip-gates')
const langIdx = argv.indexOf('--lang')
const zh = (langIdx === -1 ? 'zh' : argv[langIdx + 1]) === 'zh'

if (!existsSync(courseDir)) { console.error(`课程目录不存在: ${courseDir}`); process.exit(2) }
const issues = []
const infos = []
const say = (m) => issues.push(m)

// 统一文本读取：规范化 CRLF（Windows 生成课程的 frontmatter/表格正则会因此失配）
const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const outlinePath = join(courseDir, '.course', 'outline.json')
let outline = {}
let chapters = [] // { n, slug, title, type }
let appendices = []
let profile = {}
if (!existsSync(outlinePath)) {
  say(`outline 缺失: ${relative('.', outlinePath).split(sep).join('/')}——终检对账失去事实源（管线状态应随课程提交，issues/012 E-8）`)
} else try {
  outline = JSON.parse(readText(outlinePath))
  profile = outline.profile ?? {}
  let n = 0
  for (const part of outline.parts ?? [])
    for (const ch of part.chapters ?? []) { n += 1; chapters.push({ n, ...ch }) }
  appendices = outline.appendices ?? []
} catch (e) { say(`outline.json 解析失败: ${e.message}`) }

// ---- 1. 章文件与大纲对账 ----
const docsDir = join(courseDir, 'docs')
const mdFiles = existsSync(docsDir) ? readdirSync(docsDir).filter((f) => /^\d{2}-.*\.md$/.test(f)).sort() : []
if (!mdFiles.length) say('docs/ 下没有 NN-slug.md 章文件')
const fileChapters = mdFiles.map((f) => { const m = f.match(/^(\d+)-(.+)\.md$/); return { n: Number(m[1]), slug: m[2], file: f } })
if (chapters.length && fileChapters.length !== chapters.length)
  say(`章文件数 ${fileChapters.length} ≠ 大纲章数 ${chapters.length}`)
for (let i = 0; i < Math.min(chapters.length, fileChapters.length); i++) {
  if (chapters[i].n !== fileChapters[i].n) { say(`第 ${i + 1} 个章文件序号 ${fileChapters[i].n} 与大纲序号 ${chapters[i].n} 不一致（${fileChapters[i].file}）`); break }
  if (chapters[i].slug !== fileChapters[i].slug)
    say(`${fileChapters[i].file}: 文件 slug 与大纲（${chapters[i].slug}）不一致——sidebar 与链接按大纲渲染，会 404`)
}
for (const ap of appendices) {
  if (!existsSync(join(docsDir, `${ap.slug}.md`))) say(`附录 ${ap.slug}.md 缺失（大纲声明了 ${ap.title}）`)
}
for (const f of readdirSync(docsDir).filter((f) => /^\d{2}-.*\.md$/.test(f) === false && f.endsWith('.md') && f !== 'index.md' && f !== 'about.md')) {
  if (!appendices.some((ap) => `${ap.slug}.md` === f)) infos.push(`docs/${f} 不在大纲 appendices 里——孤儿页面（补充大纲条目或删除）`)
}

// ---- 2. frontmatter title 对账 ----
const chapterMd = (n) => fileChapters.find((c) => c.n === n)
for (const ch of chapters) {
  const fc = chapterMd(ch.n)
  if (!fc) continue
  const raw = readText(join(docsDir, fc.file))
  const t = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? ''
  const title = /^title:\s*(.+)$/m.exec(t)?.[1]?.trim().replace(/^["']|["']$/g, '')
  if (!title) say(`${fc.file}: frontmatter 缺 title`)
  else if (title !== ch.title) say(`${fc.file}: frontmatter title「${title}」≠ 大纲「${ch.title}」`)
}

// ---- 3. hero 长度与首页入口 ----
const indexPath = join(docsDir, 'index.md')
if (!existsSync(indexPath)) say('docs/index.md 缺失')
else {
  const raw = readText(indexPath)
  const fm = /^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? ''
  const heroText = /^ {2}text:\s*(.+)$/m.exec(fm)?.[1]?.trim()
  const tagline = /^ {2}tagline:\s*(.+)$/m.exec(fm)?.[1]?.trim()
  if (heroText && heroText.length > 30) say(`hero text ${heroText.length} 字 >30（改 outline.audience 后重渲染，不在模板里另造短文案）`)
  if (tagline && tagline.length > 50) say(`hero tagline ${tagline.length} 字 >50（改 outline.final_milestone.what_reader_built 后重渲染）`)
  for (const m of raw.matchAll(/link:\s*(\.?\/?[^\s']+)/g)) {
    const link = m[1]
    if (/^https?:|^mailto:/.test(link)) continue
    if (link.startsWith('/')) { say(`index.md 存在绝对站内链接 ${link}——聚合站挂载在 /{课程名}/ 前缀下会 404，一律相对`); continue }
    const target = link.replace(/^\.\//, '').replace(/#.*$/, '')
    if (target && !existsSync(join(docsDir, target)) && !existsSync(join(docsDir, `${target}.md`)))
      say(`index.md 链接 ${link} 目标不存在（死链）`)
  }
}

// ---- 4. bible / glossary / 术语覆盖 / 权威文档清单 ----
const biblePath = join(courseDir, '.course', 'bible.json')
let glossary = []
if (existsSync(biblePath)) {
  try {
    const bible = JSON.parse(readText(biblePath))
    glossary = bible.glossary ?? []
    // 权威文档清单门槛（issues/011 P0-2 / 012 E-2）：涉事实断言的课程必配；纯主观工程课须显式声明 factual_claims: false
    const authority = bible.authority_docs ?? bible.authoritative_docs // 兼容两种键名（vitepress-teaching-site 用 authoritative_docs）
    const hasAuthority = Array.isArray(authority) ? authority.length > 0 : Boolean(authority)
    if (!hasAuthority && bible.factual_claims !== false)
      say('bible 缺权威文档清单（authority_docs）——凡正文将出现客观事实断言的课程必配，final-check 查存在性；纯主观工程课请在 bible 显式声明 factual_claims: false')
  } catch (e) { say(`bible.json 解析失败: ${e.message}`) }
} else infos.push('.course/bible.json 缺失（管线状态应随课程提交——issues/012 E-8）')
const glossaryAp = appendices.find((ap) => ap.kind === 'glossary')
if (glossaryAp && glossary.length) {
  const gp = join(docsDir, `${glossaryAp.slug}.md`)
  if (existsSync(gp)) {
    const rows = [...readText(gp).matchAll(/^\|(.+)\|$/gm)]
      .map((m) => m[1].split('|')[0].trim())
      .filter((c, i, arr) => c && !/^[-: ]+$/.test(c) && !(i === 0 && arr.length > 1)) // 剥表头与分隔行，首列为术语
    const pageTerms = new Set(rows)
    const missingOnPage = glossary.filter((t) => !pageTerms.has(t.term)).map((t) => t.term)
    const extraOnPage = [...pageTerms].filter((t) => !glossary.some((g) => g.term === t))
    if (missingOnPage.length) say(`glossary 页缺 ${missingOnPage.length} 条 bible 术语：${missingOnPage.slice(0, 8).join('、')}${missingOnPage.length > 8 ? '…' : ''}`)
    if (extraOnPage.length) say(`glossary 页有 ${extraOnPage.length} 条 bible 外的条目：${extraOnPage.slice(0, 8).join('、')}${extraOnPage.length > 8 ? '…' : ''}`)
  }
}
if (glossary.length && mdFiles.length) {
  const book = mdFiles.map((f) => readText(join(docsDir, f))).join('\n').replace(/```[\s\S]*?```/g, '')
  const absent = glossary.filter((t) => !book.includes(t.term))
  if (absent.length > 3) say(`术语表 ${absent.length} 条全书未出现（容 3）：${absent.map((t) => t.term).join('、')}`)
}
// 术语页 ⊇ 全部 new_concepts（issues/011 P2-7 / 012 E-7：首教过的概念在术语页找不到，是读者的死链）
if (glossary.length) {
  const glossaryTerms = new Set(glossary.map((t) => t.term))
  const taught = [...new Set(chapters.flatMap((c) => c.new_concepts ?? []))]
  const notInGlossary = taught.filter((t) => !glossaryTerms.has(t))
  if (notInGlossary.length) say(`大纲 new_concepts 有 ${notInGlossary.length} 条不在 bible 术语表（glossary 页由术语表渲染，会漏教过的概念）：${notInGlossary.slice(0, 8).join('、')}${notInGlossary.length > 8 ? '…' : ''}`)
}

// ---- 5. src/ 标注块与验证物终态逐字 diff ----
const companionRoot = join(courseDir, 'companion')
const stripNoise = (lines) => lines
  .map((l) => l.replace(/\s+$/, ''))
  .filter((l) => l && !/^\s*(\/\/|#|\/\*|\*|\{\/\*)/.test(l))
const isSubsequenceSlice = (needle, hay) => {
  if (!needle.length) return true
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return true
  }
  return false
}
const cmpBlocks = (mdText, mdFile, rootDir, kindLabel) => {
  for (const b of mdText.match(/```\w*\n[\s\S]*?```/g) ?? []) {
    const m = /(?:\/\/|#)\s*((?:src|tests)\/[\w./-]+)/.exec(b.slice(0, 300))
    if (!m) continue
    if (b.includes('拼版')) continue // 拼版视图豁免（完整形态全书至少出现过一次——评审轴核对）
    const p = join(rootDir, m[1])
    if (!existsSync(p)) { say(`${mdFile}: 标注出处 ${m[1]} 不存在——标注必须真实`); continue }
    const blockLines = stripNoise(b.split('\n').slice(1, -1))
    const fileLines = stripNoise(readText(p).split('\n'))
    if (!isSubsequenceSlice(blockLines, fileLines)) {
      const fileSet = new Set(fileLines)
      const firstDiff = blockLines.find((l) => !fileSet.has(l))
      say(`${mdFile}: 代码块与 ${kindLabel}终态不一致（${m[1]}${firstDiff ? `，首处漂移行：「${firstDiff.slice(0, 60)}」` : ''}）——重构回写漏网，正文引用必须始终等于终态`)
    }
  }
}
for (const fc of fileChapters) cmpBlocks(readText(join(docsDir, fc.file)), fc.file, companionRoot, '伴生仓')
for (const ap of appendices) { const p = join(docsDir, `${ap.slug}.md`); if (existsSync(p)) cmpBlocks(readText(p), `${ap.slug}.md`, companionRoot, '伴生仓') }

// ---- 6. 站内相对链接与资产死链 ----
for (const f of mdFiles.concat(readdirSync(docsDir).filter((x) => x.endsWith('.md')))) {
  // 剥代码块与行内代码再扫链接：源码里的 $d[name](arg) 调用会被误判成 markdown 链接
  const raw = readText(join(docsDir, f)).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  for (const m of raw.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
    const link = m[1].trim()
    if (/^(https?:|mailto:|#)/.test(link) || link.startsWith('/')) continue // 绝对链接交由 review 口径，不在此重复
    const target = link.replace(/^\.\//, '').split('#')[0]
    if (!target) continue
    if (!existsSync(join(docsDir, target)) && !existsSync(join(docsDir, `${target}.md`)))
      say(`${f}: 站内相对链接 ${link} 目标不存在（死链——ignoreDeadLinks 只是兜底，不是免检）`)
  }
}

// ---- 7. 承诺账核销 ----
const promisesPath = join(courseDir, '.course', 'promises.json')
if (existsSync(promisesPath)) {
  try {
    const list = JSON.parse(readText(promisesPath))
    const pending = (Array.isArray(list) ? list : list.promises ?? []).filter((p) => (p.status ?? '') !== 'fulfilled')
    if (pending.length) say(`promises.json 有 ${pending.length} 条承诺未核销（终检第 12 条「能力对账」）：${pending.map((p) => `第${p.from}→${p.target ?? p.to_slug ?? '?'}章`).slice(0, 6).join('、')}`)
  } catch (e) { say(`promises.json 解析失败: ${e.message}`) }
}

// ---- 8. obligations 呈现面 ----
for (const ob of profile.obligations ?? []) {
  for (const s of ob.surfaces ?? []) {
    const p = join(courseDir, s)
    if (!existsSync(p)) { say(`obligation(${ob.kind}) 呈现面缺失: ${s}`); continue }
    if (zh && /compliance|timeliness/.test(ob.kind)) {
      const txt = readText(p)
      if (!/免责|声明|时效|合规|不构成|仅供参考|截至|风险提示/.test(txt))
        infos.push(`obligation(${ob.kind}) 呈现面 ${s} 未检出声明性措辞——人工确认一句领域惯例措辞是否到位`)
    }
  }
}

// ---- 9. 仓库痕迹政策 ----
const ref = outline.input?.ref ?? ''
const ownerRepo = ref.split('@')[0]
const allDocsText = () => mdFiles.concat(['about.md', 'index.md']).map((f) => (existsSync(join(docsDir, f)) ? readText(join(docsDir, f)) : '')).join('\n')
if ((profile.source_policy ?? 'zero-trace') === 'zero-trace' && ownerRepo) {
  const t = allDocsText()
  const esc = ownerRepo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = new RegExp(`github\\.com/${esc}/(blob|tree)`, 'i').test(t) || t.includes('.course/repo')
  if (hit) say(`zero-trace 违例：docs/ 检出 ${ownerRepo} 的 blob/tree 链接或 .course/repo 痕迹（repo 只能是作者侧备课资料）`)
} else if ((profile.source_policy ?? '') === 'guided-walkthrough') {
  const repoRoot = join(courseDir, '.course', 'repo')
  const t = allDocsText()
  for (const m of t.matchAll(/([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40}|[\w./-]+):([\w./-]+)/g)) {
    if (existsSync(repoRoot) && !existsSync(join(repoRoot, m[3]))) say(`walkthrough 引用 ${m[3]} 不在锁定 ref 的仓库里——引用必须逐字一致`)
    if (ref && !ref.includes('@')) infos.push('outline.input.ref 未锁定到具体 SHA——walkthrough 档全书引用的唯一事实源')
  }
  if (!existsSync(repoRoot)) infos.push('.course/repo/ 缺失，walkthrough 引用路径存在性未机械核对（clone 后重跑）')
}

// ---- 10. 降级章 ----
const rollingPath = join(courseDir, '.course', 'rolling.json')
if (existsSync(rollingPath)) {
  try {
    const roll = JSON.parse(readText(rollingPath))
    const entries = Array.isArray(roll) ? roll : roll.chapters ?? []
    const degraded = entries.filter((e) => e.degraded)
    for (const d of degraded) infos.push(`第 ${d.n ?? '?'} 章为降级章（实验场保持上一章形态）——交付汇报点名`)
    for (const d of degraded) {
      const fc = chapterMd(d.n)
      if (fc && !readText(join(docsDir, fc.file)).includes('::: warning'))
        say(`第 ${d.n} 章标记降级但章文件无 ::: warning 占位块——占位格式漂移`)
    }
  } catch { /* rolling 损坏不阻断终检 */ }
} else infos.push('.course/rolling.json 缺失（管线状态应随课程提交——issues/012 E-8）')

// ---- 11. 门槛实跑 + 数字断言比对（现实是事实源）----
let testCount = null, fileCount = null
if (!skipGates && existsSync(join(companionRoot, 'package.json'))) {
  const pkg = JSON.parse(readText(join(companionRoot, 'package.json')))
  const scripts = pkg.scripts ?? {}
  const run = (cmd) => { try { return execSync(`npm run ${cmd} --silent`, { cwd: companionRoot, encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) } catch (e) { return `${e.stdout ?? ''}\n${e.stderr ?? ''}` } }
  // npm/vitest 输出带 ANSI 颜色码，先剥再解析
  const plain = (s) => s.replace(/\[[0-9;]*[A-Za-z]/g, '')
  if (scripts.typecheck) {
    const out = plain(run('typecheck'))
    if (/error TS/i.test(out)) say(`伴生 typecheck 未过（正文断言与机械现实一致是硬要求）——输出尾部：\n${out.slice(-400)}`)
  }
  if (scripts.test) {
    const out = plain(run('test'))
    testCount = Number(/Tests\s+(\d+)\s+passed/.exec(out)?.[1] ?? NaN) || null
    fileCount = Number(/Test Files\s+(\d+)\s+passed/.exec(out)?.[1] ?? NaN) || null
    const vitestPassed = testCount !== null && !/(Tests?\s+\d+\s+failed|✗|FAIL\b)/.test(out)
    if (testCount === null) { // vitest 格式未命中 → unittest 兜底（Python companion：Ran N tests … OK）
      testCount = Number(/Ran\s+(\d+)\s+tests?/.exec(out)?.[1] ?? NaN) || null
    }
    const unittestOk = testCount !== null && /\bOK\b/.test(out) && !/FAILED/.test(out)
    if (!(vitestPassed || unittestOk))
      say(`伴生测试未过或计数不可解析——输出尾部：\n${out.slice(-400)}`)
    else infos.push(`伴生门槛实测：${fileCount !== null ? `${fileCount} 个测试文件 / ` : ''}${testCount} 项测试全绿`)
  }
}
if (testCount !== null) {
  const lastChapter = fileChapters[fileChapters.length - 1]?.file
  const targets = ['README.md', 'docs/index.md', 'docs/about.md', lastChapter && `docs/${lastChapter}`].filter(Boolean)
  for (const t of targets) {
    const p = t.startsWith('docs/') ? join(courseDir, t) : join(courseDir, t)
    if (!existsSync(p)) continue
    const txt = readText(p)
    const claims = []
    for (const m of txt.matchAll(/(\d+)\s*(?:个|项|条)?\s*测试(?!文件)/g)) claims.push({ n: Number(m[1]), kind: '测试数', at: m[0] })
    for (const m of txt.matchAll(/(\d+)\s*(?:项|个|条)\s*用例/g)) claims.push({ n: Number(m[1]), kind: '用例数', at: m[0] })
    for (const m of txt.matchAll(/(\d+)\s+tests?(?!\s*files?)/gi)) claims.push({ n: Number(m[1]), kind: 'tests', at: m[0] })
    for (const c of claims) if (c.n !== testCount)
      say(`${t}: 数字断言「${c.at}」与门槛实测 ${testCount} 不一致（a-share 式终章漂移——以机械输出为准改文）`)
    if (fileCount !== null) for (const m of txt.matchAll(/(\d+)\s*个?\s*测试文件/g))
      if (Number(m[1]) !== fileCount) say(`${t}: 测试文件断言「${m[0]}」与实测 ${fileCount} 不一致`)
  }
}
// 行数断言（±20% 容差，README 的「~N 行」）——只计源码文件：compileall/unittest 先跑会在
// src 下生成 __pycache__/*.pyc，把字节码当源码计数会让「约 N 行」断言可复现地误报。
if (existsSync(join(companionRoot, 'src'))) {
  let srcLines = 0
  const SRC_EXT = /\.(py|ts|tsx|js|mjs|cjs|jsx|go|rs|c|h|cpp|cc|java|rb|sh|sql)$/
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) { if (e.name !== '__pycache__' && e.name !== 'node_modules') walk(p) } else if (SRC_EXT.test(e.name)) srcLines += readText(p).split('\n').length } }
  walk(join(companionRoot, 'src'))
  const readme = join(courseDir, 'README.md')
  if (existsSync(readme)) for (const m of readText(readme).matchAll(/(?:约|~|≈)\s*(\d{3,5})\s*行/g)) {
    const claim = Number(m[1])
    if (Math.abs(srcLines - claim) / claim > 0.2)
      say(`README: 行数断言「${m[0]}」与 companion/src 实测 ${srcLines} 行偏差超 20%——改文或修断言`)
  }
}

// ---- 汇总 ----
const rel = (p) => relative(process.cwd(), p).split(sep).join('/')
console.log(`# final-check: ${rel(courseDir)} (policy=${profile.source_policy ?? 'zero-trace'}, verification=${profile.verification ?? 'code-lab'}${skipGates ? ', gates=skipped' : ''})`)
if (issues.length) { console.log(`\n[阻断 ${issues.length} 项]`); console.log(issues.join('\n')); for (const i of infos) console.log(`info: ${i}`); process.exit(1) }
for (const i of infos) console.log(`info: ${i}`)
console.log('OK')
