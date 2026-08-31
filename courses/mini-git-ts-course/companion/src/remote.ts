// src/remote.ts · 远端同步:对象枚举、会话服务端与 fetch/push/clone 客户端
//
// 真协议的对象传输是 want/have 多轮协商加 packfile(pack-protocol 文档);mini-git 从简,
// 会话协议自定(分岔就地声明、差异附录集中登记):
//   - 服务端连上先送第 10 章的引用发现流,然后等对方开口
//   - 客户端把请求一次说完(pkt-line 帧)就收掉自己的写侧;服务端读到收线才办,办完一次送回再收线
//   - fetch 请求是 `want <哈希>`(要的尖端)加 `have <哈希>`(本地已有的对象);回信是一串对象加 flush
//   - push 请求是 `push <引用>:<哈希>` 加一串对象;回信一行判词 ok 或 ng,ng 带拒绝理由
//   - 对象在线上的形状:一行头 `对象类型 哈希 字节数`,随后对象体按 ≤65516 字节装进数据帧;
//     收货方落库前用内容寻址重算哈希,名字对不上当场拒收
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AddressInfo, connect, createServer, type Server, type Socket } from 'node:net'
import { initRepo, readObject, writeObject, type ObjectType } from './objects.ts'
import { checkoutTree, parseTree } from './trees.ts'
import { parseCommit } from './commits.ts'
import { flattenTree, makeIndexEntry, saveIndex } from './index.ts'
import { attachHead, listBranches, readRef, updateRef } from './refs.ts'
import { isAncestor } from './graph.ts'
import { FLUSH_PKT, MAX_PAYLOAD, pktDecode, pktEncode, type PktFrame } from './pkt.ts'
import { encodeRefAdvertisement, parseAddress, parseRefLines, type RefServer, type RemoteRef } from './serve.ts'

/** fetchObjects 的战报:remote 是从地址折出来的远端名,pulled 是这次真正入库的对象数。 */
export interface FetchReport {
  remote: string
  pulled: number
  updated: { branch: string; hash: string }[]
}

/** pushObjects 的战报:sent 是这次随请求送出的对象数。 */
export interface PushReport {
  branch: string
  ref: string
  to: string
  sent: number
}

/** cloneRepo 的战报:empty 表示对端是空仓库(引用发现只有零号占位行),只建了骨架。 */
export interface CloneReport {
  dir: string
  objects: number
  branches: string[]
  head: string
  files: number
  empty: boolean
}

/**
 * 对象枚举:从每个尖端出发,commit 沿 tree 与 parent、tree 沿条目递归收齐全部可达对象,
 * 每个对象只收一次。第 8 章的 ancestorSet 只沿 parent 边数提交;这里把树也走全——
 * 搬仓库搬的不是提交名单,是每笔提交名下的整棵目录树。
 */
export function enumerateObjects(gitDir: string, tips: readonly string[]): string[] {
  const seen = new Set<string>()
  const queue = [...tips]
  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) {
      continue // 双父两支汇合、两笔尖端共享的祖先与子树,都只收一次
    }
    seen.add(hash)
    const { type, body } = readObject(gitDir, hash)
    if (type === 'commit') {
      const commit = parseCommit(body)
      queue.push(commit.tree, ...commit.parents)
    } else if (type === 'tree') {
      queue.push(...parseTree(body).map((e) => e.hash)) // 子 tree 与 blob 都是条目指向的对象
    }
    // blob 是叶子:内容即全部,不再指向谁
  }
  return [...seen]
}

/** 一帧数据载荷按 utf-8 读成一行,行尾换行有就剥。 */
function lineOf(frame: { kind: 'data'; payload: Buffer }): string {
  const text = frame.payload.toString('utf8')
  return text.endsWith('\n') ? text.slice(0, -1) : text
}

/** 把地址折成 remote-tracking 引用里的远端名:冒号不是引用路径里的合法字符,换成连字符。 */
function remoteName(address: string): string {
  const colon = address.lastIndexOf(':')
  return `${address.slice(0, colon)}-${address.slice(colon + 1)}`
}

/** 对象在不在本地对象库里:读得动就是有,读不动(不存在或损坏)就是没有。 */
function hasObject(gitDir: string, hash: string): boolean {
  try {
    readObject(gitDir, hash)
    return true
  } catch {
    return false
  }
}

/** 把一批对象装上线:每个对象一行头(类型 哈希 字节数)加若干体帧,收尾一个 flush。 */
function frameObjects(gitDir: string, hashes: readonly string[]): Buffer[] {
  const out: Buffer[] = []
  for (const hash of hashes) {
    const { type, body } = readObject(gitDir, hash)
    out.push(pktEncode(`${type} ${hash} ${body.length}\n`))
    for (let i = 0; i < body.length; i += MAX_PAYLOAD) {
      out.push(pktEncode(body.subarray(i, i + MAX_PAYLOAD))) // 体也走 pkt 帧:二进制字节原样过,8-bit 干净
    }
  }
  out.push(FLUSH_PKT)
  return out
}

/** 把线上的一串对象收进对象库:每收满一个就落库,并用内容寻址重算名字对账;返回收了几个。 */
function storeObjectFrames(gitDir: string, frames: readonly PktFrame[]): number {
  let count = 0
  let head: { type: ObjectType; hash: string; size: number } | null = null
  let body: Buffer[] = []
  for (const f of frames) {
    if (f.kind === 'flush') {
      continue // 收尾记号,不是内容
    }
    if (head === null) {
      const line = lineOf(f)
      const m = /^(blob|tree|commit) ([0-9a-f]{40}) (\d+)$/.exec(line)
      if (!m) {
        throw new Error(`对象流的开头 '${line}' 不成形状(该是 类型 哈希 字节数 的一行头)`)
      }
      head = { type: m[1] as ObjectType, hash: m[2], size: Number(m[3]) }
      body = []
    } else {
      body.push(f.payload)
    }
    if (head !== null) {
      const content = Buffer.concat(body)
      if (content.length === head.size) {
        const written = writeObject(gitDir, head.type, content)
        if (written !== head.hash) {
          throw new Error(`远端送来的对象自称 ${head.hash},落库前算出来却是 ${written}——内容与名字对不上,拒收`)
        }
        count += 1
        head = null
        body = []
      } else if (content.length > head.size) {
        throw new Error(`对象 ${head.hash} 声明 ${head.size} 字节,收到的却更多——流断了`)
      }
    }
  }
  if (head !== null) {
    throw new Error(`对象 ${head.hash} 声明 ${head.size} 字节,流结束还没收满`)
  }
  return count
}

/** 数据帧里的第一行;没有数据帧返回 null。 */
function firstDataLine(frames: readonly PktFrame[]): string | null {
  for (const f of frames) {
    if (f.kind === 'data') {
      return lineOf(f)
    }
  }
  return null
}

/** 对端把异常包成了 error 行的话,原样抛给调用方。 */
function failOnErrorLine(frames: readonly PktFrame[]): void {
  const first = firstDataLine(frames)
  if (first !== null && first.startsWith('error ')) {
    throw new Error(`对端报错:${first.slice('error '.length)}`)
  }
}

// ---- 会话的客户端 ----

/** 一条进行到一半的会话:清单已到手,请求还没说,回信还没来。 */
interface SyncSession {
  refs: RemoteRef[]
  /** 把请求帧写出去,然后收掉自己的写侧——服务端读到这句才开工。 */
  send(frames: readonly Buffer[]): void
  /** 等回信到收线,取出引用清单之后的那一段帧。 */
  reply(): Promise<PktFrame[]>
}

/**
 * 连上对端,等第一段 flush:引用发现到手,会话可以往下谈。
 * 之后整根管道上的字节都攒在 chunks 里;回信取「首个 flush 之后」的帧。
 */
function openSession(address: string): Promise<SyncSession> {
  const { host, port } = parseAddress(address)
  const socket = connect({ host, port })
  return new Promise<SyncSession>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    socket.on('error', (err) => {
      socket.destroy()
      if (!settled) {
        settled = true
        reject(new Error(`连不上 ${host}:${port}(${err.message})——对端起 mini-git serve 了吗?`))
      }
    })
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      if (settled) {
        return
      }
      const { frames } = pktDecode(Buffer.concat(chunks))
      if (frames.some((f) => f.kind === 'flush')) {
        settled = true
        resolve({
          refs: parseRefLines(frames),
          send: (out) => {
            for (const b of out) {
              socket.write(b)
            }
            socket.end()
          },
          reply: () =>
            new Promise<PktFrame[]>((res, rej) => {
              socket.on('close', () => {
                try {
                  const { frames } = pktDecode(Buffer.concat(chunks))
                  const firstFlush = frames.findIndex((f) => f.kind === 'flush')
                  const after = firstFlush < 0 ? [] : frames.slice(firstFlush + 1)
                  if (!after.some((f) => f.kind === 'flush')) {
                    throw new Error('会话没等到回信——对端在引用清单之后没有下文(该有对象流或一行判词)')
                  }
                  res(after)
                } catch (err) {
                  rej(err instanceof Error ? err : new Error(String(err)))
                }
              })
            }),
        })
      }
    })
    socket.on('close', () => {
      if (!settled) {
        settled = true
        reject(new Error('会话没等到引用清单——对端发的不是 mini-git 的引用发现流'))
      }
    })
  })
}

/** 本地这边的「已有」清单:全部本地分支加上这条远端的 remote-tracking 引用,各自的尖端。 */
function localTips(gitDir: string, remote: string): string[] {
  const tips: string[] = []
  for (const b of listBranches(gitDir)) {
    const h = readRef(gitDir, `refs/heads/${b}`)
    if (h !== null) {
      tips.push(h)
    }
  }
  const walk = (abs: string, rel: string) => {
    if (!existsSync(abs)) {
      return
    }
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === '' ? e.name : `${rel}/${e.name}`
      if (e.isDirectory()) {
        walk(join(abs, e.name), childRel)
      } else {
        const h = readRef(gitDir, `refs/remotes/${remote}/${childRel}`)
        if (h !== null) {
          tips.push(h)
        }
      }
    }
  }
  walk(join(gitDir, 'refs', 'remotes', remote), '')
  return tips
}

// ---- 会话的服务端 ----

/**
 * 双向会话服务端:每条连接先送引用发现流,再听对方来意——只看清单的收线即送客,
 * 说 want 的按缺送对象,说 push 的先收货再用 isAncestor 把关,非快进推送拒绝。
 * 端口传 0 由系统随机分配;close 收线不留监听句柄。
 */
export async function startSyncServer(
  gitDir: string,
  opts: { host?: string; port?: number } = {},
): Promise<RefServer> {
  if (!existsSync(join(gitDir, 'objects'))) {
    throw new Error(`serve:'${gitDir}' 不是 mini-git 仓库(没找到 objects),无引用清单可送`)
  }
  const host = opts.host ?? '127.0.0.1'
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {}) // 一条连接的异常不拖垮整个服务
    socket.setTimeout(5000, () => socket.end()) // 连上却一直不说话的,5 秒后送客
    socket.write(encodeRefAdvertisement(gitDir)) // 清单每条连接现编现送:对端引用变了,下一条就是新值
    const chunks: Buffer[] = []
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => {
      // 对方收掉了写侧:请求说完了,现在办
      try {
        handleSync(gitDir, socket, Buffer.concat(chunks))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        socket.end(Buffer.concat([pktEncode(`error ${msg}\n`), FLUSH_PKT]))
      }
    })
  })
  server.on('error', () => {}) // listen 失败由下面的 once 统一报
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(opts.port ?? 0, host, () => resolve())
  })
  const { port } = server.address() as AddressInfo
  return {
    server,
    host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const sock of sockets) sock.destroy()
        sockets.clear()
        server.close(() => resolve())
      }),
  }
}

/** 读完对方的请求,办完这一场会话:第一句话说 want 还是 push,决定走哪条路。 */
function handleSync(gitDir: string, socket: Socket, bytes: Buffer): void {
  const { frames } = pktDecode(bytes)
  const data = frames.filter((f): f is { kind: 'data'; payload: Buffer } => f.kind === 'data')
  if (data.length === 0) {
    socket.end() // 只看清单的客人:清单已送,收线送客
    return
  }
  const first = lineOf(data[0])
  if (first.startsWith('want ')) {
    handleFetch(gitDir, socket, data)
  } else if (first.startsWith('push ')) {
    handlePush(gitDir, socket, data)
  } else {
    throw new Error(`会话的第一句话 '${first}' mini-git 听不懂(want 或 push 开头才是正题)`)
  }
}

/** fetch 的服务端:want 的尖端走一遍对象枚举,减掉对方报上来的 have,剩下的打包送回。 */
function handleFetch(gitDir: string, socket: Socket, frames: { kind: 'data'; payload: Buffer }[]): void {
  const wants: string[] = []
  const haves = new Set<string>()
  for (const f of frames) {
    const line = lineOf(f)
    const want = /^want ([0-9a-f]{40})$/.exec(line)
    if (want) {
      wants.push(want[1])
      continue
    }
    const have = /^have ([0-9a-f]{40})$/.exec(line)
    if (have) {
      haves.add(have[1])
      continue
    }
    throw new Error(`fetch 请求里混进了不认识的行:'${line}'(该是 want 或 have 加 40 位哈希)`)
  }
  const missing = enumerateObjects(gitDir, wants).filter((h) => !haves.has(h))
  socket.end(Buffer.concat(frameObjects(gitDir, missing)))
}

/**
 * push 的服务端:先收货,再量尺,后挪引用。顺序有讲究:判快不快进要沿新尖端往回走,
 * 走之前对象得先落库。非快进的推送被拒时,对象已经留在库里——没有引用可达,
 * 正是第 8 章生死簿管的那种对象。真协议在协商阶段就拒,一个字节不收(差异附录)。
 */
function handlePush(gitDir: string, socket: Socket, frames: { kind: 'data'; payload: Buffer }[]): void {
  const first = lineOf(frames[0])
  const m = /^push (refs\/heads\/[A-Za-z0-9._/-]+):([0-9a-f]{40})$/.exec(first)
  if (!m) {
    throw new Error(`push 请求的第一行 '${first}' 不成形状(该是 push refs/heads/<分支>:<哈希>)`)
  }
  const [, ref, tip] = m
  storeObjectFrames(gitDir, frames.slice(1))
  const current = readRef(gitDir, ref)
  if (current !== null && !isAncestor(gitDir, current, tip)) {
    // 对端这条分支上有客户端缺的提交:硬推会让它们失去引用,拒绝
    socket.end(Buffer.concat([pktEncode(`ng ${ref} non-fast-forward\n`), FLUSH_PKT]))
    return
  }
  updateRef(gitDir, ref, tip)
  socket.end(Buffer.concat([pktEncode(`ok ${ref}\n`), FLUSH_PKT]))
}

// ---- 三个客户端操作 ----

/**
 * fetch:引用发现 → 算缺 → 拉对象 → 前移 remote-tracking 引用。
 * 只动对象库与 refs/remotes/<远端名>/<分支>;工作区、暂存区、HEAD 与本地分支一概不碰。
 */
export async function fetchObjects(gitDir: string, address: string): Promise<FetchReport> {
  const session = await openSession(address)
  const remote = remoteName(address)
  const heads = session.refs
    .filter((r) => r.name.startsWith('refs/heads/'))
    .map((r) => ({ branch: r.name.slice('refs/heads/'.length), hash: r.hash }))
  if (heads.length === 0) {
    session.send([]) // 空仓库:零号占位行不是错误,收线即散
    return { remote, pulled: 0, updated: [] }
  }
  const wants = [...new Set(heads.map((h) => h.hash))]
  const haves = new Set(enumerateObjects(gitDir, localTips(gitDir, remote)))
  const request: Buffer[] = []
  for (const h of wants) {
    request.push(pktEncode(`want ${h}\n`))
  }
  for (const h of haves) {
    request.push(pktEncode(`have ${h}\n`))
  }
  request.push(FLUSH_PKT)
  session.send(request)
  const frames = await session.reply()
  failOnErrorLine(frames)
  const pulled = storeObjectFrames(gitDir, frames)
  for (const h of heads) {
    updateRef(gitDir, `refs/remotes/${remote}/${h.branch}`, h.hash)
  }
  return { remote, pulled, updated: heads.map(({ branch, hash }) => ({ branch, hash })) }
}

/**
 * push:把本地分支尖端推给对端同名分支。送出的对象 = 本地尖端的闭包减去「对端广告里列得出、
 * 且本地走得动」的闭包;判词 ng 开头时抛错,non-fast-forward 意味着对端有你没有的提交。
 */
export async function pushObjects(gitDir: string, address: string, branch: string): Promise<PushReport> {
  const tip = readRef(gitDir, `refs/heads/${branch}`)
  if (tip === null) {
    throw new Error(`push:分支 '${branch}' 本地不存在(先 mini-git branch 看一眼现有的)`)
  }
  const session = await openSession(address)
  const theirs = new Set<string>()
  for (const r of session.refs) {
    // 广告里列得出、且本地读得到的尖端:它的闭包对端已经有了,不用重送
    if (r.name.startsWith('refs/heads/') && hasObject(gitDir, r.hash)) {
      for (const h of enumerateObjects(gitDir, [r.hash])) {
        theirs.add(h)
      }
    }
  }
  const send = enumerateObjects(gitDir, [tip]).filter((h) => !theirs.has(h))
  const ref = `refs/heads/${branch}`
  session.send([pktEncode(`push ${ref}:${tip}\n`), ...frameObjects(gitDir, send)])
  const frames = await session.reply()
  const verdict = firstDataLine(frames)
  if (verdict === null) {
    throw new Error('push:对端没有给判词——回信既不是 ok 也不是 ng')
  }
  if (verdict.startsWith('error ')) {
    throw new Error(`对端报错:${verdict.slice('error '.length)}`)
  }
  if (verdict === `ok ${ref}`) {
    return { branch, ref, to: tip, sent: send.length }
  }
  if (verdict === `ng ${ref} non-fast-forward`) {
    throw new Error(
      `push:远端拒绝了 ${ref}——non-fast-forward(对端的这条分支上有你缺的提交,硬推会丢掉它的历史;先 fetch 再合并,然后重推)`,
    )
  }
  if (verdict.startsWith(`ng ${ref}`)) {
    throw new Error(`push:远端拒绝了 ${ref}(${verdict.slice(`ng ${ref}`.length).trim()})`)
  }
  throw new Error(`push:看不懂对端的判词 '${verdict}'(该是 ok 或 ng 开头)`)
}

/**
 * clone:整仓库搬回家。引用发现 → 全量 want(本地是空仓库,一个 have 都没有)→ 落对象 →
 * 建本地分支与 remote-tracking 引用 → HEAD 跟对端 → 检出工作区并重建暂存区清单。
 * 对端是空仓库时只建骨架,不建任何分支。
 */
export async function cloneRepo(address: string, destDir: string): Promise<CloneReport> {
  const session = await openSession(address)
  const remote = remoteName(address)
  const heads = session.refs
    .filter((r) => r.name.startsWith('refs/heads/'))
    .map((r) => ({ branch: r.name.slice('refs/heads/'.length), hash: r.hash }))
  const gitDir = initRepo(destDir)
  if (heads.length === 0) {
    session.send([]) // 零号占位行的意思就是「我什么都没有」:骨架建好,散场
    return { dir: destDir, objects: 0, branches: [], head: 'main', files: 0, empty: true }
  }
  const wants = [...new Set(heads.map((h) => h.hash))]
  session.send([...wants.map((h) => pktEncode(`want ${h}\n`)), FLUSH_PKT])
  const frames = await session.reply()
  failOnErrorLine(frames)
  const objects = storeObjectFrames(gitDir, frames)
  for (const h of heads) {
    updateRef(gitDir, `refs/heads/${h.branch}`, h.hash)
    updateRef(gitDir, `refs/remotes/${remote}/${h.branch}`, h.hash)
  }
  // HEAD 跟对端:广告里的 HEAD 哈希落在哪条分支就上哪条;对不上退到 main,再不行取第一条
  const advertisedHead = session.refs.find((r) => r.name === 'HEAD')
  const headBranch =
    heads.find((h) => advertisedHead !== undefined && h.hash === advertisedHead.hash)?.branch ??
    (heads.some((h) => h.branch === 'main') ? 'main' : heads[0].branch)
  attachHead(gitDir, `refs/heads/${headBranch}`)
  const tip = readRef(gitDir, `refs/heads/${headBranch}`)!
  const tree = parseCommit(readObject(gitDir, tip).body).tree
  checkoutTree(gitDir, tree, destDir)
  const entries = [...flattenTree(gitDir, tree)].map(([path, sig]) =>
    makeIndexEntry(path, sig.hash, statSync(join(destDir, path))),
  )
  saveIndex(gitDir, entries)
  return {
    dir: destDir,
    objects,
    branches: heads.map((h) => h.branch),
    head: headBranch,
    files: entries.length,
    empty: false,
  }
}
