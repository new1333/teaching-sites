// AOF（Append Only File，追加式日志）：每条写命令执行成功后原样追加进一本只增不减的账，
// 重启时从头到尾重放一遍，数据就回来了。与数据库写前日志（WAL）相反——先干活、后记账，
// 没干成的命令不进账，账上便永远没有「内存里没发生过的事」。
// 落盘分两层（照抄真货的模型）：write 每笔必走——命令离开进程、进内核缓冲，进程崩了它还在；
// fsync 按三档策略钉盘——把内核缓冲真正写进磁盘，断电也要它在。两层都做成可注入回调：
// 测试注入收集器不真写盘，boot 注入文件版（writeSync / fsyncSync）。

import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { encodeCommand, RespDecoder } from './resp.ts'

// fsync 三档（真货 appendfsync 同名同义）：always 每笔必钉 / everysec 至多一秒一钉 / no 从不主动钉
export type FsyncPolicy = 'always' | 'everysec' | 'no'

export class Aof {
  // 账本本体：一条一条写命令（与 execute 收到的参数同构）。内存里这份永远最全——盘只是副本
  private log: string[][] = []
  private policy: FsyncPolicy
  // 第一层：write(2) 的替身——每笔必走，数据进内核缓冲（进程崩了也不丢）
  private write: ((text: string) => void) | null
  // 第二层：fsync(2) 的替身——把内核缓冲真正钉进磁盘（断电也不丢）
  private fsync: (() => void) | null
  // 重写专用：整文件换新（截断重写）——追加没法瘦身，旧账必须整体作废
  private reset: ((whole: string) => void) | null
  private now: () => number
  private lastFsyncAt = Number.NEGATIVE_INFINITY // everysec 的上一钉：开机第一笔永远立刻钉
  private loading = false // 重放进行中：这笔本就来自账本，再记就翻倍——账不能边放边抄
  private fsyncCount = 0

  constructor(options: {
    policy?: FsyncPolicy
    write?: (text: string) => void
    fsync?: () => void
    reset?: (whole: string) => void
    now?: () => number
  } = {}) {
    this.policy = options.policy ?? 'everysec' // 真货默认 appendfsync everysec——折中档
    this.write = options.write ?? null
    this.fsync = options.fsync ?? null
    this.reset = options.reset ?? null
    this.now = options.now ?? Date.now
  }

  // 记一笔：命令执行成功才轮到它（写后日志的「写后」二字）。出门就 write，fsync 按三档来
  append(cmd: string[]): void {
    if (this.loading) return
    const text = encodeCommand(cmd)
    this.log.push([...cmd])
    this.write?.(text) // 第一层每笔必走：真货每个事件循环圈把新命令 write(2) 进文件
    if (this.policy === 'always') this.doFsync() // 最稳最慢：一笔一钉
    else if (this.policy === 'everysec' && this.now() - this.lastFsyncAt >= 1000) this.doFsync()
    // 'no'：从不主动钉——交给内核自己的脾气（Linux 默认约 30 秒刷一次盘）
  }

  // 账本现状：重放的原料、测试与 INFO 的观察口
  entries(): string[][] {
    return this.log.map((cmd) => [...cmd])
  }

  // 账本条数（INFO 的 aof 观察口：重写前后一查，瘦身肉眼可见）
  get size(): number {
    return this.log.length
  }

  // 开机以来真正钉盘的次数（三档策略的节奏差，一查便知）
  get syncs(): number {
    return this.fsyncCount
  }

  // 重写：不看历史、只看现状——问内存要一份最小命令集，整本换掉。
  // 100 次 SET 同一个键？内存里只有最后一个值，最小集就一条。等价，但小得多。
  // 真货 fork 子进程后台做（fork 是下一章主角），教学版同进程同步做（差异清单登记）
  rewriteFrom(collectWriteCmds: () => string[][]): string[][] {
    const fresh = collectWriteCmds().map((cmd) => [...cmd])
    this.log = fresh
    if (this.reset) {
      this.reset(fresh.map(encodeCommand).join('')) // 新账整体替换旧文件，顺手钉盘
      this.lastFsyncAt = this.now()
      this.fsyncCount++
    }
    return fresh.map((cmd) => [...cmd])
  }

  // 重放：把账逐条交给回放器（新实例的 execute）。放账期间不许记账——每条都会真的执行一遍
  load(replay: (cmd: string[]) => void): void {
    this.loading = true
    try {
      for (const cmd of this.log) replay([...cmd])
    } finally {
      this.loading = false
    }
  }

  // 开机装载：把磁盘上读回的旧账装进内存（createFileAof 用）——原样来自盘，不必再写
  restore(cmds: string[][]): void {
    this.log = cmds.map((cmd) => [...cmd])
  }

  private doFsync(): void {
    this.fsync?.()
    this.lastFsyncAt = this.now()
    this.fsyncCount++
  }
}

// 文件版外壳（boot 演示用）：账落在磁盘文件上，格式照抄真货——RESP 编码的命令流，
// 于是「加载 AOF」就是「用第 2 章的解码器把文件再解一遍」。
// write = writeSync（进内核缓冲）；fsync = fsyncSync（钉进磁盘）；重写 = 截断换新账
export function createFileAof(path: string, options: { policy?: FsyncPolicy } = {}): Aof {
  let text = ''
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    // 首次开机：还没有旧账
  }
  const fd = { handle: openSync(path, 'a') } // 账本句柄全程开着：追加不重开，与真货同款姿势
  const aof = new Aof({
    policy: options.policy,
    write: (chunk) => writeSync(fd.handle, chunk), // write(2)：进程崩了，内核缓冲里的它还在
    fsync: () => fsyncSync(fd.handle), // 第 3 章欠的 fsync 在这兑现：从内核缓冲真正钉进磁盘
    reset: (whole) => {
      closeSync(fd.handle)
      fd.handle = openSync(path, 'w') // 截断换新：重写不是续写旧账，是整本替换
      try {
        writeSync(fd.handle, whole)
        fsyncSync(fd.handle)
      } finally {
        closeSync(fd.handle)
        fd.handle = openSync(path, 'a') // 回到追加姿势
      }
    },
  })
  aof.restore(new RespDecoder().feed(text))
  return aof
}
