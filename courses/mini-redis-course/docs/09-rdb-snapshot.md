---
title: RDB 快照：fork 与写时复制
---

# RDB 快照：fork 与写时复制

先接第 8 章末尾留的那句话：账本救回了数据，没救开机的速度——重放是把账从头再执行一遍，账有多长，开机就有多久。那一章还欠着三笔：逐条重放太慢的账怎么算；fork（系统调用，让操作系统把当前进程复制出一个几乎一样的子进程）与写时复制怎么做到「拍照不停写」；AOF 重写的后台版（真货 fork 子进程做）到底长什么样。三笔都在这一章还。落成的里程碑：dump/load 全量快照、SAVE 语义，外加一张页表图——讲清真 Redis 在持续写入下怎么拍出一张不花的照片。

## 大促前夜：一亿条账，一条一条重放

周年大促的备战清单上有一项「缓存集群升级重启」。那台缓存实例攒了 32GB 数据、一亿多条 AOF 账：登录态、购物车、库存预热，全在里面。上午十点开跑，进程起来了，redis-cli 能连上，可每条命令都被顶回来——`-LOADING`，加载日志一行一行地爬。上一章末尾引过 antirez 给的量级：加载 RDB 每大约 1GB 要十到二十秒，加载 AOF 还要翻倍——照这个账，等它重放完，半个上午就没了，而大促的流量不会等。

你自然想到另一条路：别重演历史了，拍张照片。某一瞬间的全库现状，一键一记录，重启直接照着搭——数据量多大就花多久，跟账本攒了多少笔无关。但新问题立刻冒头：拍照的那几秒里，几万个客户端还在写。SET 拍到一半被改、ZADD 还在往排行榜里塞人——照片会不会拍到一张「半张脸」？这就是快照一致性（snapshot consistency）要回答的问题：照片里必须是某一瞬间完整一致的状态，而不是写入中途、从未真实存在过的混合物。「重放慢」的病根在「逐条」二字，「半张脸」的病根在「边拍边写」——两个病，本章一个一个治。

## 原理：照片、那一瞬、和冻结它的页表

### 两种恢复成本：重演历史，还是按图搭建

AOF 重放的成本正比于账长：一亿条账，就是一亿次完整的命令执行——每条都要解码、验参、分发、动手，同键的历史还得全部重演。counter 被加了一百万次，账上就有一百万条，重放就老老实实加一百万次，哪怕内存里只剩最后那个数。

照片的成本正比于数据量：一千万个键，就是一千万次「按记录落位」，每键一次，仅此而已。counter 加一百万次？照片里它就是一行。redis.io 文档把这笔账写成了官方结论：RDB 是「非常紧凑的单文件、按时间点表示的 Redis 数据」，「与 AOF 相比，RDB 允许大数据集更快地重启」。持久化期间的性能也一样干脆——「父进程为了持久化唯一要做的活就是 fork 出一个子进程，剩下的事全由子进程完成，父进程自己从不做磁盘 IO」。

便宜不是白拿的。照片是某一瞬，两次快照之间的写入不在照片里：文档说得直白，快照通常每五分钟或更久一张，实例意外停机时「要准备好丢掉最近几分钟的数据」。所以 RDB 与 AOF 不是二选一——文档的建议是两个都开：照片管备份与快速重启，账本管不丢；两个都开时重启用 AOF，因为它「保证是最完整的」。（7.0 起 AOF 的基础文件本身可以是 RDB 格式——快照打底、增量补尾的混合思想，视野提一句。）

### 一致性：拍照不停写，靠什么不拍成半张脸

先把大概率住在你脑子里的那个直觉复述公允了：拍快照，就得停写——锁住全库，拍完再放。这直觉很合理，朴素方案也确实成立：真货的 SAVE 就带着这副同步脾气。但算一下代价：每次快照全场冻结几秒，对一个每秒十万写的缓存来说不可接受。「拍快照必须停写」这句话，错不在方案，错在「必须」。

反过来看不停写也不冻结的下场：边遍历键空间边拍。拍到 counter 时它是 7，拍完 counter 又改了 8；拍到 board 时 ZADD 刚塞进一个新成员。这张照片的问题不是「旧了一点」——是它里面的状态在任何真实时刻都不曾存在过，是半张新脸拼半张旧脸。恢复出这样一个库，比恢复出一个旧库糟糕得多。

真正需要的，是让拍照的人看到一份**冻结的、完整的那一瞬**：从开始拍到拍完，他眼里的世界一动不动；同时真实的世界照常写。这两个要求看起来矛盾——直到你问：拍照的人，为什么必须是「现在这个进程」？

### fork：复制的是页表，不是内存

第二个误区先立起来：fork 就是把内存整个复制一份，32GB 的实例拍快照得先掏出另一个 32GB——如果真是这样，这套机制谁也用不起。它不是。要看懂它真正的复制了什么，得先认识页表（page table）——操作系统给每个进程记的一本账：虚拟地址哪一页，对应物理内存哪一页。

每个进程都以为自己独占一大片连续的内存（虚拟内存）；真正的物理内存被切成一页一页（x86 典型 4KB），谁的一页落在物理内存哪里，全由页表说了算。你在第 4 章写过 Dict——键值各一张表；页表就是内核手里的另一张：键是虚页号，值是物理页号，外加一栏读写权限。

fork 做的事只有一件：**把这本账复制一份，物理内存一页都不动**。fork 出的子进程拿到自己的页表，指向同一批物理页；两本页表把这些页全标成只读。跟算一遍这本账有多厚：32GB ÷ 4KB = 8,388,608 页，每条页表项 8 字节（x86-64 典型值），约 64MB——fork 要把这 64MB 逐条抄完。所以 fork 不是白来的：文档说数据集很大时 fork 本身可能很耗时，「可能让 Redis 停止服务客户端几毫秒、数据集特别大时甚至一秒」。停顿的量级是毫秒，不是秒——这就是它能活下来的原因。

```text
① fork 前——一个进程，一张页表
   父进程页表              物理内存
   虚页0 ────────→ 页A（存着 login:alice）
   虚页1 ────────→ 页B（存着 counter）
   虚页2 ────────→ 页C（存着 board）

② fork 后——两张页表，同一批物理页，全部只读（ro）
   父进程页表                              子进程页表
   虚页0 ─ ro ──→ 页A ←─────── ro ─ 虚页0
   虚页1 ─ ro ──→ 页B ←─────── ro ─ 虚页1
   虚页2 ─ ro ──→ 页C ←─────── ro ─ 虚页2
   （物理内存一页没多；多出来的只是两本薄薄的页表）
```

### 写时复制：谁先动笔，才真的复印那一页

共享的页标成只读，写入的瞬间就会露馅——CPU 发现这页标着「只许读」，立刻陷进内核。内核这时才动手做复制，这就是写时复制（Copy-On-Write，行话缩写 COW）：**页先共享，谁先改哪页，才复制哪页**。锚点用圣经里那句：复印一本作业本，说好各改各的，谁先动笔才真的复印那一页。

```text
③ 父进程改 counter（写页B）——只有这一页被复制
   父进程页表                              子进程页表
   虚页0 ─ ro ──→ 页A ←─────── ro ─ 虚页0
   虚页1 ─ rw ──→ 页B'（新复制的副本）      虚页1 ─ ro ──→ 页B（旧值）
   虚页2 ─ ro ──→ 页C ←─────── ro ─ 虚页2
   （父页表改指 B' 并恢复可写；没被写的页继续共享。
    子进程眼里，counter 永远停在 fork 那一瞬）
```

内存的账也顺便算清——「fork 马上翻倍内存」正式破产：写多少，复制多少。10GB 数据集、快照期间业务改写了 1GB 的页，峰值就多约 1GB；一个字节都不改，多的只有那本约 20MB 的页表；全部改写才接近翻倍，那是上限，不是起拍价。

现在把整台机器拼起来。真货拍快照的三步，文档原话：Redis fork，得到一个子进程和一个父进程；子进程开始把数据集写进一个临时 RDB 文件；子进程写完，用新文件替换旧的——「这个方法让 Redis 受益于写时复制语义」。子进程的页表冻结在 fork 那一瞬，它从头到尾写的都是那一份完整一致的状态——**照片不花，不是因为世界停了，是因为拍照的人看的是另一个世界**。父进程照常接客，写到的页被 COW 静悄悄复制，子进程浑然不觉。

SAVE 与 BGSAVE 的分工也就清楚了。SAVE 文档原话：同步保存，「在生产环境里你几乎从不想调用它，它会阻塞所有其他客户端」，是 fork 失灵时的最后一招。日常是 BGSAVE：fork 子进程后台拍，命令立刻返回。而第 8 章欠的最后一笔在这对齐：AOF 重写的后台版用的是同一台机器。文档原话「日志重写用的是快照已经在用的同款写时复制技巧」。BGREWRITEAOF 同样 fork 子进程去写新账；主进程边接客边往旧账（7.0 起是一个新开的增量文件）里继续记。上一章我们同进程同步重写，省掉的那半边原理，现在补齐了。

### 本课程的边界：单进程，同步拍

教学版不演子进程。Node 里起子进程拿不到这种共享内存的 COW 语义（进程之间内存天然隔离），要演只能靠序列化传值——那正是我们已经在做的事。所以边界这样划：SAVE 在主线程同步把照片拍成一段文本，这恰是真货 SAVE 的姿势（同步、拍完才回话、期间全场等待，第 3 章的铁律在它身上兑现一次）；BGSAVE 的 fork 与 COW 讲清原理、不实现。照片记在实例里、不落盘；没有定时自动快照（真货的 save 60 1000 那类配置）；LOAD 是教学专用命令——真货没有它，照片在下次启动时自动装。每一笔都登记差异清单，收束处汇总。

## 演练：一个纯函数、三个命令、一本不碰账本的照片

本章演进两件事：src/rdb.ts 从零写出照片的序列化与装载（纯函数，不碰任何状态）；src/db.ts 添三个命令——SAVE 拍照、LOAD 装回、FLUSHALL 清场。FLUSHALL 在 API 契约里早有挂号，到「先砸再装」的剧本这才登场。另配一个素材收集器，INFO 末行添 `rdb:` 键数（全形态见第 4 章引用块）。boot 不动：照片不落盘，差异已声明。测试 tests/rdb-snapshot.test.ts 九条，照例先写先跑出红——rdb.ts 还不存在，import 直接失败。

照片的格式，教学清晰优先：一行一键的 JSON 文本。真货是紧凑二进制——版本头（REDIS0011 这类）加逐键记录加结尾 CRC64 校验和；教学版保留版本头这个思想，换成可读文本（差异清单登记）。dump 的输出长这样（示意；测试里的 fixture 用同样的格式，见 tests/rdb-snapshot.test.ts）：

```text
mini-rdb-1
{"key":"name","type":"string","value":"mini"}
{"key":"code","type":"string","value":"42","expireAtMs":100000}
{"key":"board","type":"zset","members":[["bob",8],["alice",10]]}
```

头一行是版本标记；之后每行一个键——字符串记值，有序集合按分数序记成员对（装载照这个序直接搭建跳表）；带寿命的键多一栏 `expireAtMs`。注意它存的是**绝对时刻**，不是剩余秒数：照片可能在抽屉里躺三天才被装回，剩余秒数早就不作数了，绝对时刻永远作数——真货同款口径。第 8 章 AOF 重写记剩余秒是教学简化，照片这里照真货做，两处对照正好看清「为什么绝对时刻更对」。

rdb.ts 全部家当不到五十行。类型先行：

```ts
// src/rdb.ts · SnapshotEntry 与版本头
// 一条快照记录：键 + 值的类型与内容 + 寿命（到期绝对时刻；null = 没登记寿命）。
// zset 的成员按分数有序存放，装载时照这个序直接搭建
export type SnapshotEntry =
  | { key: string; type: 'string'; value: string; expireAtMs: number | null }
  | { key: string; type: 'zset'; members: Array<[string, number]>; expireAtMs: number | null }

// 照片头：一行版本标记，将来格式变了靠它认旧照片。真货头是 REDIS0011 这类版本号，
// 结尾另有一段 CRC64 校验和——文件损坏半路就拒收（教学版不校验，差异清单登记）
const HEADER = 'mini-rdb-1'
```

dump 向持有数据的人要一份「全库现状」，逐键写成一行；load 把照片逐行读回，头一行不对就整个拒收：

```ts
// src/rdb.ts · dump 与 load
// 拍照：向持有数据的人要一份「全库现状」，逐键写成一行。
// 值里的换行、引号这类「危险字符」由 JSON 转义兜住——照片是文本，但值想装什么装什么
export function dump(collectEntries: () => SnapshotEntry[]): string {
  const lines = [HEADER]
  for (const { expireAtMs, ...entry } of collectEntries()) {
    // 没登记寿命就不写这一栏：大多数键没有寿命，照片行越短越好读
    lines.push(JSON.stringify(expireAtMs === null ? entry : { ...entry, expireAtMs }))
  }
  return lines.join('\n')
}

// 装载：把照片逐行读回记录。头一行不对就整个拒收——装错格式的东西比空手还糟
export function load(text: string): SnapshotEntry[] {
  const lines = text.split('\n')
  if (lines[0] !== HEADER) throw new Error('not a mini-rdb snapshot')
  const out: SnapshotEntry[] = []
  for (const line of lines.slice(1)) {
    if (line === '') continue // 容忍手工编辑留下的空行
    const entry = JSON.parse(line) as SnapshotEntry
    out.push({ ...entry, expireAtMs: entry.expireAtMs ?? null }) // 没写寿命栏 = 没有寿命
  }
  return out
}
```

值里的换行、引号这些「危险字符」由 JSON 转义兜住——照片是文本，但值想装什么装什么，测试里专门有一条用换行加引号加中文的值做往返。

命令层的拍照侧两件套。SAVE 的同步语义落在「拍完才回 OK」；素材收集器把寿命簿换算回绝对时刻带走，并滤掉僵尸键——死了的别拍进去，装回来就是还魂：

```ts
// src/db.ts · save 与 collectSnapshotEntries
  // SAVE：同步拍一张全量照片——命令返回时照片已经拍完（真货 SAVE 同款语义：主线程亲手拍、
  // 拍完才回话，期间全场等待）。真货另有 BGSAVE：fork 子进程后台拍、主进程照常收写（本章讲原理不实现）
  private save(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for SAVE')
    this.snapshot = dumpRdb(() => this.collectSnapshotEntries())
    this.snapshotKeys = this.snapshot.split('\n').length - 1 // 一行一键：行数减去头就是键数
    return encodeSimpleString('OK')
  }

  // 收集照片素材：主表逐键取「现状」，寿命簿换算回绝对时刻一并带走——
  // 存绝对时刻而不是剩余秒数：照片躺多久，装回来都作数（真货同款口径）。
  // 僵尸键（已到期还没被扫走）不入照片：死了的别拍进去，装回来就是还魂
  private collectSnapshotEntries(): SnapshotEntry[] {
    const out: SnapshotEntry[] = []
    for (const [key, value] of this.data.entries()) {
      if (this.expirer.isExpired(key)) continue
      const ttl = this.expirer.getTtl(key)
      const expireAtMs = ttl === null ? null : this.now() + ttl
      if (typeof value === 'string') out.push({ key, type: 'string', value, expireAtMs })
      else out.push({ key, type: 'zset', members: value.entries(), expireAtMs })
    }
    return out
  }
```

装回侧是本章与 AOF 分道的地方：重放走 execute，每条账重新演一遍；装照片**不走命令层**——不解析、不校验、不分发，按照片逐条直接搭建。这就是「重放慢」在代码里的病根与解法。它也不写账本：照片不是命令，两套装置各管各的（真货两套都开时重启用 AOF，上一节引过文档）。

```ts
// src/db.ts · load 与 flushall
  // LOAD：把最近一张照片装回来（教学版专用命令——真货没有 LOAD，照片在下次启动时自动装）。
  // 装照片不走命令层：不解析、不校验、不分发，按照片逐条直接搭建——RDB 恢复快过 AOF 重放的秘密。
  // 也不写账本：照片不是命令，两套装置各管各的（差异清单登记）。
  // 标准剧本照真货「启动时装空库」：先 FLUSHALL 再 LOAD
  private load(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for LOAD')
    if (this.snapshot === null) return encodeError('ERR no snapshot saved')
    for (const entry of parseRdb(this.snapshot)) {
      if (entry.type === 'string') this.data.set(entry.key, entry.value)
      else {
        const z = new SkipList()
        for (const [member, score] of entry.members) z.insert(member, score) // 照片按序存，照序建
        this.data.set(entry.key, z)
      }
      if (entry.expireAtMs === null) this.expirer.remove(entry.key)
      else this.expirer.setExpire(entry.key, entry.expireAtMs) // 绝对时刻原样入簿：装得再晚也作数
      this.evictor.touch(entry.key) // 装回来的键也是键：idle 时钟从装回这一刻起算
    }
    return encodeSimpleString('OK')
  }

  // FLUSHALL：清空整个键空间——快照剧本的「先砸再装」需要它（第 9 章接入，API 契约早已挂号）。
  // 删键照旧走统一路径 dropKey：寿命簿、idle 登记一并清，账本逐键补记 DEL
  // （真货向 AOF 与从库传播的是一条 FLUSHALL 命令，教学版逐键 DEL——差异清单登记）
  private flushall(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for FLUSHALL')
    for (const [key] of this.data.entries()) this.dropKey(key) // entries 先落成数组：边删边走安全
    return encodeSimpleString('OK')
  }
```

先红后绿。九条测试里最见章法的一条，钉「绝对时刻」这个选择——照片躺了 50 秒再装，剩的正是剩下的秒数，不是拍照那刻的 60 秒：

```ts
// tests/rdb-snapshot.test.ts · 寿命随照片走
  it('寿命随照片走：照片存绝对时刻，躺了 50 秒再装，剩的正是剩下的秒数', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity })
    db.execute(['SET', 'code', '42', 'EX', '100']) // 寿命到 t=100s
    clock.advance(40_000) // 剩 60s 时拍照
    db.execute(['SAVE'])
    db.execute(['FLUSHALL'])
    clock.advance(50_000) // 照片在抽屉里躺到 t=90s
    db.execute(['LOAD'])
    expect(db.execute(['TTL', 'code'])).toBe(':10\r\n') // 绝对时刻原样入簿：剩 10s，不是拍照那刻的 60s
  })
```

里程碑剧本另有钉子。SAVE → FLUSHALL → LOAD 的全量回来是第一条。过期键不入照片是第二条：僵尸不还魂，活键对照组照常回来。第三条最像第 8 章欠的账——100 条账对 1 行照片，INFO 上一眼可见（aof:100、rdb:1）。第四条钉「两套装置互不插手」：SAVE 与 LOAD 不新增账目，FLUSHALL 逐键补记 DEL。实现落地，全书 101 条全绿——第 2 到 8 章的 92 条旧测试一行未改，它们仍是公共 API 的哨兵。

## 验证：亲手拍、亲手砸、亲手装回

1. 双硬门槛先跑一遍：`cd companion && npm run typecheck && npm test`——typecheck 干净，101 条全绿（旧 92 条 + 本章 9 条）。
2. 照片剧本，备战清单上那场重启的复盘：开机前先删掉 companion 目录下的 appendonly.aof——第 8 章起账本跨开机复利，残留的旧键会一起进照片（不删的话你看到的 rdb 会大于 3，多出来的正是旧账）。然后：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`，依次 `SET login:alice token-1`、`ZADD board 10 alice 8 bob`、`SET code 42 EX 600`（各回 OK 或 :2）。`SAVE` 回 OK，`INFO` 应见 `rdb:3`。`FLUSHALL` 回 OK——先猜后跑：此刻 `INFO` 的 keys 是几？rdb 又是几？答案是 keys:0、rdb:3——库砸空了，照片还在（照片不随清场消失）。`GET login:alice` 回 nil；`LOAD` 回 OK；`GET login:alice` 回 `token-1`，`ZRANGE board 0 -1 WITHSCORES` 依次 bob、alice，`TTL code` 回 600 以内的剩余秒——绝对时刻装回，不是重新数 600。
3. 照片定格实验：`SET name mini`、`SAVE`、`SET name newer`、`LOAD`。先猜 `GET name` 回什么——`mini`。照片停在按下快门那一瞬，LOAD 是装回，不是合并。
4. 指认一处小破坏：打开 src/db.ts，把 collectSnapshotEntries 里 `if (this.expirer.isExpired(key)) continue` 那行注释掉。先猜 tests/rdb-snapshot.test.ts 哪条会红；再跑 `npx vitest run tests/rdb-snapshot.test.ts` 对照。红一条：「过期键不入照片」——照片里多了僵尸键，rdb 从 1 变 2，装回后 `GET code` 拿到了本该作废的值。改回去，回到全绿。
5. 纸上跟算 COW：拿原理里的页表图。fork 后父进程写了页 B（counter）和页 D（一个新键），哪几页被复制？子进程写照片时读的 counter 是新值还是旧值？父进程接着又写了页 A，再发生什么？（答：B、D 各复制一份，子进程读到的 counter 是 fork 那瞬的旧值；写页 A 时才轮到 A 被复制——写多少，复制多少。）

## 收束：照片救得了断电，救不了整台机器

回到大促前夜。现在那场等待的每一环你都拆得开：重放慢，是因为成本挂在账长上；照片直读，成本挂在数据量上，一亿条账对一千万个键，量级当场换挡。半张脸的担心也解了——不是世界停下来让拍照，是 fork 让子进程透过自己的页表看到一个冻结的那一瞬，父进程照常接客，写时复制悄悄结账。重写的后台版也是同一台机器：BGREWRITEAOF 的子进程用的就是快照同款技巧。下次再有人问「Redis 拍快照要不要停写」，你可以画出那张页表图。

五个新词各收一句。RDB 快照——某一瞬间全库的照片，恢复比重放快，代价是两次快照之间的写入会丢。快照一致性——照片拍到的是某一瞬间完整一致的状态，而不是写入中途的半张脸；fork 加 COW 让「那一瞬」被冻结。fork——操作系统复制出一个几乎一样的子进程的调用，复制的是页表，不是内存。写时复制——页先共享，谁先改哪页才复制哪页，快照期间主进程照常写入的秘密。页表——操作系统给每个进程记的账：虚拟地址哪一页对应物理内存哪一页。你的第九个里程碑落定：dump/load 一对纯函数、SAVE/FLUSHALL/LOAD 三令、INFO 里能亲眼盯着的 rdb 键数——拍、砸、装三种局面都亲手演过。

本章与真 Redis 的差异记六笔（汇总进附录差异清单）：照片记在实例里不落盘（真货写进 dump.rdb，断电后重启自动装）；没有定时自动快照（真货 save 60 1000 那类触发器）；LOAD 是教学专用命令、剧本「先 FLUSHALL 再 LOAD」模拟真货「启动对空库装载」（真货没有这条命令）；格式是一行一键的 JSON 文本（真货是紧凑二进制，带 CRC64 校验和与压缩，教学版坏了不拒收）；BGSAVE 不实现——SAVE 同步拍、教学版拍进内存，真货 SAVE 同步写文件、日常全靠 BGSAVE 的子进程（第 8 章「重写同进程做」那笔差异的原理半边，本章已补齐）；FLUSHALL 逐键补记 DEL（真货向 AOF 与从库传播一条 FLUSHALL）。另外照片与账本互不插手也是刻意的：真货两套都开时重启用 AOF（文档口径「保证最完整」），混合持久化只做视野提及。

自查三问（先自己答，再展开对）：

1. SAVE 拍完照，进程被 kill -9（比如 Ctrl-C），重新 `node src/boot.ts` 再 LOAD——数据回得来吗？教学版与真货各答一遍，并说出这道题踩的是差异清单第几笔。
2. 10GB 数据集的实例执行 BGSAVE，期间业务改写了 1GB 的页：内存峰值大约多多少？若一个字节都不改呢？两种情况下各自还要付出一笔什么？
3. 纸上推演：`SET code 1 EX 100` 之后 SAVE；等 90 秒，FLUSHALL，LOAD——`TTL code` 回几？同样的时序换第 8 章的 AOF 重写（SET 后立刻 BGREWRITEAOF，等 90 秒后「重启」重放）——TTL 又回几？两个数字的差异是哪两行代码写出来的？

<details>
<summary>第 1 问答案</summary>

教学版回不来——照片是实例里的一个字符串字段，进程死了内存归还系统，照片陪葬。真货回得来：SAVE 与 BGSAVE 都会把照片写进磁盘上的 dump.rdb，重启时自动装。这就是差异第一笔的重量：照片的「那一瞬」要救断电，必须落在盘上。锚点：差异清单第一、三笔。
</details>

<details>
<summary>第 2 问答案</summary>

改写 1GB：峰值多约 1GB——被写的页各复制一份。外加约 20MB 的页表副本（10GB ÷ 4KB = 2,621,440 条 × 8 字节）。一字不改：只多那约 20MB 的页表，物理页零复制。两种情况都要付同一笔：fork 抄页表本身的毫秒级停顿——数据集越大，这本账越厚。锚点：原理「fork」与「写时复制」两节的跟算。
</details>

<details>
<summary>第 3 问答案</summary>

照片：回 10。照片存绝对时刻（collectSnapshotEntries 里 `this.now() + ttl`），装回时原样入簿，已经流走的 90 秒照扣。AOF 重写：回 100。重写记剩余秒数（collectWriteCmds 里 `Math.ceil(ms / 1000)`），重放发生在 90 秒后，寿命从重放那刻重新起算——「重启前它已经老了」这个事实，剩余秒数记不下。这正是第 8 章差异第四笔、本章照片改用绝对时刻的对照。锚点：collectSnapshotEntries 与 collectWriteCmds 的寿命两行。
</details>

从下一章起，路这么走。本章已走到「照片直读」。

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、简单串与批量串、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 「跳表」 | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 「过期删除」 | 过期字典、惰性删除、定期删除、抽样 |
| 「内存满了」 | 内存淘汰、近似 LRU、LRU 与 LFU、idle 时钟 |
| 「AOF」 | 写后日志、AOF、重放、AOF 重写、刷盘策略 |
| 「RDB 快照」（本章） | RDB 快照、快照一致性、fork、写时复制、页表 |
| 下一站「复制、哨兵与集群」 | 主从复制、全量同步、增量复制、哨兵、故障转移、哈希槽 |
| 更远的路 | 「终章对账」：四问回收全书 |

留一个尾巴当钩子：照片与账本救得了断电，救不了「一台机器整个没了」——机房断电、主机宕机，盘上的 dump.rdb 和 appendonly.aof 一起陪葬。第 10 章的主从复制接这一棒，而你已经握着它的关键零件：主库给从库的第一次全量同步，发的正是这样一张 RDB——fork 那台「拍照不停写」的机器，下一章再开一次。
