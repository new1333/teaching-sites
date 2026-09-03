// tests/graph.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initRepo } from '../src/objects.ts'
import { writeTree } from '../src/trees.ts'
import { commitTree, type CommitIdentity } from '../src/commits.ts'
import { ancestorSet, isAncestor, mergeBase } from '../src/graph.ts'
import { updateRef } from '../src/refs.ts'
import { runCli } from '../src/cli.ts'

// 金样哈希:传承第 3-4 章同一套 fixture(同 tree、同身份、同时间戳、同消息)。
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 第 3 章三层 fixture 的根
const C1 = 'bf05977bd740a2b2fa530935475587501704d0cc' // 根提交,ts 1700000000
const C2 = '4e5eeac14bd4ba9f270ad6fea4858fa65f47c39b' // 第二次提交,ts 1700003600
const C3 = '273a317c713b8e6450d5bb7e4eeaafe320827599' // 第三次提交,ts 1700007200
const SIDE_A = '4be7b24bd163591878b10519bdcb3fc8b2ed9bfe' // 左分支提交,ts 1700003600
const SIDE_B = '55e2ac93dc1b4fa6dd9974a57b62eb3e81e5b429' // 右分支提交,同刻 1700003600
const MERGE = '325b55d8cd52888b7a935cbda3d0e9ccfa6516e6' // 双父合并提交,ts 1700010800

const WHO: CommitIdentity = { name: 'mini-git', email: 'mini-git@example.com', timestamp: 1700000000, timezone: '+0800' }
const whoAt = (timestamp: number): CommitIdentity => ({ ...WHO, timestamp })

let work: string
let gitDir: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-graph-'))
  gitDir = initRepo(work)
  writeFileSync(join(work, 'a.txt'), 'hello world\n')
  writeFileSync(join(work, 'lib.txt'), 'note\n')
  mkdirSync(join(work, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(work, 'lib', 'util.txt'), 'util\n')
  writeFileSync(join(work, 'lib', 'deep', 'leaf.txt'), 'hello world\n')
  writeTree(gitDir, work) // 根 tree 落库,即 ROOT_TREE
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
})

/** 造链:C1 → C2 → C3(同 tree、递增时间戳)。 */
function makeChain(): void {
  commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '第二次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C2], author: whoAt(1700007200), message: '第三次提交\n' })
}

/** 造分叉合并:C1 分出 SIDE_A、SIDE_B 两支,再合成双父 MERGE。 */
function makeMerge(): string {
  commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '左侧分支提交\n' })
  commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '右侧分支提交\n' })
  return commitTree(gitDir, {
    tree: ROOT_TREE,
    parents: [SIDE_A, SIDE_B],
    author: whoAt(1700010800),
    message: '合并两支\n',
  })
}

/** 造菱形:MERGE 之后再分叉出 D1、D2——merge-base 唯一性的标准考题。 */
function makeDiamond(): { d1: string; d2: string; m: string } {
  const m = makeMerge()
  const d1 = commitTree(gitDir, { tree: ROOT_TREE, parents: [m], author: whoAt(1700014400), message: '菱形左侧\n' })
  const d2 = commitTree(gitDir, { tree: ROOT_TREE, parents: [m], author: whoAt(1700014400), message: '菱形右侧\n' })
  return { d1, d2, m }
}

/** 造 criss-cross 简化形:C1 分出 X1、X2,再互相合并出 M1(先 X1 后 X2)与 M2(先 X2 后 X1)。 */
function makeCrissCross(laterStamp: boolean): { x1: string; x2: string; m1: string; m2: string } {
  commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
  const x1 = commitTree(gitDir, { tree: ROOT_TREE, parents: [C1], author: whoAt(1700003600), message: '交叉左侧\n' })
  const x2 = commitTree(gitDir, {
    tree: ROOT_TREE,
    parents: [C1],
    author: whoAt(laterStamp ? 1700007200 : 1700003600),
    message: '交叉右侧\n',
  })
  const m1 = commitTree(gitDir, { tree: ROOT_TREE, parents: [x1, x2], author: whoAt(1700014400), message: '交叉合并一\n' })
  const m2 = commitTree(gitDir, { tree: ROOT_TREE, parents: [x2, x1], author: whoAt(1700018000), message: '交叉合并二\n' })
  return { x1, x2, m1, m2 }
}

/** 用祖先关系当尺子,推 merge 的三种结局——测试版的「git 在判什么」。current 是 HEAD 所在侧。 */
function mergeOutcome(current: string, incoming: string): 'fast-forward' | 'already-up-to-date' | '真合并' {
  if (isAncestor(gitDir, incoming, current)) {
    return 'already-up-to-date' // 对方已在我怀里:nothing to do
  }
  if (isAncestor(gitDir, current, incoming)) {
    return 'fast-forward' // 我是对方的祖先:挪指针就够
  }
  return '真合并' // 互不包含:只能生成新提交
}

describe('ancestorSet:可达集', () => {
  it('链:从 C3 出发收到全部三代,起点自身也在集合里——「可达」含起点', () => {
    makeChain()
    expect([...ancestorSet(gitDir, C3)].sort()).toEqual([C3, C2, C1]) // 字典序:273a < 4e5e < bf05
    expect([...ancestorSet(gitDir, C2)].sort()).toEqual([C2, C1])
    expect(ancestorSet(gitDir, C3).has(C3)).toBe(true) // 自己可达自己,相等判定的地基
  })

  it('分叉:SIDE_A 可达集 = {SIDE_A, C1};与 SIDE_B 的可达集交集恰是 {C1}', () => {
    makeMerge()
    expect([...ancestorSet(gitDir, SIDE_A)].sort()).toEqual([SIDE_A, C1]) // 4be7 < bf05
    const inter = [...ancestorSet(gitDir, SIDE_A)].filter((h) => ancestorSet(gitDir, SIDE_B).has(h))
    expect(inter).toEqual([C1])
  })

  it('双父:从 MERGE 出发,四笔提交各收一次,集合大小恰 4', () => {
    makeMerge()
    const set = ancestorSet(gitDir, MERGE)
    expect(set.size).toBe(4)
    expect(set.has(SIDE_A)).toBe(true)
    expect(set.has(SIDE_B)).toBe(true)
    expect(set.has(C1)).toBe(true)
  })

  it('起点不是 commit、起点不存在,分别报错', () => {
    makeChain()
    expect(() => ancestorSet(gitDir, ROOT_TREE)).toThrow('不是 commit')
    expect(() => ancestorSet(gitDir, '0'.repeat(40))).toThrow('不存在')
  })
})

describe('isAncestor:一把只答是否的尺', () => {
  it('链上有方向:C1 是 C3 的祖先,反过来不是', () => {
    makeChain()
    expect(isAncestor(gitDir, C1, C3)).toBe(true)
    expect(isAncestor(gitDir, C3, C1)).toBe(false)
    expect(isAncestor(gitDir, C2, C3)).toBe(true)
  })

  it('自反:每笔提交都是自己的祖先——git merge-base --is-ancestor 对 A A 也答是', () => {
    makeChain()
    expect(isAncestor(gitDir, C1, C1)).toBe(true)
    expect(isAncestor(gitDir, C3, C3)).toBe(true)
  })

  it('兄弟不算:SIDE_A 与 SIDE_B 互不为祖先;分叉点 C1 是两边共同的祖先', () => {
    makeMerge()
    expect(isAncestor(gitDir, SIDE_A, SIDE_B)).toBe(false)
    expect(isAncestor(gitDir, SIDE_B, SIDE_A)).toBe(false)
    expect(isAncestor(gitDir, C1, SIDE_A)).toBe(true)
    expect(isAncestor(gitDir, C1, SIDE_B)).toBe(true)
  })

  it('经双父的任一条边都算:C1 是 MERGE 的祖先,两条路殊途同归', () => {
    makeMerge()
    expect(isAncestor(gitDir, C1, MERGE)).toBe(true)
    expect(isAncestor(gitDir, SIDE_A, MERGE)).toBe(true)
    expect(isAncestor(gitDir, MERGE, SIDE_A)).toBe(false) // 方向依旧单向
  })
})

describe('mergeBase:最近公共祖先', () => {
  it('链:一方是另一方祖先时,base 就是祖先本身——mergeBase(C3, C2) = C2', () => {
    makeChain()
    expect(mergeBase(gitDir, C3, C2)).toBe(C2)
    expect(mergeBase(gitDir, C2, C3)).toBe(C2) // 与参数顺序无关
  })

  it('分叉:mergeBase(SIDE_A, SIDE_B) = C1,正是分叉点;参数交换不变', () => {
    makeMerge()
    expect(mergeBase(gitDir, SIDE_A, SIDE_B)).toBe(C1)
    expect(mergeBase(gitDir, SIDE_B, SIDE_A)).toBe(C1)
  })

  it('相等:mergeBase(C1, C1) = C1——自己和自己,公共祖先是自己', () => {
    makeChain()
    expect(mergeBase(gitDir, C1, C1)).toBe(C1)
  })

  it('菱形(双父 merge 后再分叉):mergeBase(D1, D2) = MERGE,唯一,不再退回 C1', () => {
    const { d1, d2, m } = makeDiamond()
    expect(mergeBase(gitDir, d1, d2)).toBe(m)
    expect(mergeBase(gitDir, d2, d1)).toBe(m)
  })

  it('菱形的斜交:mergeBase(D1, SIDE_A) = SIDE_A——穿过一条 merge 边的包含关系', () => {
    const { d1 } = makeDiamond()
    expect(mergeBase(gitDir, d1, SIDE_A)).toBe(SIDE_A)
  })

  it('criss-cross 简化形:X1、X2 都是并列的最好候选,mini-git 钉死取时间戳最新的 X2', () => {
    const { x1, x2, m1, m2 } = makeCrissCross(true)
    expect(isAncestor(gitDir, x1, x2)).toBe(false) // 谁也不挡谁:两个都是最好的候选
    expect(isAncestor(gitDir, x2, x1)).toBe(false)
    expect(mergeBase(gitDir, m1, m2)).toBe(x2) // mini-git 的声明取法:交集中时间戳最新者
  })

  it('criss-cross 同刻并列:取哈希字典序最小者——多候选时也永远是确定值', () => {
    const { x1, x2, m1, m2 } = makeCrissCross(false)
    expect(mergeBase(gitDir, m1, m2)).toBe(x1 < x2 ? x1 : x2)
  })

  it('不相连的历史:两个根没有公共祖先,返回 null', () => {
    commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    const other = commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '另一个根\n' })
    expect(mergeBase(gitDir, C1, other)).toBe(null)
    expect(mergeBase(gitDir, other, C1)).toBe(null)
  })
})

describe('ff 判定:祖先关系换算成 merge 的三种结局', () => {
  it('落后方合领先方 ⇒ fast-forward:dev 在 C1、main 在 C3,main 可达自 dev 的检查通过', () => {
    makeChain()
    updateRef(gitDir, 'refs/heads/main', C3)
    updateRef(gitDir, 'refs/heads/dev', C1)
    expect(mergeOutcome(C1, C3)).toBe('fast-forward') // 在 dev 上 merge main:指针前移,无新提交
  })

  it('领先方合落后方 ⇒ Already up to date;相等是它的退化情形', () => {
    makeChain()
    updateRef(gitDir, 'refs/heads/main', C3)
    updateRef(gitDir, 'refs/heads/dev', C1)
    expect(mergeOutcome(C3, C1)).toBe('already-up-to-date') // 在 main 上 merge dev:要合的都已在怀里
    expect(mergeOutcome(C3, C3)).toBe('already-up-to-date') // 两指针同点:同一个判定吞下相等
  })

  it('兄弟分叉 ⇒ 只能真合并:互不包含时 ff 与 up-to-date 都不成立', () => {
    makeMerge()
    updateRef(gitDir, 'refs/heads/main', SIDE_A)
    updateRef(gitDir, 'refs/heads/dev', SIDE_B)
    expect(mergeOutcome(SIDE_A, SIDE_B)).toBe('真合并') // 两边各有独有提交,必须生成带双父的新提交
  })
})

describe('mini-git merge-base 命令', () => {
  it('分叉上 merge-base main dev 输出 C1;参数给 40 位哈希,结果相同', () => {
    makeMerge()
    updateRef(gitDir, 'refs/heads/main', SIDE_A)
    updateRef(gitDir, 'refs/heads/dev', SIDE_B)
    expect(runCli(['merge-base', 'main', 'dev'], work)).toBe(C1)
    expect(runCli(['merge-base', SIDE_A, SIDE_B], work)).toBe(C1)
  })

  it('--is-ancestor:链上问「C2 是 C3 的祖先吗」答是;反着问答否;自己问自己答是', () => {
    makeChain()
    expect(runCli(['merge-base', '--is-ancestor', C2, C3], work)).toBe('是')
    expect(runCli(['merge-base', '--is-ancestor', C3, C2], work)).toBe('否')
    expect(runCli(['merge-base', '--is-ancestor', C1, C1], work)).toBe('是')
  })

  it('没有公共祖先报错;不存在的分支、一个或三个参数、不认识的开关,各报各的错', () => {
    commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '第一次提交\n' })
    const other = commitTree(gitDir, { tree: ROOT_TREE, parents: [], author: whoAt(1700000000), message: '另一个根\n' })
    expect(() => runCli(['merge-base', C1, other], work)).toThrow('公共祖先')
    expect(() => runCli(['merge-base', C1, 'nope'], work)).toThrow('既不是')
    expect(() => runCli(['merge-base', C1], work)).toThrow('用法')
    expect(() => runCli(['merge-base', C1, other, C1], work)).toThrow('用法')
    expect(() => runCli(['merge-base', '--ff-only', C1, other], work)).toThrow('用法')
    mkdirSync(join(work, 'plain'))
    expect(() => runCli(['merge-base', C1, other], join(work, 'plain'))).toThrow('mini-git init')
  })
})
