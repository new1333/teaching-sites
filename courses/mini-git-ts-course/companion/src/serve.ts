// src/serve.ts · 引用发现:TCP 最小服务与 ls-remote 客户端
//
// 本章只借真 git smart protocol 的两层:pkt-line 帧(来自 src/pkt.ts)与「连上先送引用清单」
// 这个握手。承载层从简(登记差异附录):真跑在 SSH/HTTP 上,清单行还带能力协商,后续有
// want/have 与 packfile 传输;mini-git 用自己的裸 TCP 承载,送完清单即收线,不与真 git 服务互通。
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { AddressInfo, connect, createServer, type Server, type Socket } from 'node:net'
import { listBranches, readRef, resolveHead } from './refs.ts'
import { FLUSH_PKT, pktDecode, pktEncode, type PktFrame } from './pkt.ts'

/** 对端引用清单里的一条:引用名加它此刻指向的哈希。 */
export type RemoteRef = { name: string; hash: string }

/** 起服务的句柄:port 是实际绑上的端口(传 0 由系统随机分配);close 收线不留监听句柄。 */
export type RefServer = { server: Server; host: string; port: number; close(): Promise<void> }

/** 引用发现流里没有真引用时的占位名字,连同 40 个 0 一起,只在线上出现。 */
export const ZERO_ID = '0'.repeat(40)

/**
 * 把服务端的引用清单编成一段引用发现流:HEAD 有效就第一行先报 HEAD,其余分支按名字排序,
 * 结尾一个 flush 帧。pack-protocol 的两条原话各自对上:HEAD MUST be the first advertised ref;
 * The stream MUST be sorted by name according to the C locale ordering。
 * 一条分支都没有(unborn 仓库)时按真协议的空清单口径:发零号占位行 capabilities^{}——
 * 真协议这一行还带 NUL 加能力清单,mini-git 没有能力可报,只留零号名字(差异附录)。
 * 每条连接现编现送:对端引用变了,下一条连接拿到的就是新值。
 */
export function encodeRefAdvertisement(gitDir: string): Buffer {
  const lines: string[] = []
  const head = resolveHead(gitDir)
  if (head !== null) {
    lines.push(`${head} HEAD\n`) // 与分支行同款形状,只是名字叫 HEAD
  }
  for (const branch of listBranches(gitDir)) {
    lines.push(`${readRef(gitDir, `refs/heads/${branch}`)} refs/heads/${branch}\n`)
  }
  if (lines.length === 0) {
    return Buffer.concat([pktEncode(`${ZERO_ID} capabilities^{}\n`), FLUSH_PKT])
  }
  return Buffer.concat([...lines.map((line) => pktEncode(line)), FLUSH_PKT])
}

/**
 * TCP 最小服务:listen(默认 127.0.0.1 加随机端口),每条连接先送一遍引用发现流,送完即收线。
 * 从简口径:单条连接出错不让整个服务倒下;没有多客户端并发控制,实验场与测试够用。
 */
export async function startRefServer(
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
    socket.end(encodeRefAdvertisement(gitDir))
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

/**
 * 引用发现客户端:连上对端,读整段流直到收线,把每帧拆成「哈希 + 引用名」。
 * 网络分片可能从任何位置剪开:先攒齐再解;没等到 flush 收尾的流不认账。
 * 宽收口径与文档对齐:行尾换行有就剥、没有不追究;obj-id 大小写不敏感。
 */
export async function discoverRefs(address: string): Promise<RemoteRef[]> {
  const { host, port } = parseAddress(address)
  const socket = connect({ host, port })
  socket.on('connect', () => socket.end()) // 看清单的客户端连上就把写侧收掉:一个字节不说,服务端送完清单即送客
  return new Promise<RemoteRef[]>((resolve, reject) => {
    const chunks: Buffer[] = []
    socket.on('error', (err) => {
      socket.destroy()
      reject(new Error(`ls-remote:连不上 ${host}:${port}(${err.message})——对端起 mini-git serve 了吗?`))
    })
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('close', () => {
      try {
        const { frames } = pktDecode(Buffer.concat(chunks))
        if (!frames.some((f) => f.kind === 'flush')) {
          throw new Error('ls-remote:流读到头也没等到 flush 收尾帧——对端发的不是 mini-git 的引用发现流')
        }
        resolve(parseRefLines(frames))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
  })
}

/** 把 '主机:端口' 拆开;端口必须是 1-65535 的整数,其余当场报错。 */
export function parseAddress(address: string): { host: string; port: number } {
  const colon = address.lastIndexOf(':')
  if (colon < 0) {
    throw new Error(`ls-remote:地址 '${address}' 少了端口——写成 主机:端口,如 127.0.0.1:9419`)
  }
  const host = address.slice(0, colon)
  const portText = address.slice(colon + 1)
  const port = Number(portText)
  if (host === '' || !/^\d+$/.test(portText) || port < 1 || port > 65535) {
    throw new Error(`ls-remote:地址 '${address}' 不成形;要 主机:端口,端口是 1-65535 的整数`)
  }
  return { host, port }
}

/** 把数据帧逐行拆成引用条目;坏行当场报错,不猜。 */
export function parseRefLines(frames: PktFrame[]): RemoteRef[] {
  const refs: RemoteRef[] = []
  for (const frame of frames) {
    if (frame.kind === 'flush') {
      continue // 收尾记号,不是条目
    }
    const text = frame.payload.toString('utf8')
    const line = text.endsWith('\n') ? text.slice(0, -1) : text
    if (!/^[0-9a-f]{40} /i.test(line)) { // 大小写不敏感地收(pack-protocol 的 MUST);mini-git 发的一律小写
      throw new Error(`ls-remote:引用发现流里混进了不成形的行:'${line}'(该是 40 位哈希 + 空格 + 引用名)`)
    }
    refs.push({ hash: line.slice(0, 40), name: line.slice(41) })
  }
  return refs
}
