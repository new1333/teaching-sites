// tests/diff.test.ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diffLines, renderUnified, splitLines, type EditOp } from '../src/diff.ts'
import { initRepo } from '../src/objects.ts'
import { runCli } from '../src/cli.ts'

// 金样全部与真 git diff 对拍固化(git 2.53,core.autocrlf=false):
// 算法口径同为「最小行级编辑」,格式口径为 unified(diff-generate-patch / GNU diff)。
const HELLO = 'hello world\n'
const HELLO2 = 'hello world\nsecond line\n'

/** 把编辑脚本压成一行一记的紧凑形:保留 / 删 / 增。 */
function pretty(ops: readonly EditOp[]): string[] {
  return ops.map((o) => (o.op === 'context' ? `=${o.text}` : o.op === 'delete' ? `-${o.text}` : `+${o.text}`))
}

/** 20 行编号文本 L01..L20,@@ 头里的行号一眼可数。 */
function numbered(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `L${String(i + 1).padStart(2, '0')}`)
}

let work: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-diff-'))
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

describe('行拆分:splitLines', () => {
  it('以 \\n 切行,收尾换行不产生空行;空文件得到空数组', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('a')).toEqual(['a'])
    expect(splitLines('')).toEqual([])
  })
})

describe('编辑脚本:diffLines', () => {
  it('同一文本:全部是 context,一条 delete/insert 都没有', () => {
    const ops = diffLines(['alpha', 'beta', 'gamma'], ['alpha', 'beta', 'gamma'])
    expect(ops.map((o) => o.op)).toEqual(['context', 'context', 'context'])
  })

  it('改一行 = 相邻的一条 delete 加一条 insert,行号各记各的(金样数组)', () => {
    const ops = diffLines(['alpha', 'beta', 'gamma'], ['alpha', 'BETA', 'gamma'])
    expect(pretty(ops)).toEqual(['=alpha', '-beta', '+BETA', '=gamma'])
    expect(ops[1]).toMatchObject({ op: 'delete', aLine: 2, text: 'beta' }) // 旧文本第 2 行
    expect(ops[2]).toMatchObject({ op: 'insert', bLine: 2, text: 'BETA' }) // 新文本第 2 行
  })

  it('公共行按顺序保留(LCS 保序):删掉中间一行,前后行原样接上', () => {
    expect(pretty(diffLines(['alpha', 'beta', 'gamma', 'delta'], ['alpha', 'gamma']))).toEqual([
      '=alpha',
      '-beta',
      '=gamma',
      '-delta',
    ])
  })

  it('挪动三行 = 等量增删:先删后加,条数相等——算法不理解「挪动」(开篇现象)', () => {
    const old = ['a1', 'a2', 'a3', 'M1', 'M2', 'M3', 'z1', 'z2', 'z3']
    const now = ['a1', 'a2', 'a3', 'z1', 'z2', 'z3', 'M1', 'M2', 'M3']
    const ops = diffLines(old, now)
    expect(pretty(ops)).toEqual([
      '=a1', '=a2', '=a3',
      '-M1', '-M2', '-M3',
      '=z1', '=z2', '=z3',
      '+M1', '+M2', '+M3',
    ])
    const del = ops.filter((o) => o.op === 'delete').length
    const ins = ops.filter((o) => o.op === 'insert').length
    expect([del, ins]).toEqual([3, 3]) // 删三行加三行
  })

  it('行是原子单位:一行内改一个字符,也是整行 delete 加整行 insert', () => {
    const ops = diffLines(['cost = price * qty'], ['cost = price * qty0'])
    expect(pretty(ops)).toEqual(['-cost = price * qty', '+cost = price * qty0'])
  })

  it('边界:空对三行全是 insert;三行对空全是 delete;空对空没有操作', () => {
    expect(pretty(diffLines([], ['x', 'y', 'z']))).toEqual(['+x', '+y', '+z'])
    expect(pretty(diffLines(['x', 'y', 'z'], []))).toEqual(['-x', '-y', '-z'])
    expect(diffLines([], [])).toEqual([])
  })
})

describe('unified 渲染:renderUnified', () => {
  it('7 行文本改第 3 行:一个 hunk,前 2 后 3 上下文,越界的 end 不出现(对拍真 git)', () => {
    const old = ['title', 'intro', 'body', 'detail', 'summary', 'outro', 'end']
    const now = ['title', 'intro', 'BODY', 'detail', 'summary', 'outro', 'end']
    expect(renderUnified(diffLines(old, now))).toBe(
      ['@@ -1,6 +1,6 @@', ' title', ' intro', '-body', '+BODY', ' detail', ' summary', ' outro'].join('\n'),
    )
  })

  it('单行文件改唯一一行:两边条数都是 1,\",1\" 省略(对拍真 git)', () => {
    expect(renderUnified(diffLines(['only'], ['ONLY']))).toBe(['@@ -1 +1 @@', '-only', '+ONLY'].join('\n'))
  })

  it('末尾追加一行:上下文只往回取 3 行,@@ 头从第 2 行数起(对拍真 git)', () => {
    expect(renderUnified(diffLines(['one', 'two', 'three', 'four'], ['one', 'two', 'three', 'four', 'five']))).toBe(
      ['@@ -2,3 +2,4 @@', ' two', ' three', ' four', '+five'].join('\n'),
    )
  })

  it('空文件对三行:@@ -0,0 +1,3 @@ 全加号;三行对空:@@ -1,3 +0,0 @@ 全减号(对拍真 git)', () => {
    expect(renderUnified(diffLines([], ['x', 'y', 'z']))).toBe(['@@ -0,0 +1,3 @@', '+x', '+y', '+z'].join('\n'))
    expect(renderUnified(diffLines(['x', 'y', 'z'], []))).toBe(['@@ -1,3 +0,0 @@', '-x', '-y', '-z'].join('\n'))
  })

  it('两处改动隔着 6 行没变的行:上下文窗口相连,合并成一个 hunk(开篇现象)', () => {
    const old = numbered(20)
    const now = old.map((t, i) => (i === 1 ? 'CHANGED-A' : i === 8 ? 'CHANGED-B' : t)) // 改第 2、9 行
    expect(renderUnified(diffLines(old, now))).toBe(
      [
        '@@ -1,12 +1,12 @@',
        ' L01', '-L02', '+CHANGED-A',
        ' L03', ' L04', ' L05', ' L06', ' L07', ' L08',
        '-L09', '+CHANGED-B',
        ' L10', ' L11', ' L12',
      ].join('\n'),
    )
  })

  it('两处改动隔着 7 行没变的行:窗口够不着,拆成两个 hunk(对拍真 git)', () => {
    const old = numbered(20)
    const now = old.map((t, i) => (i === 1 ? 'CHANGED-A' : i === 9 ? 'CHANGED-B' : t)) // 改第 2、10 行
    expect(renderUnified(diffLines(old, now))).toBe(
      [
        '@@ -1,5 +1,5 @@',
        ' L01', '-L02', '+CHANGED-A', ' L03', ' L04', ' L05',
        '@@ -7,7 +7,7 @@',
        ' L07', ' L08', ' L09', '-L10', '+CHANGED-B', ' L11', ' L12', ' L13',
      ].join('\n'),
    )
  })

  it('完全相同的文本渲染成空字符串——没有改动就没有输出', () => {
    expect(renderUnified(diffLines(['a', 'b'], ['a', 'b']))).toBe('')
  })
})

describe('mini-git diff 命令', () => {
  it('无参数 = 工作区对暂存区:add 之后再改,红绿行当场可见(金样全文)', () => {
    initRepo(work)
    writeFileSync(join(work, 'a.txt'), HELLO)
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['commit', '-m', '第一次提交'], work)
    writeFileSync(join(work, 'a.txt'), HELLO2)
    expect(runCli(['diff'], work)).toBe(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1,2 @@',
        ' hello world',
        '+second line',
      ].join('\n'),
    )
  })

  it('--cached = 暂存区对 HEAD:同一时刻,无参数安静、--cached 有输出——两把尺子各量各的', () => {
    initRepo(work)
    writeFileSync(join(work, 'a.txt'), HELLO)
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['commit', '-m', '第一次提交'], work)
    writeFileSync(join(work, 'a.txt'), HELLO2)
    runCli(['add', 'a.txt'], work)
    expect(runCli(['diff'], work)).toBe('') // 工作区与暂存区一致
    expect(runCli(['diff', '--cached'], work)).toBe(
      [
        'diff --git a/a.txt b/a.txt',
        '--- a/a.txt',
        '+++ b/a.txt',
        '@@ -1 +1,2 @@',
        ' hello world',
        '+second line',
      ].join('\n'),
    )
  })

  it('工作区删掉文件:+++ 换成 /dev/null,整文件一条减号 hunk;未跟踪的新文件不出现', () => {
    initRepo(work)
    writeFileSync(join(work, 'gone.txt'), 'gone\n')
    runCli(['add', 'gone.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['commit', '-m', '第一次提交'], work)
    rmSync(join(work, 'gone.txt'))
    writeFileSync(join(work, 'untracked.txt'), '从未 add 过\n')
    expect(runCli(['diff'], work)).toBe(
      [
        'diff --git a/gone.txt b/gone.txt',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1 +0,0 @@',
        '-gone',
      ].join('\n'),
    )
  })

  it('unborn 分支上 --cached:HEAD 不存在,全部显示为新增(与真 git 同口径)', () => {
    initRepo(work)
    writeFileSync(join(work, 'a.txt'), HELLO)
    runCli(['add', 'a.txt'], work)
    expect(runCli(['diff', '--cached'], work)).toBe(
      [
        'diff --git a/a.txt b/a.txt',
        '--- /dev/null',
        '+++ b/a.txt',
        '@@ -0,0 +1 @@',
        '+hello world',
      ].join('\n'),
    )
  })

  it('干净仓库:两种口径都无输出;多个改动文件按路径排序,各自带头', () => {
    initRepo(work)
    writeFileSync(join(work, 'same.txt'), '一动不动\n')
    runCli(['add', 'same.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['commit', '-m', '第一次提交'], work)
    expect(runCli(['diff'], work)).toBe('')
    expect(runCli(['diff', '--cached'], work)).toBe('')
    writeFileSync(join(work, 'm1.txt'), 'v1\n')
    writeFileSync(join(work, 'm2.txt'), 'v1\n')
    runCli(['add', 'm1.txt', 'm2.txt'], work)
    writeFileSync(join(work, 'm1.txt'), 'v2\n')
    writeFileSync(join(work, 'm2.txt'), 'v2\n')
    expect(runCli(['diff'], work)).toBe(
      [
        'diff --git a/m1.txt b/m1.txt',
        '--- a/m1.txt',
        '+++ b/m1.txt',
        '@@ -1 +1 @@',
        '-v1',
        '+v2',
        'diff --git a/m2.txt b/m2.txt',
        '--- a/m2.txt',
        '+++ b/m2.txt',
        '@@ -1 +1 @@',
        '-v1',
        '+v2',
      ].join('\n'),
    )
  })

  it('不认识的开关与多余参数都报用法错误', () => {
    initRepo(work)
    expect(() => runCli(['diff', '--bogus'], work)).toThrow('用法:mini-git diff')
    expect(() => runCli(['diff', 'a.txt'], work)).toThrow('不收文件参数')
    expect(() => runCli(['diff', '--cached', '--cached'], work)).toThrow('至多一个')
  })
})
