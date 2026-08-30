// 命令分发：把解码好的参数数组变成 RESP 应答。
// 命令层错误一律回 -ERR 应答，不抛异常穿透网络层（内部不变量违反才允许 throw）。
import { Dict } from './dict.ts'
import { Expirer } from './expire.ts'
import { Evictor } from './eviction.ts'
import { Aof } from './aof.ts'
import { SkipList } from './skiplist.ts'
import { dump as dumpRdb, load as parseRdb } from './rdb.ts'
import type { SnapshotEntry } from './rdb.ts'
import {
  encodeArrayOfStrings,
  encodeBulkString,
  encodeError,
  encodeInteger,
  encodeNullBulkString,
  encodeSimpleString,
} from './resp.ts'

// 定期删除的三个参数：经典官方文档口径——每轮抽 20 个、到期比例超四分之一再来一轮；
// 外加一道时间上限兜底：主线程还要回去伺候客户端，绝不在删除上花过头
const ACTIVE_SAMPLE_N = 20
const CYCLE_BUDGET_MS = 1
const DEFAULT_CYCLE_MS = 100 // 两拍之间的间隔：每秒 10 拍，真 Redis 的 serverCron 同款节拍

export class MiniRedis {
  // 键的家：第 4 章亲手写的哈希表（链地址 + 负载因子扩容 + 渐进 rehash），换掉了 JS 白送的 Map。
  // 与真 Redis 同款单键空间：一个键一个值，字符串的值是 string，有序集合的值是跳表
  private data = new Dict<string | SkipList>()
  // 键的寿命登记簿（第 6 章）：另一张表——键 → 到期时间戳。主表不知道谁会过期
  private expirer: Expirer
  // 内存这一关（第 7 章）：键数到了上限谁腾座位——noeviction 拒写或 allkeys-lru 抽样踢老键
  private evictor: Evictor
  // 账本（第 8 章）：写命令执行成功后追加进 AOF，重启重放。不挂就是不开持久化
  private aof: Aof | null
  // 最近一张照片（第 9 章）：SAVE 拍下、LOAD 装回。真货落盘成 dump.rdb、下次启动自动装；
  // 教学版记在实例里、LOAD 手动装回（差异清单登记）
  private snapshot: string | null = null
  private snapshotKeys = 0 // 照片里拍到的键数（INFO 的 rdb 观察口）
  // 时钟可注入：测试手拨假钟，过期与淘汰行为全程不等真时间
  private now: () => number
  private cycleMs: number
  private lastCycleAt = 0 // 上一拍定期删除跑完的时刻：节流的记号

  constructor(options: { now?: () => number; random?: () => number; cycleMs?: number; aof?: Aof } = {}) {
    this.now = options.now ?? Date.now
    this.cycleMs = options.cycleMs ?? DEFAULT_CYCLE_MS
    this.aof = options.aof ?? null
    this.evictor = new Evictor({ now: this.now, random: options.random ?? Math.random })
    this.expirer = new Expirer({
      now: this.now,
      random: options.random ?? Math.random,
      dropKey: (key) => this.dropKey(key), // 登记簿记账，动手删键走统一路径
    })
    // 开机装载：新实例先把 AOF 旧账逐条重放——「重启恢复」在教学版里就是这一行。
    // 重放期间 Aof 不再记账：账已在手上，边放边抄会翻倍
    this.aof?.load((cmd) => this.execute(cmd))
  }

  execute(args: string[]): string {
    this.maybeExpireCycle() // 定期删除的驱动：夹在命令之间——单线程里没有别的空隙可站
    if (args.length === 0) return encodeError('ERR empty command')
    const name = args[0]!.toUpperCase() // 命令名大小写不敏感
    const rest = args.slice(1)
    switch (name) {
      case 'PING':
        return this.ping(rest)
      case 'SET':
        return this.set(rest)
      case 'GET':
        return this.get(rest)
      case 'DEL':
        return this.del(rest)
      case 'EXPIRE':
        return this.expire(rest)
      case 'TTL':
        return this.ttl(rest)
      case 'KEYS':
        return this.keys(rest)
      case 'ZADD':
        return this.zadd(rest)
      case 'ZRANGE':
        return this.zrange(rest)
      case 'ZCARD':
        return this.zcard(rest)
      case 'INFO':
        return this.info(rest)
      case 'CONFIG':
        return this.config(rest)
      case 'BGREWRITEAOF':
        return this.bgrewriteaof(rest)
      case 'FLUSHALL':
        return this.flushall(rest)
      case 'SAVE':
        return this.save(rest)
      case 'LOAD':
        return this.load(rest)
      default:
        return encodeError(`ERR unknown command '${args[0]}'`)
    }
  }

  private ping(args: string[]): string {
    if (args.length !== 0) return encodeError('ERR wrong number of arguments for PING')
    return encodeSimpleString('PONG')
  }

  // SET key value [EX 秒]：EX 是「顺手带寿命」——SET 与 EXPIRE 两步并一步（短信验证码的标配写法）
  private set(args: string[]): string {
    if (args.length !== 2 && args.length !== 4) return encodeError('ERR wrong number of arguments for SET')
    let ttlMs: number | null = null
    if (args.length === 4) {
      if (args[2]!.toUpperCase() !== 'EX') return encodeError('ERR syntax error')
      const secs = this.toInt(args[3]!)
      if (secs === null) return encodeError('ERR value is not an integer or out of range')
      if (secs <= 0) return encodeError(`ERR invalid expire time in 'set' command`)
      ttlMs = secs * 1000
    }
    // 新键进门前的内存关：满了按策略腾座位（allkeys-lru）或拒写（noeviction）。
    // 覆盖旧键不占新座位，不必过这关
    if (this.data.get(args[0]!) === undefined && !this.admitNewKey())
      return encodeError("OOM command not allowed when used memory > 'maxmemory'") // 真货同款 OOM 应答
    this.data.set(args[0]!, args[1]!) // 同一个键放什么都行：老值是跳表也被整个换掉
    this.evictor.touch(args[0]!) // 写入也是一次「用」：idle 时钟拨到此刻
    if (ttlMs === null) this.expirer.remove(args[0]!) // 覆盖即清寿命：不带 EX 的 SET 抹掉老登记——官方文档口径
    else this.expirer.setExpire(args[0]!, this.now() + ttlMs)
    this.aofLog(['SET', ...args]) // 干成了才记账（写后日志）：回 OK 前一笔
    return encodeSimpleString('OK')
  }

  private get(args: string[]): string {
    if (args.length !== 1) return encodeError('ERR wrong number of arguments for GET')
    const value = this.lookup(args[0]!) // 进门先查寿命簿：过期键当场删、按不存在处理
    if (value === undefined) return encodeNullBulkString()
    if (typeof value !== 'string') return this.wrongType() // 字符串的门，跳表不走
    return encodeBulkString(value)
  }

  private del(args: string[]): string {
    if (args.length === 0) return encodeError('ERR wrong number of arguments for DEL')
    let removed = 0
    for (const key of args) if (this.dropKey(key)) removed++ // 删键的活全部交给统一路径
    return encodeInteger(removed)
  }

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

  // 键级取值：先过惰性检查，过期键当场删、按不存在处理——字符串与跳表一视同仁，
  // 「过期」住在键上，不住在值类型上（排行榜整个键说没就没）
  private lookup(key: string): string | SkipList | undefined {
    if (this.expirer.lazyCheck(key)) return undefined
    const value = this.data.get(key)
    if (value !== undefined) this.evictor.touch(key) // 命中即「用过」：idle 时钟拨到此刻（近似 LRU 的挂钩）
    return value
  }

  // 新键进门前的内存关（第 7 章）：满了按策略腾座位或回绝。回 false = 拒写，命令层翻译成 OOM 应答。
  // 只在「键还不在主表里」时叫它——覆盖旧键不占新座位
  private admitNewKey(): boolean {
    const freed = this.evictor.onWrite(
      () => this.data.entries().map(([key]) => key),
      (key) => this.dropKey(key), // 淘汰的刀也走统一删键路径（箭头包一层保住 this）
    )
    return freed >= 0 // -1 = 满了且策略是宁可报错不扔数据
  }

  // EXPIRE key 秒：给已存在的键登记寿命，回 1；键不存在（含刚被惰性删除的）回 0——官方语义
  private expire(args: string[]): string {
    if (args.length !== 2) return encodeError('ERR wrong number of arguments for EXPIRE')
    const secs = this.toInt(args[1]!)
    if (secs === null) return encodeError('ERR value is not an integer or out of range')
    if (this.lookup(args[0]!) === undefined) return encodeInteger(0)
    this.expirer.setExpire(args[0]!, this.now() + secs * 1000) // 非正数＝登记一个过去的时刻：下一拍就删
    this.aofLog(['EXPIRE', ...args]) // 改寿命也是一次「写」：重放要能复原寿命簿
    return encodeInteger(1)
  }

  // TTL key：-2 键不存在 / -1 没有寿命 / N 剩余整秒（向上取整——刚设的 EX 300 别报成 299）
  private ttl(args: string[]): string {
    if (args.length !== 1) return encodeError('ERR wrong number of arguments for TTL')
    if (this.lookup(args[0]!) === undefined) return encodeInteger(-2)
    const ms = this.expirer.getTtl(args[0]!)
    return encodeInteger(ms === null ? -1 : Math.ceil(ms / 1000))
  }

  // KEYS pattern：键空间的旁观窗。只过滤不动手删——过期键不进名单，但「还在内存里」的
  // 僵尸态因此可观察（INFO 说 keys:1、KEYS 说空，两个口供对不上就是僵尸）
  private keys(args: string[]): string {
    if (args.length !== 1) return encodeError('ERR wrong number of arguments for KEYS')
    const re = globToRegex(args[0]!)
    const alive = this.data
      .entries()
      .map(([key]) => key)
      .filter((key) => !this.expirer.isExpired(key) && re.test(key))
    alive.sort() // 哈希表的桶序没有意义，按名字排好给人看
    return encodeArrayOfStrings(alive)
  }

  // 类型走错门的统一应答：真 Redis 同款错误码（公开协议事实）
  private wrongType(): string {
    return encodeError('WRONGTYPE Operation against a key holding the wrong kind of value')
  }

  // ZADD key score member [score member ...]：回「新增成员数」——老成员改分不计入
  private zadd(args: string[]): string {
    if (args.length < 3 || args.length % 2 === 0) return encodeError('ERR wrong number of arguments for ZADD')
    // 先把分数全部验完再动手：不许改了一半才发现后面一个非法分数
    const pairs: Array<[string, number]> = []
    for (let i = 1; i < args.length; i += 2) {
      const score = Number(args[i])
      if (Number.isNaN(score)) return encodeError('ERR value is not a valid float')
      pairs.push([args[i + 1]!, score])
    }
    let z = this.lookup(args[0]!) // 进门先查寿命簿（第 6 章的挂钩）：过期键当场删、按不存在处理
    if (typeof z === 'string') return this.wrongType() // 排行榜的门，字符串不走
    if (z === undefined) {
      if (!this.admitNewKey()) return encodeError("OOM command not allowed when used memory > 'maxmemory'") // 新排行榜键也要过内存关
      z = new SkipList() // 这个键的第一名成员进场，跳表立起
      this.data.set(args[0]!, z)
      this.evictor.touch(args[0]!) // 新键落座：idle 时钟从这一刻起算
    }
    let added = 0
    for (const [member, score] of pairs) if (z.insert(member, score)) added++
    this.aofLog(['ZADD', ...args]) // 干成了才记账：分数先验完、成员都进了，回条数前一笔
    return encodeInteger(added)
  }

  // ZRANGE key start stop [WITHSCORES]：按名次切片（0 起，负下标从队尾数，-1 是最后一名）
  private zrange(args: string[]): string {
    if (args.length !== 3 && args.length !== 4) return encodeError('ERR wrong number of arguments for ZRANGE')
    if (args.length === 4 && args[3]!.toUpperCase() !== 'WITHSCORES') return encodeError('ERR syntax error')
    const withScores = args.length === 4
    const z = this.lookup(args[0]!) // 进门先查寿命簿（第 6 章的挂钩）
    if (typeof z === 'string') return this.wrongType()
    if (z === undefined) return encodeArrayOfStrings([]) // 没这个键：空队伍
    const len = z.length
    let start = this.toInt(args[1]!)
    let stop = this.toInt(args[2]!)
    if (start === null || stop === null) return encodeError('ERR value is not an integer or out of range')
    if (start < 0) start = len + start // -1 = 最后一名
    if (stop < 0) stop = len + stop
    if (start < 0) start = 0 // 从队尾数出了界：回到队头
    if (stop >= len) stop = len - 1
    if (start > stop) return encodeArrayOfStrings([]) // 名次区间擦肩而过
    const picked = z.entries().slice(start, stop + 1) // 全量有序，切名次段
    const items = withScores ? picked.flatMap(([m, s]) => [m, String(s)]) : picked.map(([m]) => m)
    return encodeArrayOfStrings(items)
  }

  // ZCARD key：队伍里有几名成员
  private zcard(args: string[]): string {
    if (args.length !== 1) return encodeError('ERR wrong number of arguments for ZCARD')
    const z = this.lookup(args[0]!) // 进门先查寿命簿（第 6 章的挂钩）
    if (typeof z === 'string') return this.wrongType()
    return encodeInteger(z?.length ?? 0)
  }

  // 字符串转整数；不是整数回 null（ZRANGE 的下标专用）
  private toInt(s: string): number | null {
    const n = Number(s)
    return Number.isInteger(n) ? n : null
  }

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

  // 教学统计面：键数、寿命登记数、过期删除数、淘汰删除数、搬迁状态、AOF 条数、快照键数
  private info(args: string[]): string {
    if (args.length > 1) return encodeError('ERR wrong number of arguments for INFO')
    const lines = [
      `keys:${this.data.size}`,
      `expires:${this.expirer.ttlKeys}`,
      `expired:${this.expirer.expired}`,
      `evicted:${this.evictor.evicted}`,
      `rehash:${this.data.isRehashing() ? 1 : 0}`,
      `aof:${this.aof?.size ?? 0}`,
      `rdb:${this.snapshotKeys}`,
    ]
    return encodeBulkString(lines.join('\r\n'))
  }

  // CONFIG SET name value / CONFIG GET name：教学版只认两个名字——maxmemory（键数上限，0=不限）
  // 与 maxmemory-policy（noeviction | allkeys-lru）。真货的 CONFIG 家族庞大、GET 支持通配，
  // 教学版最小子集（差异清单登记）
  private config(args: string[]): string {
    const sub = args[0]?.toUpperCase()
    if (sub === 'SET' && args.length === 3) return this.configSet(args[1]!, args[2]!)
    if (sub === 'GET' && args.length === 2) return this.configGet(args[1]!)
    return encodeError('ERR wrong number of arguments for CONFIG')
  }

  private configSet(name: string, value: string): string {
    if (name === 'maxmemory') {
      const keys = this.toInt(value)
      if (keys === null || keys < 0) return encodeError('ERR value is not an integer or out of range')
      this.evictor.setLimit(keys) // 真货记字节数（100mb 这类写法），教学版记键数（差异清单登记）
      return encodeSimpleString('OK')
    }
    if (name === 'maxmemory-policy') {
      if (value !== 'noeviction' && value !== 'allkeys-lru')
        return encodeError("ERR policy must be 'noeviction' or 'allkeys-lru'") // 教学版只实现这两个（真货至 8.x 主线八个）
      this.evictor.setPolicy(value)
      return encodeSimpleString('OK')
    }
    return encodeError(`ERR unknown option or number of arguments for CONFIG SET - '${name}'`)
  }

  private configGet(name: string): string {
    if (name === 'maxmemory') return encodeArrayOfStrings(['maxmemory', String(this.evictor.maxKeys)])
    if (name === 'maxmemory-policy') return encodeArrayOfStrings(['maxmemory-policy', this.evictor.policyName])
    return encodeError(`ERR unknown option or number of arguments for CONFIG GET - '${name}'`)
  }

  // 定期删除的驱动：节流到 cycleMs 一拍（默认 100ms）。真货是事件循环里的定时事件（serverCron），
  // 教学版夹在命令之间跑——单线程里这活没别人干，也只能在伺候完客户端的空隙里干。
  // 一拍之内是经典文档口径的三步循环：抽 20、删到期的、到期比例超四分之一再来一轮；
  // 时间上限是第二道闸：无论过期键多饱和，主线程在删除上花满预算就收工，剩下的下一拍再说
  private maybeExpireCycle(): void {
    if (this.now() - this.lastCycleAt < this.cycleMs) return
    this.lastCycleAt = this.now()
    const start = this.now()
    for (;;) {
      const deleted = this.expirer.activeCycle(() => this.expirer.keys(), ACTIVE_SAMPLE_N)
      if (deleted * 4 <= ACTIVE_SAMPLE_N) break // 到期比例不高：本轮收工
      if (this.now() - start >= CYCLE_BUDGET_MS) break // 时间到：宁可留到下一拍，不冻全场
    }
  }
}

// 极简通配：* 任意一串、? 任意一个（真 KEYS 的完整 glob 从简，差异清单登记）
function globToRegex(pattern: string): RegExp {
  let re = ''
  for (const ch of pattern) {
    if (ch === '*') re += '.*'
    else if (ch === '?') re += '.'
    else re += ch.replace(/[.*+?^${}()|[\]\\]/, '\\$&')
  }
  return new RegExp(`^${re}$`)
}
