// tests/trees.test.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashObject, initRepo, readObject } from '../src/objects.ts'
import { checkoutTree, encodeTree, parseTree, writeTree, type TreeEntry } from '../src/trees.ts'
import { runCli } from '../src/cli.ts'

// 金样哈希:开发时用真 git 对同一批固定内容算出(write-tree / mktree)并固化;
// 任何机器重算都应逐字符一致——名字只由内容决定。
const HELLO_BLOB = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad' // 'hello world\n',第 2 章金样
const NOTE_BLOB = '519dd581e50e5b45d3b3c76c3172e9c3ec293488' // 'note\n'
const UTIL_BLOB = '3759e933a83a2d21b350e7aed1948afa2898e588' // 'util\n'
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 三层 fixture 的根
const LIB_TREE = '22be3077cbb05b68e205750f7963d342ed518c78' // lib/
const DEEP_TREE = 'e0827cda3904d0cfb4229b3cabf85d227dbfff92' // lib/deep/
// 同一批条目按朴素字典序(目录名不补尾斜杠)拼出的根 tree:另一个名字
const NAIVE_TREE = 'e2c9db0bf93ff4cd377e5b2b9809505c4357f83e'
// 单条目 100755 的 tree,git mktree 对拍固化——Windows 上 chmod 不存在,可执行位只能这样钉
const EXE_TREE = '595a3b292c0bb24731b421e937597038c06cd021'

// 真 git 写出的 tree 字节(od 逐字节核对过),作为解析金样
const DEEP_BYTES = Buffer.concat([Buffer.from('100644 leaf.txt\0'), Buffer.from(HELLO_BLOB, 'hex')])
const LIB_BYTES = Buffer.concat([
  Buffer.from('40000 deep\0'),
  Buffer.from(DEEP_TREE, 'hex'),
  Buffer.from('100644 util.txt\0'),
  Buffer.from(UTIL_BLOB, 'hex'),
])

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-trees-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/** 建固定三层 fixture:根下 a.txt、lib.txt 与 lib/;lib 下 util.txt 与 deep/;deep 下 leaf.txt。 */
function makeFixture(root: string): void {
  writeFileSync(join(root, 'a.txt'), 'hello world\n')
  writeFileSync(join(root, 'lib.txt'), 'note\n')
  mkdirSync(join(root, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(root, 'lib', 'util.txt'), 'util\n')
  writeFileSync(join(root, 'lib', 'deep', 'leaf.txt'), 'hello world\n')
}

/** 数对象库里的松散对象文件数。 */
function countObjects(gitDir: string): number {
  let n = 0
  for (const bucket of readdirSync(join(gitDir, 'objects'))) {
    n += readdirSync(join(gitDir, 'objects', bucket)).length
  }
  return n
}

describe('parseTree:把字节拆成条目', () => {
  it('金样字节解析:deep tree 的唯一条目', () => {
    expect(parseTree(DEEP_BYTES)).toEqual([{ mode: '100644', name: 'leaf.txt', hash: HELLO_BLOB }])
  })

  it('金样字节解析:lib tree 的两条目,目录模式是五位 40000', () => {
    const entries = parseTree(LIB_BYTES)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toEqual({ mode: '40000', name: 'deep', hash: DEEP_TREE })
    expect(entries[1]).toEqual({ mode: '100644', name: 'util.txt', hash: UTIL_BLOB })
  })

  it('名字里带空格也切得开:模式切在第一个空格,名字以 0 字节收尾', () => {
    const bytes = Buffer.concat([Buffer.from('100644 my file.txt\0'), Buffer.from(HELLO_BLOB, 'hex')])
    expect(parseTree(bytes)).toEqual([{ mode: '100644', name: 'my file.txt', hash: HELLO_BLOB }])
  })

  it('名字没有 0 字节收尾,或哈希不足 20 字节,判损坏', () => {
    expect(() => parseTree(Buffer.from('100644 a.txt'))).toThrow('损坏')
    const short = Buffer.concat([Buffer.from('100644 a.txt\0'), Buffer.alloc(10)])
    expect(() => parseTree(short)).toThrow('损坏')
  })

  it('模式不在取值白名单里,判损坏', () => {
    const bytes = Buffer.concat([Buffer.from('40644 a.txt\0'), Buffer.from(HELLO_BLOB, 'hex')])
    expect(() => parseTree(bytes)).toThrow('损坏')
  })
})

describe('encodeTree:把条目拼回字节', () => {
  it('与手拼金样字节恒等;解析再编码,字节恒等', () => {
    expect(encodeTree([{ mode: '100644', name: 'leaf.txt', hash: HELLO_BLOB }]).equals(DEEP_BYTES)).toBe(true)
    expect(encodeTree(parseTree(LIB_BYTES)).equals(LIB_BYTES)).toBe(true)
    expect(encodeTree(parseTree(DEEP_BYTES)).equals(DEEP_BYTES)).toBe(true)
  })

  it('可执行位 100755 的 tree 哈希金样(git mktree 对拍固化)', () => {
    const body = encodeTree([{ mode: '100755', name: 'run.sh', hash: HELLO_BLOB }])
    expect(hashObject('tree', body)).toBe(EXE_TREE)
  })

  it('拒绝不是 40 位十六进制的条目哈希', () => {
    expect(() => encodeTree([{ mode: '100644', name: 'x', hash: 'abc' }])).toThrow('40 位')
  })
})

describe('writeTree:整棵目录递归序列化', () => {
  it('三层 fixture 的根 tree 哈希金样;.git 不进 tree', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    expect(writeTree(gitDir, work)).toBe(ROOT_TREE)
    const names = parseTree(readObject(gitDir, ROOT_TREE).body).map((e) => e.name)
    expect(names).toEqual(['a.txt', 'lib.txt', 'lib'])
  })

  it('子目录的 tree 哈希逐层钉死', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    const lib = parseTree(readObject(gitDir, LIB_TREE).body)
    expect(readObject(gitDir, LIB_TREE).type).toBe('tree')
    expect(lib.find((e) => e.name === 'deep')?.hash).toBe(DEEP_TREE)
  })

  it('同一批条目按朴素字典序拼,得到的是另一个名字——排序规则承重', () => {
    const naive: TreeEntry[] = [
      { mode: '100644', name: 'a.txt', hash: HELLO_BLOB },
      { mode: '40000', name: 'lib', hash: LIB_TREE },
      { mode: '100644', name: 'lib.txt', hash: NOTE_BLOB },
    ]
    const naiveHash = hashObject('tree', encodeTree(naive))
    expect(naiveHash).toBe(NAIVE_TREE)
    expect(naiveHash).not.toBe(ROOT_TREE)
  })

  it('4 个文件只落 3 个 blob:同内容跨目录去重,整库恰 6 个对象', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    expect(countObjects(gitDir)).toBe(6) // 3 个 blob + 3 个 tree
    expect(readObject(gitDir, HELLO_BLOB).type).toBe('blob')
  })

  it('再跑一遍 writeTree,一个新对象都不添', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    expect(writeTree(gitDir, work)).toBe(ROOT_TREE)
    expect(countObjects(gitDir)).toBe(6)
  })
})

describe('mini-git 命令接线', () => {
  it('write-tree 输出根 tree 哈希并落库', () => {
    runCli(['init'], work)
    makeFixture(work)
    expect(runCli(['write-tree'], work)).toBe(ROOT_TREE)
    expect(readObject(join(work, '.git'), ROOT_TREE).type).toBe('tree')
  })

  it('没 init 就 write-tree,提示先 init', () => {
    makeFixture(work)
    expect(() => runCli(['write-tree'], work)).toThrow('mini-git init')
  })

  it('cat-file -p 按真 git 口径渲染 tree,-t 报类型', () => {
    runCli(['init'], work)
    makeFixture(work)
    runCli(['write-tree'], work)
    expect(runCli(['cat-file', '-p', ROOT_TREE], work)).toBe(
      [
        `100644 blob ${HELLO_BLOB}\ta.txt`,
        `100644 blob ${NOTE_BLOB}\tlib.txt`,
        `040000 tree ${LIB_TREE}\tlib`,
      ].join('\n'),
    )
    expect(runCli(['cat-file', '-t', ROOT_TREE], work)).toBe('tree')
  })
})

describe('checkoutTree:把 tree 还原成目录', () => {
  it('整树检出:四个文件按原字节回到原位置', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    const dest = join(work, 'restored')
    checkoutTree(gitDir, ROOT_TREE, dest)
    expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('hello world\n')
    expect(readFileSync(join(dest, 'lib.txt'), 'utf8')).toBe('note\n')
    expect(readFileSync(join(dest, 'lib', 'util.txt'), 'utf8')).toBe('util\n')
    expect(readFileSync(join(dest, 'lib', 'deep', 'leaf.txt'), 'utf8')).toBe('hello world\n')
  })

  it('检出后再 writeTree,回到同一个根哈希(往返闭环)', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    const dest = join(work, 'restored')
    checkoutTree(gitDir, ROOT_TREE, dest)
    expect(writeTree(gitDir, dest)).toBe(ROOT_TREE)
  })

  it('对不是 tree 的对象做检出,报错', () => {
    const gitDir = initRepo(work)
    makeFixture(work)
    writeTree(gitDir, work)
    expect(() => checkoutTree(gitDir, HELLO_BLOB, join(work, 'nope'))).toThrow('不是 tree')
  })
})
