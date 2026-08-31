// tests/refs.test.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashObject, initRepo, readObject } from '../src/objects.ts'
import { parseCommit } from '../src/commits.ts'
import {
  attachHead,
  detachHead,
  listBranches,
  readHead,
  readRef,
  resolveHead,
  updateRef,
} from '../src/refs.ts'
import { flattenTree, loadIndex } from '../src/index.ts'
import { runCli } from '../src/cli.ts'

// 传承第 3-5 章的金样:同一套 fixture,内容定名字
const HELLO_BLOB = '3b18e512dba79e4c8300dd08aeb37f8e728b8dad' // 'hello world\n'
const ROOT_TREE = 'fa0086005716702a3661501fa32495bae7619b91' // 三层 fixture 的根
const C1 = 'bf05977bd740a2b2fa530935475587501704d0cc' // 第 4 章根提交金样
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904' // 'tree 0\0' 的 SHA-1,第 5 章自查题推过它
const A2 = 'hello world\nsecond line\n' // 第二笔提交里 a.txt 的新版

let work: string
let gitDir: string

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-refs-'))
  gitDir = initRepo(work)
})

afterEach(() => {
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 建固定三层 fixture:与第 3-5 章同一套。 */
function makeFixture(root: string): void {
  writeFileSync(join(root, 'a.txt'), 'hello world\n')
  writeFileSync(join(root, 'lib.txt'), 'note\n')
  mkdirSync(join(root, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(root, 'lib', 'util.txt'), 'util\n')
  writeFileSync(join(root, 'lib', 'deep', 'leaf.txt'), 'hello world\n')
}

/** 数一个目录下的文件总数(递归),给「建分支只写一个文件」当实物证据。 */
function countFiles(dir: string): number {
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(join(dir, e.name)) : 1
  }
  return n
}

/** 一条龙做出第一笔提交;先断言输出与金样 C1 同名,再把 C1 交回去。 */
function firstCommit(): string {
  makeFixture(work)
  runCli(['add', 'a.txt', 'lib.txt', 'lib/deep/leaf.txt', 'lib/util.txt'], work)
  process.env.MINI_GIT_TIMESTAMP = '1700000000'
  expect(runCli(['commit', '-m', '第一次提交'], work)).toBe(`[main(根提交) ${C1.slice(0, 7)}] 第一次提交`)
  return C1
}

describe('引用文件:readRef/updateRef/listBranches', () => {
  it('updateRef 写 refs/heads/dev(自动建目录),readRef 读回;不存在的引用返回 null', () => {
    expect(readRef(gitDir, 'refs/heads/dev')).toBe(null)
    updateRef(gitDir, 'refs/heads/dev', C1)
    expect(readFileSync(join(gitDir, 'refs', 'heads', 'dev'), 'utf8')).toBe(`${C1}\n`)
    expect(readRef(gitDir, 'refs/heads/dev')).toBe(C1)
  })

  it('嵌套分支名也只是一条路径:refs/heads/feature/ui 建两层目录;listBranches 递归按字典序列出', () => {
    updateRef(gitDir, 'refs/heads/main', C1)
    updateRef(gitDir, 'refs/heads/dev', C1)
    updateRef(gitDir, 'refs/heads/feature/ui', C1)
    expect(listBranches(gitDir)).toEqual(['dev', 'feature/ui', 'main'])
  })

  it('updateRef 拒绝非 40 位;readRef 读到 ref: 形状判损坏——引用文件里该是对象名', () => {
    updateRef(gitDir, 'refs/heads/main', C1)
    expect(() => updateRef(gitDir, 'refs/heads/bad', 'not-a-hash')).toThrow('40 位')
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), 'ref: refs/heads/other\n')
    expect(() => readRef(gitDir, 'refs/heads/main')).toThrow('ref:')
  })

  it('还没建过任何分支时 listBranches 返回空;readHead 读到 ref: 形状的目标', () => {
    expect(listBranches(gitDir)).toEqual([])
    expect(readHead(gitDir)).toEqual({ kind: 'ref', ref: 'refs/heads/main' })
  })
})

describe('resolveHead:HEAD 的三种读法', () => {
  it('unborn 返回 null;ref: 一跳读到提交名;裸哈希(detached)直接返回——第 5 章三形状语义平移', () => {
    expect(resolveHead(gitDir)).toBe(null) // 分支存在但从没生过提交
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), `${C1}\n`)
    expect(resolveHead(gitDir)).toBe(C1)
    writeFileSync(join(gitDir, 'HEAD'), `${C1}\n`) // detached:HEAD 直接写提交名
    expect(resolveHead(gitDir)).toBe(C1)
  })

  it('符号引用是条链就逐跳跟下去:HEAD → refs/heads/top → refs/heads/main → 提交名', () => {
    writeFileSync(join(gitDir, 'refs', 'heads', 'main'), `${C1}\n`)
    writeFileSync(join(gitDir, 'refs', 'heads', 'top'), 'ref: refs/heads/main\n')
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/top\n')
    expect(resolveHead(gitDir)).toBe(C1)
    expect(readHead(gitDir)).toEqual({ kind: 'ref', ref: 'refs/heads/top' }) // 第一跳只拆一层
  })

  it('链成环报错而不是死循环;HEAD 内容两头不是判损坏', () => {
    writeFileSync(join(gitDir, 'refs', 'heads', 'a'), 'ref: refs/heads/b\n')
    writeFileSync(join(gitDir, 'refs', 'heads', 'b'), 'ref: refs/heads/a\n')
    writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/a\n')
    expect(() => resolveHead(gitDir)).toThrow('环')
    writeFileSync(join(gitDir, 'HEAD'), '随便一句话\n')
    expect(() => resolveHead(gitDir)).toThrow('损坏')
    writeFileSync(join(gitDir, 'HEAD'), 'ref: outside/heads\n')
    expect(() => resolveHead(gitDir)).toThrow('refs/')
  })
})

describe('branch:建分支是一次文件写入', () => {
  it('在 C1 上建 dev:.git 恰好多一个文件,内容 41 字节;对象库一个对象都没多', () => {
    firstCommit()
    const before = countFiles(gitDir)
    const objectsBefore = countFiles(join(gitDir, 'objects'))
    expect(runCli(['branch', 'dev'], work)).toBe(`已建分支 'dev' → refs/heads/dev = ${C1}`)
    expect(countFiles(gitDir)).toBe(before + 1)
    expect(countFiles(join(gitDir, 'objects'))).toBe(objectsBefore)
    expect(statSync(join(gitDir, 'refs', 'heads', 'dev')).size).toBe(41) // 40 字符 + 换行
  })

  it('重名、非法名字、unborn 三种拒绝各报各的错', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    expect(() => runCli(['branch', 'dev'], work)).toThrow('已存在')
    expect(() => runCli(['branch', 'a..b'], work)).toThrow('分支名')
    expect(() => runCli(['branch', '.hidden'], work)).toThrow('分支名')
    rmSync(work, { recursive: true, force: true })
    work = mkdtempSync(join(tmpdir(), 'mini-git-refs-'))
    gitDir = initRepo(work)
    expect(() => runCli(['branch', 'dev'], work)).toThrow('还没生过提交')
  })

  it('列表按字典序,当前分支带 *;detached 时首行点名', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    expect(runCli(['branch'], work)).toBe('  dev\n* main')
    writeFileSync(join(gitDir, 'HEAD'), `${C1}\n`) // 手工 detached
    expect(runCli(['branch'], work)).toBe(`* (HEAD detached at ${C1.slice(0, 7)})\n  dev\n  main`)
  })
})

describe('commit:第一条 porcelain 命令', () => {
  it('一条龙复现第 4 章金样:同一套清单与时间戳,提交名就是 C1;refs/heads/main 同时出生', () => {
    firstCommit()
    expect(readRef(gitDir, 'refs/heads/main')).toBe(C1)
    expect(runCli(['status'], work)).toBe('干净:工作区、暂存区与 HEAD 三方一致(4 个文件)')
    expect(runCli(['log', C1], work)).toContain('第一次提交')
  })

  it('commit 推进当前分支,其他分支原地不动:dev 停在 C1,main 前移到 c2', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), A2)
    writeFileSync(join(work, 'b.txt'), 'b\n')
    runCli(['add', 'a.txt', 'b.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    const out = runCli(['commit', '-m', '第二次提交'], work)
    const c2 = readRef(gitDir, 'refs/heads/main')!
    expect(out).toBe(`[main ${c2.slice(0, 7)}] 第二次提交`)
    expect(readRef(gitDir, 'refs/heads/dev')).toBe(C1) // dev 没被带跑
    const parsed = parseCommit(readObject(gitDir, c2).body)
    expect(parsed.parents).toEqual([C1]) // 父指针接在上笔提交后面
    expect(flattenTree(gitDir, parsed.tree).get('a.txt')?.hash).toBe(hashObject('blob', Buffer.from(A2, 'utf8')))
    expect(flattenTree(gitDir, parsed.tree).get('b.txt')).toBeDefined()
    expect(runCli(['log', c2], work).split('commit ').length - 1).toBe(2) // 两笔可达
  })

  it('空清单也照单全收:提交的是空树 4b825dc6——真 git 此时会拒绝,这是登记过的分岔', () => {
    process.env.MINI_GIT_TIMESTAMP = '1700000000'
    const out = runCli(['commit', '-m', '空提交'], work)
    const root = readRef(gitDir, 'refs/heads/main')!
    const parsed = parseCommit(readObject(gitDir, root).body)
    expect(parsed.tree).toBe(EMPTY_TREE)
    expect(parsed.parents).toEqual([])
    expect(out).toBe(`[main(根提交) ${root.slice(0, 7)}] 空提交`)
  })

  it('detached 下的提交任何分支都不收:refs 全目录扫不到它,HEAD 自己前移,只能靠哈希找回', () => {
    const c1 = firstCommit()
    writeFileSync(join(work, 'a.txt'), A2)
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['commit', '-m', '第二次提交'], work)
    runCli(['checkout', c1], work) // 回到 C1,进入 detached
    writeFileSync(join(work, 'a.txt'), 'detached edit\n')
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700007200'
    const out4 = runCli(['commit', '-m', '游离的提交'], work)
    const c4 = resolveHead(gitDir)!
    expect(out4).toBe(`[HEAD detached ${c4.slice(0, 7)}] 游离的提交`)
    expect(readFileSync(join(gitDir, 'HEAD'), 'utf8').trim()).toBe(c4) // HEAD 直接记着它
    expect(runCli(['branch'], work)).toBe(`* (HEAD detached at ${c4.slice(0, 7)})\n  main`)
    const refTexts: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) {
          walk(join(dir, e.name))
        } else {
          refTexts.push(readFileSync(join(dir, e.name), 'utf8'))
        }
      }
    }
    walk(join(gitDir, 'refs'))
    expect(refTexts.join('')).not.toContain(c4) // 没有任何分支引用它
    runCli(['checkout', 'main'], work)
    expect(resolveHead(gitDir)).not.toBe(c4)
    expect(readObject(gitDir, c4).type).toBe('commit') // 对象还在库里,只是没有引用指路
  })
})

describe('checkout:切换分支与检出提交', () => {
  it('切到 dev:工作区与暂存区恢复成 C1 的样子,b.txt 退场,status 干净', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), A2)
    writeFileSync(join(work, 'b.txt'), 'b\n')
    runCli(['add', 'a.txt', 'b.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['commit', '-m', '第二次提交'], work)
    expect(runCli(['checkout', 'dev'], work)).toBe("已切换到分支 'dev',检出 4 个文件")
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('hello world\n')
    expect(existsSync(join(work, 'b.txt'))).toBe(false)
    expect(readFileSync(join(gitDir, 'HEAD'), 'utf8')).toBe('ref: refs/heads/dev\n')
    expect(loadIndex(gitDir).map((e) => e.path)).toEqual(['a.txt', 'lib.txt', 'lib/deep/leaf.txt', 'lib/util.txt'])
    expect(runCli(['status'], work)).toBe('干净:工作区、暂存区与 HEAD 三方一致(4 个文件)')
  })

  it('dev 上再提交后切回 main:a.txt 换回新版;dev 停在自己的新提交上,main 没被带跑', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), A2)
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['commit', '-m', '第二次提交'], work)
    runCli(['checkout', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), 'dev 线的改动\n')
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700007200'
    const out3 = runCli(['commit', '-m', 'dev 的提交'], work)
    const c3 = readRef(gitDir, 'refs/heads/dev')!
    expect(out3).toBe(`[dev ${c3.slice(0, 7)}] dev 的提交`)
    runCli(['checkout', 'main'], work)
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe(A2)
    expect(runCli(['status'], work)).toBe('干净:工作区、暂存区与 HEAD 三方一致(4 个文件)')
    expect(readHead(gitDir)).toEqual({ kind: 'ref', ref: 'refs/heads/main' })
  })

  it('checkout 40 位哈希进入 detached:HEAD 变裸哈希;attachHead/detachHead 是两个方向的实体', () => {
    const c1 = firstCommit()
    expect(runCli(['checkout', c1], work)).toBe(
      `已检出到 ${c1.slice(0, 7)}(detached HEAD:不在任何分支上,新提交只能靠哈希找回)`,
    )
    expect(readHead(gitDir)).toEqual({ kind: 'hash', hash: c1 })
    expect(runCli(['status'], work)).toBe('干净:工作区、暂存区与 HEAD 三方一致(4 个文件)')
    attachHead(gitDir, 'refs/heads/main')
    expect(readHead(gitDir)).toEqual({ kind: 'ref', ref: 'refs/heads/main' })
    detachHead(gitDir, c1)
    expect(readHead(gitDir)).toEqual({ kind: 'hash', hash: c1 })
  })

  it('脏工作区被无条件覆盖、未跟踪文件保留——真 git 会拒绝切换,这是声明过的从简口径', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    writeFileSync(join(work, 'a.txt'), A2)
    writeFileSync(join(work, 'todo.md'), '还没决定要不要\n')
    runCli(['checkout', 'dev'], work)
    expect(readFileSync(join(work, 'a.txt'), 'utf8')).toBe('hello world\n') // 改动没了
    expect(existsSync(join(work, 'todo.md'))).toBe(true) // 未跟踪的不动
  })

  it('不存在的分支报错并列出现有分支;checkout 一个 tree 对象报错', () => {
    firstCommit()
    runCli(['branch', 'dev'], work)
    expect(() => runCli(['checkout', 'nope'], work)).toThrow('不存在')
    expect(() => runCli(['checkout', ROOT_TREE], work)).toThrow('tree')
  })
})
