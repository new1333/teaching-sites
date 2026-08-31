// src/cli.ts · runCli
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { hashObject, initRepo, readObject, writeObject } from './objects.ts'
import { parseTree, writeTree } from './trees.ts'
import { commitTree, logWalk, type CommitIdentity, type LogEntry } from './commits.ts'

export const HELP = `mini-git —— 一个用来弄懂 git 原理的迷你实现

用法:
  mini-git --help                 打印这份帮助
  mini-git init                   在当前目录建立 .git 仓库骨架
  mini-git hash-object [-w] 文件  算出文件内容的对象名;-w 顺手写入对象库
  mini-git cat-file -p 对象名     把对象内容原文读回;tree 按条目逐行列出
  mini-git cat-file -t 对象名     只看对象的类型
  mini-git write-tree             把当前目录整棵序列化成 tree 对象,输出根哈希
  mini-git commit-tree <tree> [-p <父>]... -m <消息>
                                  把 tree、父提交、作者与消息打包成提交对象;
                                  名字/邮箱/时间用环境变量声明,不偷看机器状态
  mini-git log <起点提交>         从某个提交出发,按时间倒序列出可达的全部提交`

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
    case 'write-tree':
      return cmdWriteTree(cwd, args)
    case 'commit-tree':
      return cmdCommitTree(cwd, args)
    case 'log':
      return cmdLog(cwd, args)
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

function cmdWriteTree(cwd: string, args: string[]): string {
  if (args.length !== 0) {
    throw new Error('用法:mini-git write-tree;不带参数,序列化的是当前目录')
  }
  return writeTree(requireGitDir(cwd), cwd)
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

// 直接用 `tsx src/cli.ts` 运行时才执行;被测试 import 时不执行。
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(runCli(process.argv.slice(2)))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  }
}
