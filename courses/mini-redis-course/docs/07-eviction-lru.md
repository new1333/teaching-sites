---
title: 内存满了：不精确的 LRU
---

# 内存满了：不精确的 LRU

先接上第 6 章末尾的尾巴。过期删除管的是「到期的键」——它们死得名正言顺；可内存真的满了、而键一个都没到期呢？那一章留了一句狠话：淘汰牺牲的是活键。还有一笔旧账要还：第 6 章自查第 3 问问你，Expirer 删键为什么走回调而不自己持有主表——答案末尾埋了一句「第 7 章的 Evictor 也想删键，难道每个都持有整个库？」这一章 Evictor 来了，同一副药方再抓一副。

## 晚高峰的 OOM 告警：内存满了，一个键都没被清

周四上午十一点，订单服务的告警群炸了。应用日志刷屏的是同一个错：

```text
OOM command not allowed when used memory > 'maxmemory'
```

缓存实例的内存到顶了，SET 一连串吃报错，写入侧的业务接连超时。刚入职的同事盯着屏幕喊：「内存满了不会清点旧数据腾地方吗？」值班的老手回他一句：「清哪个？你敢担保哪个键没人用？」更反直觉的是下一幕：登上去一看，这台 Redis 从头到尾一个键都没清——默认策略还真是「宁可报错，不扔数据」。

这一章把整个机制写出来：内存上限（maxmemory）到了之后的三种选择；为什么默认选最保守的那种；真要扔的时候，为什么扔的是「大概率最久没用」的键；以及为什么这个「最久没用」从头到尾都不精确——**近似 LRU 踢的从来不是全局最旧的键，是随机抽中的 5 个键里最旧的那个**。落成里程碑：Evictor（键数上限、抽样近似 LRU、两策略）、CONFIG 这对开关、INFO 里能亲眼看涨的 evicted 计数。

## 原理：满了之后，只有三种选择

内存上限到了，服务器面前其实只有三条路：拒写、乱扔、挑着扔。逐条看。

### 先拒写：noeviction 的哲学

默认策略叫 noeviction：满了就拒绝会新增数据的写命令，回上面那条 OOM 错误；读命令照常服务。redis.conf 的原话（译文）：「Redis 将开始对会使用更多内存的命令回以错误，如 SET、LPUSH 等，并继续应答 GET 这类只读命令。」为什么默认这么轴？因为 Redis 不知道你把它当什么用。当缓存用，键扔了可以再查一次库补回来；当主数据存储用，键扔了就真没了。**扔数据的决定必须由人来做**，服务器不替你赌——这是默认值的哲学，也是为什么告警群里那句「清点旧数据」听着有理、却没人敢半夜动手。

「满了」怎么量？真 Redis 配 maxmemory，按字节算，还能写 100mb 这样的单位。教学版简化成键数上限：设 100 就是至多 100 个键（差异声明，登记进附录差异清单）。这会让「覆盖旧键」永远不触发拒写——键数没变；真货按字节，把小值改成大值同样可能触线。

### 要扔的话扔谁：LRU 与它的实现账

真要腾地方，扔谁最不心疼？直觉是 LRU（Least Recently Used，最近最少使用）：最久没人碰的键，大概率短期内也没人碰。注意这个推理的本质——**LRU 本身就是一次猜测**，猜「过去没人用的，将来也没人用」。既然是猜，就不必猜得十全十美，这句话是本章后半段的伏笔。

教科书的精确 LRU 长这样：哈希表管定位，再配一条双向链表管顺序——每次访问把节点从链中间摘下来、插到队头，内存满了踢队尾。做反事实检验，硬上这套要付两笔账：

- 内存账：双向链表每个节点要前驱、后继两个指针，64 位机器上一个指针 8 字节，两个 16 字节。不少键的值本身就是几个字符——元数据比数据还贵。
- CPU 账：每次 GET 都要摘链、头插。第 3 章的账本翻出来：主线程上的每个动作都让全体客户端排队，而读恰是缓存服务器的每秒几十万次的主业。

antirez 在设计文里把这层意思说得很直（译文）：键空间「没有余地再把对象串进链表了（胖指针！）」，而且 LRU 本身也只是对「我们想要什么」的近似——「那不如把 LRU 本身再近似一层」。这句反问是整个设计的钥匙：与其花大代价维护一个精确的猜测，不如便宜地维护一个不精确的猜测。

### 近似 LRU：抽 5 个，踢最久没用的

于是有了真正的实现——随机抽样近似 LRU。每个键记一个 idle 时钟（键最近一次使用是什么时候；「idle」直译是闲置——多久没人碰）；内存满了要腾座位时，随机抽 5 个键，踢掉其中 idle 最大的——最久没用的那个。抽 5 这个数有出处：antirez 那篇设计文里，初版算法只抽 3 个（「选 3 个随机键，踢 idle 最高的那个」）。后来实现提速，官方默认改为 5——redis.conf 的 maxmemory-samples。想更准可以加到 10：「非常接近真 LRU，但更费 CPU」；上限 64。

你大概以为 LRU 是精确全局有序的——内存里有一条从头到尾排好的队，踢的永远是全局最旧。现在你能亲手拆穿这个直觉：出局的只是「抽中的 5 个里最旧」。antirez 的博文配过一张著名的三色带实验图：灌满键、按序访问、再灌一半新键逼它淘汰——理论 LRU 应该恰好踢掉最老的一半，近似 LRU 只是大致如此：老键大概率先走，也有漏网的；新键偶尔中弹。redis.io 文档的原话是「Redis 的 LRU 算法只会概率性地淘汰较老的键」。为什么这样也够用？因为真实访问多呈幂律分布——少数热键吃掉绝大多数流量。官方模拟的结论：幂律访问模式下，近似 LRU 与精确 LRU 的差异「极小或不存在」。锚点用圣经里那句话：抽 5 个人问谁最久没来，而不是给全场每个客人挂一只计时器。

这套近似你其实见过。第 6 章定期删除抽 20 个查过期，这一章抽 5 个挑淘汰——同一副「抽样」药方，第二次抓：把每轮成本钉死在与总键数无关的常数上，让这活在单线程里活得下去。

### LFU 纠什么偏：频率对新近度

LRU 有一个著名的偏：它只看「最近一次」。凌晨跑一次全量报表，把一百万个键挨个读一遍——每个键的 idle 全部清零，冷数据集体冒充热数据（行话叫缓存污染），第二天早上命中率塌方。LFU（Least Frequently Used，最不经常使用）纠的就是这个偏：不看最近，看频率——常用的键分数高，报表扫过一遍的冷键分数纹丝不动。真 Redis 4.0 起提供 LFU 策略，工程上同样「近似」。每个对象只用一个 8 位计数器，配对数概率计数（Morris 计数器——越热越难再加一分，255 封顶约当百万次访问），外加每分钟衰减一次（昨天的热不算今天的热）。参数是 redis.conf 里的 lfu-log-factor 10 与 lfu-decay-time 1。本课程不实现 LFU，思想带走即可：新近度与频率是两种「热」，扫一遍改变前者、不改变后者。

还有一笔账要分清：**过期删的是该死的键，淘汰牺牲的是还活着的键**。淘汰出局的键往往还有大好寿命——它死于内存不够，不是寿命到期。所以 INFO 里 evicted 与 expired 是两本账：第 6 章那本记到期离场的，这一章新添的这本，记的是内存处决的活键。两类删除在真货里同属「服务器自发的删除」（redis.conf 讲惰性释放时把 eviction 与 expire 并列），在我们的教学版里则更进一步——走的是同一扇删键的门，演练槽见。

## 演练：先立 idle 时钟，再挂内存关

本章演进三件事：src/eviction.ts 从零写出 Evictor；src/db.ts 把内存关挂进命令层，顺带把删键收拢成统一路径；INFO 添上 evicted。测试 tests/eviction-lru.test.ts 十二条，照例先写先跑出红。文件头的职责注释把全章路线说完了：

```ts
// src/eviction.ts · 文件头
// 内存淘汰：键数到了上限，谁腾座位——noeviction（满了拒写不删键，真 Redis 同款默认）
// 或 allkeys-lru（随机抽样近似 LRU：抽 5 个、踢里面最久未用的）。
// 为什么「近似」：精确 LRU 要一张全局双向链表，每次访问都得把节点挪到队头——
// 每个键多背两个指针（antirez 的原话「fat pointers!」，对象里塞不下），每次读写多一次挪动。
// 既然 LRU 本身也只是「预测谁还会被用」的近似，那就把近似再近似一层：抽 5 个，踢最旧的。
```

### 第一步：Evictor——idle 时钟加抽样踢人

字段与构造。idle 时钟又是一张「键 → 数字」的表，你第 4 章的 Dict 第三次上岗；时钟与随机源照旧可注入——测试要手拨假钟、要固定种子的伪随机，「踢了谁」不赌运气。

```ts
// src/eviction.ts · 字段与构造
export class Evictor {
  // idle 时钟：键 → 最近一次被用（读或写）的时刻（毫秒）。idle = now − 最近用时，越大越久没用。
  // 真货把秒级时钟塞在对象头的 24bit 字段里、不占额外内存；教学版的值结构里塞不下，
  // 另开一张表记（差异清单登记）
  private lastSeen = new Dict<number>()
  // 时钟与随机源都可注入：测试手拨假钟、注入固定种子的伪随机，「踢了谁」不赌运气
  private now: () => number
  private random: () => number
  private limit = 0 // 键数上限（真货 maxmemory 记字节数，教学版以键数近似）：0 = 不限
  private policy: EvictPolicy = 'noeviction' // 满了先拒写——redis.conf 同款默认
  private evictedTotal = 0

  constructor(options: { now?: () => number; random?: () => number } = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
  }
```

touch 是全部的状态写入——不排队、不排序、不挪节点，「最近用过」只是一次改时间戳。

```ts
// src/eviction.ts · touch 与 remove
  // 记一笔「刚刚用过」：读命中与写入都算。近似 LRU 的全部状态就这一张表——
  // 不排队、不排序、不挪节点，「最近用过」只是一次改时间戳
  touch(key: string): void {
    this.lastSeen.set(key, this.now())
  }

  // 键没了（DEL、过期、淘汰都算），idle 登记跟着撤——不然表里攒孤儿
  remove(key: string): void {
    this.lastSeen.delete(key)
  }
```

onWrite 是本章的主菜：一个新键要进门，满了按策略办。抽样用第 6 章同款的部分洗牌；踢人的判据是 idle 最大。

```ts
// src/eviction.ts · onWrite
  // 一个新键要进键空间了（调用方保证这不是覆盖）：满了按策略办。
  // 回本轮腾出的键数；策略是 noeviction 且已满 → 回 -1（拒写信号，命令层翻译成 OOM 应答）
  onWrite(collectKeys: () => string[], evictOne: (key: string) => void): number {
    if (this.limit === 0) return 0 // 没设上限：内存关不存在
    const pool = collectKeys()
    if (pool.length < this.limit) return 0 // 没满：照常进
    if (this.policy === 'noeviction') return -1 // 满了：宁可报错，不扔还活着的数据
    let freed = 0
    while (pool.length >= this.limit) {
      // 近似 LRU 一轮：随机抽 5 个（部分洗牌，洗完前 n 个位置就是样本），踢其中 idle 最大的。
      // 不是全局最旧，是「抽中的 5 个里最旧」——性能换准确，赌的是老键大概率也在样本里
      const n = Math.min(EVICT_SAMPLE_N, pool.length)
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(this.random() * (pool.length - i))
        const picked = pool[i]!
        pool[i] = pool[j]!
        pool[j] = picked
      }
      let victim = pool[0]!
      for (let i = 1; i < n; i++) if (this.idleOf(pool[i]!) > this.idleOf(victim)) victim = pool[i]!
      evictOne(victim) // 删键走与 DEL、过期同一扇门（命令层的 dropKey）
      this.lastSeen.delete(victim) // 被踢出键空间的键，不再占这本表
      const idx = pool.indexOf(victim)
      pool[idx] = pool[pool.length - 1]! // 与末位对调再砍尾：O(1) 出池，池面本来就无序
      pool.pop()
      freed++
      this.evictedTotal++
    }
    return freed
  }
```

### 第二步：挂进命令层——统一删键路径与内存关

先还旧账。第 6 章自查第 3 问的答案在这里兑现成代码：Expirer、Evictor 都想删键，谁也不许攥着整个键空间——**谁持有键空间，谁动手删键**，别的一律回调。MiniRedis 把删键收拢成一个出口 dropKey，主表、寿命簿、idle 登记一次清干净；DEL、过期、淘汰三条路全从这走：

```ts
// src/db.ts · dropKey：三条删键路的公共出口
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

Expirer 构造时接到的 dropKey 回调、Evictor 踢人时接到的 evictOne 回调，指的都是它。过期与淘汰从此共用同一套删键路径——这正是上一章收束时承诺的「Evictor 删键走与过期同一套删键路径」。测试里有对应的钉子：淘汰的键若带着 TTL，寿命登记跟着撤，INFO 的 expires 不留孤儿。

内存关本体是个小包装，贴着「新键才占座位」的语义：

```ts
// src/db.ts · admitNewKey：新键进门前的内存关
  // 新键进门前的内存关（第 7 章）：满了按策略腾座位或回绝。回 false = 拒写，命令层翻译成 OOM 应答。
  // 只在「键还不在主表里」时叫它——覆盖旧键不占新座位
  private admitNewKey(): boolean {
    const freed = this.evictor.onWrite(
      () => this.data.entries().map(([key]) => key),
      (key) => this.dropKey(key), // 淘汰的刀也走统一删键路径（箭头包一层保住 this）
    )
    return freed >= 0 // -1 = 满了且策略是宁可报错不扔数据
  }
```

挂钩点有三处，都是一行到三行的小手术：SET 在写入前过内存关、写入后 touch（写入也是一次「用」）；ZADD 只在「排行榜键还不存在」的分支过同样的关；lookup 命中时 touch 一笔——GET、ZRANGE、EXPIRE 这些读门从此都会刷新 idle 时钟（KEYS 例外，旁观窗只看不摸）。它们的当前形态已经长在第 2、5、6 章的引用块里，这里不重贴。

最后一对零件是开关。真 Redis 用 CONFIG SET 运行时改配置，教学版只认两个名字。

```ts
// src/db.ts · CONFIG：内存关的两个旋钮
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
```

### 第三步：INFO 的第二本删除台账

INFO 在 keys/expires/expired/rehash 之间插入一行 `evicted:${this.evictor.evicted}`。过期与淘汰两本删除台账并排放好，谁也没吃掉谁（当前全形态见第 4 章引用块）。

### 先红后绿

测试照例先写先跑，第一次全红——eviction.ts 还不存在，import 直接失败。十二条里最见功力的是「不赌真随机」：抽样本是随机的，测试把随机源注入成固定种子的伪随机（lcg），或干脆恒 0——恒 0 时洗牌退化成「什么都不换」，抽中的恰是池面前 5 个，victim 人人可推。

```ts
// tests/eviction-lru.test.ts · 恒 0 随机：抽样确定化
  it('恒 0 随机下抽样退化为「取池面前 5 个」：踢的是样本里 idle 最大的', () => {
    const clock = fakeClock(1000)
    const evicted: string[] = []
    const e = new Evictor({ now: clock.now, random: () => 0 })
    e.setLimit(5)
    e.setPolicy('allkeys-lru')
    // 池面 a..f：touch 时刻依次 +10ms——a 最久没用，f 刚刚用过
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) {
      clock.advance(10)
      e.touch(k)
    }
    const pool = ['a', 'b', 'c', 'd', 'e', 'f']
    const freed = e.onWrite(() => [...pool], (k) => evicted.push(k))
    expect(freed).toBe(2) // 6 键上限 5：腾到 4 才放新键进来
    expect(evicted).toEqual(['a', 'b']) // 两轮各踢 idle 最大：先 a，再 b——刚用过的 f 永不中签
    expect(e.evicted).toBe(2)
  })
```

另一条是里程碑剧本，大纲里那句「设 100 键上限，灌满后先访问旧键 A 再灌新键——没被碰过的更旧键先消失」原样翻译。

```ts
// tests/eviction-lru.test.ts · 里程碑剧本
  it('里程碑剧本：100 键上限灌满，先访问 k000 再灌新键——没被碰过的更旧键先消失', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity, random: lcg(7) })
    db.execute(['CONFIG', 'SET', 'maxmemory', '100'])
    db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    for (let i = 0; i < 100; i++) db.execute(['SET', `k${String(i).padStart(3, '0')}`, 'v'])
    clock.advance(60_000) // 一分钟过去：100 个键全都闲置
    expect(db.execute(['GET', 'k000'])).toBe('$1\r\nv\r\n') // 全场唯一一次访问：k000 的 idle 清零
    expect(db.execute(['SET', 'newcomer', 'v'])).toBe('+OK\r\n') // 新键进门：踢一个老的腾座位
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '100', evicted: '1' }) // 键数不涨，总数守恒
    expect(db.execute(['GET', 'k000'])).toBe('$1\r\nv\r\n') // 刚用过的键活了
    expect(db.execute(['GET', 'newcomer'])).toBe('$1\r\nv\r\n') // 新键也进来了
    let gone = 0
    for (let i = 1; i < 100; i++) if (db.execute(['GET', `k${String(i).padStart(3, '0')}`]) === '$-1\r\n') gone++
    expect(gone).toBe(1) // 被踢的是 k001..k099 里的一个：k000 的 idle 是 0，永不中签
  })
```

注意 k000 为什么必活：它的 idle 是 0，只要它进了样本，样本里必有比它更老的——**刚用过的键在抽样里天然免疫**。承诺的兑现也有钉子。

```ts
// tests/eviction-lru.test.ts · 淘汰与过期走同一套删键路径
  it('淘汰与过期走同一套删键路径：被踢的带 TTL 键，寿命登记跟着撤——expires 不留孤儿', () => {
    const clock = fakeClock(0)
    const db = new MiniRedis({ now: clock.now, cycleMs: Infinity, random: () => 0 })
    db.execute(['CONFIG', 'SET', 'maxmemory', '2'])
    db.execute(['CONFIG', 'SET', 'maxmemory-policy', 'allkeys-lru'])
    db.execute(['SET', 'shortlived', 'v', 'EX', '100']) // 带寿命的键
    clock.advance(1000)
    db.execute(['SET', 'keeper', 'v']) // 晚一秒进场：更「新」
    expect(db.execute(['SET', 'newcomer', 'v'])).toBe('+OK\r\n') // 满 2：踢 idle 最大的 shortlived
    expect(db.execute(['GET', 'shortlived'])).toBe('$-1\r\n')
    expect(db.execute(['GET', 'keeper'])).toBe('$1\r\nv\r\n')
    // 淘汰的账不记进过期：它还没到寿命，是内存判了它；寿命簿也不留孤儿登记
    expect(infoOf(db.execute(['INFO']))).toMatchObject({ keys: '2', expires: '0', evicted: '1', expired: '0' })
  })
```

实现落地，全书 79 条全绿——第 2 到 6 章的 67 条旧测试一行未改，它们仍是公共 API 的哨兵。

## 验证：亲手看到 OOM，亲手看到踢人

1. 双硬门槛先跑一遍：`cd companion && npm run typecheck && npm test`——typecheck 干净，79 条全绿（旧 67 条 + 本章 12 条）。
2. 开机复现告警那晚：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`。依次：`CONFIG SET maxmemory 3`（回 OK，从此至多 3 个键）、`SET a 1`、`SET b 2`、`SET c 3`（各回 OK）、`SET d 4`——应看到报错原文 `(error) OOM command not allowed when used memory > 'maxmemory'`。开头那场晚高峰告警，此刻在你手里复现完毕。
3. 读不受拦，先猜后跑：满了之后 `GET a` 回什么？`TTL a`、`KEYS *` 呢？先猜再跑——全部照常，内存关只拦新增键的写。再猜一个：`SET a 111`（覆盖旧键）会报 OOM 吗？不会——覆盖不占新座位，这是键数口径与真货字节口径的一个差异点。
4. 保命符实验：`CONFIG SET maxmemory-policy allkeys-lru`，然后 `SET a x`、`SET b y`、`SET c z`（三条之间隔几秒，让 idle 拉开）、`GET a`（摸一下最老的键）、`SET d v`——先猜谁消失了？跑 `GET b`——`(nil)`。出局的是 b：a 刚有人碰过、c 最新写入，b 最久没人碰；三个键全在样本里，idle 最大者出局，连「近似」都用不上。`INFO` 应看到 `evicted:1` 且 `keys:3`。
5. 指认一处小破坏：打开 `src/eviction.ts`，把 `const EVICT_SAMPLE_N = 5` 改成 `1`——样本砍到一个，「idle 最大」成了摆设。先猜哪两条测试会红；再跑 `npx vitest run tests/eviction-lru.test.ts` 对照。红两条：「恒 0 随机下抽样退化」（踢的变成池面前两个 a、f，与断言的 a、b 对不上）与「GET 就是保命符」（hot 键照样第一轮就抽中出局——「最近用过」这层保护没了）。有趣的是里程碑那条仍绿——k000 恰好不在池面第一位，是运气不是保护。改回 5，回到全绿。

## 收束：那晚的告警，现在你能一条条拆开

回到上午十一点的告警群。现在你能亲口讲清每一环：报错原文说 maxmemory 到顶；服务器一个键没清，因为默认策略 noeviction——扔数据的决定必须由人来做；读命令一直活着，拦下的只有新增键的写。值班动作也清楚了：要么 `CONFIG SET maxmemory-policy allkeys-lru` 让它自己腾座位，要么加内存。换了策略之后谁出局？大概率是抽中的 5 个里最久没用的那个——不是全局最旧，够用，因为热键本来就集中在少数几个身上。

四个新词各收一句。内存淘汰——内存满了主动腾地方，与过期不同：过期删到期键，淘汰牺牲活键。近似 LRU——不维护全局精确链表，随机抽 5 个踢最久未用的，性能换准确。LRU 与 LFU——两种「热」：新近度与频率；报表扫描洗得动前者，洗不动后者。idle 时钟——每键记一笔最近使用时刻，近似 LRU 唯一的状态。你的第七个里程碑落定：CONFIG 两个旋钮、Evictor 一套抽样踢人、INFO 里 expired 旁并排的 evicted 台账——写满、拒写、腾位三种局面都亲手演过。

本章与真 Redis 的差异记六笔（汇总进附录差异清单）：maxmemory 以键数近似（真货按字节，覆盖大值也会触发拒写）；idle 用毫秒时间戳另开一张表（真货是对象头里的 24bit 秒级时钟，读命中时无条件刷新，不占额外内存）；没有候选池（真货 3.0 起有一个 16 槽的池子跨轮记住好候选，antirez 说加到抽 10 就几乎等于真 LRU）；策略只实现 noeviction 与 allkeys-lru 两个（真货至 8.x 主线八个，volatile- 系列只在带 TTL 的键里挑；8.6 起新增 LRM 系，当个视野即可）；CONFIG 只认两个名字且 GET 不支持通配；内存关只在「新增键」时收取键名单（真货读一个内存计数器，O(1)）。另有一笔留给后面：淘汰删的是活键，命令日志里没有它的死讯——真货会向 AOF 与从库补记一条 DEL，重放才与内存一致，「AOF」章兑现。

自查三问（先自己答，再展开对）：

1. 把 `EVICT_SAMPLE_N` 从 5 改成 10，本章测试有一条会红吗？逐条推演「恒 0 随机」「近似语义」「里程碑剧本」再动手验证——答案和「样本更大更接近真 LRU」这件事是什么关系？
2. 凌晨的报表把一百万个键挨个读了一遍。第二天早高峰，LRU 缓存与 LFU 缓存各是什么遭遇？用「新近度会刷新、频率只加一」推一遍。
3. Evictor 为什么不自己持有 data 删键、而要走 evictOne 回调绕一圈？把持有关系反过来（Evictor 持有 MiniRedis），第 6 章自查第 3 问里列的代价在本章会具体变成什么？

<details>
<summary>第 1 问答案</summary>

一条都不红。恒 0 随机：池 6 键抽 10，n = min(10, 6) = 6，全抽——victim 仍是 idle 最大的 a，再 b。近似语义与里程碑：判据没变（idle 最大者出局，刚 touch 的键天然免疫），样本从 5 到 10 只是让「样本里最旧」更接近「全局最旧」。测试断言的是语义而非「恰好抽中谁」，所以样本变大不红。官方文档同款结论：抽 10 时近似已非常接近理论 LRU。锚点：onWrite 的 victim 挑选与 idleOf。
</details>

<details>
<summary>第 2 问答案</summary>

LRU：一百万个键的 idle 全部清零，冷数据集体冒充热数据（缓存污染）；早高峰真正要用的热键，有一部分昨晚已被「假热」挤出去，命中率塌一阵，直到访问模式把队伍重新洗回来。LFU：每个键的频率计数只加了一（Morris 计数器越热越难加一，冷键加完仍远低于热键），排名几乎不动，早高峰基本无感。这正是 LFU 存在的理由。锚点：原理一节「LFU 纠什么偏」。
</details>

<details>
<summary>第 3 问答案</summary>

谁持有键空间，谁动手删键。Evictor 只管策略与记账（idle 表、抽样、计数），删键的能力以 evictOne 回调「借」进来。反过来让 Evictor 持有 MiniRedis：它单独测试就得拖上整个命令层；它删键得绕过 EXPIRE 的寿命簿语义（键空间有三张表要同时清，Evictor 得全知道）；本章之后 AOF 还要来挂钩——每个机制都攥着整个库，就没人能单独演进。dropKey 是三条路的公共出口，回调是「借刀」的规矩。锚点：演练第二步 dropKey 与第 6 章自查第 3 问。
</details>

从下一章起，路这么走（本章已走到「内存满了会自己腾」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 「跳表」 | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 「过期删除」 | 过期字典、惰性删除、定期删除、抽样 |
| 「内存满了」（本章） | 内存淘汰、近似 LRU、LRU 与 LFU、idle 时钟 |
| 下一站「内存会断电」 | 「AOF」：AOF、AOF 重写、刷盘策略；「RDB 快照」：RDB 快照、fork、写时复制 |
| 更远的路 | 「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：内存这一关守住了——满了会拒、会腾、账本记得清。可这一切都活在内存里，断一次电全没了。下一部分「内存会断电」从 AOF 开始：把每一步写下来，重启后一笔笔重放。
