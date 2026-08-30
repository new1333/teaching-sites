---
title: 过期删除：惰性与定期
---

# 过期删除：惰性与定期

先接上第 5 章末尾那个尾巴：键的家有了，键的寿命还没人管。再问两个老问题——第 3 章那条铁律还记得吗：单线程免「等 IO」，不免「干活慢」，主线程上的慢活会冻结全场；第 4 章那服药还记得吗：一次搬不完的活，摊薄成每次一小口。这一章两样都要用上。

## SET 带 EX 之后就没人管了：一个月涨出三倍的内存

周五上线短信登录，验证码这么写：`SET code:13800001234 4271 EX 300`——5 分钟有效期。你心里想的是「5 分钟一到它自动消失」，毕竟名字里带 EX（expire，过期）。一个月后监控报警：这台小服务器的内存涨了三倍。登进去 `INFO` 一看，keys 十几万——全是历史验证码，一条都没走。

再想一层更冷的事实：**从头到尾，没有任何东西到点去删过它们**。你以为 EXPIRE 背后有个定时器，到 300 秒「叮」一声把键收走。做一个反事实检验：一亿个带寿命的键，就有一亿个定时器，每秒几百万次到期回调全挤在第 3 章那条单线程上——这不是删除策略，这是自我冻结。所以真 Redis（我们的教学版同款）根本不装定时器：**到期时间只是记在一张表上，删除是另一件事，分两只手做**。官方文档把这个机制讲得很直白（译文）：「键以被动与主动两种方式过期。客户端访问一个已超时的键时，它被被动地过期掉。但仅此还不够：有些过期键永远不会再被访问，它们也该被删掉。所以 Redis 周期性地在设置了过期时间的键里随机测试几个，把已过期的从键空间删除。」（redis.io，[EXPIRE 命令页](https://redis.io/docs/latest/commands/expire/) 附录）

这一章把两只手都写出来：过期字典（expires dict）——另一张表，键 → 到期时间戳；惰性删除（lazy expiration）——被访问时才检查才删；定期删除（periodic expiration）——周期抽样补刀没人访问的键。落成里程碑：EXPIRE/TTL 命令、SET 的 EX 选项、惰性与定期两条删除路径，以及 INFO 里那个能亲眼看涨的 expired 计数。

## 原理：到期只是记账，删除分两只手

### 过期字典：另一张表

为什么是「另一张表」而不是给键加个字段？算笔账就明白：大多数键永远不过期（配置、队列、排行榜），给主表每个键都背一个「到期时间」字段，是为极少数验证码向全体键征税。所以到期时间单独放一张表——你第 4 章写的 Dict 正好再就业一次：

```text
主表 data（键 → 值）                寿命簿 deadlines（键 → 到期的绝对时刻）
┌──────────────┬──────────┐       ┌──────────────┬──────────┐
│ code:138...  │ "4271"   │       │ code:138...  │ 300_000  │ ← 绝对时间戳
│ keeper       │ "v"      │       └──────────────┴──────────┘
│ lb           │ SkipList │       keeper、lb 没登记 → 永不过期
└──────────────┴──────────┘
```

登记的是绝对时刻（第 300_000 毫秒到），不是「还能活 300 秒」。这是官方文档明说的口径：过期信息以绝对 Unix 时间戳存储——进程重启、时钟照走，登记照样作数。锚点用你见过的药房：药瓶上不印有效期，柜台旁有本有效期登记簿；药师取药时翻一眼（第一只手），打烊前再巡一批（第二只手）。

跟着算一遍：t=0 时 `SET code 4271 EX 300`，寿命簿记下 `code → 300_000`。`TTL code` 回 `(300_000 − 0) ÷ 1000 = 300`。拨到 t=299_999，剩 1 毫秒，向上取整仍回 1。拨到 t=300_000：到点，该删了——由谁删？两只手各自的答案，正是这一章的核心。

### 惰性删除：取药时翻一眼登记簿

第一只手最省事：谁访问这个键，谁顺路查一眼登记簿。GET（以及一切取键的命令）进门先问「这个键登记过寿命吗？到点了吗」；到点了，当场删键、撤登记、计数 +1，然后回「不存在」。没登记或没到点，一切照旧——一个键的常态，是查一万次也不动手。

代价的账也摆在明面上。CPU 账：每次访问多一次 O(1) 的查表，几乎白送。内存账：**没人访问的过期键，会一直躺在内存里**——开头那三倍内存，就是这笔欠账攒了一个月。验证码恰恰是最没人回头访问的数据：输对的人再不碰它，输错的人换了新键。惰性删除对它们无能为力。

### 定期删除：药师打烊前巡一批

第二只手补刀。既然不能给每个键装定时器，也不能全表扫一遍（一亿键挨个对时间戳，主线程冻住几百毫秒——第 3 章的自我冻结又来了），就只剩一条路。抽样（sampling）——随机挑一小撮出来检查，而不是全部过一遍。抽样把每轮成本钉死在一个与总键数无关的常数上，这是定期删除能活在单线程里的前提。

多年来官方文档给的口径是一个三步循环：每秒约 10 轮，每轮从带寿命的键里随机抽 20 个，删掉其中已到期的；如果抽中的键里过期比例超过 25%，说明过期键还堆积着，立刻再来一轮。注意这个设计的两层节制：抽样封住「每轮做多少」，25% 规则封住「值得连做几轮」——过期键不多时一轮就收工，堆积严重时才加班。我们再上一道官方实现同精神的闸：时间上限——一轮循环花满预算（教学版 1ms）就强制收工，剩下的下一拍再删。为什么非要掐时间？第 3 章的答案原封不动：定期删除跑在伺候客户端的同一条主线程上，删除跑久了，全体客户端排队等它。而「加班也只加到预算为止、活永远切成一轮 20 个的小批」，正是第 4 章渐进 rehash 那服药——一次大阻塞摊薄成无数次微秒小活——第二回抓药。

两只手的账合起来看：惰性删除 CPU 近乎零花销、内存欠账无上限；定期删除花一点主线程时间、把内存欠账按批清掉、预算封住 CPU 开销。谁也替代不了谁——只留惰性，冷键永生；只留定期，热键过期后还要被人多读几拍。官方两种都做，我们的教学版也两种都做。

### 覆盖与查看：两个官方口径的小细节

键没了，登记簿要跟着干净，这里有两条官方语义（redis.io，EXPIRE 页）：其一，覆盖即清寿命——`SET` 不带 EX 覆盖一个键时，它原有的寿命登记被抹掉，TTL 从此回 -1；DEL 删键时登记一并撤走。其二，TTL 三态：-2 键不存在；-1 键在但没登记寿命；N 剩余整秒。「覆盖清寿命」不是怪癖，是保护：新写入的数据凭什么背着老数据的有效期？要续命，明说——再带一次 EX，或调 EXPIRE。

## 演练：先立寿命簿，再接两只手

本章演进三件事：src/expire.ts 从零写出 Expirer，src/db.ts 把它挂进命令层，再加一个 KEYS 当观察窗。测试 tests/ttl-expire.test.ts 十九条，照例先写先跑出红。登记簿开头的职责注释把全章路线说完了：

```ts
// src/expire.ts · 文件头
// 键的寿命登记簿：另一张表——键 → 到期时间戳（绝对毫秒）。
// 键本身不知道自己会过期，主表里也没有期限字段；到期与否，查这本登记簿。
// 删除的两只手：惰性（访问那一刻查，lazyCheck）与定期（周期抽样，activeCycle）——
// 一只省 CPU 但留僵尸键占内存，一只补刀内存但花主线程时间，谁也离不开谁。
```

### 第一步：Expirer——登记簿本体

字段与构造。注意时钟和随机源都是注入的——测试要手拨假钟、要伪随机，「过期」这件事就不能依赖真时间。

```ts
// src/expire.ts · 字段与构造
  // 到期登记表：键 → 到期的绝对时刻（毫秒）。存绝对时间戳而不是「还能活多久」——
  // 进程停了钟也照走（真 Redis 同款口径：重启后登记照样作数）
  private deadlines = new Dict<number>()
  // 时钟与随机源都可注入：测试手拨假钟、注入伪随机，「过期」这件事不用等真时间
  private now: () => number
  private random: () => number
  // 动手的回调：登记簿只管记账，从主表里删键由持有主表的人动手——两张表各管各的
  private dropKey: (key: string) => void
  private expiredTotal = 0

  constructor(options: { now?: () => number; random?: () => number; dropKey: (key: string) => void }) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.dropKey = options.dropKey
  }
```

第一只手 lazyCheck，惰性删除的全部本体就这八行。

```ts
// src/expire.ts · lazyCheck
  // 惰性删除：访问那一刻才查。到点了就动手（撤登记 + 叫 dropKey 删主表键 + 计数），回 true；
  // 没登记或没到点回 false，一个键的常态是查一万次也不动手
  lazyCheck(key: string): boolean {
    const deadline = this.deadlines.get(key)
    if (deadline === undefined || this.now() < deadline) return false
    this.deadlines.delete(key)
    this.dropKey(key)
    this.expiredTotal++
    return true
  }
```

第二只手 activeCycle，一轮定期删除。抽样用的是部分洗牌：只洗前 sampleN 个位置，前 n 个位置恰好就是抽中的样本，成本 O(n)、不碰剩下的。

```ts
// src/expire.ts · activeCycle
  // 定期删除一轮：从候选池随机抽 sampleN 个，到期的删掉，回本轮删除数。
  // 为什么抽样而不是全查：百万键挨个对时间戳，主线程要冻住——抽样是定期删除能活在单线程里的前提
  activeCycle(collectKeys: () => string[], sampleN = 20): number {
    const pool = collectKeys()
    const n = Math.min(sampleN, pool.length)
    // 部分洗牌：只洗前 n 个位置，抽样的全部成本是 O(n)——不碰剩下的，也不额外开数组
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(this.random() * (pool.length - i))
      const picked = pool[i]!
      pool[i] = pool[j]!
      pool[j] = picked
    }
    let deleted = 0
    for (let i = 0; i < n; i++) if (this.lazyCheck(pool[i]!)) deleted++
    return deleted
  }
```

### 第二步：挂进服务器——SET EX、EXPIRE/TTL、KEYS

两张表怎么挂钩？构造函数里接线：MiniRedis 把「从键空间删键」做成回调递给 Expirer——登记簿记账，动手的永远是键空间的持有者。到第 7 章，这个回调升级成统一路径 dropKey：DEL、过期、淘汰三条删键路共用同一个出口。

```ts
// src/db.ts · 构造：主表与寿命簿挂上钩
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
```

命令层所有取键的门，换成同一个入口 lookup——先过惰性检查，过期键当场删、按不存在处理。注意它是键级的：字符串键与跳表键一视同仁，第 5 章排行榜上的活动榜整个键到期就整个清场——「过期」住在键上，不住在值类型上。（命中时顺手 touch 的那笔 idle 时钟是下一章近似 LRU 的挂钩；构造末尾的重放与 aof 选项是「AOF」章账本的挂钩——本章先当它们不存在。）

```ts
// src/db.ts · lookup：所有取键的门都从这进
  // 键级取值：先过惰性检查，过期键当场删、按不存在处理——字符串与跳表一视同仁，
  // 「过期」住在键上，不住在值类型上（排行榜整个键说没就没）
  private lookup(key: string): string | SkipList | undefined {
    if (this.expirer.lazyCheck(key)) return undefined
    const value = this.data.get(key)
    if (value !== undefined) this.evictor.touch(key) // 命中即「用过」：idle 时钟拨到此刻（近似 LRU 的挂钩）
    return value
  }
```

SET 长出 EX 选项（全貌见第 2 章，这里是寿命簿相关的增量）——验证码的两步并一步，外加「覆盖即清寿命」。

```ts
// src/db.ts · set 的 EX 分支、内存关与寿命簿两行
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
```

EXPIRE 与 TTL 两个新命令，语义对齐官方（不存在回 0 / 三态回值）：

```ts
// src/db.ts · EXPIRE 与 TTL 命令
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
```

最后加一个观察窗：KEYS 列活键，但只过滤、不动手删——过期键不进名单，可它 physically 还在内存里。INFO 说 keys:1、KEYS 说空，两个口供对不上，就是「已到期还没被删」的僵尸态现形。这个窗口是本章实验的眼睛：

```ts
// src/db.ts · KEYS：旁观窗，只过滤不动手
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
```

### 第三步：定期驱动——夹在命令之间

谁去叫 activeCycle？真 Redis 是事件循环里的定时事件（serverCron，每秒约 10 次，没命令也照跑）。教学版把它做成命令之间的节流驱动：每条命令进门先看「距上一拍够 100ms 了吗」，够了就跑一轮三步循环。一拍之内是经典口径的「抽 20、删到期的、超四分之一再来一轮」，外加时间上限兜底：

```ts
// src/db.ts · 定期删除的三个参数
// 定期删除的三个参数：经典官方文档口径——每轮抽 20 个、到期比例超四分之一再来一轮；
// 外加一道时间上限兜底：主线程还要回去伺候客户端，绝不在删除上花过头
const ACTIVE_SAMPLE_N = 20
const CYCLE_BUDGET_MS = 1
const DEFAULT_CYCLE_MS = 100 // 两拍之间的间隔：每秒 10 拍，真 Redis 的 serverCron 同款节拍
```

```ts
// src/db.ts · maybeExpireCycle：定期删除的驱动
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
```

### 先红后绿

测试照例先写先跑，第一次全红——expire.ts 还不存在，import 直接失败。十九条里最见功力的是「两条路径各自单独钉死」：想断言惰性路径，就得保证删键的不是定期；想断言定期路径，就得保证那些键从头到尾没被访问过。靠的是两个注入旋钮：手拨假钟与周期开关。钉惰性的这条，把周期关到 Infinity，僵尸态三连拍现形：

```ts
// tests/ttl-expire.test.ts · 惰性路径单独钉死
  it('过期后 GET 回 nil 且当场删：KEYS 里先消失、INFO 的 keys 后归零——僵尸键死在 GET 手上', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity }) // 定期删除关掉，只剩惰性
    db.execute(['SET', 'code', '42', 'EX', '1'])
    clock.advance(2000) // 到期了
    // 僵尸态：还没人访问过——键 physically 还在（keys:1），但 KEYS 已经不认它
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '1', expires: '1', expired: '0' })
    expect(parseBulkArray(db.execute(['KEYS', '*']))).toEqual([])
    expect(db.execute(['GET', 'code'])).toBe('$-1\r\n') // 访问那一刻：查簿、删键、回不存在
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expires: '0', expired: '1' })
  })
```

钉时间上限的这条最妙：用一只能「花时间」的钟——每读一次时间走 1ms。一轮抽样删 20 个键，钟就走了 20ms，1ms 预算当场击穿，循环收工。一条 PING 只删一小批，分三拍清完：

```ts
// tests/ttl-expire.test.ts · 时间上限兜底
  it('时间上限兜底：递进钟下每轮删除都花掉假钟 20ms，预算 1ms 一到就收工', () => {
    const clock = steppingClock(1_000_000) // 每读一次时间 +1ms
    const db = new MiniRedis({ now: clock.now, cycleMs: 1000 })
    for (let i = 0; i < 60; i++) db.execute(['SET', `k${i}`, 'v', 'EX', '1']) // 登记时还没到期
    clock.advance(2000) // 全部过期
    db.execute(['PING']) // 一轮抽样删 20 个键，钟已走掉 20ms：预算击穿，收工
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '40', expired: '20' })
    clock.advance(2000)
    db.execute(['PING']) // 下一拍再来一小批
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '20', expired: '40' })
    clock.advance(2000)
    db.execute(['PING'])
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '0', expired: '60' })
  })
```

另一侧，定期路径独立成立：五个键到期后只发一条 PING——一个都没 GET 过，expired 已是 5（删它们的只能是周期）；固定假钟下 50 个全过期，靠 25% 规则一条命令里循环抽到清空。实现落地，全书 67 条全绿——第 2 到 5 章的 48 条旧测试一行未改，它们仍是公共 API 的哨兵。

## 验证：亲手看到键走掉

1. 双硬门槛先跑一遍：`cd companion && npm run typecheck && npm test`——typecheck 干净，67 条全绿（旧 48 条 + 本章 19 条）。
2. 开机做里程碑的可感知面：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`。依次：`SET code 42 EX 2`（回 OK）、`TTL code`（回 2）、原地等 3 秒（这回是真钟）、`GET code`——应看到 `(nil)`；`INFO` 应看到 `expired:1` 与 `keys:0`；`TTL code` 回 -2（删干净了）。诚实说明：开机实验里你分不清是哪只手删的——默认 100ms 一拍的定期删除大概率先动手；单独看惰性路径，要靠测试里 `cycleMs: Infinity` 那组的纯度。
3. 僵尸态去哪了：`SET keeper v`、`SET gone 1 EX 1`，等 2 秒，跑 `INFO`——先猜 `keys` 是几？跑出来是 `keys:1, expired:1`。等的那 2 秒里没有任何命令进门，`gone` 确实当了 2 秒僵尸；但你敲下的这条 `INFO` 就是过期后进门的第一条命令——它先过 `maybeExpireCycle` 的定期补刀，僵尸在你想看它之前就被清走了。想亲眼钉住僵尸态，得关掉定期那只手——测试里 `cycleMs: Infinity` 那组的三连拍（演练槽已见过）就是干这个的。
4. 先猜后跑：`SET s v`、`EXPIRE s 100`、`SET s v2`——`TTL s` 回几？跑：-1，覆盖清寿命（官方同款语义）。想续命该怎么办，自查第 2 问。
5. 再猜一个：`EXPIRE missing 10` 回几？`TTL missing` 回几？跑：0 与 -2——EXPIRE 只认活键，TTL 把「不存在」与「没寿命」分开报。
6. 指认一处小破坏：打开 `src/db.ts`，把 set 里 `if (ttlMs === null) this.expirer.remove(args[0]!)` 那行改成空块 `if (ttlMs === null) { /* 实验后改回 */ }`——覆盖时不再清寿命。先猜哪条测试会红；再跑 `npx vitest run tests/ttl-expire.test.ts` 对照。红一条：「SET 覆盖清寿命（官方文档口径）」——覆盖后的 TTL 会报出老登记的剩余秒。改回，回到全绿。

## 收束：三倍内存的账，现在你自己能算

回到开头那台内存涨了三倍的服务器。现在你能亲口讲清楚每一环：EX 300 只是在寿命簿上记了一笔；验证码输完就没人访问，惰性删除永远等不到那只手；定期删除倒是在跑，但它每秒 10 拍、每拍抽 20 个，还要掐着 1ms 预算收工——十几万个僵尸键，是能被慢慢清掉的，前提是键量别再涨得比清得快。你当时以为的定时器从头到尾不存在，存在的只是「记账 + 两只都在预算内干活的手」。INFO 的 expired 就是那本清理台账——本章之后，它涨给你看。

四个新词各收一句。过期字典——另一张表，键 → 到期时间戳，键本身不知道自己会过期。惰性删除——被访问那一刻才查才删，CPU 近乎白送，代价是没人碰的键占内存。定期删除——周期抽样补刀，每轮一小批、比例高才连做、时间预算封顶。抽样——随机查一小撮代替全表扫，把每轮成本钉死在与总键数无关的常数上。你的第六个里程碑落定：服务器会说 EXPIRE/TTL/KEYS，SET 懂得 EX，键有了寿命——字符串和排行榜一视同仁。

本章与真 Redis 的差异记四笔（汇总进附录差异清单）：定期驱动夹在命令之间而非事件循环定时事件，空闲时无命令就不跑；固定 20 个、25%、1ms 预算是经典文档口径，现行真货已改为自适应（active-expire-effort 可调）；候选池每轮先取全名单再抽样，真货从哈希桶直接抽；KEYS 只认 `*` 与 `?` 的极简通配，且只过滤不删。另有一笔留给后面：键过期时真 Redis 会在 AOF 里补记一条 DEL，让重放与过期一致——「AOF」章兑现。

自查三问（先自己答，再展开对）：

1. 把 `ACTIVE_SAMPLE_N` 从 20 改成 5：「饱和时一轮接一轮」（50 键、固定假钟）还绿吗？「时间上限兜底」（递进钟）呢？先逐条推演，再动手改跑。
2. `SET k v EX 100` 之后 `SET k v`，TTL 变 -1——那「验证码重发一次、有效期重置五分钟」的正确写法是什么？为什么官方偏要把覆盖设计成清寿命而不是保留？
3. lazyCheck 明明知道键该删了，为什么删主表键要走 dropKey 回调、而不让 Expirer 直接持有 data 自己删？把两张表的持有关系反过来（Expirer 持有 MiniRedis）会付出什么代价？

<details>
<summary>第 1 问答案</summary>

饱和测试仍绿：固定假钟下预算永不触发，25% 规则驱动循环一轮 5 个、十轮清完 50 个，终点不变。时间上限测试红：递进钟下一轮只删 5 个、钟走 5ms，预算照样击穿、每拍清 5 个——断言 `keys:40, expired:20` 落空（实际是 55/5）。这道题的要点：抽样数改小，25% 规则的「清得完」没变，变的只是每批大小与节奏。锚点：maybeExpireCycle 两个 break。
</details>

<details>
<summary>第 2 问答案</summary>

重置写法是再带一次 EX：`SET code 42 EX 300`，或先 SET 再 `EXPIRE code 300`。覆盖清寿命是保护而非麻烦：不带 EX 的 SET 语义是「写入一个不知道寿命的新值」——若沿用老寿命，新数据会在写入者不知情时消失，这类「静默丢数据」比「多活一会儿」危险得多。redis.io 的 SET/EXPIRE 页都把这条写成明确语义。锚点：原理一节「覆盖与查看」。
</details>

<details>
<summary>第 3 问答案</summary>

登记簿与主表各管各的：Expirer 持有 deadlines，MiniRedis 持有 data。删除主表键的能力，以回调的方式「借」给它。反过来让 Expirer 持有整个 MiniRedis，两张表就耦死了——Expirer 单独测试要拖上全套命令层，下一章的 Evictor 也想删键，难道每个都持有整个库？回调把「谁记账」与「谁动手」拆开，两张表各自可测、可换。锚点：演练第二步的构造接线与 dropKey 注释。
</details>

从下一章起，路这么走（本章已走到「键有了寿命」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 「跳表」 | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 「过期删除」（本章） | 过期字典、惰性删除、定期删除、抽样 |
| 下一站「内存满了」 | 内存淘汰、近似 LRU、LRU 与 LFU、idle 时钟 |
| 更远的路 | 「AOF」与「RDB 快照」：AOF、AOF 重写、刷盘策略、fork、写时复制；「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：过期删除管的是「到期的键」——它们死得名正言顺。可内存真的满了、而键一个都没到期呢？那时候牺牲谁？「内存淘汰」章回答：抽 5 个、踢最久没用的，宁可错杀，不许冻场。
