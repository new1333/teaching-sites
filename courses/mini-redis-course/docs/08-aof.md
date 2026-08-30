---
title: AOF：把每一步写下来重放
---

# AOF：把每一步写下来重放

先接上第 7 章末尾那句话：内存这一关守住了——满了会拒、会腾、账本记得清，可这一切都活在内存里，断一次电全没了。从这一章起进入新的部分：内存会断电。还有三笔旧账要还。第 3 章说 fsync 会在某章正式登场——这个把数据真正钉进磁盘的系统调用，到底在钉什么？第 6、7 章各留了一句「键过期/淘汰时真 Redis 会向 AOF 补记一条 DEL」——为什么一条删除需要「补记」？这两个问题其实是同一个问题的两面，答案都在本章的三个字母里：AOF。

## 凌晨三点的重启发布：缓存全空，数据库打红

周二凌晨三点，订单服务按计划滚动发布。Redis 进程重启，一秒钟后就绪——看起来毫无异常。三十秒后，数据库的 CPU 告警响了：登录态全没了，每个请求都要回源查一次数据库；限流计数器全归零，攒了一晚上的风控规则瞬间失效；缓存命中率从 95% 掉到 0，冷启动的流量洪峰整个砸向数据库。第 1 章讲过的缓存雪崩，就这样在发布窗口里兑现了一遍。

问题的根源朴素得吓人：**你的数据住在内存里，而进程一重启，内存整个归还系统**。前七章建的一切——哈希表、跳表、寿命簿、淘汰台账——都在同一个进程的地址空间里。进程死了，它们就没了；不落盘的内存数据库，重启等于丢数据，这不是事故，是默认行为。要救，只有一个办法：在内存之外留一份「重启后能照着重来一遍」的东西。业界两条路：隔一阵拍一张全量照片（RDB 快照，下一章），或者把每一步写命令都记下来（AOF，本章）。这一章把 AOF 写出来：Aof 类（追加、重放、重写）、fsync 三档刷盘策略、还有 dropKey 里那笔补记的 DEL。落成里程碑：SET 十轮后「重启」，GET 仍返回最后一轮的值；重写后日志条数肉眼可见变小。

## 原理：一本只记事实的账

### AOF 是什么：写后日志

AOF（Append Only File，追加式日志文件）的思路一句话讲完：每条写命令执行完，把它原样追加到一本只增不减的账里；重启时把账从头到尾重放（再执行一遍），数据就回来了。redis.io 文档的原话：「AOF 持久化记录服务器收到的每一条写操作。这些操作可以在服务器启动时再次重放，重建出原始数据集。」账本的格式也不新鲜——就是 RESP 编码的命令流，和你第 2 章写的解码器吃的完全同一种字节。antirez 在博客里专门提过这一点：AOF「用的是客户端与 Redis 通信的完全相同的格式」，甚至可以直接用 netcat 把一个 AOF 文件灌进另一个实例。

锚点就用圣经里那句：记账本。先花完钱再记一笔；破产（重启）之后，按账本一笔笔重花，钱包就回到了破产前的状态。

这里有一个大概率已经住在你脑子里的误区，先公允地把它复述出来。你用过数据库，知道数据库有 WAL（Write-Ahead Log，写前日志）：先记日志、再改数据，几乎整个磁盘数据库世界都这么干——所以「持久化日志 = 先记账后动手」的直觉很有来处，不丢人。但 **AOF 是写后日志：先执行命令，干成了才记账**，顺序正好相反。

为什么 Redis 敢反过来？做反事实检验：假如像 WAL 那样先记账再执行，会发生什么。验参、类型门禁、内存关——第 7 章那道 OOM 的闸——全都在执行路径上。命令还没执行，你不知道它会不会被拒。先记了账，被拒的命令就已经躺在盘上了；重放的时候，它面对的是一个全新的空库：内存关不拦它（CONFIG 不入账，重放时没有 maxmemory），一条从未发生过的写就此「复活」。账和原库对不上，重放就失去了意义。写成「先执行、成功才记」，这个问题从根上不存在：**账上永远只有真发生过的事**。antirez 的博客里有一个现成的例子：向 AOF 记 SET、再记一条 DEL 一个不存在的键——「最后这条 DEL 没有入账，因为它没有对数据集产生任何修改」。我们的 dropKey 正是这么写的：键真被删掉才记那一笔 DEL。

再往深一层：数据库的 WAL 为什么必须写前？因为它改的是磁盘上就地的数据页——改到一半断电，页本身坏了，得靠日志重做或回滚。也就是说，WAL 写前保护的是「磁盘上的正本」。Redis 恰好没有这个负担。内存是正本，AOF 只是抄本；抄本只追加、从不改写已落盘的内容，追加式日志天生没有「改了一半」这回事。文档的原话：append-only，「没有寻道，断电也不会有损坏问题」。写前在 Redis 这儿买不来任何东西，反而丢掉了「只记生效命令」的干净语义。

写后也有代价：从「命令在内存里干成了」到「这笔账钉进了磁盘」之间有一个窗口，窗口里的尾巴可能丢。这个窗口怎么收，就是刷盘策略的事，原理最后一节讲。

### 重放：新实例把账再执行一遍

重放没有魔法。所谓「重启恢复」，就是新建一个空库，把账本上的命令逐条喂给 execute——SET 就再 SET 一遍，DEL 就再 DEL 一遍。重放的终点状态，等于记账时那台库的内存状态。

但有两种「内存变了、账上没有」的情况，会让重放的结果偏离原库。第一种好懂：服务器自己删掉的键。过期删除（第 6 章）和内存淘汰（第 7 章）都删键，可没有任何客户端下过 DEL——命令日志里自然没有这笔。重放会把 SET 原样重演，这个键就带着「完整的寿命」回来了。更糟的是寿命的语义：账上记的是 SET code 42 EX 100，重放发生在很久之后，这 100 秒从重放那一刻重新起算（真货逐条账同样如此——记的就是相对秒数）。「重启前它已经死了」这个事实，账上没有。EXPIRE 命令文档把解法说得很直白：「为了在不牺牲一致性的前提下取得正确行为，键过期时，会在 AOF 文件与所有已连接的从库中合成一条 DEL 操作。」**重放的世界里没有「时间已经过去」，只有账上记没记**——所以服务器自发的删除必须补记死讯，这笔账记在 dropKey 里，过期、淘汰、DEL 三条删除路共用。这就是第 6、7 章那两句承诺的兑现处。

第二种更隐蔽，留给你在自查里推演（重写会把 DEL 掉的键彻底忘掉——这是特性不是缺陷）。

### AOF 重写：按内存现况重新记账

账只增不减，问题迟早爆发。redis.io 文档举的例子正好是我们的里程碑：「把一个计数器递增 100 次，数据集里只有一个键存着最终值，AOF 里却有 100 条记录。其中 99 条对重建当前状态毫无用处。」

AOF 重写（rewrite）的解法干净得出人意料：**重写不是整理旧账，是按内存现况重新记一本**。遍历当前键空间，每个字符串键记一条 SET、每个排行榜记一条 ZADD（带寿命的补一条 EXPIRE），新旧两本账在「重放后等价」意义上相同，新账却只含最少必要的命令。100 次 SET 同键，内存里只有最后一个值，新账就一条。旧账连同一并作废换掉——重写期间不欠旧日志任何东西，因为新账的原料是内存，不是旧账。

真货的 BGREWRITEAOF 在后台做这件事。文档说它会「写出重建当前内存数据集所需的最短命令序列」，用的还是「快照同款的写时复制技巧」。fork 出子进程去写新账，主进程照常接客。fork 和写时复制是下一章的主角，教学版先做声明简化：同进程同步重写，命令返回时账已换新（差异清单登记，bible 里也有这笔）。还有一笔顺带的真货现状：7.0 起 AOF 拆成基础文件加增量文件再加一份清单的多部式结构，教学版保持单文件，视野即可。

### 刷盘策略：write 管进程崩，fsync 管断电

最后还第 3 章的账。那一章讲事件循环时埋了一句：fsync 会在 AOF 章正式登场。它到底是干什么的？

先要拆掉一个常见的含混：「写到文件」其实有两层。第一层是 write 系统调用：把数据从进程交进操作系统内核的缓冲区。这一步完成，数据就不再属于进程——进程崩了、被 kill 了，内核照样替你留着，之后会落盘。第二层才是 fsync 系统调用：命令内核把缓冲区里这笔数据真正写进磁盘，写到断电也不丢为止。antirez 的原话：「用 write(2) 写进内核缓冲，给我们对进程故障的数据安全；用 fsync(2) 提交到磁盘，给我们对断电这类彻底系统故障的数据安全。」fsync 慢得有名：它要等磁盘真正完成写入（磁盘往返是第 1 章标尺上最慢的那一档），期间还会阻塞同一文件上的其他写。

于是「什么时候 fsync」成了三档选择题，官方名字 appendfsync，我们叫刷盘策略：

- always：每笔账写完立刻 fsync。最安全也最慢，文档原话「非常非常慢，非常安全」。
- everysec：至多一秒钉一次。出事至多丢一秒的数据，官方建议档、也是默认档。
- no：从不主动 fsync，交给操作系统看着办——Linux 内核默认大约每 30 秒自己刷一次。

三档没有对错，是钱（磁盘往返延迟）换命（能容忍丢多少）的连续谱。教学版把两层各做成一个可注入的回调：write 每笔必走（教学版也照此办理）；fsync 按三档来，测试里注入收集器数次数，boot 里用真的 fsyncSync。**write 管进程崩溃，fsync 管断电**——这句话值得原样背走。

## 演练：先有账，再挂钩，最后落到文件

本章演进三件事：src/aof.ts 从零写出 Aof；src/db.ts 把记账挂进命令层（写命令成功后 append、dropKey 补记 DEL、BGREWRITEAOF 命令、INFO 加 aof 条数）；src/boot.ts 换上文件版账本。测试 tests/aof.test.ts 十三条，照例先写先跑出红。文件头的职责注释把模型一次说清：

```ts
// src/aof.ts · 文件头
// AOF（Append Only File，追加式日志）：每条写命令执行成功后原样追加进一本只增不减的账，
// 重启时从头到尾重放一遍，数据就回来了。与数据库写前日志（WAL）相反——先干活、后记账，
// 没干成的命令不进账，账上便永远没有「内存里没发生过的事」。
// 落盘分两层（照抄真货的模型）：write 每笔必走——命令离开进程、进内核缓冲，进程崩了它还在；
// fsync 按三档策略钉盘——把内核缓冲真正写进磁盘，断电也要它在。两层都做成可注入回调：
// 测试注入收集器不真写盘，boot 注入文件版（writeSync / fsyncSync）。
```

### 第一步：Aof——账本、两层落盘、重写与重放

字段就是全部状态的清单：账本本体、三档策略、两个落盘回调、一个重写回调、时钟，外加两个标记（上一钉的时刻、是否正在重放）。

```ts
// src/aof.ts · 字段与构造
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
```

append 是写后日志的化身：先入账、出门就 write、fsync 按三档裁决。注意 loading 那道闸——重放期间不许记账，否则每重启一次账就翻一倍。

```ts
// src/aof.ts · append
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
```

三档共用同一个钉盘动作，四行就是全部家当：

```ts
// src/aof.ts · doFsync
  private doFsync(): void {
    this.fsync?.()
    this.lastFsyncAt = this.now()
    this.fsyncCount++
  }
```

重写与重放是一对反方向的门：重写问内存要新账（collectWriteCmds 由持有内存的人提供），重放把账交给回放器。

```ts
// src/aof.ts · rewriteFrom
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
```

```ts
// src/aof.ts · load 与 restore
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
```

### 第二步：挂进命令层——四处一行的小手术加一个新命令

MiniRedis 的构造函数接一个可选的 aof，接上就当场重放——「重启恢复」在教学版里就是这一行。「重启」的语义也在这：新建实例、共用同一本账，账活得比实例久，扮演磁盘的角色。

```ts
// src/db.ts · 构造函数的尾部
    // 开机装载：新实例先把 AOF 旧账逐条重放——「重启恢复」在教学版里就是这一行。
    // 重放期间 Aof 不再记账：账已在手上，边放边抄会翻倍
    this.aof?.load((cmd) => this.execute(cmd))
```

记账的挂钩只有一行厚，全部贴在「命令干成了」的判定点之后。set 与 zadd 在回 OK、回条数之前，expire 在回 1 之前，各记一笔原样命令；统一删键路径里补记死讯。被 OOM 拒掉的 SET、撞上 WRONGTYPE 的 ZADD 走不到挂钩，自然不进账——写后日志的语义不是靠判空实现的，是靠挂钩的位置。

```ts
// src/db.ts · dropKey：三条删键路的公共出口（含本章新增的第四行）
  // 统一删键路径：主表、寿命簿、idle 登记一次清干净——DEL、过期、淘汰三条路都从这走。
  // 回「主表里本来有没有这个键」
  private dropKey(key: string): boolean {
    const existed = this.data.delete(key)
    if (existed) {
      this.expirer.remove(key) // 寿命登记随键撤——不然簿里留孤儿，活键背黑锅
      this.evictor.remove(key) // idle 登记同理：键都没了，别再占着近似 LRU 的表
      this.aofLog(['DEL', key]) // 补记死讯：没人下过 DEL 命令的删除（过期、淘汰）也得让重放知道
    }
    return existed
  }
```

BGREWRITEAOF 是本章唯一的新命令，配一个「问内存要最小命令集」的收集器：

```ts
// src/db.ts · aofLog、bgrewriteaof 与 collectWriteCmds
  // 写后记账（第 8 章）：命令干成了才进账本。aof 可选——不挂就是不记账
  private aofLog(cmd: string[]): void {
    this.aof?.append(cmd)
  }

  // BGREWRITEAOF：按当前内存反推最小命令集，整本换掉臃肿的日志。真货 fork 子进程后台做
  // （fork 是下一章主角），教学版同进程同步做——命令返回时账本已换新（差异清单登记）
  private bgrewriteaof(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for BGREWRITEAOF')
    if (this.aof === null) return encodeError('ERR AOF is not enabled') // 教学版口径：没挂账本就没得重写
    this.aof.rewriteFrom(() => this.collectWriteCmds())
    return encodeSimpleString('OK')
  }

  // 最小命令集：不看历史、只看现状——每个字符串键一条 SET、每个排行榜一条 ZADD（全成员一条），
  // 带寿命的键再补一条 EXPIRE（剩余秒数；真货重写时用 PEXPIREAT 存绝对时刻，差异清单登记）。
  // EXPIRE 必须排在键的 SET/ZADD 之后：先有键，寿命簿才有处可记
  private collectWriteCmds(): string[][] {
    const cmds: string[][] = []
    for (const [key, value] of this.data.entries()) {
      if (typeof value === 'string') cmds.push(['SET', key, value])
      else cmds.push(['ZADD', key, ...value.entries().flatMap(([m, s]) => [String(s), m])])
    }
    for (const key of this.expirer.keys()) {
      const ms = this.expirer.getTtl(key)
      if (ms !== null && ms > 0) cmds.push(['EXPIRE', key, String(Math.ceil(ms / 1000))]) // 僵尸键不入新账：死了的别复活
    }
    return cmds
  }
```

顺手把 INFO 加一个观察口：末尾多一行 `aof:${this.aof?.size ?? 0}`（当前全形态见第 4 章引用块）。重写前后各查一次，瘦身肉眼可见——这是 milestone 的可感知面。

### 第三步：boot 落到真文件

开机入口换上文件版账本，「重启不再两袖清风」从此是真的。

```ts
// src/boot.ts · 全貌
// 亲手开机入口：node src/boot.ts 起服务，然后用 redis-cli -p 6399 连它。
// 第 8 章起带上 AOF：账本落在 appendonly.aof，开机先把旧账重放一遍——重启不再两袖清风
import { MiniRedis } from './db.ts'
import { createMiniRedisServer } from './server.ts'
import { createFileAof } from './aof.ts'

const port = Number(process.argv[2] ?? 6399)
const aof = createFileAof('appendonly.aof') // 默认 everysec：折中档——两条命令隔一秒以上就都会钉盘
const server = await createMiniRedisServer(new MiniRedis({ aof }), port)
console.log(`mini-redis 已就绪：redis-cli -p ${server.port} PING（AOF 开机重放 ${aof.size} 条）`)
```

createFileAof 做三件事。开机读旧账，文件不存在当空账；把两层回调接到真的 writeSync/fsyncSync 上；重写时截断换新。第 3 章欠的 fsync 在 fsync 那一行还上。

```ts
// src/aof.ts · createFileAof
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
```

### 先红后绿

测试照例先写先跑，第一次全红——aof.ts 还不存在，import 直接失败。十三条里三张脸最值得看。第一张钉两层落盘的节奏，手拨假钟加两个计数回调，不真写盘。

```ts
// tests/aof.test.ts · everysec：写归写，钉归钉
  it('everysec：write 每笔都走（进程崩了不丢），fsync 一秒至多钉一次（断电至多丢一秒）', () => {
    const clock = fakeClock(1_000_000)
    let writes = 0
    let pins = 0
    const aof = new Aof({
      policy: 'everysec',
      now: clock.now,
      write: () => writes++,
      fsync: () => pins++,
    })
    aof.append(['SET', 'a', '1']) // 开机第一笔：距上一钉「无穷久」，立刻钉
    expect(writes).toBe(1)
    expect(pins).toBe(1)
    clock.advance(400)
    aof.append(['SET', 'b', '2']) // 距上钉 0.4s：写归写，钉先欠着
    clock.advance(400)
    aof.append(['SET', 'c', '3']) // 距上钉 0.8s：还是欠着
    expect(writes).toBe(3)
    expect(pins).toBe(1)
    clock.advance(300)
    aof.append(['SET', 'd', '4']) // 距上钉 1.1s：这笔进门时顺路钉一把
    expect(writes).toBe(4)
    expect(pins).toBe(2)
    expect(aof.size).toBe(4) // 钉不钉，内存账本都是全的——盘只是副本
  })
```

第二张是第 6 章承诺的兑现处。过期删除之后，账上多出一条没人下过命令的 DEL，「重启」后键不还魂。

```ts
// tests/aof.test.ts · 过期补记 DEL
  it('过期补记 DEL：惰性删除那一刻账上多一笔死讯，「重启」后键不还魂（第 6 章承诺兑现）', () => {
    const clock = fakeClock(0)
    const aof = new Aof({ now: clock.now })
    const db1 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    db1.execute(['SET', 'code', '42', 'EX', '100'])
    clock.advance(200_000)
    expect(db1.execute(['GET', 'code'])).toBe('$-1\r\n') // 惰性删除：没人下过 DEL，键却没了
    expect(aof.entries()).toEqual([
      ['SET', 'code', '42', 'EX', '100'],
      ['DEL', 'code'], // 服务器自发删除也要记账——否则重放会把键连本带利救活
    ])
    const db2 = new MiniRedis({ aof, now: clock.now, cycleMs: Infinity })
    expect(db2.execute(['GET', 'code'])).toBe('$-1\r\n')
    expect(db2.execute(['TTL', 'code'])).toBe(':-2\r\n') // 不是「还魂再等 100 秒」，是压根没有它
  })
```

第三张是里程碑剧本本尊：SET 十轮、「重启」、GET 最后一轮，外加 TCP 侧一条「关服再开」的端到端版。第 7 章的淘汰补记 DEL 同样有钉子（allkeys-lru 踢掉的键，重启后也真没了），篇幅起见不贴。实现落地，全书 92 条全绿——第 2 到 7 章的 79 条旧测试一行未改，它们仍是公共 API 的哨兵。

## 验证：亲手断电，亲手瘦身

1. 双硬门槛先跑一遍：`cd companion && npm run typecheck && npm test`——typecheck 干净，92 条全绿（旧 79 条 + 本章 13 条）。
2. 重启实验，凌晨那场发布的复盘：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`，依次 `SET login:alice token-1`、`SET counter 7`、`ZADD board 10 alice`（各回 OK）。回到终端 1 按 Ctrl-C——「进程死了」。再 `node src/boot.ts`：开机那行应显示 `AOF 开机重放 3 条`。先猜后跑：`GET login:alice` 回什么？`token-1`。`GET counter`、`ZCARD board` 也都在。冷启动的雪崩，此刻在你手里拆掉了。（想重跑旧章的开机实验，先删掉 companion 目录下的 appendonly.aof——账本从此跨开机复利。）
3. 瘦身实验：灌一百笔同键写——bash 用 `for i in $(seq 1 100); do redis-cli -p 6399 SET counter v$i > /dev/null; done`（PowerShell 用 `1..100 | ForEach-Object { redis-cli -p 6399 SET counter "v$_" }`）。`INFO` 应见 `aof:103`（上一实验的 3 条旧账也在，3 加 100）；`BGREWRITEAOF` 回 OK；再 `INFO`——`aof:3`（三个活键各一条，一百笔同键写只剩最后一条）；`GET counter` 仍是 `v100`。等价，但小了一百倍。
4. 先猜后跑，寿命的去向：`SET code 42 EX 100`，等 40 秒再 `BGREWRITEAOF`，前后各查一次 `INFO`——`aof` 条数多了一条，多的那条是 `EXPIRE`（重写要把剩余寿命也记进最小集）。跑 `TTL code`——回 60 上下，与那 40 秒对得上。
5. 指认一处小破坏：打开 src/db.ts，把 dropKey 里那行 `this.aofLog(['DEL', key])` 注释掉。先猜 tests/aof.test.ts 哪两条会红；再跑 `npx vitest run tests/aof.test.ts` 对照。红两条：「过期补记 DEL」（entries 里少了那笔 DEL）与「淘汰补记 DEL」（db2 的 GET a 拿到了值，被淘汰的键复活了）。改回去，回到全绿。这条破坏就是第 6、7 章两句承诺的全部重量。

## 收束：那场发布，现在你能一条条拆开

回到凌晨三点。现在你知道那场雪崩的每一环：进程重启，内存归还系统，缓存自然全空；你也知道解法已经写进你的服务器——账本活得比进程久，开机先重放，登录态与限流计数原样回来，数据库不用挨那一波。下次发布窗口，冷启动不再是赌注。

五个新词各收一句。写后日志——先执行、成功才记账的日志顺序，账上永远只有真发生过的事；数据库 WAL 写前是为了保护磁盘上的正本，Redis 正本在内存，抄本只追加，写前买不来什么。AOF——追加式日志文件，每条写命令执行完原样追加，格式就是 RESP。重放——把账从头到尾再执行一遍，重启恢复的全部含义。AOF 重写——按当前内存反推最小命令集整本换新，100 条同键 SET 只留最后一条。刷盘策略——fsync 什么时候钉盘的三档选择：always 每笔、everysec 每秒、no 交给内核。你的第八个里程碑落定：Aof 一类、BGREWRITEAOF 一令、INFO 里能亲眼看涨的 aof 条数——断电、重放、瘦身三种局面都亲手演过。

本章与真 Redis 的差异记六笔（汇总进附录差异清单）：重写同进程同步做（真货 fork 子进程加写时复制，重写期间照常接客，命令回「后台重写已启动」的教学简化版 OK）；everysec 没有后台线程，钉盘点只搭在写路径上（真货后台线程每秒必钉，安静下来的尾巴一秒内会被补钉，教学版要等下一笔写进门）；write 逐笔单写（真货按事件循环圈批量 write）；重写时寿命记剩余秒数（真货记 PEXPIREAT 绝对时刻，重放后寿命不重置）；多键 DEL 拆成单键 DEL 记账、且只记真删掉东西的 DEL（真货按原命令记，重放等价）；没有自动重写触发与损坏修复（auto-aof-rewrite-percentage、redis-check-aof，7.0 的多部式 AOF 也从简）。

自查三问（先自己答，再展开对）：

1. 把 src/aof.ts 里 everysec 的判定 `>= 1000` 改成 `>= 0`（每笔必钉），tests/aof.test.ts 里哪条会红？always 与 no 的两条为什么不红？改回去。
2. 机房断电与进程被 kill，三档策略各丢多少数据？用「write 管进程崩、fsync 管断电」推一遍，再说说教学版 everysec 的尾巴在两种事故下各是什么命运。
3. 纸上重写一遍：账上依次有 SET k v1、SET k v2、DEL k、SET k v3、SET m 5 EX 60（当前时刻刚设 60 秒）。BGREWRITEAOF 之后账上是哪几条？把 k 换成「设了 EXPIRE 又被 DEL」的键呢？

<details>
<summary>第 1 问答案</summary>

红一条：everysec 那条——判定永远成立，四笔四次钉，pins 到 4，与断言的 2 对不上。always 与 no 不红：它们的行为由各自分支决定，不经过这行判定；策略语义没变，断言就没变。顺带看清：always 与「判定失效的 everysec」行为相同——三档本质是「钉盘频率」这一根旋钮。锚点：append 的三行分支。
</details>

<details>
<summary>第 2 问答案</summary>

进程被 kill：三档都不丢——write 每笔必走，数据已进内核缓冲，与进程无关。断电：always 丢 0；everysec 丢最近一秒内未钉的账；no 丢内核还没刷盘的全部（Linux 默认至多约 30 秒）。教学版 everysec 的尾巴：进程崩不丢（write 已走）；断电时，若停写后再没来过新写，尾巴可能一直没钉——真货的后台线程会在一秒内补上，这是差异清单第二笔。锚点：原理「刷盘策略」一节与差异清单。
</details>

<details>
<summary>第 3 问答案</summary>

三笔存活者各一条。SET k v3——内存里 k 只有这个值，前两笔与 DEL 全被现状覆盖；SET m 5 与 EXPIRE m 60（剩余秒数补在键之后）。k 若「设了 EXPIRE 又被 DEL」：DEL 之后 k 不在内存里，重写只看现状——k 一条都不留，连 EXPIRE 也不用补。死键从新账里消失，正是重写「不欠旧日志」的体现。锚点：collectWriteCmds 两个循环的顺序与注释。
</details>

从下一章起，路这么走（本章已走到「断电不丢」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 「跳表」 | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 「过期删除」 | 过期字典、惰性删除、定期删除、抽样 |
| 「内存满了」 | 内存淘汰、近似 LRU、LRU 与 LFU、idle 时钟 |
| 「AOF」（本章） | 写后日志、AOF、重放、AOF 重写、刷盘策略 |
| 下一站「RDB 快照」 | RDB 快照、fork、写时复制 |
| 更远的路 | 「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：AOF 救回了数据，却没救重启的速度——重放是把账从头再执行一遍，账有多长，开机就有多久。antirez 在同一篇博客的附记里给过量级：加载 RDB 快照大约每 GB 十到二十秒，加载 AOF 还要翻倍。账本长到一亿条的那天，凌晨三点的发布会等到天亮。下一章 RDB 快照：不重放，直接拍照——以及拍照时数据还在被写入，怎么保证照片不花（fork 与写时复制，重写的后台版也一并讲清）。
