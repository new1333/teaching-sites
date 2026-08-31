// tests/interop.test.ts
// 与真 git 的互操作对拍(全书收尾验收):mini-git 从零建的仓库,真 git 逐对象读;
// 反过来,真 git 建的对象与 index,mini-git 原样读回。
// 守卫式:机器上没有 git 时整套对拍显示为 skipped,而不是失败——
// 全书 211 条测试不依赖真 git,只有这一章的对拍用它当裁判。
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initRepo } from '../src/objects.ts'
import { resolveHead } from '../src/refs.ts'
import { logWalk } from '../src/commits.ts'
import { runCli } from '../src/cli.ts'

/** 探测环境里有没有真 git 可用:找不到可执行文件(ENOENT)或跑不动,都算没有。 */
function gitAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    return spawnSync('git', ['--version'], { encoding: 'utf8', timeout: 10_000, env }).status === 0
  } catch {
    return false
  }
}

/** 跑真 git;一律带 -c core.autocrlf=false(第 2 章口径:拿原始字节,不吃行尾转换)。 */
function git(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).toString()
}

/** 真 git 侧固定身份与日期:提交哈希金样可复现,不偷看机器配置。 */
const REAL_GIT_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: 'mini-git',
  GIT_AUTHOR_EMAIL: 'mini-git@example.com',
  GIT_COMMITTER_NAME: 'mini-git',
  GIT_COMMITTER_EMAIL: 'mini-git@example.com',
}

describe('守卫:没有 git 的机器上,对拍显式跳过', () => {
  it('PATH 里找不到 git 时,探测返回 false(整套对拍报告 skipped 而非失败)', () => {
    expect(gitAvailable({ ...process.env, PATH: join(tmpdir(), 'no-git-in-this-dir') })).toBe(false)
  })
})

describe.skipIf(!gitAvailable())('正方向:mini-git 建仓库,真 git 验货', () => {
  let work: string
  let gitDir: string
  let c1: string
  let c2: string
  let c3: string
  let m: string

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'mini-git-interop-'))
    gitDir = initRepo(work)
    mkdirSync(join(work, 'lib'), { recursive: true })
    writeFileSync(join(work, 'a.txt'), 'one\n')
    writeFileSync(join(work, 'lib', 'b.txt'), 'two\n')
    runCli(['add', 'a.txt'], work)
    runCli(['add', 'lib/b.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    runCli(['commit', '-m', '第一次提交'], work)
    c1 = resolveHead(gitDir)!
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), 'one\ntwo\n')
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['commit', '-m', 'main 前进'], work)
    c2 = resolveHead(gitDir)!
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'lib', 'b.txt'), 'two\ndev\n')
    runCli(['add', 'lib/b.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700007200'
    runCli(['commit', '-m', 'dev 前进'], work)
    c3 = resolveHead(gitDir)!
    runCli(['checkout', 'main'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700010800'
    runCli(['merge', 'dev'], work)
    m = resolveHead(gitDir)!
  })

  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
    delete process.env.MINI_GIT_TIMESTAMP
  })

  it('同一批输入,四笔提交的名字都是金样:跨机器逐字符相同(含 merge 提交)', () => {
    expect(c1).toBe('91ad33a8c5025a6630eaadc4e93e4104a0e3fcfc')
    expect(c2).toBe('f5c9d68f5a557d959dbee4bc7ce993763e8210ba')
    expect(c3).toBe('fa63246a6f955e1ec9a3761c422f6fd0be2a7457')
    expect(m).toBe('6de8bcd52a71e1dd776cf5b0e5c2fdaa7ab2e4a9')
  })

  it('cat-file 逐个读对象:三种类型认得,blob 原文一致,tree/commit 与 mini-git 自己的渲染逐字符一致', () => {
    const commitText = git(['cat-file', '-p', m], work)
    const rootTree = /^tree ([0-9a-f]{40})$/m.exec(commitText)![1]
    expect(git(['cat-file', '-t', c1], work)).toBe('commit\n')
    expect(git(['cat-file', '-t', rootTree], work)).toBe('tree\n')
    // tree 的渲染不带收尾换行,真 git 的输出带;commit 的对象文本自带收尾换行,两边逐字符相等
    expect(git(['cat-file', '-p', rootTree], work)).toBe(runCli(['cat-file', '-p', rootTree], work) + '\n')
    expect(git(['cat-file', '-p', c1], work)).toBe(runCli(['cat-file', '-p', c1], work))
    expect(git(['cat-file', '-p', m], work)).toContain(`parent ${c2}`)
    expect(git(['cat-file', '-p', m], work)).toContain(`parent ${c3}`)
    // main 前进后 a.txt 的 blob:原文一字不差
    const c2Text = git(['cat-file', '-p', c2], work)
    const c2Tree = /^tree ([0-9a-f]{40})$/m.exec(c2Text)![1]
    const aHash = /^100644 blob ([0-9a-f]{40})\ta\.txt$/m.exec(git(['cat-file', '-p', c2Tree], work))![1]
    expect(git(['cat-file', '-p', aHash], work)).toBe('one\ntwo\n')
  }, 30_000)

  it('log 走完整历史:顺序与消息和 mini-git 的 logWalk 一致,双父合并出现在最前', () => {
    const subjects = git(['log', '--format=%s', 'main'], work).trim().split('\n')
    expect(subjects).toEqual(["Merge branch 'dev'", 'dev 前进', 'main 前进', '第一次提交'])
    expect(logWalk(gitDir, m).map((e) => e.message.trimEnd())).toEqual(subjects)
  }, 30_000)

  it('rev-parse 读引用:main/dev/HEAD 与 mini-git 的 readRef 同答;merge-base 也同答', () => {
    expect(git(['rev-parse', 'main'], work).trim()).toBe(m)
    expect(git(['rev-parse', 'dev'], work).trim()).toBe(c3)
    expect(git(['rev-parse', 'HEAD'], work).trim()).toBe(m)
    // dev 已并入 main:两尖端的最近公共祖先正是 dev 自己
    expect(git(['merge-base', 'main', 'dev'], work).trim()).toBe(c3)
  }, 30_000)

  it('fsck --strict 全面体检:零输出通过——对象、tree 条目排序、引用、连通性一并过审', () => {
    expect(git(['fsck', '--strict'], work)).toBe('')
  }, 30_000)

  it('拷走 .git 等于带走整个仓库:只复制 .git 到空目录,真 git 照样走完历史;工作区文件不在其中', () => {
    const away = mkdtempSync(join(tmpdir(), 'mini-git-interop-away-'))
    try {
      mkdirSync(join(away, 'repo'), { recursive: true })
      cpSync(gitDir, join(away, 'repo', '.git'), { recursive: true })
      expect(git(['log', '--oneline', 'main'], join(away, 'repo'))).toBe(
        git(['log', '--oneline', 'main'], work),
      )
      // 历史全在,文件没有:status 只报工作区的删除,不报任何对象错误
      expect(git(['status', '--short'], join(away, 'repo'))).toBe(' D a.txt\n D lib/b.txt\n')
    } finally {
      rmSync(away, { recursive: true, force: true })
    }
  }, 30_000)

  it('真 git 的接纳不是无条件:删掉一个 blob 对象,cat-file 当场翻车', () => {
    const c2Text = git(['cat-file', '-p', c2], work)
    const c2Tree = /^tree ([0-9a-f]{40})$/m.exec(c2Text)![1]
    const aHash = /^100644 blob ([0-9a-f]{40})\ta\.txt$/m.exec(git(['cat-file', '-p', c2Tree], work))![1]
    const away = mkdtempSync(join(tmpdir(), 'mini-git-interop-away-'))
    try {
      mkdirSync(join(away, 'repo'), { recursive: true })
      cpSync(gitDir, join(away, 'repo', '.git'), { recursive: true })
      const obj = join(away, 'repo', '.git', 'objects', aHash.slice(0, 2), aHash.slice(2))
      rmSync(obj)
      // 名字即内容的封条:对象不在名字说的地方,真 git 不认
      const r = spawnSync('git', ['cat-file', '-p', aHash], { cwd: join(away, 'repo'), encoding: 'utf8' })
      expect(r.status).not.toBe(0)
      expect(r.stderr).toContain('Not a valid object name')
    } finally {
      rmSync(away, { recursive: true, force: true })
    }
  }, 30_000)
})

describe.skipIf(!gitAvailable())('反方向:真 git 建的对象,mini-git 读回', () => {
  let real: string

  beforeEach(() => {
    real = mkdtempSync(join(tmpdir(), 'mini-git-realgit-'))
    git(['init'], real)
    writeFileSync(join(real, 'x.txt'), 'real\n')
    git(['add', '-A'], real, { ...REAL_GIT_ENV, GIT_AUTHOR_DATE: '1700000000 +0800', GIT_COMMITTER_DATE: '1700000000 +0800' })
    git(['commit', '-m', '真 git 的第一笔'], real, { ...REAL_GIT_ENV, GIT_AUTHOR_DATE: '1700000000 +0800', GIT_COMMITTER_DATE: '1700000000 +0800' })
    mkdirSync(join(real, 'lib'), { recursive: true })
    writeFileSync(join(real, 'lib', 'y.txt'), 'git\n')
    writeFileSync(join(real, 'x.txt'), 'real\nline\n')
    git(['add', '-A'], real, { ...REAL_GIT_ENV, GIT_AUTHOR_DATE: '1700003600 +0800', GIT_COMMITTER_DATE: '1700003600 +0800' })
    git(['commit', '-m', '真 git 的第二笔'], real, { ...REAL_GIT_ENV, GIT_AUTHOR_DATE: '1700003600 +0800', GIT_COMMITTER_DATE: '1700003600 +0800' })
  })

  afterEach(() => {
    rmSync(real, { recursive: true, force: true })
  })

  it('cat-file 与 log:提交原文与真 git 的 cat-file -p 逐字符一致,logWalk 收齐两笔', () => {
    const tip = resolveHead(join(real, '.git'))!
    expect(runCli(['cat-file', '-p', tip], real)).toBe(git(['cat-file', '-p', 'HEAD'], real))
    const entries = logWalk(join(real, '.git'), tip)
    expect(entries.map((e) => e.message.trimEnd())).toEqual(['真 git 的第二笔', '真 git 的第一笔'])
    expect(entries[0].parents).toEqual([entries[1].hash])
  }, 30_000)

  it('status:解析真 git 写的 index,三态对比判干净;改一处、添一处,两段各归各', () => {
    expect(runCli(['status'], real)).toContain('干净')
    expect(runCli(['status'], real)).toContain('(2 个文件)')
    writeFileSync(join(real, 'x.txt'), 'real\nline\nchanged\n')
    writeFileSync(join(real, 'z.txt'), 'untracked\n')
    const out = runCli(['status'], real)
    expect(out).toContain('未暂存的变更')
    expect(out).toContain('修改:x.txt')
    expect(out).toContain('未跟踪的文件')
    expect(out).toContain('z.txt')
  }, 30_000)

  it('hash-object 同答:对同一文件,两边算出同一个名字', () => {
    writeFileSync(join(real, 'probe.txt'), 'same bytes, same name\n')
    expect(runCli(['hash-object', 'probe.txt'], real)).toBe(git(['hash-object', '--no-filters', 'probe.txt'], real).trim())
  }, 30_000)
})
