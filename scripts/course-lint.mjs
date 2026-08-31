#!/usr/bin/env node
// 课程章 lint —— 仓库级共享脚本（issues/012 改造 D：从 chapter-writing.md 内嵌脚本上移并参数化）。
//
// 用法：
//   node scripts/course-lint.mjs <course_dir> <章md> [术语...] [flags]
//
//   术语（terminology 存在性检查的词条）可直接跟在章文件后，或用 --terms <术语...> 传入；
//   通行做法：bible 术语表全部条目 + 读者模型陌生概念。
//
// flags：
//   --new <术语...>                    本章新教术语（term-intro 首现解释检查只看它们；没有就省略）
//   --pain <词...>                     大纲 hook/pain_point 的现象词（开篇检查以它们为准——检测与 spec 对齐，
//                                      不奖励硬造踩坑故事，issues/010 教训）
//   --lang <zh|en>                     默认 zh。en 时跳过中文专用规则（中英空格/被字句/长句/黑话/翻译腔/
//                                      term-intro 句式信号），跨语言通用规则（出处真实、承诺账、判词密度、
//                                      省略纪律、snippet 存在性、痛点开章、字数参考线）全语言生效
//   --source-policy <zero-trace|guided-walkthrough>
//                                      默认读 <course_dir>/.course/outline.json 的 profile.source_policy，
//                                      缺省 zero-trace。walkthrough 档允许带 owner/repo@sha:path 标注的
//                                      仓库引用块，且必须带标注
//   --verification <code-lab|canvas-app|worksheet|observation|repo-probe|none>
//                                      默认先读本章 verification，再读 outline.profile.verification。
//                                      profile=mixed 时本章必须显式消歧
//   --min-chars <N>                    teaching 章正文参考线（中文字符，不含代码），默认 1200；低于只出
//                                      info 提示、不阻断——讲透即收；--min-chars 0 关闭（review/总览章在
//                                      outline 声明 length_exempt，本脚本读到 spec 会自动豁免，无需手动传）
//
// outline.json 存在时自动读取本章 spec（按文件名 NN-slug 匹配）：hook.phenomena / pain_point 现象词
// 兜底、type=review 或 length_exempt 自动豁免字数、source_policy / verification 兜底。CLI 显式参数优先。
//
// 退出码：有阻断问题 1，干净 0；「info:」前缀的行不阻断。

import { readFileSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const argv = process.argv.slice(2)
if (argv.length < 2) {
  console.error('用法: node scripts/course-lint.mjs <course_dir> <章md> [术语...] [--new t...] [--pain w...] [--lang zh|en] [--source-policy p] [--verification v] [--min-chars N]')
  process.exit(2)
}

// ---- 参数解析：flag 值为一组词，直到下一个 --flag 或结尾 ----
function takeGroup(args, idx) {
  const out = []
  for (let i = idx + 1; i < args.length; i++) {
    if (args[i].startsWith('--')) break
    out.push(args[i])
  }
  return out
}
function takeOne(args, idx) {
  const v = args[idx + 1]
  return v && !v.startsWith('--') ? v : undefined
}

const courseDir = argv[0]
const mdPath = argv[1]
const flags = {}
const termsFromCli = []
for (let i = 2; i < argv.length; i++) {
  const a = argv[i]
  if (!a.startsWith('--')) { termsFromCli.push(a); continue }
  switch (a) {
    case '--new': flags.new = takeGroup(argv, i); break
    case '--pain': flags.pain = takeGroup(argv, i); break
    case '--terms': termsFromCli.push(...takeGroup(argv, i)); break
    case '--lang': flags.lang = takeOne(argv, i); break
    case '--source-policy': flags.sourcePolicy = takeOne(argv, i); break
    case '--verification': flags.verification = takeOne(argv, i); break
    case '--min-chars': flags.minChars = Number(takeOne(argv, i)); break
    default: console.error(`未知参数 ${a}`); process.exit(2)
  }
}

// 章文件路径：按原样或相对 course_dir 解析（<course_dir> <章md> 两种传法都接受）
const mdResolved = existsSync(mdPath) ? mdPath : existsSync(join(courseDir, mdPath)) ? join(courseDir, mdPath) : null
if (!mdResolved) { console.error(`章文件不存在: ${mdPath}`); process.exit(2) }
const md = readFileSync(mdResolved, 'utf8')

// ---- outline spec 自动读取（缺省修润：没有 outline 就按默认规则跑）----
const outlinePath = join(courseDir, '.course', 'outline.json')
let chapterSpec = null
let profile = {}
let outlineVersion = 1
if (existsSync(outlinePath)) {
  try {
    const outline = JSON.parse(readFileSync(outlinePath, 'utf8'))
    outlineVersion = outline.schema_version ?? 1
    profile = outline.profile ?? {}
    const slugFromName = (mdPath.split(/[\\/]/).pop() ?? '').match(/^\d+-(.+)\.md$/)?.[1]
    chapterSpec = outline.parts?.flatMap((p) => p.chapters ?? []).find((c) => c.slug === slugFromName) ?? null
  } catch { /* outline 损坏不阻断 lint，按 CLI 参数与默认值跑 */ }
}
let runLanguage
const runPath = join(courseDir, '.course', 'run.json')
if (existsSync(runPath)) {
  try { runLanguage = JSON.parse(readFileSync(runPath, 'utf8')).language } catch { /* final-check owns state validation */ }
}
const lang = flags.lang ?? runLanguage ?? 'zh'
const zh = lang === 'zh'
const sourcePolicy = flags.sourcePolicy ?? profile.source_policy ?? 'zero-trace'
const verification = flags.verification ?? chapterSpec?.verification ?? profile.verification ?? 'code-lab'
const minChars = flags.minChars !== undefined ? flags.minChars
  : (chapterSpec && (chapterSpec.type === 'review' || chapterSpec.length_exempt)) ? 0 : 1200

const newTerms = flags.new ?? []
// --pain 优先；其次本章 spec 的 hook.phenomena；再次 pain_point 里的成段关键词（≥4 字的中文片段）
let painWords = flags.pain ?? []
if (!painWords.length && chapterSpec) {
  if (Array.isArray(chapterSpec.hook?.phenomena) && chapterSpec.hook.phenomena.length) painWords = chapterSpec.hook.phenomena
  else if (typeof chapterSpec.pain_point === 'string')
    painWords = chapterSpec.pain_point.split(/[，。；、,;:：/（）()\s]+/).filter((s) => s.length >= 4).slice(0, 6)
}
const terms = termsFromCli

const mdRel = relative(process.cwd(), mdResolved).split(sep).join('/')
const issues = []
const infos = []
if (outlineVersion >= 2 && verification === 'mixed')
  issues.push('verification: profile=mixed 时本章必须声明具体 verification；mixed 不是可执行模式')

const text = md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '') // 剥代码
const blocks = md.match(/```\w*\n[\s\S]*?```/g) ?? []
const companionRoot = join(courseDir, 'companion')
const repoRoot = join(courseDir, '.course', 'repo')
const REPO_REF = /([\w.-]+\/[\w.-]+)@([0-9a-f]{7,40}|[\w./-]+):([\w./-]+)/ // owner/repo@sha:path

// ---- 中文专用规则（--lang en 跳过）----
if (zh) {
  const spacing = (text.match(/[\u4e00-\u9fff](?=[A-Za-z0-9])|[A-Za-z0-9](?=[\u4e00-\u9fff])/g) ?? []).length
  if (spacing > 15) issues.push(`spacing: 中西文缺空格 ${spacing} 处`)
  const passive = (text.match(/[\u4e00-\u9fff]*被[\u4e00-\u9fff]+/g) ?? []).length
  if (passive > 12) issues.push(`passive: 被字句 ${passive} 处`)
  for (const p of ['值得注意的?是', '我们?可以看到', '正如你(所)?看到(的)?', '需要指出的是']) {
    const n = (text.match(new RegExp(p, 'g')) ?? []).length
    if (n >= 3) issues.push(`translation-tone: 「${p}」出现 ${n} 次`)
  }
  const prose = text.replace(/^---[\s\S]*?---/, '').replace(/^#{1,6}[^\n]*$/gm, '').replace(/^\|.*$/gm, '')
  const long = prose.split(/[。！？；]/).filter((s) => s.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '').length > 80)
  if (long.length > 1) issues.push(`long-sentence: 超 80 字长句 ${long.length} 处——拆短，一句只装一件事`)
  for (const w of ['赋能', '抓手', '组合拳', '打法', '底层逻辑', '心智模型', '护城河'])
    if (text.includes(w)) issues.push(`jargon: 黑话「${w}」——说人话`)
  for (const t of newTerms) {
    const i = text.indexOf(t)
    if (i < 0) continue // 存在性由 terminology 检查负责
    const para = text.slice(Math.max(0, i - 120), i + 400)
    if (!/(（|\()[^）)]{3,}(）|\))|——|也就(?:是|说)|指的是|意思是|是一种|是一个|：[^。：]{8,}/.test(para))
      issues.push(`term-intro: 「${t}」首现段落内无解释信号（括号注释 / 破折号 /「也就是」「指的是」…）`)
  }
}

// ---- 跨语言通用规则 ----
const missing = terms.filter((t) => !text.includes(t))
if (missing.length > 3) issues.push(`terminology: ${missing.length} 条术语未出现：${missing.join('、')}`)

// 源码引用政策：zero-trace 禁外部源码引用；guided-walkthrough 允许但必须带 owner/repo@sha:path 标注
for (const b of blocks) {
  const header = b.slice(3, 300)
  const sourceish = /^(\/\/|\/\*|#)\s*(源码|source|from)/im.test(header)
  const repoAnno = REPO_REF.exec(header)
  if (sourcePolicy === 'zero-trace') {
    if (sourceish) issues.push('source-quote: 外部源码引用已禁用（source_policy: zero-trace——repo 只是作者侧备课资料）')
  } else {
    if (sourceish && !repoAnno)
      issues.push('source-quote: walkthrough 档引用仓库代码必须标注 owner/repo@sha:path（如 // vuejs/pinia@abc1234:src/store.ts）')
    if (repoAnno && existsSync(repoRoot) && !existsSync(join(repoRoot, repoAnno[3])))
      issues.push(`snippet-missing: 仓库引用 ${repoAnno[3]} 在 .course/repo/ 锁定 ref 中不存在——引用必须与锁定 ref 逐字一致`)
  }
}

const bolds = (text.match(/\*\*[^*\n]+\*\*/g) ?? []).length
if (bolds > 8) issues.push(`bold-density: 加粗判断 ${bolds} 处（上限 8，含列表标签）`)

const cur = Number((mdPath.match(/[\\/](\d+)-/) ?? [])[1] ?? 0)
const fwdMatches = [...text.matchAll(/第\s*(\d+)\s*章/g)].filter((m) => Number(m[1]) > cur)
if (fwdMatches.length > 3) issues.push(`forward-ref: 闪前「第 N 章」${fwdMatches.length} 处（上限 3，去向收在章末地图）`)
if (fwdMatches.length) {
  const targets = [...new Set(fwdMatches.map((m) => m[1]))].sort((a, b) => a - b)
  const promisesPath = join(courseDir, '.course', 'promises.json')
  const known = existsSync(promisesPath) ? readFileSync(promisesPath, 'utf8') : ''
  const unregistered = fwdMatches.filter((m) => !known.includes(`第 ${m[1]} 章`) && !known.includes(`"${m[1]}"`)).length
  infos.push(`promise-info: 本章闪前指向第 ${targets.join('、')} 章${existsSync(promisesPath) ? `（${unregistered} 处未在 .course/promises.json 登记——目标章生成时清账）` : '（登记进 .course/promises.json，目标章生成时清账）'}`)
}

for (const w of ['集中营']) if (text.includes(w)) issues.push(`metaphor: 禁用比喻词「${w}」`)

for (const b of blocks) {
  const header = b.slice(3, 300)
  const lines = b.split('\n').length - 2
  const isRepoQuote = REPO_REF.test(header)
  if (lines > 12 && !isRepoQuote && !/(?:\/\/|#)\s*(src\/|tests\/|用法示例|companion|拼版)/.test(header))
    issues.push(`snippet-source: ${lines} 行代码块未标注出处（首行注释 src/… 或 用法示例；Python 等语言用 # 注释同样可标注）`)
}
for (const b of blocks) {
  const header = b.slice(0, 300)
  const isCompanion = /(?:\/\/|#)\s*((?:src|tests)\/[\w./-]+)/.exec(header)
  if (!isCompanion) continue
  const rel = isCompanion[1]
  if (!existsSync(join(companionRoot, rel)) && !existsSync(rel)) {
    issues.push(`snippet-missing: 出处 ${rel} 在伴生仓中不存在——标注必须真实`)
    continue
  }
  if (b.includes('拼版')) continue
  const bodyLines = b.split('\n').slice(1, -1)
  const elided = bodyLines.filter((l) => /^\s*(\.\.\.|…|\/\/\s*(…|\.\.\.|其余|省略|同上))/.test(l)).length
  if (elided) issues.push(`elision: 实验场代码块有 ${elided} 行省略——承重逻辑禁用 … 开天窗，拼版视图须标注「拼版」`)
  const placeholder = bodyLines.filter((l) => /^\s*(\/\*|\{\/\*).*(占位|省略|此处|骨架|展开|实现略|\.\.\.)/.test(l)).length
  if (placeholder) issues.push(`placeholder: 实验场代码块内有 ${placeholder} 行注释占位——承重分支禁空壳`)
}

// ---- 开章钩子（检测意图，别催生模板：与大纲 spec 对齐）----
const head = text.slice(0, 1500)
if (painWords.length) {
  if (!painWords.some((w) => head.includes(w)))
    issues.push(`pain-point: 开篇 1500 字内未出现大纲 hook/pain_point 的现象词（应含：${painWords.join('、')}）`)
} else if (zh) {
  if (!['没有', '踩', '坑', 'bug', '报错', '崩溃', '泄漏', '失败', '丢失', '出错', '涨', '跌', '算错', '看不懂'].some((m) => head.toLowerCase().includes(m)))
    issues.push('pain-point: 开篇 1500 字内无钩子现象词（建议改用 --pain 传大纲现象词，或在大纲 hook.phenomena 声明）')
}

// ---- 字数参考线（teaching 章；review/length_exempt 免提示；只提示不阻断——讲透即收，单薄先补教学再补字数）----
if (minChars > 0) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length
  const words = zh ? cjk : (text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length
  const need = zh ? minChars : Math.round(minChars / 1.6)
  if (words < need) infos.push(`length: 正文 ${words} ${zh ? '字' : '词'}，低于参考线 ${need}——若已讲透可忽略；若单薄，先补概念教学（review/总览章在 outline 声明 length_exempt 免提示）`)
}

// ---- 任务清单可判定性（observation 形态；任何课的勾选任务单同规）----
const checklist = md.match(/^\s*- \[[ x]\].+$/gm) ?? []
const vague = checklist.filter((l) => /感受一下|体验一下|自行体会|注意观察/.test(l) || !/看到|显示|输出|返回|出现|报错|等于|应为|值为|包含|高亮|标出|结果是|得到/.test(l))
if (vague.length) issues.push(`observation: ${vague.length} 条任务缺少可判定现象（应写明「看到/输出/返回什么」，不写「感受一下」）`)
if (verification === 'observation' && !checklist.length)
  issues.push('observation: 本章无勾选式任务清单（- [ ] 每条 = 读者操作 + 应看到的具体现象）')

if (issues.length) {
  console.log(`[${mdRel}]`)
  console.log(issues.join('\n'))
  for (const i of infos) console.log(`info: ${i}`)
  process.exit(1)
}
for (const i of infos) console.log(`info: ${i}`)
console.log(`OK (${mdRel}, lang=${lang}, policy=${sourcePolicy}, verification=${verification})`)
