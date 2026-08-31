// src/objects.ts · 对象库:内容寻址的存与取
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'

/** git 的三种对象类型;blob 是「文件内容」,tree 与 commit 在后两章登场。 */
export type ObjectType = 'blob' | 'tree' | 'commit'

const OBJECT_TYPES: readonly ObjectType[] = ['blob', 'tree', 'commit']

/** 在 workDir 下建立能装对象的最小 .git 骨架,返回 .git 目录路径。 */
export function initRepo(workDir: string): string {
  const gitDir = join(workDir, '.git')
  mkdirSync(join(gitDir, 'objects'), { recursive: true })
  mkdirSync(join(gitDir, 'refs', 'heads'), { recursive: true })
  const head = join(gitDir, 'HEAD')
  if (!existsSync(head)) {
    writeFileSync(head, 'ref: refs/heads/main\n', 'utf8')
  }
  return gitDir
}

/**
 * 建裸仓库骨架:不套 .git 这层壳,骨架直接铺在 workDir 本身——没有工作区,目录就是仓库,
 * 天生当 push/fetch 的服务端落点(对齐 git clone --bare 的口径)。
 */
export function initRepoBare(workDir: string): string {
  mkdirSync(join(workDir, 'objects'), { recursive: true })
  mkdirSync(join(workDir, 'refs', 'heads'), { recursive: true })
  const head = join(workDir, 'HEAD')
  if (!existsSync(head)) {
    writeFileSync(head, 'ref: refs/heads/main\n', 'utf8')
  }
  return workDir
}

/** 拼出「对象头 + 内容」的完整字节流:对象头是 `<类型> <字节数>\0` 这段文本。 */
function frameObject(type: ObjectType, body: Buffer): Buffer {
  const header = Buffer.from(`${type} ${body.length}\0`, 'utf8')
  return Buffer.concat([header, body])
}

/** 对「对象头 + 内容」取 SHA-1,返回 40 位十六进制对象名。 */
export function hashObject(type: ObjectType, body: Buffer): string {
  return createHash('sha1').update(frameObject(type, body)).digest('hex')
}

/** 名字前 2 位当目录名、后 38 位当文件名的松散对象路径。 */
function looseObjectPath(gitDir: string, hash: string): string {
  return join(gitDir, 'objects', hash.slice(0, 2), hash.slice(2))
}

/** 把对象作为松散文件写进 gitDir/objects,返回对象名;已存在则跳过不重写。 */
export function writeObject(gitDir: string, type: ObjectType, body: Buffer): string {
  const hash = hashObject(type, body)
  const path = looseObjectPath(gitDir, hash)
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, deflateSync(frameObject(type, body), { level: 1 }))
  }
  return hash
}

/** 按对象名读回松散对象,返回它的类型与内容。 */
export function readObject(gitDir: string, hash: string): { type: ObjectType; body: Buffer } {
  if (!/^[0-9a-f]{40}$/.test(hash)) {
    throw new Error(`对象名 '${hash}' 不是 40 位十六进制,无法当作对象名`)
  }
  const path = looseObjectPath(gitDir, hash)
  if (!existsSync(path)) {
    throw new Error(`对象 '${hash}' 不存在`)
  }
  const framed = inflateSync(readFileSync(path))
  const zero = framed.indexOf(0)
  if (zero < 0) {
    throw new Error(`对象 '${hash}' 已损坏:找不到对象头的结束字节`)
  }
  const [type, sizeText] = framed.subarray(0, zero).toString('utf8').split(' ')
  if (!OBJECT_TYPES.includes(type as ObjectType)) {
    throw new Error(`对象 '${hash}' 已损坏:不认识的对象类型 '${type}'`)
  }
  const body = framed.subarray(zero + 1)
  if (Number(sizeText) !== body.length) {
    throw new Error(`对象 '${hash}' 已损坏:头部声明 ${sizeText} 字节,实读 ${body.length} 字节`)
  }
  return { type: type as ObjectType, body }
}
