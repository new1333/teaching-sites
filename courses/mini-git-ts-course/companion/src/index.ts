// src/index.ts · 暂存区:index v2 的编解码与三态对比
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { hashObject, readObject } from './objects.ts'
import { parseTree, type TreeMode } from './trees.ts'

/** index 条目:index v2 里一条 62 字节定长记录的全部字段,顺序与字节布局一致。 */
export interface IndexEntry {
  ctimeSec: number
  ctimeNsec: number
  mtimeSec: number
  mtimeNsec: number
  dev: number
  ino: number
  mode: number
  uid: number
  gid: number
  size: number
  hash: string
  flags: number
  path: string
}

/** 三态对比里一个文件的身份:模式加内容指纹——两个都相同才算「没变」。 */
export interface FileSig {
  mode: number
  hash: string
}

/** classifyStatus 的产物:四类判定,每类按路径排序。 */
export interface StatusReport {
  staged: { path: string; kind: 'new' | 'modified' | 'deleted' }[]
  unstaged: { path: string; kind: 'modified' | 'deleted' }[]
  untracked: string[]
  unchanged: string[]
}

/** mini-git 认识的 index 模式取值:普通文件、可执行文件、符号链接(子模块 160000 不做)。 */
const INDEX_MODES: readonly number[] = [0o100644, 0o100755, 0o120000]

/** 定长段 62 字节 = 10 个 4 字节 stat 字段 + 20 字节哈希 + 2 字节 flags;名字长度上限 0xFFF。 */
const FIXED_ENTRY_BYTES = 62
const MAX_NAME_BYTES = 0xfff
const HASH_RE = /^[0-9a-f]{40}$/

/** entry 的总长:定长段加名字,垫 1-8 个 NUL 凑成 8 的倍数。 */
function entryBytes(nameLen: number): number {
  return (Math.floor((FIXED_ENTRY_BYTES + nameLen) / 8) + 1) * 8
}

/** 把 .git/index 的字节拆成条目数组;只读条目区,扩展不解析,末尾校验和必验。 */
export function parseIndex(bytes: Buffer): IndexEntry[] {
  if (bytes.length < 32) {
    throw new Error(`index 已损坏:至少 12 字节头加 20 字节校验和,实得 ${bytes.length} 字节`)
  }
  if (bytes.subarray(0, 4).toString('utf8') !== 'DIRC') {
    throw new Error('index 已损坏:开头 4 字节不是魔数 DIRC')
  }
  const version = bytes.readUInt32BE(4)
  if (version !== 2) {
    throw new Error(`index 版本是 ${version},mini-git 只认 v2(v3/v4 的稀疏路径等扩展它不读)`)
  }
  const count = bytes.readUInt32BE(8)
  const entries: IndexEntry[] = []
  let pos = 12
  for (let i = 0; i < count; i++) {
    if (pos + FIXED_ENTRY_BYTES > bytes.length) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的定长段不足 62 字节`)
    }
    const entry: IndexEntry = {
      ctimeSec: bytes.readUInt32BE(pos),
      ctimeNsec: bytes.readUInt32BE(pos + 4),
      mtimeSec: bytes.readUInt32BE(pos + 8),
      mtimeNsec: bytes.readUInt32BE(pos + 12),
      dev: bytes.readUInt32BE(pos + 16),
      ino: bytes.readUInt32BE(pos + 20),
      mode: bytes.readUInt32BE(pos + 24),
      uid: bytes.readUInt32BE(pos + 28),
      gid: bytes.readUInt32BE(pos + 32),
      size: bytes.readUInt32BE(pos + 36),
      hash: bytes.subarray(pos + 40, pos + 60).toString('hex'),
      flags: bytes.readUInt16BE(pos + 60),
      path: '',
    }
    if (!INDEX_MODES.includes(entry.mode)) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的模式 ${entry.mode.toString(8)} 不在 mini-git 认识的取值里`)
    }
    if ((entry.flags & ~MAX_NAME_BYTES) !== 0) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的 flags 高位非零(冲突阶段或 assume-valid),mini-git 不读`)
    }
    const nameLen = entry.flags & MAX_NAME_BYTES
    if (nameLen === 0) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的路径是空的`)
    }
    if (nameLen === MAX_NAME_BYTES) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 用了 0xFFF 超长路径约定,mini-git 不读`)
    }
    if (pos + FIXED_ENTRY_BYTES + nameLen > bytes.length) {
      throw new Error(`index 已损坏:第 ${i + 1} 条 entry 的路径不足 ${nameLen} 字节`)
    }
    entry.path = bytes.subarray(pos + FIXED_ENTRY_BYTES, pos + FIXED_ENTRY_BYTES + nameLen).toString('utf8')
    pos += entryBytes(nameLen)
    entries.push(entry)
  }
  const body = bytes.subarray(0, bytes.length - 20)
  if (!createHash('sha1').update(body).digest().equals(bytes.subarray(bytes.length - 20))) {
    throw new Error('index 已损坏:末尾 20 字节校验和与前文对不上')
  }
  return entries
}

/** 4 字节小工具:大端序写一个无符号数。 */
function u32(value: number): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(value)
  return b
}

/** 把条目数组拼回 index v2 的完整字节(含末尾 20 字节 SHA-1 校验和);条目按路径字节序排。 */
export function writeIndex(entries: readonly IndexEntry[]): Buffer {
  const byPath = (a: IndexEntry, b: IndexEntry) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8'))
  const parts: Buffer[] = [Buffer.from('DIRC', 'utf8'), u32(2), u32(entries.length)]
  for (const e of [...entries].sort(byPath)) {
    if (!HASH_RE.test(e.hash)) {
      throw new Error(`条目 '${e.path}' 的哈希 '${e.hash}' 不是 40 位十六进制`)
    }
    if (!INDEX_MODES.includes(e.mode)) {
      throw new Error(`条目 '${e.path}' 的模式 ${e.mode.toString(8)} 不在 mini-git 认识的取值里`)
    }
    const nameLen = Buffer.byteLength(e.path, 'utf8')
    if (nameLen > MAX_NAME_BYTES) {
      throw new Error(`条目 '${e.path}' 的路径有 ${nameLen} 字节,超过 index v2 名字长度的 4095 上限`)
    }
    const fixed = Buffer.alloc(FIXED_ENTRY_BYTES)
    fixed.writeUInt32BE(e.ctimeSec, 0)
    fixed.writeUInt32BE(e.ctimeNsec, 4)
    fixed.writeUInt32BE(e.mtimeSec, 8)
    fixed.writeUInt32BE(e.mtimeNsec, 12)
    fixed.writeUInt32BE(e.dev, 16)
    fixed.writeUInt32BE(e.ino, 20)
    fixed.writeUInt32BE(e.mode, 24)
    fixed.writeUInt32BE(e.uid, 28)
    fixed.writeUInt32BE(e.gid, 32)
    fixed.writeUInt32BE(e.size, 36)
    Buffer.from(e.hash, 'hex').copy(fixed, 40)
    fixed.writeUInt16BE(nameLen, 60) // flags 就是名字长度:长度先于路径,读时才知道读多长
    const total = entryBytes(nameLen)
    parts.push(fixed, Buffer.from(e.path, 'utf8'), Buffer.alloc(total - FIXED_ENTRY_BYTES - nameLen))
  }
  const body = Buffer.concat(parts)
  return Buffer.concat([body, createHash('sha1').update(body).digest()])
}

/** 读 .git/index;文件不存在(还没 add 过)返回空清单。 */
export function loadIndex(gitDir: string): IndexEntry[] {
  const path = join(gitDir, 'index')
  return existsSync(path) ? parseIndex(readFileSync(path)) : []
}

/** 把清单写回 .git/index。 */
export function saveIndex(gitDir: string, entries: readonly IndexEntry[]): void {
  writeFileSync(join(gitDir, 'index'), writeIndex(entries))
}

/** 毫秒拆成「秒 + 纳秒」两个字段;stat 里的设备号等大于 32 位的值截到低 32 位。 */
function secOf(ms: number): number {
  return Math.floor(ms / 1000)
}
function nsecOf(ms: number): number {
  return Math.round((ms - secOf(ms) * 1000) * 1e6)
}
function low32(v: number | bigint): number {
  return Number(BigInt(v) & 0xffffffffn)
}

/** 用磁盘状态(stat)与已知对象名,造一条 index 条目;flags 记路径字节数。 */
export function makeIndexEntry(path: string, hash: string, st: Stats): IndexEntry {
  const nameLen = Buffer.byteLength(path, 'utf8')
  if (nameLen > MAX_NAME_BYTES) {
    throw new Error(`add:路径 '${path}' 有 ${nameLen} 字节,超过 index v2 名字长度的 4095 上限`)
  }
  return {
    ctimeSec: secOf(st.ctimeMs),
    ctimeNsec: nsecOf(st.ctimeMs),
    mtimeSec: secOf(st.mtimeMs),
    mtimeNsec: nsecOf(st.mtimeMs),
    dev: low32(st.dev),
    ino: low32(st.ino),
    mode: (st.mode & 0o111) !== 0 ? 0o100755 : 0o100644,
    uid: low32(st.uid),
    gid: low32(st.gid),
    size: st.size,
    hash,
    flags: nameLen,
    path,
  }
}

/** 扫工作区(跳过 .git),把每个文件摊平成 路径 → {模式, 内容指纹};只算哈希,不落对象。 */
export function scanWorktree(dir: string): Map<string, FileSig> {
  const out = new Map<string, FileSig>()
  const walk = (abs: string, rel: string) => {
    for (const name of readdirSync(abs)) {
      if (name === '.git') {
        continue // 对象库与清单自己不进快照
      }
      const child = join(abs, name)
      const childRel = rel === '' ? name : `${rel}/${name}`
      const st = statSync(child)
      if (st.isDirectory()) {
        walk(child, childRel)
      } else if (st.isFile()) {
        const mode = (st.mode & 0o111) !== 0 ? 0o100755 : 0o100644
        out.set(childRel, { mode, hash: hashObject('blob', readFileSync(child)) })
      } else {
        throw new Error(`status:'${childRel}' 既不是文件也不是目录,mini-git 处理不了`)
      }
    }
  }
  walk(dir, '')
  return new Map([...out].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
}

/** tree 条目的六位文本模式 → index/工作区通用的 32 位模式。 */
const TREE_MODE_TO_FILE: Record<Exclude<TreeMode, '40000'>, number> = {
  '100644': 0o100644,
  '100755': 0o100755,
  '120000': 0o120000,
}

/** 把一棵 tree 递归摊平成 路径 → {模式, 指纹};status 拿它代表「HEAD 那一刻」。 */
export function flattenTree(gitDir: string, hash: string): Map<string, FileSig> {
  const out = new Map<string, FileSig>()
  const walk = (treeHash: string, prefix: string) => {
    const { type, body } = readObject(gitDir, treeHash)
    if (type !== 'tree') {
      throw new Error(`对象 '${treeHash}' 不是 tree(它是 ${type}),没法摊平成文件清单`)
    }
    for (const e of parseTree(body)) {
      const rel = prefix === '' ? e.name : `${prefix}/${e.name}`
      if (e.mode === '40000') {
        walk(e.hash, rel)
      } else {
        out.set(rel, { mode: TREE_MODE_TO_FILE[e.mode], hash: e.hash })
      }
    }
  }
  walk(hash, '')
  return out
}

/** 三态对比:暂存区、工作区、HEAD 两两比对,每条路径归进四类之一。 */
export function classifyStatus(
  index: ReadonlyMap<string, FileSig>,
  worktree: ReadonlyMap<string, FileSig>,
  head: ReadonlyMap<string, FileSig>,
): StatusReport {
  const staged: StatusReport['staged'] = []
  const unstaged: StatusReport['unstaged'] = []
  const unchanged: string[] = []
  const same = (a: FileSig | undefined, b: FileSig): boolean => a !== undefined && a.hash === b.hash && a.mode === b.mode
  for (const path of new Set([...index.keys(), ...head.keys()])) {
    const i = index.get(path)
    const h = head.get(path)
    if (i === undefined) {
      staged.push({ path, kind: 'deleted' }) // HEAD 有、清单没有:删除已暂存
    } else if (h === undefined) {
      staged.push({ path, kind: 'new' }) // 清单有、HEAD 没有:新文件待提交
    } else if (!same(h, i)) {
      staged.push({ path, kind: 'modified' })
    }
    if (i !== undefined) {
      const w = worktree.get(path)
      if (w === undefined) {
        unstaged.push({ path, kind: 'deleted' })
      } else if (!same(w, i)) {
        unstaged.push({ path, kind: 'modified' })
      }
      if (h !== undefined && same(h, i) && w !== undefined && same(w, i)) {
        unchanged.push(path)
      }
    }
  }
  const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  return {
    staged: staged.sort(byPath),
    unstaged: unstaged.sort(byPath),
    untracked: [...worktree.keys()].filter((p) => !index.has(p)).sort(),
    unchanged: unchanged.sort(),
  }
}
