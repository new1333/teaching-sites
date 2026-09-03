// tests/merge.test.ts
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initRepo, readObject, writeObject } from '../src/objects.ts'
import { writeTreeFromIndex } from '../src/trees.ts'
import { commitTree, parseCommit, type CommitIdentity } from '../src/commits.ts'
import { mergeBlobs, mergeCommits, mergeTrees } from '../src/merge.ts'
import { flattenTree } from '../src/index.ts'
import { readRef, resolveHead } from '../src/refs.ts'
import { runCli } from '../src/cli.ts'

const WHO: CommitIdentity = { name: 'mini-git', email: 'mini-git@example.com', timestamp: 1700000000, timezone: '+0800' }
const whoAt = (timestamp: number): CommitIdentity => ({ ...WHO, timestamp })

// 七行与十行的标准底稿;两侧改动都落在它上面
const SEVEN = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\n'
const TEN = 'l1\nl2\nl3\nl4\nl5\nl6\nl7\nl8\nl9\nl10\n'

// 金样:与真 git 对拍逐字符一致后才固化(对拍记录见 docs/09 演练节)
const SAME_LINE_CONFLICT = `one
<<<<<<< HEAD
TWO-OURS
=======
2-THEIRS
>>>>>>> dev
three
four
five
six
seven
`
const TOUCHING_CONFLICT = `one
<<<<<<< HEAD
TWO
=======
two
INSERTED
>>>>>>> dev
three
four
five
`
const DELETE_MODIFY_CONFLICT = `keep
<<<<<<< HEAD
=======
del1-X
del2
>>>>>>> dev
keep2
`

let work: string
let gitDir: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-merge-'))
  gitDir = initRepo(work)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 数对象库里的对象总数(递归 objects/xx),给「ff 不造提交」当实物证据。 */
function countObjects(): number {
  let n = 0
  for (const d of readdirSync(join(gitDir, 'objects'))) {
    n += readdirSync(join(gitDir, 'objects', d)).length
  }
  return n
}

/** 用「路径 → 文本」直接造一棵 tree 落库:blob 写对象、清单序列化,不碰工作区。 */
function makeTree(files: readonly (readonly [string, string])[]): string {
  return writeTreeFromIndex(
    gitDir,
    files.map(([path, text]) => ({
      ctimeSec: 0, ctimeNsec: 0, mtimeSec: 0, mtimeNsec: 0, dev: 0, ino: 0, uid: 0, gid: 0, size: 0,
      mode: 0o100644,
      hash: writeObject(gitDir, 'blob', Buffer.from(text, 'utf8')),
      flags: Buffer.byteLength(path, 'utf8'),
      path,
    })),
  )
}

const blobOf = (hash: string): string => readObject(gitDir, hash).body.toString('utf8')

describe('mergeBlobs:行对齐账上的判定', () => {
  it('两侧改不同区域:两处改动都自动合入,全文无任何标记;哪侧在前都一样', () => {
    const ours = SEVEN.replace('two\n', 'TWO-OURS\n')
    const theirs = SEVEN.replace('six\n', 'SIX-THEIRS\n')
    const want = SEVEN.replace('two\n', 'TWO-OURS\n').replace('six\n', 'SIX-THEIRS\n')
    expect(mergeBlobs(SEVEN, ours, theirs)).toEqual({ merged: want, conflicts: 0 })
    expect(mergeBlobs(SEVEN, theirs, ours)).toEqual({ merged: want, conflicts: 0 }) // 谁先谁后不改变判定
  })

  it('同一行双侧改法不同:产出与真 git 同格式的冲突标记(<<<<<<< HEAD / ======= / >>>>>>> dev)', () => {
    const ours = SEVEN.replace('two\n', 'TWO-OURS\n')
    const theirs = SEVEN.replace('two\n', '2-THEIRS\n')
    expect(mergeBlobs(SEVEN, ours, theirs, { ours: 'HEAD', theirs: 'dev' })).toEqual({
      merged: SAME_LINE_CONFLICT,
      conflicts: 1,
    })
  })

  it('双侧改得一模一样:自动采纳一份,不算冲突', () => {
    const both = SEVEN.replace('two\n', 'SAME\n')
    expect(mergeBlobs(SEVEN, both, both)).toEqual({ merged: both, conflicts: 0 })
    expect(mergeBlobs(SEVEN, SEVEN, SEVEN)).toEqual({ merged: SEVEN, conflicts: 0 }) // 都没动:原样
  })

  it('相触即冲突:ours 改第 2 行、theirs 在其后插入,挨着就没人敢自动定夺(严格在前才自动)', () => {
    const base = 'one\ntwo\nthree\nfour\nfive\n'
    const ours = base.replace('two\n', 'TWO\n')
    const theirs = base.replace('two\n', 'two\nINSERTED\n')
    expect(mergeBlobs(base, ours, theirs, { ours: 'HEAD', theirs: 'dev' })).toEqual({
      merged: TOUCHING_CONFLICT,
      conflicts: 1,
    })
  })

  it('同文件两处同改(间隔 5 行):两个冲突块,conflicts 计 2,标记成对出现', () => {
    const ours = TEN.replace('l2\n', 'A-OURS\n').replace('l8\n', 'B-OURS\n')
    const theirs = TEN.replace('l2\n', 'A-THEIRS\n').replace('l8\n', 'B-THEIRS\n')
    const result = mergeBlobs(TEN, ours, theirs, { ours: 'HEAD', theirs: 'dev' })
    expect(result.conflicts).toBe(2)
    expect(result.merged.match(/<<<<<<< HEAD/g)).toHaveLength(2)
    expect(result.merged.match(/=======$/gm)).toHaveLength(2)
    expect(result.merged.match(/>>>>>>> dev/g)).toHaveLength(2)
    expect(result.merged).toContain('A-OURS\n=======\nA-THEIRS')
    expect(result.merged).toContain('B-OURS\n=======\nB-THEIRS')
    expect(result.merged).toContain('l5\n') // 两块之间未动的行原样保留
  })

  it('删对改:ours 删两行、theirs 改其中一行——缺失一侧当空内容,空侧冲突块与真 git 逐字符一致', () => {
    const base = 'keep\ndel1\ndel2\nkeep2\n'
    const ours = 'keep\nkeep2\n'
    const theirs = 'keep\ndel1-X\ndel2\nkeep2\n'
    expect(mergeBlobs(base, ours, theirs, { ours: 'HEAD', theirs: 'dev' })).toEqual({
      merged: DELETE_MODIFY_CONFLICT,
      conflicts: 1,
    })
  })

  it('标签口径:两翼标记行写的是传入的标签;base 为空且双侧各添不同内容,整文件成一块冲突(add/add)', () => {
    const result = mergeBlobs('', 'ours version\n', 'theirs version\n', { ours: 'main', theirs: 'feature/x' })
    expect(result).toEqual({
      merged: `<<<<<<< main\nours version\n=======\ntheirs version\n>>>>>>> feature/x\n`,
      conflicts: 1,
    })
  })
})

describe('mergeTrees:按路径逐文件判', () => {
  it('不同文件各改一处:全部自动合入,conflicts 为空,合并树里两处改动都在', () => {
    const base = makeTree([
      ['a.txt', SEVEN],
      ['b.txt', 'b-one\nb-two\n'],
    ])
    const ours = makeTree([
      ['a.txt', SEVEN.replace('two\n', 'TWO-OURS\n')],
      ['b.txt', 'b-one\nb-two\n'],
    ])
    const theirs = makeTree([
      ['a.txt', SEVEN],
      ['b.txt', 'b-one\nB-THEIRS\n'],
    ])
    const merged = mergeTrees(gitDir, base, ours, theirs)
    expect(merged.conflicts).toEqual([])
    const files = flattenTree(gitDir, merged.tree)
    expect([...files.keys()].sort()).toEqual(['a.txt', 'b.txt'])
    expect(blobOf(files.get('a.txt')!.hash)).toBe(SEVEN.replace('two\n', 'TWO-OURS\n'))
    expect(blobOf(files.get('b.txt')!.hash)).toBe('b-one\nB-THEIRS\n')
  })

  it('同文件同区域:路径进 conflicts,合并树里该路径的 blob 含标记', () => {
    const base = makeTree([['notes.txt', SEVEN]])
    const ours = makeTree([['notes.txt', SEVEN.replace('two\n', 'TWO-OURS\n')]])
    const theirs = makeTree([['notes.txt', SEVEN.replace('two\n', '2-THEIRS\n')]])
    const merged = mergeTrees(gitDir, base, ours, theirs, { ours: 'HEAD', theirs: 'dev' })
    expect(merged.conflicts).toEqual(['notes.txt'])
    expect(blobOf(flattenTree(gitDir, merged.tree).get('notes.txt')!.hash)).toBe(SAME_LINE_CONFLICT)
  })

  it('单侧新增与单侧删除:只有一侧动过的路径,那一侧说了算', () => {
    const base = makeTree([['old.txt', 'old\n']])
    const added = mergeTrees(gitDir, base, makeTree([['old.txt', 'old\n'], ['added.txt', 'new stuff\n']]), base)
    expect([...flattenTree(gitDir, added.tree).keys()].sort()).toEqual(['added.txt', 'old.txt']) // ours 新增:保留
    const deleted = mergeTrees(gitDir, base, makeTree([['added.txt', 'new stuff\n']]), makeTree([['old.txt', 'old\n']]))
    expect([...flattenTree(gitDir, deleted.tree).keys()].sort()).toEqual(['added.txt']) // ours 删除 old.txt:树里没有了
  })

  it('双侧新增同一文件:内容相同自动合入一份,内容不同整文件冲突', () => {
    const base = makeTree([])
    const same = mergeTrees(gitDir, base, makeTree([['new.txt', 'same\n']]), makeTree([['new.txt', 'same\n']]))
    expect(same.conflicts).toEqual([])
    expect(blobOf(flattenTree(gitDir, same.tree).get('new.txt')!.hash)).toBe('same\n')
    const diff = mergeTrees(gitDir, base, makeTree([['new.txt', 'ours\n']]), makeTree([['new.txt', 'theirs\n']]))
    expect(diff.conflicts).toEqual(['new.txt'])
  })
})

describe('mergeCommits:第 8 章判定表的三个格子', () => {
  it('落后方合领先方 ⇒ fast-forward;领先方合落后方 ⇒ up-to-date——同一张图两问', () => {
    const c1 = commitTree(gitDir, { tree: makeTree([]), parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    const c2 = commitTree(gitDir, { tree: makeTree([]), parents: [c1], author: whoAt(1700003600), message: '第二次提交\n' })
    expect(mergeCommits(gitDir, c1, c2, { author: WHO })).toEqual({ kind: 'fast-forward', to: c2 })
    expect(mergeCommits(gitDir, c2, c1, { author: WHO })).toEqual({ kind: 'up-to-date' })
    expect(mergeCommits(gitDir, c2, c2, { author: WHO })).toEqual({ kind: 'up-to-date' }) // 相等是 up-to-date 的退化情形
  })

  it('分叉真合并:产出的提交带两个父,顺序恰为 [ours, theirs]', () => {
    const c1 = commitTree(gitDir, { tree: makeTree([]), parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    const left = commitTree(gitDir, { tree: makeTree([]), parents: [c1], author: whoAt(1700003600), message: '左侧\n' })
    const right = commitTree(gitDir, { tree: makeTree([]), parents: [c1], author: whoAt(1700003600), message: '右侧\n' })
    const outcome = mergeCommits(gitDir, left, right, { author: whoAt(1700010800), message: '合并两支\n' })
    expect(outcome.kind).toBe('merged')
    if (outcome.kind !== 'merged') {
      throw new Error('不可能:上一行已断言')
    }
    const commit = parseCommit(readObject(gitDir, outcome.commit).body)
    expect(commit.parents).toEqual([left, right])
    expect(commit.message).toBe('合并两支\n')
    expect(commit.tree).toBe(outcome.tree)
  })

  it('不相连的历史:给不出 base,报错点名公共祖先', () => {
    const a = commitTree(gitDir, { tree: makeTree([]), parents: [], author: WHO, message: '根一\n' })
    const b = commitTree(gitDir, { tree: makeTree([]), parents: [], author: WHO, message: '根二\n' })
    expect(() => mergeCommits(gitDir, a, b, { author: WHO })).toThrow('公共祖先')
  })
})

describe('mini-git merge 命令', () => {
  /** 建分叉:base(两文件)→ main 改 a.txt、dev 改 b.txt;返回两分支尖端。 */
  function forkedBranches(oursText: string, theirsText: string): { main: string; dev: string } {
    writeFileSync(join(work, 'a.txt'), SEVEN)
    writeFileSync(join(work, 'b.txt'), 'b-one\nb-two\n')
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['add', 'a.txt', 'b.txt'], work)
    runCli(['commit', '-m', '第一次提交'], work)
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), oursText)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'main 的改动'], work)
    const main = resolveHead(gitDir)!
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'b.txt'), theirsText)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['add', 'b.txt'], work)
    runCli(['commit', '-m', 'dev 的改动'], work)
    const dev = resolveHead(gitDir)!
    runCli(['checkout', 'main'], work)
    return { main, dev }
  }

  it('不同文件各改一处:合并完成,工作区两处都在,log 首条带两个父,dev 引用不动', () => {
    const { main, dev } = forkedBranches(SEVEN.replace('two\n', 'TWO-OURS\n'), 'b-one\nB-THEIRS\n')
    const out = runCli(['merge', 'dev'], work)
    expect(out).toContain('合并完成')
    expect(out).toContain('双父')
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe(SEVEN.replace('two\n', 'TWO-OURS\n'))
    expect(readFileSync(join(work, 'b.txt'), 'utf8')).toBe('b-one\nB-THEIRS\n')
    const head = resolveHead(gitDir)!
    expect(head).not.toBe(main)
    const commit = parseCommit(readObject(gitDir, head).body)
    expect(commit.parents).toEqual([main, dev])
    expect(readRef(gitDir, 'refs/heads/dev')).toBe(dev) // 被合一方的引用不动
    expect(runCli(['log', resolveHead(gitDir)!], work)).toContain('dev 的改动') // log 沿双父能走到两边
  })

  it('同文件不同区域:自动合入无标记,一样产双父提交', () => {
    forkedBranches(SEVEN.replace('two\n', 'TWO-OURS\n'), 'b-one\nB-THEIRS\n')
    // dev 上也改 a.txt 的另一区域,制造「同文件两处」
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('six\n', 'SIX-THEIRS\n'))
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'dev 也改 a.txt'], work)
    runCli(['checkout', 'main'], work)
    const out = runCli(['merge', 'dev'], work)
    expect(out).toContain('合并完成')
    const merged = readFileSync(join(work, 'a.txt'), 'utf8')
    expect(merged).toBe(SEVEN.replace('two\n', 'TWO-OURS\n').replace('six\n', 'SIX-THEIRS\n'))
    expect(merged.includes('<<<')).toBe(false)
    expect(parseCommit(readObject(gitDir, resolveHead(gitDir)!).body).parents).toHaveLength(2)
  })

  it('同区域双改:冲突标记写进工作区,分支引用不动,status 把带标记内容登记为已暂存', () => {
    const { main } = forkedBranches(SEVEN.replace('two\n', 'TWO-OURS\n'), 'b-one\nB-THEIRS\n')
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('two\n', '2-THEIRS\n'))
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'dev 改同一行'], work)
    runCli(['checkout', 'main'], work)
    const out = runCli(['merge', 'dev'], work)
    expect(out).toContain('自动合并失败')
    expect(out).toContain('a.txt')
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe(SAME_LINE_CONFLICT)
    expect(resolveHead(gitDir)).toBe(main) // HEAD 没动:没有生成任何提交
    const status = runCli(['status'], work)
    expect(status).toContain('已暂存的变更')
    expect(status).toContain('修改:a.txt') // 带标记内容已登记进暂存区(mini-git 口径,差异附录)
    expect(status).not.toContain('未暂存的变更')
  })

  it('冲突后的收尾:手工改平标记再 add + commit,出来的是单父提交(mini-git 不记 MERGE_HEAD 的口径)', () => {
    forkedBranches(SEVEN.replace('two\n', 'TWO-OURS\n'), 'b-one\nB-THEIRS\n')
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('two\n', '2-THEIRS\n'))
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'dev 改同一行'], work)
    runCli(['checkout', 'main'], work)
    runCli(['merge', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('two\n', '手工定的稿\n'))
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700007200'
    runCli(['commit', '-m', '解决冲突'], work)
    const commit = parseCommit(readObject(gitDir, resolveHead(gitDir)!).body)
    expect(commit.parents).toHaveLength(1)
    expect(runCli(['status'], work)).toContain('干净')
  })

  it('ff 短路:落后方合领先方只挪引用,不造提交——对象库一个对象都没多', () => {
    writeFileSync(join(work, 'a.txt'), SEVEN)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', '第一次提交'], work)
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('two\n', 'TWO\n'))
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'main 前进'], work)
    const main = resolveHead(gitDir)!
    runCli(['checkout', 'dev'], work)
    const before = countObjects()
    const out = runCli(['merge', 'main'], work)
    expect(out).toContain('Fast-forward')
    expect(readRef(gitDir, 'refs/heads/dev')).toBe(main) // 指针挪到 main 尖端
    expect(countObjects()).toBe(before) // 没有新 commit、tree、blob
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe(SEVEN.replace('two\n', 'TWO\n')) // 工作区检成目标
    expect(runCli(['log', resolveHead(gitDir)!], work).match(/commit [0-9a-f]{40}/g)).toHaveLength(2)
  })

  it('up-to-date:领先方合落后方,原样照抄 git 的 Already up to date.,引用与文件都不动', () => {
    writeFileSync(join(work, 'a.txt'), SEVEN)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', '第一次提交'], work)
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), SEVEN.replace('two\n', 'TWO\n'))
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', 'main 前进'], work)
    const main = resolveHead(gitDir)!
    const out = runCli(['merge', 'dev'], work)
    expect(out).toBe('Already up to date.')
    expect(resolveHead(gitDir)).toBe(main)
    expect(readRef(gitDir, 'refs/heads/dev')).not.toBe(main)
  })

  it('detached HEAD 上拒绝合并;不存在的分支、参数个数不对、不认识的开关,各报各的错', () => {
    writeFileSync(join(work, 'a.txt'), SEVEN)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['add', 'a.txt'], work)
    runCli(['commit', '-m', '第一次提交'], work)
    runCli(['branch', 'dev'], work)
    runCli(['checkout', resolveHead(gitDir)!], work)
    expect(() => runCli(['merge', 'dev'], work)).toThrow('detached')
    runCli(['checkout', 'main'], work)
    expect(() => runCli(['merge', 'nope'], work)).toThrow('不存在')
    expect(() => runCli(['merge'], work)).toThrow('用法')
    expect(() => runCli(['merge', 'dev', 'dev'], work)).toThrow('用法')
    expect(() => runCli(['merge', '--no-ff', 'dev'], work)).toThrow('用法')
    expect(() => runCli(['merge', 'dev'], join(work, 'nowhere'))).toThrow('mini-git init')
  })
})
