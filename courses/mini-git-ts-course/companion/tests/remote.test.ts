// tests/remote.test.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initRepo, initRepoBare, readObject } from '../src/objects.ts'
import { listBranches, readRef, resolveHead } from '../src/refs.ts'
import { runCli, runNetCli } from '../src/cli.ts'
import { discoverRefs, encodeRefAdvertisement, type RefServer } from '../src/serve.ts'
import { cloneRepo, enumerateObjects, fetchObjects, pushObjects, startSyncServer } from '../src/remote.ts'

let originWork: string
let originGit: string
let server: RefServer | null = null

beforeEach(() => {
  originWork = mkdtempSync(join(tmpdir(), 'mini-git-sync-'))
  originGit = initRepo(originWork)
})

afterEach(async () => {
  if (server !== null) {
    await server.close() // 端口自清理:不留监听句柄
    server = null
  }
  rmSync(originWork, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 源仓库:第一笔同时收 a.txt 与 lib/b.txt,dev 停在第一笔,main 独自前进一笔。 */
function makeOrigin(): { c1: string; c2: string } {
  mkdirSync(join(originWork, 'lib'), { recursive: true })
  writeFileSync(join(originWork, 'a.txt'), 'one\n')
  writeFileSync(join(originWork, 'lib', 'b.txt'), 'two\n')
  runCli(['add', 'a.txt'], originWork)
  runCli(['add', 'lib/b.txt'], originWork)
  process.env.MINI_GIT_TIMESTAMP = '1700000000'
  runCli(['commit', '-m', '第一次提交'], originWork)
  const c1 = resolveHead(originGit)!
  runCli(['branch', 'dev'], originWork)
  writeFileSync(join(originWork, 'a.txt'), 'one\ntwo\n')
  runCli(['add', 'a.txt'], originWork)
  process.env.MINI_GIT_TIMESTAMP = '1700003600'
  runCli(['commit', '-m', 'main 前进'], originWork)
  const c2 = resolveHead(originGit)!
  return { c1, c2 }
}

/** 与源仓库共享历史的另一侧:through=1 只到第一笔,through=2 追平 main;同样的内容、消息与时间戳,内容寻址担保同样的哈希。 */
function makePeer(through: 1 | 2): { work: string; git: string; c1: string; c2: string } {
  const work = mkdtempSync(join(tmpdir(), 'mini-git-sync-'))
  const git = initRepo(work)
  mkdirSync(join(work, 'lib'), { recursive: true })
  writeFileSync(join(work, 'a.txt'), 'one\n')
  writeFileSync(join(work, 'lib', 'b.txt'), 'two\n')
  runCli(['add', 'a.txt'], work)
  runCli(['add', 'lib/b.txt'], work)
  process.env.MINI_GIT_TIMESTAMP = '1700000000'
  runCli(['commit', '-m', '第一次提交'], work)
  const c1 = resolveHead(git)!
  let c2 = c1
  if (through === 2) {
    writeFileSync(join(work, 'a.txt'), 'one\ntwo\n')
    runCli(['add', 'a.txt'], work)
    process.env.MINI_GIT_TIMESTAMP = '1700003600'
    runCli(['commit', '-m', 'main 前进'], work)
    c2 = resolveHead(git)!
  }
  return { work, git, c1, c2 }
}

/** 一步提交:改一个文件、add、commit(时间戳钉死),返回新提交的哈希。 */
function commit(work: string, rel: string, content: string, msg: string, stamp: number): string {
  const abs = join(work, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
  runCli(['add', rel], work)
  process.env.MINI_GIT_TIMESTAMP = String(stamp)
  runCli(['commit', '-m', msg], work)
  return resolveHead(join(work, '.git'))!
}

/** 起本章的会话服务,拿随机端口;存进 server,afterEach 负责关。 */
async function start(gitDir: string): Promise<RefServer> {
  server = await startSyncServer(gitDir)
  return server
}

/** 空裸仓库:push/fetch 的远端落点。 */
function makeBare(): { work: string; git: string } {
  const work = mkdtempSync(join(tmpdir(), 'mini-git-sync-'))
  return { work, git: initRepoBare(work) }
}

/** 给 clone 用的一次性目标目录(挂在独立的临时目录下)。 */
function freshDest(name: string): { parent: string; dest: string } {
  const parent = mkdtempSync(join(tmpdir(), 'mini-git-sync-'))
  return { parent, dest: join(parent, name) }
}

describe('对象枚举:从尖端收齐全家', () => {
  it('commit 沿 tree 与 parent、tree 沿条目递归:两笔提交的历史共 8 个对象,一笔是 5 个', () => {
    const { c1, c2 } = makeOrigin()
    const fromFirst = enumerateObjects(originGit, [c1])
    const fromSecond = enumerateObjects(originGit, [c2])
    // c1 名下:2 个 blob + lib 的 tree + 根 tree + c1 自己
    expect(fromFirst.length).toBe(5)
    // c2 再加:改过的 blob + 新根 tree + c2 自己(lib 的 tree 原样复用)
    expect(fromSecond.length).toBe(8)
    expect(fromSecond).toContain(c1)
    expect(fromSecond).toContain(c2)
  })

  it('两个尖端共享的对象只收一次:5 + 8 还是 8(内容寻址的去重在图这边兑现)', () => {
    const { c1, c2 } = makeOrigin()
    expect(enumerateObjects(originGit, [c1, c2]).length).toBe(8)
  })
})

describe('会话服务端:先送清单,再听来意', () => {
  it('第 10 章的 ls-remote 客户端原样能连:连上即收写侧,服务端送清单后送客', async () => {
    makeOrigin()
    const s = await start(originGit)
    const main = readRef(originGit, 'refs/heads/main')!
    const want = [
      { name: 'HEAD', hash: main },
      ...listBranches(originGit).map((b) => ({
        name: `refs/heads/${b}`,
        hash: readRef(originGit, `refs/heads/${b}`)!,
      })),
    ]
    expect(await discoverRefs(`127.0.0.1:${s.port}`)).toEqual(want)
  })

  it('空仓库对端:引用发现只有零号占位行,不算错误', async () => {
    const s = await start(originGit)
    expect(await discoverRefs(`127.0.0.1:${s.port}`)).toEqual([
      { name: 'capabilities^{}', hash: '0'.repeat(40) },
    ])
  })

  it('服务端 detached HEAD:HEAD 行照发裸哈希,不因不在分支上而缺席', async () => {
    const { c1, c2 } = makeOrigin()
    commit(originWork, 'a.txt', 'one\ntwo\nthree\n', 'main 又前进', 1700007200) // main 挪走,c2 不再是任何分支的尖端
    runCli(['checkout', c2], originWork) // detached:HEAD 文件直接记哈希
    const s = await start(originGit)
    expect(await discoverRefs(`127.0.0.1:${s.port}`)).toEqual([
      { name: 'HEAD', hash: c2 },
      { name: 'refs/heads/dev', hash: c1 },
      { name: 'refs/heads/main', hash: readRef(originGit, 'refs/heads/main')! },
    ])
  })
})

describe('fetch:拉对象,前移 remote-tracking 引用,别的都不动', () => {
  it('只拉缺的 3 个对象;refs/remotes 前移,工作区、index、HEAD 与本地分支纹丝不动', async () => {
    makeOrigin()
    const sibling = makePeer(2)
    try {
      expect(sibling.c1).toBe(readRef(originGit, 'refs/heads/dev')!) // 同样的输入,同样的哈希:两头共享第一笔
      expect(sibling.c2).toBe(readRef(originGit, 'refs/heads/main')!)
      commit(originWork, 'a.txt', 'one\ntwo\nthree\n', 'main 又前进', 1700007200)
      const s = await start(originGit)
      const remote = `127.0.0.1-${s.port}`
      const report = await fetchObjects(sibling.git, `127.0.0.1:${s.port}`)
      // 两头本已追平,缺的只有 c3 那一笔:新 blob + 新根 tree + 新 commit(lib 的 tree 原样复用)
      expect(report.pulled).toBe(3)
      expect(report.updated).toEqual([
        { branch: 'dev', hash: sibling.c1 },
        { branch: 'main', hash: readRef(originGit, 'refs/heads/main')! },
      ])
      // remote-tracking 引用落在 refs/remotes/<主机>-<端口>/ 下
      expect(readRef(sibling.git, `refs/remotes/${remote}/main`)).toBe(readRef(originGit, 'refs/heads/main')!)
      expect(readRef(sibling.git, `refs/remotes/${remote}/dev`)).toBe(sibling.c1)
      // 本地这半边一概没动
      expect(readRef(sibling.git, 'refs/heads/main')).toBe(sibling.c2)
      expect(readFileSync(join(sibling.work, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
      expect(runCli(['status'], sibling.work)).toContain('干净')
    } finally {
      rmSync(sibling.work, { recursive: true, force: true })
    }
  })

  it('第二次 fetch:对过账后一个对象都不拉,引用不变', async () => {
    makeOrigin()
    const sibling = makePeer(2)
    try {
      const s = await start(originGit)
      await fetchObjects(sibling.git, `127.0.0.1:${s.port}`)
      const again = await fetchObjects(sibling.git, `127.0.0.1:${s.port}`)
      expect(again.pulled).toBe(0)
      expect(again.updated.map((u) => u.branch)).toEqual(['dev', 'main'])
    } finally {
      rmSync(sibling.work, { recursive: true, force: true })
    }
  })

  it('命令层战报:对象数与 remote-tracking 引用的落点写明在输出里', async () => {
    makeOrigin()
    const sibling = makePeer(2)
    try {
      commit(originWork, 'a.txt', 'one\ntwo\nthree\n', 'main 又前进', 1700007200)
      const s = await start(originGit)
      const out = await runNetCli(['fetch', `127.0.0.1:${s.port}`], sibling.work)
      expect(out).toContain('拉取 3 个对象')
      expect(out).toContain(`main → refs/remotes/127.0.0.1-${s.port}/main(`)
    } finally {
      rmSync(sibling.work, { recursive: true, force: true })
    }
  })
})

describe('push:裸仓库当远端,isAncestor 把关', () => {
  it('init --bare:骨架直接铺在目录本身,没有 .git 壳', () => {
    const bare = makeBare()
    try {
      const out = runCli(['init', '--bare'], bare.work)
      expect(out).toContain('裸仓库')
      expect(existsSync(join(bare.work, 'objects'))).toBe(true)
      expect(existsSync(join(bare.work, 'refs', 'heads'))).toBe(true)
      expect(existsSync(join(bare.work, '.git'))).toBe(false)
    } finally {
      rmSync(bare.work, { recursive: true, force: true })
    }
  })

  it('领先就收:空远端照单全收建引用;同一尖端再推,一个对象都不用送', async () => {
    const { c2 } = makeOrigin()
    const bare = makeBare()
    try {
      const s = await start(bare.git)
      const addr = `127.0.0.1:${s.port}`
      const report = await pushObjects(originGit, addr, 'main')
      expect(report.to).toBe(c2)
      expect(report.sent).toBe(8) // 空远端:整段历史全送
      expect(readRef(bare.git, 'refs/heads/main')).toBe(c2)
      expect(readObject(bare.git, c2).type).toBe('commit')
      const again = await pushObjects(originGit, addr, 'main')
      expect(again.sent).toBe(0) // 广告里列得出的尖端,闭包不用重送
      expect(readRef(bare.git, 'refs/heads/main')).toBe(c2)
    } finally {
      rmSync(bare.work, { recursive: true, force: true })
    }
  })

  it('落后被拒:文案点名 non-fast-forward;远端引用不挪,但对象已经落库', async () => {
    makeOrigin()
    const sibling = makePeer(1)
    const bare = makeBare()
    try {
      const c3 = commit(sibling.work, 'lib/b.txt', 'two\nmore\n', '另一侧前进', 1700010800)
      const s = await start(bare.git)
      const addr = `127.0.0.1:${s.port}`
      await pushObjects(originGit, addr, 'main') // 先把 main 推到 c2
      await expect(pushObjects(sibling.git, addr, 'main')).rejects.toThrow('non-fast-forward')
      expect(readRef(bare.git, 'refs/heads/main')).toBe(readRef(originGit, 'refs/heads/main')!)
      // 货收了、门没开:c3 的对象在远端对象库里,只是没有引用够得着它
      expect(readObject(bare.git, c3).type).toBe('commit')
    } finally {
      rmSync(sibling.work, { recursive: true, force: true })
      rmSync(bare.work, { recursive: true, force: true })
    }
  })

  it('补救通道:fetch 回落后的一侧,merge 出双父提交,再推就过', async () => {
    makeOrigin()
    const sibling = makePeer(1)
    const bare = makeBare()
    try {
      const c3 = commit(sibling.work, 'lib/b.txt', 'two\nmore\n', '另一侧前进', 1700010800)
      const s = await start(bare.git)
      const addr = `127.0.0.1:${s.port}`
      await pushObjects(sibling.git, addr, 'main') // 远端停在 c3
      const fetched = await fetchObjects(originGit, addr)
      expect(fetched.pulled).toBe(4) // c3 那笔:blob + lib tree + 根 tree + commit
      expect(readRef(originGit, `refs/remotes/127.0.0.1-${s.port}/main`)).toBe(c3)
      const merged = runCli(['merge', c3], originWork)
      expect(merged).toContain('双父')
      const pushed = await pushObjects(originGit, addr, 'main')
      expect(readRef(bare.git, 'refs/heads/main')).toBe(pushed.to)
      expect(readObject(bare.git, pushed.to).type).toBe('commit')
    } finally {
      rmSync(sibling.work, { recursive: true, force: true })
      rmSync(bare.work, { recursive: true, force: true })
    }
  })
})

describe('clone:整仓库搬回家', () => {
  it('重建完整工作区与历史:对象、两条分支、remote-tracking 引用、检出与暂存区一次到位', async () => {
    const { c1, c2 } = makeOrigin()
    const s = await start(originGit)
    const { parent, dest } = freshDest('cloned')
    try {
      const report = await cloneRepo(`127.0.0.1:${s.port}`, dest)
      expect(report.empty).toBe(false)
      expect(report.objects).toBe(8)
      expect(report.branches).toEqual(['dev', 'main'])
      expect(report.head).toBe('main')
      expect(report.files).toBe(2)
      const git = join(dest, '.git')
      expect(readRef(git, 'refs/heads/main')).toBe(c2)
      expect(readRef(git, 'refs/heads/dev')).toBe(c1)
      expect(readRef(git, `refs/remotes/127.0.0.1-${s.port}/main`)).toBe(c2)
      expect(resolveHead(git)).toBe(c2)
      // 工作区逐字节还原,log 与源仓库逐字符一致
      expect(readFileSync(join(dest, 'a.txt'), 'utf8')).toBe('one\ntwo\n')
      expect(readFileSync(join(dest, 'lib', 'b.txt'), 'utf8')).toBe('two\n')
      expect(runCli(['log', c2], dest)).toBe(runCli(['log', c2], originWork))
      expect(runCli(['status'], dest)).toContain('干净')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('空仓库 clone:零号占位行打道回府,只建骨架不建分支', async () => {
    const s = await start(originGit)
    const { parent, dest } = freshDest('empty-clone')
    try {
      const report = await cloneRepo(`127.0.0.1:${s.port}`, dest)
      expect(report.empty).toBe(true)
      expect(report.branches).toEqual([])
      expect(existsSync(join(dest, '.git', 'objects'))).toBe(true)
      expect(readdirSync(join(dest, '.git', 'refs', 'heads'))).toEqual([])
      expect(readdirSync(dest).filter((e) => e !== '.git')).toEqual([])
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('clone 的命令层:空远端如实说明,不当错误', async () => {
    const s = await start(originGit)
    const { parent, dest } = freshDest('cmd-empty')
    try {
      const out = await runNetCli(['clone', `127.0.0.1:${s.port}`, dest], originWork)
      expect(out).toContain('空仓库')
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })

  it('clone 下来就能干活:新提交推回源,非裸远端也照收', async () => {
    makeOrigin()
    const s = await start(originGit)
    const { parent, dest } = freshDest('roundtrip')
    try {
      await cloneRepo(`127.0.0.1:${s.port}`, dest)
      const c4 = commit(dest, 'a.txt', 'one\ntwo\nfour\n', '克隆侧前进', 1700014400)
      const report = await pushObjects(join(dest, '.git'), `127.0.0.1:${s.port}`, 'main')
      expect(report.sent).toBe(3) // c4 那笔:blob + 根 tree + commit
      expect(readRef(originGit, 'refs/heads/main')).toBe(c4)
    } finally {
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('命令层与防线', () => {
  it('fetch/push/clone 的同步入口指路 runNetCli', () => {
    expect(() => runCli(['fetch', '127.0.0.1:9419'], originWork)).toThrow('runNetCli')
    expect(() => runCli(['push', '127.0.0.1:9419', 'main'], originWork)).toThrow('runNetCli')
    expect(() => runCli(['clone', '127.0.0.1:9419', 'x'], originWork)).toThrow('runNetCli')
  })

  it('push 分支本地不存在:连接之前就报错,不白跑一趟网络', async () => {
    makeOrigin()
    const s = await start(originGit)
    await expect(pushObjects(originGit, `127.0.0.1:${s.port}`, 'nope')).rejects.toThrow('不存在')
  })

  it('对端只送清单不回话:fetch 等不到回信,报可读的错', async () => {
    makeOrigin()
    const sibling = makePeer(2)
    const rogue = createServer((sock) => {
      sock.write(encodeRefAdvertisement(originGit))
      sock.on('data', () => {}) // 得有人读,流才往前走:没有 data 监听,'end' 永远不来
      sock.on('end', () => sock.end()) // 听完请求就收线,一个字的回信都不给
    })
    const port = await new Promise<number>((resolve) =>
      rogue.listen(0, '127.0.0.1', () => resolve((rogue.address() as { port: number }).port)),
    )
    try {
      await expect(fetchObjects(sibling.git, `127.0.0.1:${port}`)).rejects.toThrow('没等到回信')
    } finally {
      await new Promise<void>((done) => rogue.close(() => done()))
      rmSync(sibling.work, { recursive: true, force: true })
    }
  })
})
