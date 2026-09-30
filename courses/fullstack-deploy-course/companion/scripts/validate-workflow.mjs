// companion/scripts/validate-workflow.mjs · pnpm validate:ci：CI 工作流的结构断言（本地能证明的部分）
//
// 现实约束：GitHub Actions 只在 GitHub 的 runner 上真实运行，本地无法触发——
// 所以本脚本的职责是「本地能证明的那一半」：工作流文件的结构、它与 package.json
// scripts 的对应关系、服务容器参数与测试环境变量的一致性。真实运行发生在
// push 之后（见第 8 章的诚实边界声明）。
//
// 断言清单（编号与正文一一对应）：
//   01 工作流文件存在且解析成功          07 setup-node 缓存（pnpm + pnpm-lock.yaml）
//   02 触发器含 push 与 pull_request     08 步骤顺序（checkout→pnpm→setup-node→install）
//   03 运行器为 ubuntu-latest            09 run 步骤与 scripts 对账（lint/typecheck/test/build）
//   04 job 设有超时上限                  10 服务容器（postgres:16-alpine + 引导三变量 + 端口）
//   05 concurrency 按分支分组            11 服务容器健康参数齐全
//   06 pnpm 版本 = packageManager        12 NUXT_DB_URL 与服务容器参数一致
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const ROOT = join(import.meta.dirname, '..')
const WORKFLOW = join(ROOT, '.github', 'workflows', 'ci.yml')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

// 本章的步骤契约：CI 里的检查命令必须与本地同源（package.json scripts），
// 唯一允许的内联命令是带锁定标志的依赖安装
const EXPECTED_SCRIPTS = ['lint', 'typecheck', 'test', 'build']
const INLINE_ALLOWED = ['pnpm install --frozen-lockfile']

const results = []
function assert(num, label, fn) {
  try {
    const note = fn()
    results.push({ num, label, ok: true, note: note || '' })
  } catch (err) {
    results.push({ num, label, ok: false, note: err.message })
  }
}
function fail(msg) {
  throw new Error(msg)
}

// —— 解析（01 的范围）——
let doc
let steps = []
let svc = null

assert('01', '工作流文件存在且解析成功', () => {
  if (!existsSync(WORKFLOW)) fail(`未找到 ${WORKFLOW}——CI 工作流还没建立`)
  try {
    doc = parse(readFileSync(WORKFLOW, 'utf8'))
  } catch (err) {
    fail(`YAML 解析失败：${err.message}`)
  }
  if (!doc || typeof doc !== 'object' || !doc.jobs) fail('解析结果里没有 jobs')
  const jobKeys = Object.keys(doc.jobs)
  if (jobKeys.length !== 1) fail(`期望恰好 1 个 job，实际 ${jobKeys.length} 个（${jobKeys.join(', ')}）`)
  steps = doc.jobs[jobKeys[0]].steps ?? []
})

const job = doc?.jobs ? doc.jobs[Object.keys(doc.jobs)[0]] : null
if (job?.services?.postgres) svc = job.services.postgres

const usesStep = (prefix) => steps.filter((s) => typeof s.uses === 'string' && s.uses.startsWith(prefix))
const stepIndex = (prefix) => steps.findIndex((s) => typeof s.uses === 'string' && s.uses.startsWith(prefix))

assert('02', '触发器同时含 push 与 pull_request', () => {
  // YAML 1.2 核心 schema 下 on 是字符串键；个别解析器会把它读成布尔 true，两者都认
  const on = doc?.['on'] ?? doc?.true
  if (!on || typeof on !== 'object') fail('缺少 on 触发器声明')
  for (const ev of ['push', 'pull_request']) {
    if (!(ev in on)) fail(`on 里缺 ${ev} 触发器`)
  }
})

assert('03', '运行器为 ubuntu-latest', () => {
  if (job?.['runs-on'] !== 'ubuntu-latest') fail(`runs-on 应为 ubuntu-latest，实际 ${JSON.stringify(job?.['runs-on'])}`)
})

assert('04', 'job 设有超时上限（timeout-minutes）', () => {
  const t = job?.['timeout-minutes']
  if (typeof t !== 'number' || t <= 0) fail('job 未设置正数 timeout-minutes——挂死的流水线会烧完整个默认时限')
})

assert('05', 'concurrency 按分支分组且新提交取消旧运行', () => {
  const c = doc?.concurrency
  if (!c || typeof c !== 'object') fail('缺少 concurrency 声明')
  if (!String(c.group ?? '').includes('github.ref')) fail('concurrency.group 应包含 github.ref（按分支分组）')
  if (c['cancel-in-progress'] !== true) fail('cancel-in-progress 应为 true（同分支新提交取消旧运行）')
})

assert('06', 'pnpm/action-setup 版本与 packageManager 一致', () => {
  const pm = PKG.packageManager ?? ''
  const m = pm.match(/^pnpm@(\S+)$/)
  if (!m) fail(`package.json 缺少 packageManager 字段（实际：${pm || '无'}）`)
  const step = usesStep('pnpm/action-setup')[0]
  if (!step) fail('未找到 pnpm/action-setup 步骤')
  if (step.with?.version !== m[1]) {
    fail(`版本漂移：工作流写 ${JSON.stringify(step.with?.version)}，packageManager 是 ${m[1]}——CI 与本地会用不同版本的 pnpm`)
  }
})

assert('07', '依赖缓存存在：cache=pnpm 且指向 pnpm-lock.yaml', () => {
  const step = usesStep('actions/setup-node')[0]
  if (!step) fail('未找到 actions/setup-node 步骤')
  if (step.with?.cache !== 'pnpm') fail('setup-node 未配置 cache: pnpm——依赖每次从零下载')
  if (step.with?.['cache-dependency-path'] !== 'pnpm-lock.yaml') {
    fail(`cache-dependency-path 应为 pnpm-lock.yaml，实际 ${JSON.stringify(step.with?.['cache-dependency-path'])}——缓存键不会随锁文件变化`)
  }
})

assert('08', '步骤顺序：checkout → pnpm → setup-node（缓存）→ 安装', () => {
  if (stepIndex('actions/checkout') !== 0) fail('第一步应是 actions/checkout')
  const iPnpm = stepIndex('pnpm/action-setup')
  const iNode = stepIndex('actions/setup-node')
  if (iPnpm < 0 || iNode < 0) fail('缺少 pnpm/action-setup 或 actions/setup-node')
  if (iPnpm > iNode) fail('pnpm/action-setup 应在 actions/setup-node 之前——cache: pnpm 需要 pnpm 先就位才能查存储路径')
  const iInstall = steps.findIndex((s) => typeof s.run === 'string' && s.run.trim().startsWith('pnpm install'))
  if (iInstall < 0 || iInstall < iNode) fail('依赖安装应出现在 setup-node 之后')
})

assert('09', 'run 步骤与 package.json scripts 对账', () => {
  const problems = []
  const invoked = []
  let installs = 0
  for (const s of steps) {
    if (typeof s.run !== 'string') continue
    const tokens = s.run.trim().split(/\s+/)
    if (tokens[0] !== 'pnpm') problems.push(`非 pnpm 命令未被允许：${s.run.trim()}`)
    else if (tokens[1] === 'install') {
      installs += 1
      if (!INLINE_ALLOWED.includes(s.run.trim())) problems.push(`安装命令应为 ${INLINE_ALLOWED[0]}，实际 ${s.run.trim()}`)
    } else {
      const name = tokens[1]
      if (!(name in PKG.scripts)) problems.push(`pnpm ${name} 不在 package.json scripts 里——CI 引用了本地不存在的命令`)
      if (tokens.length > 2) problems.push(`pnpm ${name} 带了额外参数（${tokens.slice(2).join(' ')}）——参数应登记进 script 本身`)
      invoked.push(name)
    }
  }
  if (installs !== 1) problems.push(`期望恰好 1 条 pnpm install，实际 ${installs}`)
  if (JSON.stringify(invoked) !== JSON.stringify(EXPECTED_SCRIPTS)) {
    problems.push(`脚本调用序列应为 [${EXPECTED_SCRIPTS.join(', ')}]，实际 [${invoked.join(', ')}]`)
  }
  if (problems.length > 0) fail(problems.join('；'))
})

assert('10', '服务容器：postgres:16-alpine + 引导三变量 + 端口映射', () => {
  if (!svc) fail('job.services 里没有 postgres')
  if (svc.image !== 'postgres:16-alpine') fail(`镜像应为 postgres:16-alpine（与本地 compose.db.yaml 同款），实际 ${svc.image}`)
  for (const k of ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB']) {
    if (!svc.env?.[k]) fail(`服务容器缺 ${k}`)
  }
  const ports = svc.ports ?? []
  if (!ports.includes('5432:5432')) fail(`端口映射应含 5432:5432（宿主:容器），实际 ${JSON.stringify(ports)}`)
})

assert('11', '服务容器健康参数齐全', () => {
  const opts = String(svc?.options ?? '')
  const missing = ['--health-cmd', '--health-interval', '--health-timeout', '--health-retries']
    .filter((f) => !opts.includes(f))
  if (missing.length > 0) fail(`options 缺健康参数：${missing.join(' ')}——job 不会等数据库转绿就开始跑步骤`)
})

assert('12', 'test 步骤的 NUXT_DB_URL 与服务容器参数一致', () => {
  const testStep = steps.find((s) => s.run?.trim() === 'pnpm test')
  if (!testStep) fail('未找到 pnpm test 步骤')
  const raw = testStep.env?.NUXT_DB_URL
  if (!raw) fail('pnpm test 步骤未注入 NUXT_DB_URL——global-setup 找不到数据库实例')
  const u = new URL(raw)
  const [hostPort, containerPort] = String(svc.ports[0] ?? '').split(':')
  if (u.hostname !== 'localhost') fail(`连接主机应为 localhost（runner 约定），实际 ${u.hostname}`)
  if (u.port !== hostPort) fail(`连接端口 ${u.port} 与映射宿主侧 ${hostPort} 不一致`)
  if (containerPort !== '5432') fail(`映射容器侧应为 5432（postgres 监听口），实际 ${containerPort}`)
  if (u.username !== svc.env.POSTGRES_USER) fail(`用户名 ${u.username} ≠ POSTGRES_USER ${svc.env.POSTGRES_USER}`)
  if (u.password !== svc.env.POSTGRES_PASSWORD) fail(`密码与 POSTGRES_PASSWORD 不一致——跑测试时会得到 authentication failed`)
  if (u.pathname.slice(1) !== svc.env.POSTGRES_DB) fail(`库名 ${u.pathname.slice(1)} ≠ POSTGRES_DB ${svc.env.POSTGRES_DB}`)
})

// —— 汇报（全部断言跑完再给结论：红几条、红在哪，一眼可见）——
console.log('[validate] CI 工作流结构断言：.github/workflows/ci.yml × package.json')
for (const r of results) {
  const tail = r.ok ? (r.note ? `（${r.note}）` : '') : ` —— ${r.note}`
  console.log(`[validate] ${r.num} ${r.label} …… ${r.ok ? '通过' : '红'}${tail}`)
}
const failed = results.filter((r) => !r.ok)
if (failed.length > 0) {
  console.log(`[validate] ${failed.length} 项断言未通过（退出码 1）——修的是结构，证明的是「工作流与本地命令链同源」`)
  process.exit(1)
}
console.log(`[validate] ${results.length} 项断言全部通过（本地能证明的一半；真实运行在 push 之后发生）`)
