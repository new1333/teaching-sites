// src/refs.ts · 引用:分支的实体与 HEAD 的解析
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 40 位十六进制对象名的形状;引用文件里写的、resolveHead 要跟到的,都是它。 */
const HASH_RE = /^[0-9a-f]{40}$/

/** 符号引用内容的前缀;git-symbolic-ref 的定义:内容以 `ref: refs/` 开头。 */
const SYMREF_PREFIX = 'ref: '

/** 符号引用链最多跟 5 跳;再多几乎必是环,报错好过死循环。 */
const MAX_SYMREF_HOPS = 5

/** HEAD 的第一跳:文本里写的目标——指向另一个引用(符号引用),或直接是一个提交名(detached)。 */
export type HeadTarget = { kind: 'ref'; ref: string } | { kind: 'hash'; hash: string }

/** 读引用文件的原文(相对 .git 的路径,如 'refs/heads/main');文件不存在返回 null。 */
function readRefText(gitDir: string, ref: string): string | null {
  const path = join(gitDir, ref)
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
}

/** 把一段引用文件原文拆成「符号引用目标」或「对象名」;两头不是当场报错。 */
function parseRefText(text: string, where: string): HeadTarget {
  if (HASH_RE.test(text)) {
    return { kind: 'hash', hash: text }
  }
  if (text.startsWith(SYMREF_PREFIX)) {
    const ref = text.slice(SYMREF_PREFIX.length).trim()
    if (!ref.startsWith('refs/')) {
      throw new Error(`${where} 已损坏:'${text}' 指的 '${ref}' 不在 refs/ 命名空间里`)
    }
    return { kind: 'ref', ref }
  }
  throw new Error(`${where} 已损坏:内容 '${text}' 既不是 ref: 形状也不是 40 位提交名`)
}

/** 读 HEAD 的第一跳,只拆一层;HEAD 不存在或形状不对当场报错。 */
export function readHead(gitDir: string): HeadTarget {
  const text = readRefText(gitDir, 'HEAD')
  if (text === null) {
    throw new Error(`HEAD 文件不存在:'${join(gitDir, 'HEAD')}'——mini-git init 会写它,丢了就找不回当前分支`)
  }
  return parseRefText(text, 'HEAD')
}

/**
 * 把 HEAD 解析到提交名:符号引用逐跳跟下去,跟到裸哈希为止;
 * 链上任何一环的引用文件还不存在(unborn 分支)返回 null。
 */
export function resolveHead(gitDir: string): string | null {
  let target = readHead(gitDir)
  for (let hops = 0; ; hops++) {
    if (target.kind === 'hash') {
      return target.hash // detached:HEAD 直接写着提交名
    }
    if (hops >= MAX_SYMREF_HOPS) {
      throw new Error(`HEAD 的符号引用链超过 ${MAX_SYMREF_HOPS} 跳,几乎必是环:'${target.ref}'`)
    }
    const text = readRefText(gitDir, target.ref)
    if (text === null) {
      return null // unborn:分支存在但从没生过提交,HEAD 指向空处
    }
    target = parseRefText(text, `引用 '${target.ref}'`)
  }
}

/** 读一个引用:返回它记录的对象名;引用不存在返回 null;内容是 ref: 形状判损坏——引用文件里该是对象名。 */
export function readRef(gitDir: string, ref: string): string | null {
  const text = readRefText(gitDir, ref)
  if (text === null) {
    return null
  }
  if (!HASH_RE.test(text)) {
    throw new Error(`引用 '${ref}' 里不是 40 位对象名,而是 '${text}'`)
  }
  return text
}

/** 写一个引用:把 40 位对象名写进 .git/<ref>,目录不存在就建。 */
export function updateRef(gitDir: string, ref: string, hash: string): void {
  if (!HASH_RE.test(hash)) {
    throw new Error(`updateRef:'${hash}' 不是 40 位十六进制,写不进引用 '${ref}'`)
  }
  const path = join(gitDir, ref)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${hash}\n`, 'utf8')
}

/** 列出 refs/heads/ 下全部分支名(含嵌套如 feature/ui),按字典序。 */
export function listBranches(gitDir: string): string[] {
  const out: string[] = []
  const walk = (abs: string, rel: string) => {
    if (!existsSync(abs)) {
      return
    }
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        walk(join(abs, e.name), childRel)
      } else {
        out.push(childRel)
      }
    }
  }
  walk(join(gitDir, 'refs', 'heads'), '')
  return out.sort()
}

/** 让 HEAD 指回分支(attach):写入 `ref: <引用>` 的一行文本。 */
export function attachHead(gitDir: string, ref: string): void {
  if (!ref.startsWith('refs/')) {
    throw new Error(`attachHead:'${ref}' 不在 refs/ 命名空间里,HEAD 不能指过去`)
  }
  writeFileSync(join(gitDir, 'HEAD'), `${SYMREF_PREFIX}${ref}\n`, 'utf8')
}

/** 让 HEAD 直接记录一个提交名——detached 状态的实体。 */
export function detachHead(gitDir: string, hash: string): void {
  if (!HASH_RE.test(hash)) {
    throw new Error(`detachHead:'${hash}' 不是 40 位十六进制,写不进 HEAD`)
  }
  writeFileSync(join(gitDir, 'HEAD'), `${hash}\n`, 'utf8')
}
