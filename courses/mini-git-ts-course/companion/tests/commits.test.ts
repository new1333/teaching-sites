// tests/commits.test.ts
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashObject, initRepo, readObject } from '../src/objects.ts'
import { writeTree } from '../src/trees.ts'
import { commitTree, encodeCommit, logWalk, parseCommit, type CommitIdentity } from '../src/commits.ts'
import { runCli } from '../src/cli.ts'

// 金样哈希:真 git commit-tree 对同一批固定输入(同 tree、同身份、同时间戳、同消息)算出并固化。
// 「同消息」包括收尾换行——真 git 的 -m 会补一个;库函数按原文收,所以测试里显式写 \n。
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 第 3 章三层 fixture 的根
const C1 = 'bf05977bd740a2b2fa530935475587501704d0cc' // 根提交,ts 1700000000
const C2 = '4e5eeac14bd4ba9f270ad6fea4858fa65f47c39b' // 第二次提交,ts 1700003600
const C3 = '273a317c713b8e6450d5bb7e4eeaafe320827599' // 第三次提交,ts 1700007200
const SIDE_A = '4be7b24bd163591878b10519bdcb3fc8b2ed9bfe' // 左分支提交,ts 1700003600
const SIDE_B = '55e2ac93dc1b4fa6dd9974a57b62eb3e81e5b429' // 右分支提交,同刻 1700003600
const MERGE = '325b55d8cd52888b7a935cbda3d0e9ccfa6516e6' // 双父合并提交,ts 1700010800

const WHO: CommitIdentity = { name: 'mini-git', email: 'mini-git@example.com', timestamp: 1700000000, timezone: '+0800' }
const whoAt = (timestamp: number): CommitIdentity => ({ ...WHO, timestamp })

// 真 git 写出的根提交原文(od 逐字节核对过):解析金样
const C1_TEXT = [
  `tree ${ROOT_TREE}`,
  'author mini-git <mini-git@example.com> 1700000000 +0800',
  'committer mini-git <mini-git@example.com> 1700000000 +0800',
  '',
  '第一次提交',
  '',
].join('\n')

let work: string
let gitDir: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-commits-'))
  gitDir = initRepo(work)
  writeFileSync(join(work, 'a.txt'), 'hello world\n')
  writeFileSync(join(work, 'lib.txt'), 'note\n')
  mkdirSync(join(work, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(work, 'lib', 'util.txt'), 'util\n')
  writeFileSync(join(work, 'lib', 'deep', 'leaf.txt'), 'hello world\n')
  writeTree(gitDir, work) // 根 tree 落库,即 ROOT_TREE
  process.env.MINI_GIT_AUTHOR_NAME = WHO.name
  process.env.MINI_GIT_AUTHOR_EMAIL = WHO.email
  process.env.MINI_GIT_TZ = WHO.timezone
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_AUTHOR_NAME
  delete process.env.MINI_GIT_AUTHOR_EMAIL
  delete process.env.MINI_GIT_TZ
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 数对象库里的松散对象文件数。 */
function countObjects(dir: string): number {
  let n = 0
  for (const bucket of readdirSync(join(dir, 'objects'))) {
    n += readdirSync(join(dir, 'objects', bucket)).length
  }
  return n
}

/** 造链式金样:C1 → C2 → C3(同 tree、递增时间戳)。 */
function makeChain(): void {
  commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '第二次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C2], author: whoAt(1700007200), message: '第三次提交\n' })
}

/** 造分叉合并金样:C1 分出 A、B 两支,再合成双父 M。 */
function makeMerge(): void {
  commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '左侧分支提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '右侧分支提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [SIDE_A, SIDE_B], author: whoAt(1700010800), message: '合并两支\n' })
}

describe('commitTree:提交对象落库', () => {
  it('根提交哈希金样:零父,author 与 committer 两行同身份', () => {
    const c1 = commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    expect(c1).toBe(C1)
    expect(readObject(gitDir, c1).type).toBe('commit')
  })

  it('链式:每代换一个父指针,三只提交的名字逐个钉死', () => {
    makeChain()
    expect(readObject(gitDir, C1).type).toBe('commit')
    expect(readObject(gitDir, C2).type).toBe('commit')
    expect(readObject(gitDir, C3).type).toBe('commit')
  })

  it('双父:两个 -p 各占一行 parent,顺序与给出的一致', () => {
    makeMerge()
    const m = parseCommit(readObject(gitDir, MERGE).body)
    expect(m.parents).toEqual([SIDE_A, SIDE_B])
    expect(m.message).toBe('合并两支\n')
  })

  it('tree 不存在、tree 是 blob、父提交是 tree,分别报错', () => {
    expect(() => commitTree(gitDir, { tree: '0'.repeat(40), parents: [], author: WHO, message: 'x\n' })).toThrow('不存在')
    expect(() =>
      commitTree(gitDir, { tree: '3b18e512dba79e4c8300dd08aeb37f8e728b8dad', parents: [], author: WHO, message: 'x\n' }),
    ).toThrow('不是 tree')
    expect(() => commitTree(gitDir, { tree: ROOT_TREE, parents: [ROOT_TREE], author: WHO, message: 'x\n' })).toThrow(
      '不是 commit',
    )
  })
})

describe('parseCommit:文本拆回字段', () => {
  it('真 git 的根提交原文,拆出 tree/零父/双身份/消息', () => {
    expect(hashObject('commit', Buffer.from(C1_TEXT, 'utf8'))).toBe(C1)
    expect(parseCommit(Buffer.from(C1_TEXT, 'utf8'))).toEqual({
      tree: ROOT_TREE,
      parents: [],
      author: whoAt(1700000000),
      committer: whoAt(1700000000),
      message: '第一次提交\n',
    })
  })

  it('双亲原文解析:parent 行按出现顺序进数组', () => {
    const text = [
      `tree ${ROOT_TREE}`,
      `parent ${SIDE_A}`,
      `parent ${SIDE_B}`,
      'author mini-git <mini-git@example.com> 1700010800 +0800',
      'committer mini-git <mini-git@example.com> 1700010800 +0800',
      '',
      '合并两支',
      '',
    ].join('\n')
    expect(hashObject('commit', Buffer.from(text, 'utf8'))).toBe(MERGE)
    expect(parseCommit(Buffer.from(text, 'utf8')).parents).toEqual([SIDE_A, SIDE_B])
  })

  it('解析再编码,文本恒等', () => {
    makeMerge()
    for (const hash of [C1, SIDE_A, SIDE_B, MERGE]) {
      const body = readObject(gitDir, hash).body
      expect(encodeCommit(parseCommit(body))).toBe(body.toString('utf8'))
    }
  })

  it('缺空行、缺 committer 行、身份行没邮箱,各判损坏', () => {
    const noBlank = `tree ${ROOT_TREE}\nauthor mini-git <mini-git@example.com> 1 +0800`
    expect(() => parseCommit(Buffer.from(noBlank, 'utf8'))).toThrow('空行')
    const noCommitter = `tree ${ROOT_TREE}\nauthor mini-git <mini-git@example.com> 1 +0800\n\nx\n`
    expect(() => parseCommit(Buffer.from(noCommitter, 'utf8'))).toThrow('缺少 committer')
    const noEmail = `tree ${ROOT_TREE}\nauthor mini-git 1 +0800\ncommitter mini-git <m@e.com> 1 +0800\n\nx\n`
    expect(() => parseCommit(Buffer.from(noEmail, 'utf8'))).toThrow('身份行')
  })

  it('头部混进不认识的行(如 gpgsig),判损坏——mini-git 不解析可选头部', () => {
    const signed = `tree ${ROOT_TREE}\ngpgsig fake\nauthor mini-git <mini-git@example.com> 1 +0800\ncommitter mini-git <mini-git@example.com> 1 +0800\n\nx\n`
    expect(() => parseCommit(Buffer.from(signed, 'utf8'))).toThrow('不认识')
  })
})

describe('logWalk:提交图遍历', () => {
  it('链式:从 C3 出发,时间倒序 C3 → C2 → C1,消息逐个恢复', () => {
    makeChain()
    const log = logWalk(gitDir, C3)
    expect(log.map((c) => c.hash)).toEqual([C3, C2, C1])
    expect(log.map((c) => c.message.trim())).toEqual(['第三次提交', '第二次提交', '第一次提交'])
    expect(log[2].parents).toEqual([])
  })

  it('分叉:两支各自回溯到同一个根,根对象只存一份', () => {
    makeMerge()
    expect(logWalk(gitDir, SIDE_A).map((c) => c.hash)).toEqual([SIDE_A, C1])
    expect(logWalk(gitDir, SIDE_B).map((c) => c.hash)).toEqual([SIDE_B, C1])
  })

  it('双父:一次遍历走完两支,公共根 C1 恰好出现一次;整库 10 个对象', () => {
    makeMerge()
    const log = logWalk(gitDir, MERGE)
    expect(log.map((c) => c.hash)).toEqual([MERGE, SIDE_A, SIDE_B, C1])
    expect(new Set(log.map((c) => c.hash)).size).toBe(4)
    expect(countObjects(gitDir)).toBe(10) // 6 个 tree/blob + 4 个 commit
  })

  it('同刻规则:时间戳相同的两支,先发现的在前——父一先于父二', () => {
    makeMerge()
    const order = logWalk(gitDir, MERGE).map((c) => c.hash)
    expect(order.indexOf(SIDE_A)).toBeLessThan(order.indexOf(SIDE_B))
  })

  it('排序看时间戳,不看图形状:起点比父旧时,父排在前面', () => {
    commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    const skewed = commitTree(gitDir, {
      tree: ROOT_TREE,
      parents: [C1],
      author: whoAt(1699990000), // 时钟倒挂:子比父还早
      message: '时钟倒挂\n',
    })
    expect(logWalk(gitDir, skewed).map((c) => c.hash)).toEqual([C1, skewed])
  })

  it('起点不是 commit、起点不存在,分别报错', () => {
    makeChain()
    expect(() => logWalk(gitDir, ROOT_TREE)).toThrow('不是 commit')
    expect(() => logWalk(gitDir, '0'.repeat(40))).toThrow('不存在')
  })
})

describe('改一笔,后代哈希全变', () => {
  it('只改根提交的消息,三代名字全换;旧对象一个不少地留在库里', () => {
    makeChain()
    const c1b = commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交(修订)\n' })
    const c2b = commitTree(gitDir, { tree: ROOT_TREE, parents: [c1b], author: whoAt(1700003600), message: '第二次提交\n' })
    const c3b = commitTree(gitDir, { tree: ROOT_TREE, parents: [c2b], author: whoAt(1700007200), message: '第三次提交\n' })
    expect(c1b).not.toBe(C1)
    expect(c2b).not.toBe(C2) // 消息与时间原样,只因父指针换了内容
    expect(c3b).not.toBe(C3)
    expect(readObject(gitDir, C3).type).toBe('commit') // 旧历史仍在,提交只进不改
    expect(countObjects(gitDir)).toBe(12) // 6 个 tree/blob + 新旧各 3 个 commit
  })
})

describe('mini-git 命令接线', () => {
  it('commit-tree 落根提交,输出与真 git 逐字符一致(-m 自动补收尾换行)', () => {
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    expect(runCli(['commit-tree', ROOT_TREE, '-m', '第一次提交'], work)).toBe(C1)
  })

  it('两次 -p 造出双父提交,哈希金样', () => {
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    expect(runCli(['commit-tree', ROOT_TREE, '-m', '第一次提交'], work)).toBe(C1)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    expect(runCli(['commit-tree', ROOT_TREE, '-p', C1, '-m', '左侧分支提交'], work)).toBe(SIDE_A)
    expect(runCli(['commit-tree', ROOT_TREE, '-p', C1, '-m', '右侧分支提交'], work)).toBe(SIDE_B)
    process.env.MINI_GIT_TIMESTAMP = '1700010800'
    expect(runCli(['commit-tree', ROOT_TREE, '-p', SIDE_A, '-p', SIDE_B, '-m', '合并两支'], work)).toBe(MERGE)
  })

  it('log 输出整段金样:时间倒序,同刻父一在前,消息缩进四格', () => {
    makeMerge()
    const entry = (hash: string, ts: number, msg: string) =>
      [`commit ${hash}`, 'Author: mini-git <mini-git@example.com>', `Date:   ${ts} +0800`, '', `    ${msg}`].join('\n')
    expect(runCli(['log', MERGE], work)).toBe(
      [
        entry(MERGE, 1700010800, '合并两支'),
        entry(SIDE_A, 1700003600, '左侧分支提交'),
        entry(SIDE_B, 1700003600, '右侧分支提交'),
        entry(C1, 1700000000, '第一次提交'),
      ].join('\n\n'),
    )
  })

  it('多行消息逐行缩进四格', () => {
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    const c1 = runCli(['commit-tree', ROOT_TREE, '-m', '两行\n消息'], work)
    expect(runCli(['log', c1], work)).toBe(
      [
        `commit ${c1}`,
        'Author: mini-git <mini-git@example.com>',
        'Date:   1700000000 +0800',
        '',
        '    两行',
        '    消息',
      ].join('\n'),
    )
  })

  it('cat-file -t 报 commit;-p 原文读回,与真 git 的 cat-file -p 同款', () => {
    makeChain()
    expect(runCli(['cat-file', '-t', C1], work)).toBe('commit')
    expect(runCli(['cat-file', '-p', C1], work)).toBe(C1_TEXT)
  })

  it('缺 -m、缺起点、没 init,给可读的报错', () => {
    expect(() => runCli(['commit-tree', ROOT_TREE], work)).toThrow('用法')
    expect(() => runCli(['log'], work)).toThrow('用法')
    mkdirSync(join(work, 'plain'))
    expect(() => runCli(['log', C1], join(work, 'plain'))).toThrow('mini-git init')
  })
})
