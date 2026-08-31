// tests/objects.test.ts
import { deflateSync } from 'node:zlib'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashObject, initRepo, readObject, writeObject } from '../src/objects.ts'
import { runCli } from '../src/cli.ts'

// 金样哈希:与真 git 对任意机器算出的值逐字符一致,用来钉死「名字只由内容决定」
const EMPTY_BLOB = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391'
const HELLO_BLOB = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad'
const HELLO_CRLF_BLOB = 'f35d3e67b4cdad5ef058bec4a2ef955a98c4848a'
// 只对内容本身取 SHA-1(不含对象头)得到的值,用来证明对象头确实参与哈希
const HELLO_RAW_SHA1 = '22596363b3de40b06f981fb85d82312e8c0ed511'

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-objects-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

describe('hashObject:内容决定名字', () => {
  it('空内容与 hello world 的金样哈希', () => {
    expect(hashObject('blob', Buffer.alloc(0))).toBe(EMPTY_BLOB)
    expect(hashObject('blob', Buffer.from('hello world\n'))).toBe(HELLO_BLOB)
  })

  it('哈希的输入是「对象头 + 内容」,不是内容本身', () => {
    expect(hashObject('blob', Buffer.from('hello world\n'))).not.toBe(HELLO_RAW_SHA1)
  })

  it('同一份字节配不同类型,名字必须不同', () => {
    const body = Buffer.from('hello world\n')
    expect(hashObject('tree', body)).not.toBe(hashObject('blob', body))
  })

  it('多一个回车字节,名字就完全换一副面孔', () => {
    expect(hashObject('blob', Buffer.from('hello world\r\n'))).toBe(HELLO_CRLF_BLOB)
  })
})

describe('init 与对象的落盘读写', () => {
  it('init 建出能装对象的最小仓库骨架', () => {
    const gitDir = initRepo(work)
    expect(existsSync(join(gitDir, 'objects'))).toBe(true)
    expect(existsSync(join(gitDir, 'refs', 'heads'))).toBe(true)
    expect(readFileSync(join(gitDir, 'HEAD'), 'utf8')).toBe('ref: refs/heads/main\n')
  })

  it('writeObject 按名字前 2 位分目录落盘', () => {
    const gitDir = initRepo(work)
    const hash = writeObject(gitDir, 'blob', Buffer.from('hello world\n'))
    expect(hash).toBe(HELLO_BLOB)
    expect(existsSync(join(gitDir, 'objects', '3b', hash.slice(2)))).toBe(true)
  })

  it('同一对象写两遍,只落一个文件', () => {
    const gitDir = initRepo(work)
    writeObject(gitDir, 'blob', Buffer.from('hello world\n'))
    const again = writeObject(gitDir, 'blob', Buffer.from('hello world\n'))
    expect(again).toBe(HELLO_BLOB)
    expect(readdirSync(join(gitDir, 'objects'))).toHaveLength(1)
  })

  it('readObject 读回类型与原文', () => {
    const gitDir = initRepo(work)
    const hash = writeObject(gitDir, 'blob', Buffer.from('hello world\n'))
    const back = readObject(gitDir, hash)
    expect(back.type).toBe('blob')
    expect(back.body.toString('utf8')).toBe('hello world\n')
  })

  it('空内容也原样读得回', () => {
    const gitDir = initRepo(work)
    const hash = writeObject(gitDir, 'blob', Buffer.alloc(0))
    const back = readObject(gitDir, hash)
    expect(back.body.length).toBe(0)
  })

  it('拒绝不是 40 位十六进制的对象名', () => {
    const gitDir = initRepo(work)
    expect(() => readObject(gitDir, 'abc')).toThrow('不是 40 位')
  })

  it('拒绝读不存在的对象', () => {
    const gitDir = initRepo(work)
    expect(() => readObject(gitDir, '0'.repeat(40))).toThrow('不存在')
  })

  it('头部声明的大小与实读不符,判为损坏', () => {
    const gitDir = initRepo(work)
    // 手工放进一个坏对象:头部声称 99 字节,实际只有 2 字节
    const fakeHash = 'ab' + 'c'.repeat(38)
    mkdirSync(join(gitDir, 'objects', 'ab'), { recursive: true })
    writeFileSync(join(gitDir, 'objects', 'ab', fakeHash.slice(2)), deflateSync(Buffer.from('blob 99\0hi')))
    expect(() => readObject(gitDir, fakeHash)).toThrow('损坏')
  })
})

describe('mini-git 命令接线', () => {
  it('hash-object 只算不写,输出与金样一致', () => {
    writeFileSync(join(work, 'hello.txt'), 'hello world\n')
    expect(runCli(['hash-object', 'hello.txt'], work)).toBe(HELLO_BLOB)
    expect(existsSync(join(work, '.git'))).toBe(false)
  })

  it('hash-object -w 把对象写进对象库', () => {
    runCli(['init'], work)
    writeFileSync(join(work, 'hello.txt'), 'hello world\n')
    expect(runCli(['hash-object', '-w', 'hello.txt'], work)).toBe(HELLO_BLOB)
    expect(existsSync(join(work, '.git', 'objects', '3b', HELLO_BLOB.slice(2)))).toBe(true)
  })

  it('读不存在的文件给可读的报错', () => {
    expect(() => runCli(['hash-object', 'nope.txt'], work)).toThrow('无法读取')
  })

  it('没 init 就 -w,报错并提示先 init', () => {
    writeFileSync(join(work, 'hello.txt'), 'hello world\n')
    expect(() => runCli(['hash-object', '-w', 'hello.txt'], work)).toThrow('mini-git init')
  })

  it('cat-file -p 读回原文,-t 报类型', () => {
    runCli(['init'], work)
    writeFileSync(join(work, 'hello.txt'), 'hello world\n')
    const hash = runCli(['hash-object', '-w', 'hello.txt'], work)
    expect(runCli(['cat-file', '-p', hash], work)).toBe('hello world\n')
    expect(runCli(['cat-file', '-t', hash], work)).toBe('blob')
  })

  it('cat-file 对残缺对象名给报错', () => {
    runCli(['init'], work)
    expect(() => runCli(['cat-file', '-p', '3b18e5'], work)).toThrow('不是 40 位')
  })
})
