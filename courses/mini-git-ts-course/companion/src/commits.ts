// src/commits.ts · 提交对象:历史节点的编解码与图遍历
import { readObject, writeObject } from './objects.ts'

/** 作者/提交者身份:提交对象里那行「名字 <邮箱> Unix秒 时区」。 */
export interface CommitIdentity {
  name: string
  email: string
  timestamp: number
  timezone: string
}

/** parseCommit 的产物:提交对象文本里的全部字段。 */
export interface Commit {
  tree: string
  parents: string[]
  author: CommitIdentity
  committer: CommitIdentity
  message: string
}

/** commitTree 的输入:committer 不给就与 author 相同(mini-git 从不分家)。 */
export interface CommitInput {
  tree: string
  parents: string[]
  author: CommitIdentity
  committer?: CommitIdentity
  message: string
}

/** logWalk 的产物:提交对象字段,外加它自己的名字。 */
export interface LogEntry extends Commit {
  hash: string
}

const HASH_RE = /^[0-9a-f]{40}$/

/** 拼一行身份:「author mini-git <mini-git@example.com> 1700000000 +0800」。 */
function identityLine(kind: 'author' | 'committer', who: CommitIdentity): string {
  return `${kind} ${who.name} <${who.email}> ${who.timestamp} ${who.timezone}`
}

/** 把提交字段拼成对象文本:tree/parent/author/committer 头部、一个空行、消息原文。 */
export function encodeCommit(commit: Commit): string {
  const lines = [`tree ${commit.tree}`]
  for (const p of commit.parents) {
    lines.push(`parent ${p}`)
  }
  lines.push(identityLine('author', commit.author), identityLine('committer', commit.committer), '', commit.message)
  return lines.join('\n')
}

/** 解析一行身份;形状不对当场报错。 */
function parseIdentityLine(line: string): CommitIdentity {
  const m = /^(.*) <(.*)> (\d+) ([+-]\d{4})$/.exec(line)
  if (!m) {
    throw new Error(`commit 已损坏:身份行 '${line}' 不是「名字 <邮箱> 时间戳 时区」的形状`)
  }
  return { name: m[1], email: m[2], timestamp: Number(m[3]), timezone: m[4] }
}

/** 把提交对象的文本拆回字段;parent 行按出现顺序进数组。 */
export function parseCommit(body: Buffer): Commit {
  const text = body.toString('utf8')
  const blank = text.indexOf('\n\n')
  if (blank < 0) {
    throw new Error('commit 已损坏:找不到头部与消息之间的空行')
  }
  let tree: string | null = null
  const parents: string[] = []
  let author: CommitIdentity | null = null
  let committer: CommitIdentity | null = null
  for (const line of text.slice(0, blank).split('\n')) {
    if (line.startsWith('tree ')) {
      tree = line.slice(5)
    } else if (line.startsWith('parent ')) {
      parents.push(line.slice(7))
    } else if (line.startsWith('author ')) {
      author = parseIdentityLine(line.slice(7))
    } else if (line.startsWith('committer ')) {
      committer = parseIdentityLine(line.slice(10))
    } else {
      // mini-git 不解析 gpgsig、encoding 等可选头部:遇到就当损坏,差异清单里登记
      throw new Error(`commit 已损坏:头部出现了不认识的行 '${line}'`)
    }
  }
  if (tree === null || !HASH_RE.test(tree)) {
    throw new Error('commit 已损坏:缺少有效的 tree 行')
  }
  for (const p of parents) {
    if (!HASH_RE.test(p)) {
      throw new Error(`commit 已损坏:parent '${p}' 不是 40 位十六进制`)
    }
  }
  if (author === null) {
    throw new Error('commit 已损坏:缺少 author 行')
  }
  if (committer === null) {
    throw new Error('commit 已损坏:缺少 committer 行')
  }
  return { tree, parents, author, committer, message: text.slice(blank + 2) }
}

/** 读一个对象并确认它是 commit,返回拆好的字段。 */
function requireCommit(gitDir: string, hash: string): Commit {
  const { type, body } = readObject(gitDir, hash)
  if (type !== 'commit') {
    throw new Error(`对象 '${hash}' 不是 commit(它是 ${type}),无法当作历史节点遍历`)
  }
  return parseCommit(body)
}

/** 校验 tree 与 parents 都真实存在后,把提交对象写进对象库,返回提交名。 */
export function commitTree(gitDir: string, input: CommitInput): string {
  if (readObject(gitDir, input.tree).type !== 'tree') {
    throw new Error(`commit-tree:对象 '${input.tree}' 不是 tree,没法当作提交的目录快照`)
  }
  for (const p of input.parents) {
    if (readObject(gitDir, p).type !== 'commit') {
      throw new Error(`commit-tree:对象 '${p}' 不是 commit,没法当作父提交`)
    }
  }
  const commit: Commit = { ...input, committer: input.committer ?? input.author }
  return writeObject(gitDir, 'commit', Buffer.from(encodeCommit(commit), 'utf8'))
}

/**
 * 从 head 沿 parent 边收集全部可达提交(每个只收一次),按 committer 时间戳降序排列;
 * 同一时刻按发现先后——父一先于父二。排序是全局的,不看图形状。
 */
export function logWalk(gitDir: string, head: string): LogEntry[] {
  const seen = new Set<string>()
  const found: LogEntry[] = []
  const queue = [head]
  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) {
      continue
    }
    seen.add(hash)
    const commit = requireCommit(gitDir, hash)
    found.push({ ...commit, hash })
    queue.push(...commit.parents)
  }
  return found.sort((a, b) => b.committer.timestamp - a.committer.timestamp) // sort 稳定:同刻保持发现序
}
