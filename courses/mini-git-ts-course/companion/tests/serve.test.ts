// tests/serve.test.ts
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AddressInfo, createServer, connect, type Socket } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initRepo } from '../src/objects.ts'
import { listBranches, readRef } from '../src/refs.ts'
import { runCli, runNetCli } from '../src/cli.ts'
import { discoverRefs, encodeRefAdvertisement, startRefServer, type RefServer } from '../src/serve.ts'

let work: string
let gitDir: string
let server: RefServer | null = null
const extras: { close(): Promise<void> }[] = [] // 临时起的假服务,测完统一收线

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'mini-git-wire-'))
  gitDir = initRepo(work)
})

afterEach(async () => {
  if (server !== null) {
    await server.close() // 端口自清理:不留监听句柄
    server = null
  }
  for (const s of extras.splice(0)) {
    await s.close()
  }
  rmSync(work, { recursive: true, force: true })
  delete process.env.MINI_GIT_TIMESTAMP
})

/** 起本章的服务,拿一个随机端口;存进 server,afterEach 负责关。 */
async function start(): Promise<RefServer> {
  server = await startRefServer(gitDir)
  return server
}

/** 一笔提交落在 main 上,把哈希交回去;时间戳固定,不碰机器时钟。 */
function firstCommit(): string {
  writeFileSync(join(work, 'a.txt'), 'one\n')
  runCli(['add', 'a.txt'], work)
  process.env.MINI_GIT_TIMESTAMP = '1700000000'
  runCli(['commit', '-m', '第一次提交'], work)
  return readRef(gitDir, 'refs/heads/main')!
}

/** main、dev、feature/ui 三条分支:dev 与 feature/ui 停在第一笔,main 独自前进一笔。 */
function threeBranches(): string {
  const c1 = firstCommit()
  runCli(['branch', 'dev'], work)
  runCli(['branch', 'feature/ui'], work)
  writeFileSync(join(work, 'a.txt'), 'one\ntwo\n')
  runCli(['add', 'a.txt'], work)
  process.env.MINI_GIT_TIMESTAMP = '1700003600'
  runCli(['commit', '-m', 'main 前进'], work)
  return c1
}

/** 磁盘侧的期望清单:refs/heads 下逐个读引用文件。 */
function diskRefs(): { name: string; hash: string }[] {
  return listBranches(gitDir).map((b) => ({ name: `refs/heads/${b}`, hash: readRef(gitDir, `refs/heads/${b}`)! }))
}

/** 裸 socket 读回整段流:不经过 discoverRefs,直接看线上字节。 */
function readWire(port: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const sock = connect(port, '127.0.0.1')
    sock.on('error', reject)
    sock.on('data', (c: Buffer) => chunks.push(c))
    sock.on('close', () => resolve(Buffer.concat(chunks)))
  })
}

/** 起一个「发指定字节就收线」的假服务,拿随机端口:验证客户端对坏流的防线。 */
async function startRogueServer(bytes: Buffer): Promise<number> {
  const sockets = new Set<Socket>()
  const rogue = createServer((sock) => {
    sockets.add(sock)
    sock.end(bytes)
  })
  return new Promise((resolve) => {
    rogue.listen(0, '127.0.0.1', () => {
      extras.push({
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy()
            rogue.close(() => done())
          }),
      })
      resolve((rogue.address() as AddressInfo).port)
    })
  })
}

describe('引用发现:进程内服务往返', () => {
  it('多分支:客户端列出的引用与磁盘 refs 完全一致,HEAD 在最前、其余按名字排序', async () => {
    threeBranches()
    const s = await start()
    const refs = await discoverRefs(`127.0.0.1:${s.port}`)
    const main = readRef(gitDir, 'refs/heads/main')!
    expect(refs).toEqual([{ name: 'HEAD', hash: main }, ...diskRefs()])
  })

  it('每收一条连接都送一遍清单:连两次,两次一致——清单不缓存,对端引用变了就送新值', async () => {
    threeBranches()
    const s = await start()
    const first = await discoverRefs(`127.0.0.1:${s.port}`)
    const second = await discoverRefs(`127.0.0.1:${s.port}`)
    expect(first).toEqual(second)
  })

  it('unborn 仓库(无提交):线上只有零号占位行加 flush;ls-remote 不列任何引用', async () => {
    const s = await start()
    const refs = await discoverRefs(`127.0.0.1:${s.port}`)
    expect(refs).toEqual([{ name: 'capabilities^{}', hash: '0'.repeat(40) }])
    expect(await runNetCli(['ls-remote', `127.0.0.1:${s.port}`], work)).toBe('')
  })

  it('线上字节:裸 socket 读回的整段流,与逐行 pktEncode 加 flush 拼出的期望分毫不差', async () => {
    threeBranches()
    const s = await start()
    expect((await readWire(s.port)).equals(encodeRefAdvertisement(gitDir))).toBe(true)
  })
})

describe('mini-git ls-remote 命令', () => {
  it('输出对齐真 git 的形状:哈希 + Tab + 引用名,一行一条,HEAD 在前', async () => {
    threeBranches()
    const s = await start()
    const main = readRef(gitDir, 'refs/heads/main')!
    const want = diskRefs().map((r) => `${r.hash}\t${r.name}`)
    expect(await runNetCli(['ls-remote', `127.0.0.1:${s.port}`], work)).toBe([`${main}\tHEAD`, ...want].join('\n'))
  })

  it('同步入口 runCli 不收网络命令:指路 runNetCli——命令行入口本来就走它', () => {
    expect(() => runCli(['ls-remote', '127.0.0.1:9419'], work)).toThrow('runNetCli')
    expect(() => runCli(['serve'], work)).toThrow('runNetCli')
  })

  it('地址不成形各报各的错:缺端口、端口不是数字', async () => {
    await expect(discoverRefs('127.0.0.1')).rejects.toThrow('主机:端口')
    await expect(discoverRefs('127.0.0.1:NotAPort')).rejects.toThrow('主机:端口')
  })
})

describe('客户端防线:连不上与坏流', () => {
  it('端口上没有服务:报可读的错,不把 ECONNREFUSED 原样甩出来', async () => {
    const s = await startRefServer(gitDir)
    const port = s.port
    await s.close() // 拿一个刚被释放、几乎必然没人的端口
    await expect(discoverRefs(`127.0.0.1:${port}`)).rejects.toThrow('连不上')
  })

  it('流里混进坏前缀:notpkt 第一帧就解不动,报错点名十六进制', async () => {
    const port = await startRogueServer(Buffer.from('notpkt', 'ascii'))
    await expect(discoverRefs(`127.0.0.1:${port}`)).rejects.toThrow('十六进制')
  })

  it('流有帧却没收尾 flush:读到头也不认账', async () => {
    const port = await startRogueServer(Buffer.from('0005a', 'ascii')) // 一帧好字节,但整段没有 flush
    await expect(discoverRefs(`127.0.0.1:${port}`)).rejects.toThrow('flush')
  })
})
