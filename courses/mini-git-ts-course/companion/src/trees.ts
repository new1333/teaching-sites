// src/trees.ts · 目录的序列化与检出:tree 对象的编解码
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readObject, writeObject } from './objects.ts'

/** tree 条目的模式取值:普通文件、可执行文件、符号链接、目录(存储时目录是五位的 40000)。 */
export type TreeMode = '100644' | '100755' | '120000' | '40000'

export interface TreeEntry {
  mode: TreeMode
  name: string
  hash: string
}

const TREE_MODES: readonly TreeMode[] = ['100644', '100755', '120000', '40000']

/** 名字与哈希都定长不了,但哈希固定 20 字节:它是每条 entry 的「字节数锚」。 */
const HASH_BYTES = 20

/** 把 tree 对象的字节内容拆成条目数组;顺序与字节中的顺序一致。 */
export function parseTree(body: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = []
  let pos = 0
  while (pos < body.length) {
    const nul = body.indexOf(0, pos)
    if (nul < 0) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 找不到名字结尾的 0 字节`)
    }
    const head = body.subarray(pos, nul).toString('utf8')
    const space = head.indexOf(' ')
    if (space < 0) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 缺少模式与名字之间的空格`)
    }
    const mode = head.slice(0, space)
    if (!TREE_MODES.includes(mode as TreeMode)) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 的模式 '${mode}' 不在取值范围内`)
    }
    if (nul + 1 + HASH_BYTES > body.length) {
      throw new Error(`tree 已损坏:第 ${entries.length + 1} 条 entry 的哈希不足 ${HASH_BYTES} 字节`)
    }
    entries.push({
      mode: mode as TreeMode,
      name: head.slice(space + 1),
      hash: body.subarray(nul + 1, nul + 1 + HASH_BYTES).toString('hex'),
    })
    pos = nul + 1 + HASH_BYTES
  }
  return entries
}

/** 把条目数组拼回 tree 对象的字节内容;不排序,按给定顺序拼。 */
export function encodeTree(entries: readonly TreeEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const e of entries) {
    if (!/^[0-9a-f]{40}$/.test(e.hash)) {
      throw new Error(`条目 '${e.name}' 的哈希 '${e.hash}' 不是 40 位十六进制`)
    }
    parts.push(Buffer.from(`${e.mode} ${e.name}\0`, 'utf8'), Buffer.from(e.hash, 'hex'))
  }
  return Buffer.concat(parts)
}

/** git 的排序键:目录名当作多一个尾斜杠再比(lib/ 排在 lib.txt 之后);比较按 utf8 字节。 */
function sortKey(entry: TreeEntry): Buffer {
  return Buffer.from(entry.mode === '40000' ? `${entry.name}/` : entry.name, 'utf8')
}

function compareEntries(a: TreeEntry, b: TreeEntry): number {
  return Buffer.compare(sortKey(a), sortKey(b))
}

/** 递归序列化 dir 下的全部文件与子目录(跳过 .git),blobs 与 trees 全部落库,返回根 tree 哈希。 */
export function writeTree(gitDir: string, dir: string): string {
  const entries: TreeEntry[] = []
  for (const name of readdirSync(dir)) {
    if (name === '.git') {
      continue // 对象库自己不能进快照;嵌套仓库(子模块)超出 mini-git 范围
    }
    const path = join(dir, name)
    const st = statSync(path)
    if (st.isDirectory()) {
      entries.push({ mode: '40000', name, hash: writeTree(gitDir, path) })
    } else if (st.isFile()) {
      // Windows 文件系统没有可执行位,这里恒为 100644;POSIX 上有执行位的文件会得到 100755
      const mode: TreeMode = (st.mode & 0o111) !== 0 ? '100755' : '100644'
      entries.push({ mode, name, hash: writeObject(gitDir, 'blob', readFileSync(path)) })
    } else {
      throw new Error(`write-tree: '${path}' 既不是文件也不是目录,mini-git 处理不了`)
    }
  }
  entries.sort(compareEntries)
  return writeObject(gitDir, 'tree', encodeTree(entries))
}

/** 读一个对象并确认它是 tree,返回其字节内容。 */
function requireTree(gitDir: string, hash: string): Buffer {
  const { type, body } = readObject(gitDir, hash)
  if (type !== 'tree') {
    throw new Error(`对象 '${hash}' 不是 tree(它是 ${type}),无法当作目录检出`)
  }
  return body
}

/** 把 hash 指向的 tree 连同全部子对象还原成 destDir 下的目录与文件。 */
export function checkoutTree(gitDir: string, hash: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true })
  for (const e of parseTree(requireTree(gitDir, hash))) {
    const target = join(destDir, e.name)
    if (e.mode === '40000') {
      checkoutTree(gitDir, e.hash, target)
    } else {
      const { type, body } = readObject(gitDir, e.hash)
      if (type !== 'blob') {
        throw new Error(`tree 条目 '${e.name}' 指向的 '${e.hash}' 不是 blob,无法还原成文件`)
      }
      writeFileSync(target, body)
    }
  }
}
