// tests/index.test.ts
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashObject, initRepo, readObject } from '../src/objects.ts'
import { encodeTree, writeTree } from '../src/trees.ts'
import {
  classifyStatus,
  flattenTree,
  loadIndex,
  makeIndexEntry,
  parseIndex,
  readHeadHash,
  scanWorktree,
  writeIndex,
  type FileSig,
  type IndexEntry,
} from '../src/index.ts'
import { runCli } from '../src/cli.ts'

// 真 git 2.53 对三层 fixture `git add -A` 后写出的 .git/index 全量 426 字节(od 逐字节核对后固化)。
// 其中 ctime/mtime/dev/ino 是生成机器的指纹,跨机器必然不同;测试只断言结构事实,不碰这些字段。
const GOLDEN_INDEX = Buffer.from(
  '444952430000000200000004' + // 头 12 字节:DIRC、版本 2、4 条
    '6A959A5124AF039C6A959A5124AF039C0000000000000000000081A400000000000000000000000C3B18E512DBA79E4C8300DD08AEB37F8E728B8DAD0005612E7478740000000000' + // entry 1:a.txt(72 字节)
    '6A959A5124BE44B06A959A5124BE44B00000000000000000000081A4000000000000000000000005519DD581E50E5B45D3B3C76C3172E9C3EC29348800076C69622E747874000000' + // entry 2:lib.txt(72 字节)
    '6A959A5125C42EB06A959A5125C42EB00000000000000000000081A400000000000000000000000C3B18E512DBA79E4C8300DD08AEB37F8E728B8DAD00116C69622F646565702F6C6561662E74787400' + // entry 3:lib/deep/leaf.txt(80 字节)
    '6A959A5125B4EC706A959A5125C42EB00000000000000000000081A40000000000000000000000053759E933A83A2D21B350E7AED1948AFA2898E588000C6C69622F7574696C2E747874000000000000' + // entry 4:lib/util.txt(80 字节)
    '5452454500000052003420310AFA0086005716702A3661501FA32495BAE7619B916C6962003220310A22BE3077CBB05B68E205750F7963D342ED518C7864656570003120300AE0827CDA3904D0CFB4229B3CABF85D227DBFFF923D93D80A9FA2704625EBCC36A7DC8C61FE6F15F1', // TREE 扩展(90 字节)+ 末尾 20 字节 SHA-1 校验和
  'hex',
)

// 第 3 章三层 fixture 的既有金样:blob 与根 tree 的名字只由内容决定,本章照用
const HELLO_BLOB = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad' // 'hello world\n'
const NOTE_BLOB = '519dd581e50e5b45d3b3c76c3172e9c3ec293488' // 'note\n'
const UTIL_BLOB = '3759e933a83a2d21b350e7aed1948afa2898e588' // 'util\n'
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 三层 fixture 的根
const C1 = 'bf05977bd740a2b2fa530935475587501704d0cc' // 第 4 章根提交金样

/** 造一条手工条目:stat 字段全填假数,布局字段(bytes)与内容字段(hash/path)是真的。 */
function fakeEntry(path: string, hash: string, size: number): IndexEntry {
  return {
    ctimeSec: 1700000000,
    ctimeNsec: 123456789,
    mtimeSec: 1700003600,
    mtimeNsec: 987654321,
    dev: 0x1234,
    ino: 0x5678,
    mode: 0o100644,
    uid: 1000,
    gid: 1000,
    size,
    hash,
    flags: Buffer.byteLength(path, 'utf8'),
    path,
  }
}

let work: string
let gitDir: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-index-'))
  gitDir = initRepo(work)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 建固定三层 fixture:与第 3、4 章同一套。 */
function makeFixture(root: string): void {
  writeFileSync(join(root, 'a.txt'), 'hello world\n')
  writeFileSync(join(root, 'lib.txt'), 'note\n')
  mkdirSync(join(root, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(root, 'lib', 'util.txt'), 'util\n')
  writeFileSync(join(root, 'lib', 'deep', 'leaf.txt'), 'hello world\n')
}

const FIXTURE_PATHS = ['a.txt', 'lib.txt', 'lib/deep/leaf.txt', 'lib/util.txt']
const FIXTURE_HASHES = [HELLO_BLOB, NOTE_BLOB, HELLO_BLOB, UTIL_BLOB]

describe('parseIndex:拆真 git 写的 index', () => {
  it('金样解析:4 条,路径按字节序,hash/mode/size/flags 逐项对上', () => {
    const entries = parseIndex(GOLDEN_INDEX)
    expect(entries.map((e) => e.path)).toEqual(FIXTURE_PATHS)
    expect(entries.map((e) => e.hash)).toEqual(FIXTURE_HASHES)
    expect(entries.every((e) => e.mode === 0o100644)).toBe(true)
    expect(entries.map((e) => e.size)).toEqual([12, 5, 12, 5])
    expect(entries.map((e) => e.flags)).toEqual([5, 7, 17, 12]) // flags 低 12 位 = 路径字节数
  })

  it('魔数不是 DIRC、版本不是 2,分别判损坏', () => {
    const badMagic = Buffer.from(GOLDEN_INDEX)
    badMagic.write('DIRX', 0, 'utf8')
    expect(() => parseIndex(badMagic)).toThrow('DIRC')
    const v3 = Buffer.from(GOLDEN_INDEX)
    v3.writeUInt32BE(3, 4)
    expect(() => parseIndex(v3)).toThrow('版本')
  })

  it('条目数报多了、名字长度 0xFFF、flags 高位非零,各判损坏', () => {
    const inflated = Buffer.from(writeIndex([fakeEntry('a.txt', HELLO_BLOB, 12)]))
    inflated.writeUInt32BE(2, 8) // 头声明 2 条,字节里只有 1 条
    expect(() => parseIndex(inflated)).toThrow('损坏')
    const longName = Buffer.from(GOLDEN_INDEX)
    longName.writeUInt16BE(0xfff, 12 + 60) // 第一条 entry 的 flags 改成 0xFFF(超长路径约定)
    expect(() => parseIndex(longName)).toThrow('损坏')
    const staged = Buffer.from(GOLDEN_INDEX)
    staged.writeUInt16BE(0x3005, 12 + 60) // stage 位(0x3000)非零:合并冲突里的条目
    expect(() => parseIndex(staged)).toThrow('flags')
  })

  it('末尾校验和对不上前文,判损坏——动一个字节都逃不掉', () => {
    const flipped = Buffer.from(GOLDEN_INDEX)
    flipped[13] ^= 0xff // 动头部一个字节
    expect(() => parseIndex(flipped)).toThrow('校验和')
    const truncated = GOLDEN_INDEX.subarray(0, 100) // 截到条目中间
    expect(() => parseIndex(truncated)).toThrow('损坏')
  })
})

describe('writeIndex:拼字节与自写自读', () => {
  it('单条 entry 的字节逐段钉死:12 字节头、62 字节定长、路径、NUL 垫齐、20 字节校验和', () => {
    const one = writeIndex([fakeEntry('a.txt', HELLO_BLOB, 12)])
    expect(one.length).toBe(12 + 72 + 20) // (62 + 5) 垫到 8 的倍数 = 72
    expect(one.subarray(0, 4).toString('utf8')).toBe('DIRC')
    expect(one.readUInt32BE(4)).toBe(2)
    expect(one.readUInt32BE(8)).toBe(1)
    expect(one.readUInt32BE(12 + 36)).toBe(12) // size 在第 10 个 4 字节字段
    expect(one.subarray(12 + 40, 12 + 60).toString('hex')).toBe(HELLO_BLOB)
    expect(one.readUInt16BE(12 + 60)).toBe(5) // flags = 'a.txt' 的 5 个字节
    expect(one.subarray(12 + 62, 12 + 67).toString('utf8')).toBe('a.txt')
    expect(one.subarray(12 + 67, 12 + 72).every((b) => b === 0)).toBe(true) // 垫 5 个 NUL
  })

  it('四条 fixture 条目:总长 12 + (72+72+80+80) + 20 = 336;parse 再 write 字节恒等', () => {
    const entries = FIXTURE_PATHS.map((p, i) => fakeEntry(p, FIXTURE_HASHES[i], i % 2 === 0 ? 12 : 5))
    const bytes = writeIndex(entries)
    expect(bytes.length).toBe(336)
    const again = writeIndex(parseIndex(bytes))
    expect(again.equals(bytes)).toBe(true)
  })

  it('条目按路径字节序落盘:乱序进,字典序出;lib.txt 排在 lib/ 前面', () => {
    const hashOf = new Map(FIXTURE_PATHS.map((p, i) => [p, FIXTURE_HASHES[i]]))
    const shuffled = ['lib/util.txt', 'lib/deep/leaf.txt', 'lib.txt', 'a.txt'].map((p) => fakeEntry(p, hashOf.get(p)!, 5))
    expect(parseIndex(writeIndex(shuffled)).map((e) => e.path)).toEqual(FIXTURE_PATHS)
  })

  it('拒绝非法哈希与非法模式;自写产物篡改一字节,parseIndex 当场验出', () => {
    expect(() => writeIndex([fakeEntry('a.txt', 'abc', 1)])).toThrow('40 位')
    expect(() => writeIndex([{ ...fakeEntry('a.txt', HELLO_BLOB, 1), mode: 0o100666 }])).toThrow('模式')
    const bytes = Buffer.from(writeIndex([fakeEntry('a.txt', HELLO_BLOB, 12)]))
    bytes[40] ^= 0xff // 动 hash 的一个字节
    expect(() => parseIndex(bytes)).toThrow('校验和')
  })
})

describe('add:把工作区内容登记进清单', () => {
  it('add 落 blob、写清单:路径与哈希逐条对上,输出的对象库多了 3 个 blob', () => {
    makeFixture(work)
    expect(runCli(['add', 'a.txt', 'lib.txt', 'lib/deep/leaf.txt', 'lib/util.txt'], work)).toBe(
      '已暂存 4 个文件,清单共 4 条',
    )
    const entries = loadIndex(gitDir)
    expect(entries.map((e) => e.path)).toEqual(FIXTURE_PATHS)
    expect(entries.map((e) => e.hash)).toEqual(FIXTURE_HASHES)
    expect(entries.every((e) => e.mode === 0o100644)).toBe(true)
    for (const h of [HELLO_BLOB, NOTE_BLOB, UTIL_BLOB]) {
      expect(readObject(gitDir, h).type).toBe('blob') // blob 真的落了库
    }
  })

  it('分两次 add:已有条目不丢;重复 add 同一文件,条目被替换成新版本', () => {
    makeFixture(work)
    runCli(['add', 'a.txt'], work)
    runCli(['add', 'lib/util.txt'], work)
    expect(loadIndex(gitDir).map((e) => e.path)).toEqual(['a.txt', 'lib/util.txt'])
    const changed = 'second line\n'
    writeFileSync(join(work, 'a.txt'), changed)
    runCli(['add', 'a.txt'], work)
    const entries = loadIndex(gitDir)
    expect(entries).toHaveLength(2)
    expect(entries.find((e) => e.path === 'a.txt')?.hash).toBe(hashObject('blob', Buffer.from(changed, 'utf8')))
  })

  it('条目的 stat 字段来自磁盘:mode/size 与文件一致', () => {
    makeFixture(work)
    runCli(['add', 'a.txt'], work)
    const e = loadIndex(gitDir).find((x) => x.path === 'a.txt')
    expect(e?.mode).toBe(0o100644)
    expect(e?.size).toBe(12)
    expect(e?.mtimeSec).toBeGreaterThan(0)
    expect(e?.flags).toBe(5)
  })

  it('不存在的文件、目录、.git 里的路径、仓库外路径,分别报错', () => {
    makeFixture(work)
    expect(() => runCli(['add'], work)).toThrow('用法')
    expect(() => runCli(['add', 'nope.txt'], work)).toThrow('不存在')
    expect(() => runCli(['add', 'lib'], work)).toThrow('用法')
    expect(() => runCli(['add', '.git/HEAD'], work)).toThrow('.git')
    expect(() => runCli(['add', '../outside.txt'], work)).toThrow('之外')
  })
})

describe('write-tree 改吃暂存区', () => {
  it('全量暂存后 write-tree 与第 3 章工作区口径同根:fa0086…', () => {
    makeFixture(work)
    for (const p of FIXTURE_PATHS) {
      runCli(['add', p], work)
    }
    expect(runCli(['write-tree'], work)).toBe(ROOT_TREE)
  })

  it('部分暂存:write-tree 只收清单里的文件,树哈希与手拼的树一致', () => {
    makeFixture(work)
    runCli(['add', 'a.txt', 'lib.txt'], work)
    const tree = hashObject(
      'tree',
      encodeTree([
        { mode: '100644', name: 'a.txt', hash: HELLO_BLOB },
        { mode: '100644', name: 'lib.txt', hash: NOTE_BLOB },
      ]),
    )
    expect(runCli(['write-tree'], work)).toBe(tree)
  })

  it('暂存旧版后再改工作区:write-tree 仍吃暂存的那套——第 3 章欠的分裂补上了', () => {
    makeFixture(work)
    for (const p of FIXTURE_PATHS) {
      runCli(['add', p], work)
    }
    writeFileSync(join(work, 'a.txt'), 'hello world\nsecond line\n')
    expect(runCli(['write-tree'], work)).toBe(ROOT_TREE) // 工作区的新版没 add,不进树
  })

  it('index 不存在时沿用第 3 章口径:扫工作区(与真 git 写空树是一条登记过的分岔)', () => {
    makeFixture(work)
    expect(runCli(['write-tree'], work)).toBe(ROOT_TREE) // 一次 add 都没做过
    expect(writeTree(gitDir, work)).toBe(ROOT_TREE) // 库函数口径未变,旧能力仍在
  })
})

describe('三态对比:status', () => {
  const sig = (hash: string): FileSig => ({ mode: 0o100644, hash })

  it('classifyStatus 四类判定:逐路径对号入座', () => {
    const index = new Map([
      ['a.txt', sig('aa')], // HEAD 没有 → 已暂存新文件
      ['b.txt', sig('bb')], // 三方一致 → 未变
      ['c.txt', sig('cc2')], // HEAD 是 cc1 → 已暂存修改
      ['d.txt', sig('dd')], // 工作区没有 → 未暂存删除
    ])
    const worktree = new Map([
      ['a.txt', sig('aa')], // 与暂存一致
      ['b.txt', sig('bb')], // 与暂存一致
      ['c.txt', sig('cc2')], // 与暂存一致
      ['f.txt', sig('ff')], // 不在清单 → 未跟踪
    ])
    const head = new Map([
      ['b.txt', sig('bb')],
      ['c.txt', sig('cc1')],
      ['d.txt', sig('dd')], // 与清单一致:不是新文件,只输在工作区这一侧
      ['e.txt', sig('ee')], // 清单没有 → 已暂存删除
    ])
    const r = classifyStatus(index, worktree, head)
    expect(r.staged).toEqual([
      { path: 'a.txt', kind: 'new' },
      { path: 'c.txt', kind: 'modified' },
      { path: 'e.txt', kind: 'deleted' },
    ])
    expect(r.unstaged).toEqual([{ path: 'd.txt', kind: 'deleted' }])
    expect(r.untracked).toEqual(['f.txt'])
    expect(r.unchanged).toEqual(['b.txt'])
  })

  it('工作区改了但没 add:同一文件同时进两段——开篇现象的机制', () => {
    makeFixture(work)
    for (const p of FIXTURE_PATHS) {
      runCli(['add', p], work)
    }
    writeFileSync(join(work, 'a.txt'), 'hello world\nsecond line\n')
    writeFileSync(join(work, 'todo.md'), 'later\n')
    expect(runCli(['status'], work)).toBe(
      [
        '已暂存的变更(暂存区 相对 HEAD):',
        '  新文件:a.txt',
        '  新文件:lib.txt',
        '  新文件:lib/deep/leaf.txt',
        '  新文件:lib/util.txt',
        '未暂存的变更(工作区 相对 暂存区):',
        '  修改:a.txt',
        '未跟踪的文件(不在暂存区):',
        '  todo.md',
      ].join('\n'),
    )
  })

  it('有 HEAD 之后的干净态:三方一致一笔带过;再改再 add 再改,两段都是「修改」', () => {
    makeFixture(work)
    for (const p of FIXTURE_PATHS) {
      runCli(['add', p], work)
    }
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    const c1 = runCli(['commit-tree', runCli(['write-tree'], work), '-m', '第一次提交'], work)
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), `${c1}\n`)
    expect(runCli(['status'], work)).toBe('干净:工作区、暂存区与 HEAD 三方一致(4 个文件)')
    writeFileSync(join(work, 'a.txt'), 'hello world\nv2\n')
    runCli(['add', 'a.txt'], work)
    writeFileSync(join(work, 'a.txt'), 'hello world\nv3\n')
    expect(runCli(['status'], work)).toBe(
      [
        '已暂存的变更(暂存区 相对 HEAD):',
        '  修改:a.txt',
        '未暂存的变更(工作区 相对 暂存区):',
        '  修改:a.txt',
        '未变:3 个文件',
      ].join('\n'),
    )
  })

  it('没 add 过的新仓库:一切未跟踪;HEAD 是 ref: 形状且分支没生过提交,readHeadHash 返回 null', () => {
    makeFixture(work)
    expect(runCli(['status'], work)).toBe(
      ['未跟踪的文件(不在暂存区):', ...FIXTURE_PATHS.map((p) => `  ${p}`)].join('\n'),
    )
    expect(readHeadHash(gitDir)).toBe(null)
  })

  it('删掉 .git/index:与 HEAD 比出全部已暂存删除,与工作区比出全部未跟踪——第 1 章的预测', () => {
    makeFixture(work)
    for (const p of FIXTURE_PATHS) {
      runCli(['add', p], work)
    }
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    const c1 = runCli(['commit-tree', runCli(['write-tree'], work), '-m', '第一次提交'], work)
    expect(c1).toBe(C1) // 与第 4 章金样同一套输入,同一个名字
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), `${c1}\n`)
    rmSync(join(gitDir, 'index'))
    expect(runCli(['status'], work)).toBe(
      [
        '已暂存的变更(暂存区 相对 HEAD):',
        ...FIXTURE_PATHS.map((p) => `  删除:${p}`),
        '未跟踪的文件(不在暂存区):',
        ...FIXTURE_PATHS.map((p) => `  ${p}`),
      ].join('\n'),
    )
  })
})

describe('HEAD 读取与摊平', () => {
  it('readHeadHash:ref: 形状解析到分支小文件;裸哈希形状直接返回', () => {
    expect(readHeadHash(gitDir)).toBe(null) // 分支还没生过提交
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), `${C1}\n`)
    expect(readHeadHash(gitDir)).toBe(C1)
    writeFileSync(join(gitDir, 'HEAD'), `${C1}\n`) // detached:HEAD 直接写哈希
    expect(readHeadHash(gitDir)).toBe(C1)
  })

  it('flattenTree:把 HEAD 的 tree 摊平成 路径 → 指纹,含子目录', () => {
    makeFixture(work)
    writeTree(gitDir, work) // 根 tree 落库,即 ROOT_TREE
    const flat = flattenTree(gitDir, ROOT_TREE)
    expect([...flat.keys()]).toEqual(FIXTURE_PATHS)
    expect(flat.get('lib/deep/leaf.txt')).toEqual({ mode: 0o100644, hash: HELLO_BLOB })
    expect(flat.get('lib/util.txt')).toEqual({ mode: 0o100644, hash: UTIL_BLOB })
  })

  it('scanWorktree:跳过 .git,逐文件算指纹但不落对象', () => {
    makeFixture(work)
    const scan = scanWorktree(work)
    expect([...scan.keys()]).toEqual(FIXTURE_PATHS)
    expect(scan.get('lib.txt')).toEqual({ mode: 0o100644, hash: NOTE_BLOB })
    expect(() => runCli(['cat-file', '-t', NOTE_BLOB], work)).toThrow('不存在') // 没写进对象库
  })

  it('makeIndexEntry:flags 记路径字节数;超长路径拒绝', () => {
    makeFixture(work)
    const st = statSync(join(work, 'a.txt'))
    expect(makeIndexEntry('a.txt', HELLO_BLOB, st).flags).toBe(5)
    const long = `${'x'.repeat(5000)}.txt`
    expect(() => makeIndexEntry(long, HELLO_BLOB, st)).toThrow('4095')
  })
})
