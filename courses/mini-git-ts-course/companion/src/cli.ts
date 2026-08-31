// src/cli.ts · runCli
import { existsSync, readdirSync, readFileSync, rmSync, statSync, type Stats } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hashObject, initRepo, readObject, writeObject } from './objects.ts'
import { checkoutTree, parseTree, writeTree, writeTreeFromIndex } from './trees.ts'
import { commitTree, logWalk, parseCommit, type CommitIdentity, type LogEntry } from './commits.ts'
import {
  classifyStatus,
  flattenTree,
  loadIndex,
  makeIndexEntry,
  saveIndex,
  scanWorktree,
} from './index.ts'
import { attachHead, detachHead, listBranches, readHead, readRef, resolveHead, updateRef } from './refs.ts'
import { diffLines, renderUnified, splitLines } from './diff.ts'
import { isAncestor, mergeBase } from './graph.ts'
import { mergeCommits } from './merge.ts'

/** 40 位十六进制;checkout 用它分辨「给的是提交名还是分支名」。 */
const HASH_RE = /^[0-9a-f]{40}$/

export const HELP = `mini-git —— 一个用来弄懂 git 原理的迷你实现

用法:
  mini-git --help                 打印这份帮助
  mini-git init                   在当前目录建立 .git 仓库骨架
  mini-git hash-object [-w] 文件  算出文件内容的对象名;-w 顺手写入对象库
  mini-git cat-file -p 对象名     把对象内容原文读回;tree 按条目逐行列出
  mini-git cat-file -t 对象名     只看对象的类型
  mini-git add <文件>...          把文件当前内容登记进暂存区清单(.git/index)
  mini-git status                 三态对比:工作区、暂存区、HEAD 两两比较,分四类报告
  mini-git write-tree             把暂存区清单序列化成 tree 对象,输出根哈希;
                                  .git/index 还不存在时,沿用旧口径序列化当前目录
  mini-git commit-tree <tree> [-p <父>]... -m <消息>
                                  把 tree、父提交、作者与消息打包成提交对象;
                                  名字/邮箱/时间用环境变量声明,不偷看机器状态
  mini-git log <起点提交>         从某个提交出发,按时间倒序列出可达的全部提交
  mini-git branch                 列出本地分支,当前分支标 *
  mini-git branch <名字>          在当前提交处建分支——写一个 41 字节的小文件
  mini-git checkout <分支|提交名>  切换分支或检出提交;给 40 位提交名进入 detached HEAD
  mini-git commit -m <消息>       一条龙:暂存区清单 → tree → commit → 推进当前分支引用;
                                  名字/邮箱/时间的口径与 commit-tree 相同
  mini-git diff [--cached]        行级差异;不带开关比「工作区 对 暂存区」,
                                  --cached 比「暂存区 对 HEAD」(HEAD 不存在时全部算新增)
  mini-git merge-base <A> <B>     两笔提交(分支名或 40 位哈希)的最近公共祖先,输出它的哈希
  mini-git merge-base --is-ancestor <A> <B>
                                  换一个问题:A 是 B 的祖先吗?答「是」或「否」
  mini-git merge <分支|提交名>     三方合并:能自动合入就产双父提交,改到同处则把冲突标记写进工作区`

/** 把一组命令行参数变成一段输出;不直接碰终端,方便测试。cwd 注入,默认当前目录。 */
export function runCli(argv: string[], cwd: string = process.cwd()): string {
  const [cmd, ...args] = argv
  if (cmd === undefined || cmd === '--help' || cmd === 'help') {
    return HELP
  }
  switch (cmd) {
    case 'init':
      return `已初始化空 mini-git 仓库:${initRepo(cwd)}`
    case 'hash-object':
      return cmdHashObject(cwd, args)
    case 'cat-file':
      return cmdCatFile(cwd, args)
    case 'add':
      return cmdAdd(cwd, args)
    case 'status':
      return cmdStatus(cwd, args)
    case 'write-tree':
      return cmdWriteTree(cwd, args)
    case 'commit-tree':
      return cmdCommitTree(cwd, args)
    case 'log':
      return cmdLog(cwd, args)
    case 'branch':
      return cmdBranch(cwd, args)
    case 'checkout':
      return cmdCheckout(cwd, args)
    case 'commit':
      return cmdCommit(cwd, args)
    case 'diff':
      return cmdDiff(cwd, args)
    case 'merge-base':
      return cmdMergeBase(cwd, args)
    case 'merge':
      return cmdMerge(cwd, args)
    default:
      return `mini-git: 未知命令 '${cmd}'(收到参数:${args.join(' ')})。运行 mini-git --help 查看可用命令。`
  }
}

/** 当前目录下的 .git 必须已经有对象库,否则提示先 init。 */
function requireGitDir(cwd: string): string {
  const gitDir = join(cwd, '.git')
  if (!existsSync(join(gitDir, 'objects'))) {
    throw new Error(`当前目录不是 mini-git 仓库(在 ${gitDir} 下没找到 objects),先运行 mini-git init`)
  }
  return gitDir
}

function cmdHashObject(cwd: string, args: string[]): string {
  const flags = args.filter((a) => a.startsWith('-'))
  const files = args.filter((a) => !a.startsWith('-'))
  if (files.length !== 1 || flags.some((f) => f !== '-w')) {
    throw new Error("用法:mini-git hash-object [-w] <文件>;目前只支持 -w 这一个开关")
  }
  const write = flags.includes('-w')
  const path = resolve(cwd, files[0])
  let body: Buffer
  try {
    body = readFileSync(path)
  } catch {
    throw new Error(`hash-object: 无法读取文件 '${files[0]}'`)
  }
  if (!write) {
    return hashObject('blob', body)
  }
  return writeObject(requireGitDir(cwd), 'blob', body)
}

function cmdCatFile(cwd: string, args: string[]): string {
  const [mode, hash] = args
  if (args.length !== 2 || (mode !== '-p' && mode !== '-t')) {
    throw new Error('用法:mini-git cat-file <-p | -t> <对象名>;-p 读内容,-t 只看类型')
  }
  const { type, body } = readObject(requireGitDir(cwd), hash)
  if (mode === '-t') {
    return type
  }
  return type === 'tree' ? renderTree(body) : body.toString('utf8')
}

/** 把 tree 按真 git cat-file -p 的口径渲染成一行一条:模式(补足 6 位)、类型、哈希、Tab、名字。 */
function renderTree(body: Buffer): string {
  return parseTree(body)
    .map((e) => {
      const kind = e.mode === '40000' ? 'tree' : 'blob'
      return `${e.mode.padStart(6, '0')} ${kind} ${e.hash}\t${e.name}`
    })
    .join('\n')
}

function cmdAdd(cwd: string, args: string[]): string {
  const usage = '用法:mini-git add <文件>...;只收文件路径,不收开关,也不展开目录'
  if (args.length === 0 || args.some((a) => a.startsWith('-'))) {
    throw new Error(usage)
  }
  const gitDir = requireGitDir(cwd)
  const byPath = new Map(loadIndex(gitDir).map((e) => [e.path, e]))
  for (const arg of args) {
    const abs = resolve(cwd, arg)
    const rel = relative(cwd, abs).split(sep).join('/')
    if (rel.startsWith('..')) {
      throw new Error(`add:'${arg}' 在仓库目录之外,mini-git 暂存不了`)
    }
    if (rel === '.git' || rel.startsWith('.git/')) {
      throw new Error(`add:'${arg}' 在 .git 里面,对象库自己不进快照`)
    }
    let st: Stats
    try {
      st = statSync(abs)
    } catch {
      throw new Error(`add:文件 '${arg}' 不存在或读不了`)
    }
    if (!st.isFile()) {
      throw new Error(`${usage}(目录 '${arg}' 请逐个文件点名)`)
    }
    byPath.set(rel, makeIndexEntry(rel, writeObject(gitDir, 'blob', readFileSync(abs)), st))
  }
  saveIndex(gitDir, [...byPath.values()])
  return `已暂存 ${args.length} 个文件,清单共 ${byPath.size} 条`
}

function cmdStatus(cwd: string, args: string[]): string {
  if (args.length !== 0) {
    throw new Error('用法:mini-git status;不带参数')
  }
  const gitDir = requireGitDir(cwd)
  const index = new Map(loadIndex(gitDir).map((e) => [e.path, { mode: e.mode, hash: e.hash }]))
  const worktree = scanWorktree(cwd)
  const head = new Map<string, { mode: number; hash: string }>()
  const headHash = resolveHead(gitDir)
  if (headHash !== null) {
    const { type, body } = readObject(gitDir, headHash)
    if (type !== 'commit') {
      throw new Error(`HEAD 指向的 '${headHash}' 不是 commit(它是 ${type}),没法当作当前提交`)
    }
    for (const [path, sig] of flattenTree(gitDir, parseCommit(body).tree)) {
      head.set(path, sig)
    }
  }
  return renderStatus(classifyStatus(index, worktree, head))
}

/** status 的三段渲染:段头写明「哪两块在比」,文件行带 新文件/修改/删除 标签。 */
function renderStatus(report: ReturnType<typeof classifyStatus>): string {
  const lines: string[] = []
  const label: Record<string, string> = { new: '新文件', modified: '修改', deleted: '删除' }
  if (report.staged.length > 0) {
    lines.push('已暂存的变更(暂存区 相对 HEAD):')
    lines.push(...report.staged.map((s) => `  ${label[s.kind]}:${s.path}`))
  }
  if (report.unstaged.length > 0) {
    lines.push('未暂存的变更(工作区 相对 暂存区):')
    lines.push(...report.unstaged.map((s) => `  ${label[s.kind]}:${s.path}`))
  }
  if (report.untracked.length > 0) {
    lines.push('未跟踪的文件(不在暂存区):')
    lines.push(...report.untracked.map((p) => `  ${p}`))
  }
  if (lines.length === 0) {
    return `干净:工作区、暂存区与 HEAD 三方一致(${report.unchanged.length} 个文件)`
  }
  if (report.unchanged.length > 0) {
    lines.push(`未变:${report.unchanged.length} 个文件`)
  }
  return lines.join('\n')
}

function cmdWriteTree(cwd: string, args: string[]): string {
  if (args.length !== 0) {
    throw new Error('用法:mini-git write-tree;不带参数')
  }
  const gitDir = requireGitDir(cwd)
  if (!existsSync(join(gitDir, 'index'))) {
    // mini-git 特有口径:index 还没生过(一次 add 都没做)时,沿用第 3 章的整目录扫描;
    // 真 git 此时写的是空树,这条分岔登记在差异附录
    return writeTree(gitDir, cwd)
  }
  return writeTreeFromIndex(gitDir, loadIndex(gitDir))
}

/** 分支名的底线规则:字母数字开头,可用 . _ - 与 / 分层;不收 .. 与 .lock 结尾(参照 git check-ref-format 的底线子集)。 */
function assertBranchName(name: string): void {
  const shape = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(name)
  if (!shape || name.includes('..') || name.endsWith('.lock')) {
    throw new Error(`branch:'${name}' 不是 mini-git 收的分支名(字母数字开头,可用 . _ - 与 / 分层;不收 .. 和 .lock 结尾)`)
  }
}

function cmdBranch(cwd: string, args: string[]): string {
  const gitDir = requireGitDir(cwd)
  if (args.length === 0) {
    const head = readHead(gitDir)
    const lines: string[] = []
    if (head.kind === 'hash') {
      lines.push(`* (HEAD detached at ${head.hash.slice(0, 7)})`)
    }
    for (const b of listBranches(gitDir)) {
      lines.push(head.kind === 'ref' && head.ref === `refs/heads/${b}` ? `* ${b}` : `  ${b}`)
    }
    return lines.join('\n')
  }
  if (args.length === 1) {
    assertBranchName(args[0])
    const ref = `refs/heads/${args[0]}`
    if (readRef(gitDir, ref) !== null) {
      throw new Error(`branch:分支 '${args[0]}' 已存在`)
    }
    const head = resolveHead(gitDir)
    if (head === null) {
      throw new Error(`branch:当前分支还没生过提交,HEAD 指向空处——mini-git 建不了没有起点的分支,先 commit 一笔`)
    }
    updateRef(gitDir, ref, head)
    return `已建分支 '${args[0]}' → ${ref} = ${head}`
  }
  throw new Error('用法:mini-git branch [名字];不带参数列分支,带名字在当前提交处建分支')
}

function cmdCheckout(cwd: string, args: string[]): string {
  const usage = '用法:mini-git checkout <分支名 | 40 位提交名>'
  if (args.length !== 1) {
    throw new Error(`${usage};恰好一个目标`)
  }
  const [target] = args
  const gitDir = requireGitDir(cwd)
  let hash: string
  let branch: string | null = null // null = detached:HEAD 将直接记提交名
  if (HASH_RE.test(target)) {
    const kind = readObject(gitDir, target).type
    if (kind !== 'commit') {
      throw new Error(`checkout:'${target}' 是 ${kind} 不是 commit,检不出工作区`)
    }
    hash = target
  } else {
    branch = target
    const found = readRef(gitDir, `refs/heads/${branch}`)
    if (found === null) {
      const existing = listBranches(gitDir).join('、')
      throw new Error(`checkout:分支 '${branch}' 不存在;现有分支:${existing === '' ? '无' : existing}`)
    }
    hash = found
  }
  const count = restoreWorktree(gitDir, cwd, hash)
  if (branch === null) {
    detachHead(gitDir, hash)
    return `已检出到 ${hash.slice(0, 7)}(detached HEAD:不在任何分支上,新提交只能靠哈希找回)`
  }
  attachHead(gitDir, `refs/heads/${branch}`)
  return `已切换到分支 '${branch}',检出 ${count} 个文件`
}

/**
 * 把工作区与暂存区恢复成某笔提交的样子:删旧清单里的文件、检出 tree、按检出结果重建清单。
 * 从简口径:真 git 会先检查未提交改动、可能拒绝切换;mini-git 无条件覆盖被跟踪的文件,未跟踪的不动。
 */
function restoreWorktree(gitDir: string, workDir: string, commitHash: string): number {
  const { type, body } = readObject(gitDir, commitHash)
  if (type !== 'commit') {
    throw new Error(`checkout:'${commitHash}' 是 ${type} 不是 commit,检不出工作区`)
  }
  return restoreToTree(gitDir, workDir, parseCommit(body).tree)
}

/** restoreWorktree 的主体:给定 tree,删旧清单文件、检出、重建 index——merge 产出树后也走这条路落盘。 */
function restoreToTree(gitDir: string, workDir: string, tree: string): number {
  const dirs = new Set<string>()
  for (const e of loadIndex(gitDir)) {
    rmSync(join(workDir, e.path), { force: true })
    for (let i = e.path.indexOf('/'); i > 0; i = e.path.indexOf('/', i + 1)) {
      dirs.add(e.path.slice(0, i)) // 收集祖先目录,等文件删完再顺手清空壳
    }
  }
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    const abs = join(workDir, d)
    if (existsSync(abs) && readdirSync(abs).length === 0) {
      rmSync(abs, { recursive: true })
    }
  }
  checkoutTree(gitDir, tree, workDir)
  const entries = [...flattenTree(gitDir, tree)].map(([path, sig]) =>
    makeIndexEntry(path, sig.hash, statSync(join(workDir, path))),
  )
  saveIndex(gitDir, entries)
  return entries.length
}

function cmdCommit(cwd: string, args: string[]): string {
  const usage = '用法:mini-git commit -m <消息>;收暂存区清单,生成提交并推进当前分支'
  let message: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '-m') {
      throw new Error(`${usage};不认识参数 '${args[i]}'`)
    }
    const msg = args[++i]
    if (msg === undefined || message !== undefined) {
      throw new Error(`${usage};恰好一个 -m,后面跟消息文本`)
    }
    message = msg
  }
  if (message === undefined) {
    throw new Error(`${usage};-m 不能省`)
  }
  const gitDir = requireGitDir(cwd)
  const tree = writeTreeFromIndex(gitDir, loadIndex(gitDir))
  const parent = resolveHead(gitDir)
  const hash = commitTree(gitDir, {
    tree,
    parents: parent === null ? [] : [parent], // unborn 分支上的第一笔:没有父提交
    author: identityFromEnv(),
    message: message.endsWith('\n') ? message : `${message}\n`,
  })
  const head = readHead(gitDir)
  const firstLine = message.split('\n')[0]
  if (head.kind === 'ref') {
    updateRef(gitDir, head.ref, hash) // 推进当前分支;其他分支的引用文件一个都没碰
    const name = head.ref.startsWith('refs/heads/') ? head.ref.slice('refs/heads/'.length) : head.ref
    return `[${name}${parent === null ? '(根提交)' : ''} ${hash.slice(0, 7)}] ${firstLine}`
  }
  detachHead(gitDir, hash) // detached:HEAD 自己前移,任何分支都不动
  return `[HEAD detached ${hash.slice(0, 7)}] ${firstLine}`
}

/** 身份与环境:mini-git 不偷看任何机器状态,名字/邮箱/时间全部由环境变量声明。 */
function identityFromEnv(): CommitIdentity {
  const stamp = process.env.MINI_GIT_TIMESTAMP
  return {
    name: process.env.MINI_GIT_AUTHOR_NAME ?? 'mini-git',
    email: process.env.MINI_GIT_AUTHOR_EMAIL ?? 'mini-git@example.com',
    timestamp: stamp !== undefined ? Number(stamp) : Math.floor(Date.now() / 1000),
    timezone: process.env.MINI_GIT_TZ ?? '+0800',
  }
}

function cmdCommitTree(cwd: string, args: string[]): string {
  const usage = '用法:mini-git commit-tree <tree> [-p <父提交>]... -m <消息>'
  let tree: string | undefined
  let message: string | undefined
  const parents: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '-p') {
      const parent = args[++i]
      if (parent === undefined) {
        throw new Error(`${usage};-p 后面要跟一个父提交对象名`)
      }
      parents.push(parent)
    } else if (a === '-m') {
      const msg = args[++i]
      if (msg === undefined) {
        throw new Error(`${usage};-m 后面要跟消息文本`)
      }
      message = msg
    } else if (tree === undefined) {
      tree = a
    } else {
      throw new Error(`${usage};只收一个 tree 位置参数`)
    }
  }
  if (tree === undefined || message === undefined) {
    throw new Error(`${usage};tree 与 -m 都不能省`)
  }
  // 真 git 的 -m 会替消息补一个收尾换行,这里对齐;库函数收原文,不做修饰
  const full = message.endsWith('\n') ? message : `${message}\n`
  return commitTree(requireGitDir(cwd), { tree, parents, author: identityFromEnv(), message: full })
}

function cmdLog(cwd: string, args: string[]): string {
  const [head] = args
  if (args.length !== 1) {
    throw new Error('用法:mini-git log <起点提交>;从这一个提交出发往回走')
  }
  return logWalk(requireGitDir(cwd), head).map(renderLogEntry).join('\n\n')
}

/** 一条 log:段落形状对齐真 git;日期列印 Unix 秒与时区原文,不换算本地日历。 */
function renderLogEntry(c: LogEntry): string {
  const body = c.message.endsWith('\n') ? c.message.slice(0, -1) : c.message
  const lines = [
    `commit ${c.hash}`,
    `Author: ${c.author.name} <${c.author.email}>`,
    `Date:   ${c.author.timestamp} ${c.author.timezone}`,
    '',
  ]
  for (const line of body.split('\n')) {
    lines.push(`    ${line}`)
  }
  return lines.join('\n')
}

/**
 * 行级差异:不带开关比「工作区 对 暂存区」,--cached 比「暂存区 对 HEAD」。
 * 口径与真 git 对齐:无参数时只看暂存区里登记过的路径(未跟踪文件不出现);
 * HEAD 不存在(unborn)时 --cached 把旧侧当空,全部显示为新增。
 * 从简:不输出 index 行与 mode 行,@@ 头不带函数名,只比内容不比模式。
 */
function cmdDiff(cwd: string, args: string[]): string {
  const usage = '用法:mini-git diff [--cached];至多一个开关,不收文件参数'
  const flags = args.filter((a) => a.startsWith('-'))
  const rest = args.filter((a) => !a.startsWith('-'))
  if (rest.length !== 0) {
    throw new Error(`${usage};登记在清单里的文件全比,不按路径筛`)
  }
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--cached')) {
    throw new Error(`${usage};mini-git 只认 --cached 这一个开关`)
  }
  const gitDir = requireGitDir(cwd)
  const index = new Map(loadIndex(gitDir).map((e) => [e.path, e.hash]))
  const blobText = (hash: string): string => readObject(gitDir, hash).body.toString('utf8')

  // 两侧的「路径 → 文本」;undefined 表示这一侧没有该文件(新文件 / 被删文件)
  let oldSide: Map<string, string | undefined>
  let newSide: Map<string, string | undefined>
  if (flags[0] === '--cached') {
    const head = resolveHead(gitDir)
    const headFiles =
      head === null
        ? new Map<string, { mode: number; hash: string }>() // unborn:HEAD 这侧是空的
        : flattenTree(gitDir, parseCommit(readObject(gitDir, head).body).tree)
    oldSide = new Map([...headFiles].map(([path, sig]) => [path, blobText(sig.hash)]))
    newSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
  } else {
    oldSide = new Map([...index].map(([path, hash]) => [path, blobText(hash)]))
    newSide = new Map()
    for (const path of index.keys()) {
      const abs = join(cwd, path)
      newSide.set(path, existsSync(abs) ? readFileSync(abs, 'utf8') : undefined) // 文件没了 = 整文件删除
    }
  }

  const sections: string[] = []
  for (const path of [...new Set([...oldSide.keys(), ...newSide.keys()])].sort()) {
    const oldText = oldSide.get(path)
    const newText = newSide.get(path)
    const hunks = renderUnified(diffLines(splitLines(oldText ?? ''), splitLines(newText ?? '')))
    if (hunks === '') {
      continue // 同文本(含两边都没有)不输出
    }
    sections.push(
      [
        `diff --git a/${path} b/${path}`,
        `--- ${oldText === undefined ? '/dev/null' : `a/${path}`}`,
        `+++ ${newText === undefined ? '/dev/null' : `b/${path}`}`,
        hunks,
      ].join('\n'),
    )
  }
  return sections.join('\n')
}

/**
 * 找最近公共祖先,或做祖先判定。参数收分支名或 40 位提交名,与 checkout 同款的双口径。
 * 从简口径:真 git 的 --is-ancestor 用退出码 0/1 回答,mini-git 的命令层只产文本,改答「是/否」;
 * 没有公共祖先时真 git 静默退出 1,mini-git 抛一行可读的错——两条都登记差异附录。
 */
function cmdMergeBase(cwd: string, args: string[]): string {
  const usage = '用法:mini-git merge-base [--is-ancestor] <提交A> <提交B>;参数收分支名或 40 位提交名'
  const flags = args.filter((a) => a.startsWith('-'))
  const rest = args.filter((a) => !a.startsWith('-'))
  if (flags.length > 1 || (flags.length === 1 && flags[0] !== '--is-ancestor') || rest.length !== 2) {
    throw new Error(`${usage};恰好两个提交参数,至多一个 --is-ancestor 开关`)
  }
  const gitDir = requireGitDir(cwd)
  const resolveTarget = (target: string): string => {
    if (HASH_RE.test(target)) {
      return target
    }
    const found = readRef(gitDir, `refs/heads/${target}`)
    if (found === null) {
      throw new Error(`merge-base:'${target}' 既不是 40 位提交名,也不是已存在的分支`)
    }
    return found
  }
  const [a, b] = rest.map(resolveTarget)
  if (flags[0] === '--is-ancestor') {
    return isAncestor(gitDir, a, b) ? '是' : '否'
  }
  const base = mergeBase(gitDir, a, b)
  if (base === null) {
    throw new Error(`merge-base:'${a.slice(0, 7)}' 与 '${b.slice(0, 7)}' 没有公共祖先——两段不相连的历史,给不出 base`)
  }
  return base
}

/**
 * 三方合并:第 8 章判定表的三个格子在此落地。up-to-date 原样照抄 git 的原文;
 * fast-forward 只挪引用不造提交;真合并成功产双父提交并检出结果树;
 * 冲突则把带标记的内容写进工作区与暂存区,分支引用不动。
 * 从简口径(登记差异附录):不写 MERGE_HEAD,冲突后的收尾提交是普通单父提交;
 * index 里只登记带标记内容这一份(真 git 是 1/2/3 三阶段);不检查未提交改动,无条件合并。
 */
function cmdMerge(cwd: string, args: string[]): string {
  const usage = '用法:mini-git merge <分支名 | 40 位提交名>;恰好一个目标,不收开关'
  if (args.length !== 1 || args[0].startsWith('-')) {
    throw new Error(usage)
  }
  const gitDir = requireGitDir(cwd)
  const head = readHead(gitDir)
  if (head.kind !== 'ref' || !head.ref.startsWith('refs/heads/')) {
    throw new Error(`merge:HEAD 不在分支上(detached)——mini-git 只在分支上合并,合并结果要有引用可推进`)
  }
  const branch = head.ref.slice('refs/heads/'.length)
  const ours = resolveHead(gitDir)
  if (ours === null) {
    throw new Error(`merge:当前分支 '${branch}' 还没生过提交,没有可合的底`)
  }
  const [target] = args
  let theirs: string
  if (HASH_RE.test(target)) {
    theirs = target
  } else {
    const found = readRef(gitDir, `refs/heads/${target}`)
    if (found === null) {
      throw new Error(`merge:分支 '${target}' 不存在;现有分支:${listBranches(gitDir).join('、') || '无'}`)
    }
    theirs = found
  }
  const outcome = mergeCommits(gitDir, ours, theirs, {
    labels: { ours: 'HEAD', theirs: target }, // git 的标签口径:ours 恒 HEAD,theirs 写 merge 参数原文
    message: `Merge ${HASH_RE.test(target) ? `commit '${target}'` : `branch '${target}'`}\n`,
    author: identityFromEnv(),
  })
  switch (outcome.kind) {
    case 'up-to-date':
      return 'Already up to date.'
    case 'fast-forward':
      updateRef(gitDir, head.ref, outcome.to)
      restoreWorktree(gitDir, cwd, outcome.to)
      return `Fast-forward:${branch} ${ours.slice(0, 7)}..${outcome.to.slice(0, 7)}(只挪引用,无新提交)`
    case 'merged':
      updateRef(gitDir, head.ref, outcome.commit)
      restoreToTree(gitDir, cwd, outcome.tree)
      return `合并完成:${branch} ${outcome.commit.slice(0, 7)}(双父 ${ours.slice(0, 7)} + ${theirs.slice(0, 7)})`
    case 'conflicted': {
      restoreToTree(gitDir, cwd, outcome.tree)
      const lines = [`自动合并失败:${outcome.conflicts.length} 个文件带着冲突标记写进了工作区与暂存区:`]
      lines.push(...outcome.conflicts.map((p) => `  ${p}`))
      lines.push('手工编辑解决后 mini-git add + mini-git commit 收尾;mini-git 不记 MERGE_HEAD,收尾提交是单父提交(HEAD 未动)')
      return lines.join('\n')
    }
  }
}

// 直接用 `tsx src/cli.ts` 运行时才执行;被测试 import 时不执行。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(runCli(process.argv.slice(2)))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
