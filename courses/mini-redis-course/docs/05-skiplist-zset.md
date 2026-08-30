---
title: 跳表：能二分查找的链表
---

# 跳表：能二分查找的链表

先接上第 4 章末尾那个尾巴。哈希表里所有键一律平等——一次哈希、一个桶，谁也不比谁靠前。可排行榜要的恰恰是「排在谁前面」：成员按分数排队，还要随时切出前一百名。这个问题 Dict 帮不上忙，得请这一章的主角。

## 排行榜的两头堵

给游戏做一个排行榜：十万个（玩家， 分数），两个最常见的方案都顶不住。

方案一：数组存着，每次查榜 `Array.sort` 排一遍。查一次排一次——范围查询每次都重排，十万个成员排一遍是上百万次比较，每来一个看榜的都收一遍税。那预先排好呢？新问题来了：有人涨分就得插进中间，数组插入要把后面一半全往后挪——十万个成员平均挪五万个位置，插入慢得没法看。

方案二：交给 MySQL，`order by score limit 100`。底层同样是「查一次排一次」（有索引能好些，但每次范围查询都要沿索引走一遍再回表），而且榜单是秒级高频更新的——涨分、上榜、掉榜，每一步都过网络、过磁盘。第 1 章算过这笔账：内存一百纳秒的事，别去麻烦几毫秒的磁盘。

你真正要的是第三种东西：**插得快（涨分随时发生），且永远排好队（切前一百名不用再排）**。它叫有序集合（sorted set，Redis 里叫 ZSET）——成员各带一个分数、永远按分数排好队的集合，排行榜的标准答案。而这副能屈能伸的骨架，叫跳表（skip list）：多层索引的有序链表。这一章先看清它凭什么快，再亲手写出它，最后把 ZADD/ZRANGE/ZCARD 三个命令接上服务器。

## 原理：让链表也能「跳」

### 二分查找的墙：链表跳不过去

先拆一个直觉。「查得快」有两条路：第 4 章你亲手写过哈希——算下标直达；另一条是二分查找——每步砍掉一半。二分查找要求数组——因为砍一半的前提是能一步跳到中间，数组下标随便跳，链表只能顺着 next 一个个蹭。

所以有序链表落了个尴尬名声：插入 O(1)（找到位置后改两个指针就完事），查找 O(N)（找位置本身要蹭完半条链）。**跳表的全部聪明，就花在让链表也能「跳」上。**

### 多层索引：给链表盖楼层

锚点用你坐过的地铁：慢车站站停，快车跳几站——去远处先乘快车、到附近再换慢车。给有序链表照此办理：底层链表放全部成员（站站停的慢车）；往上每隔一些成员抽一个出来，组成更稀的一层（跳站的快车）；再往上再抽稀。这就是多层索引（multilevel index）——上层是底层序列的抽稀快照，越往上站越少、跳得越远。

```text
成员分数： 10   20   30   40   50   60   70   80

3 层： head ────────────────→ 40 ────────────────→ ∅
2 层： head ────→ 20 ───────→ 40 ────→ 60 ───────→ ∅
1 层： head → 10 → 20 → 30 → 40 → 50 → 60 → 70 → 80 → ∅
```

查找 55：从最高层起步，先大步跳——3 层跳到 40（再走就过站，停）；下到 2 层，40 的下一个是 60，太远（停）；下到 1 层，40→50（50 不够），下一个 60 过站，停。结论一式两份：55 不在表里；要插的话就插在 50 与 60 之间。数一数步数：每层至多走了两三步、层数很少——八成员的表走了三层的头几步，八百万成员的表也只是层数多一些，每层照样走两三步。这就是 O(logN)：与二分查找同源的「每步砍一半」，只是砍法从「跳到中间」换成了「能跳多远跳多远、跳不动就下楼」。

### 随机层数：抛硬币，不再平衡

下一个问题才是跳表的命门：谁上楼？哪些成员有资格进上层索引？

直觉答案会想到平衡树（AVL、红黑树那一族——会自己在插入删除后旋转、保持两边一样高的二分查找树）。它们确实保得住 O(logN)，代价是全局纪律：每次插入后要检查路径上的平衡，不平衡就旋转改指针。反事实检验一下另一条路——如果不抛硬币、按固定规则上楼（比如「每两个抽一个」「按插入顺序轮流」）会怎样：删掉中间一个成员，整条规律链全乱，前后邻居都得重排。**规则是全局的，维护就得是全局的。**

跳表的答案是：每个新节点独立抛硬币——掷出「升」的概率是 1/4，升一级再抛，最多升到 32 级。这就是随机层数（random level）。它换掉的是「正确性的来源」：查找正确从不依赖哪些节点在上层——只要每层是底层的一个有序子集，走法就永远正确；上层结构只影响快慢，不影响对错。没有规则，就没有全局状态；没有全局状态，就没有再平衡。

概率替你把形状守住了。每个节点停在 1 级的概率是 3/4（第一次就掷出「不升」），恰好 2 级是 1/4 × 3/4，恰好 3 级是 1/4² × 3/4——每级人数恰是下一级的四分之一，这种一级比一级按固定比例少的分布叫几何分布。跟着算一遍：一万个成员的表，1 级一万个、2 级约 2500、3 级约 625、4 级约 156、5 级约 39、6 级约 10、7 级约 2.4——顶层自然停在第 7、8 层，不多不少正好够用。两个公开事实对照（出处：redis/redis 仓库 src/server.h 与 src/t_zset.c 的注释，转述不引码）。上限定义 `ZSKIPLIST_MAXLEVEL 32`，注释写着「对 2^64 个元素也够了」——1/4 概率下第 32 层平均每 4^31 个节点才出一个，而 4^32 恰好等于 2^64。晋升概率定义 `ZSKIPLIST_P 0.25`，注释就一句「Skiplist P = 1/4」。血统也有出处：t_zset.c 的头注释自述这份实现差不多是 William Pugh 1990 年论文的 C 翻译。论文标题就叫《Skip Lists: A Probabilistic Alternative to Balanced Trees》——「跳表：平衡树的概率替代品」，随机层数的设计意图写在标题里。

两笔零碎的账顺手算清。其一，1/4 为什么不是更直觉的 1/2？源码注释只写了取值、没写理由，这里不编成因，只算得出来的账。每个节点的平均指针数是 1/(1−p)：p 取 1/4 是 1.33 个，取 1/2 是 2 个——省下约三分之一的指针内存；代价是每一层平均要多蹭几步（期望约 3 步对 1 步），而总层数反而减半（顶层高度从 log₂N 变 log₄N）——总查找步数同量级，落袋的是那份内存。其二，硬币手气差到极点会怎样？全员都停在 1 级，跳表退化成纯链表，查找回 O(N)——慢，但结果照对；而十万个节点全员 1 级的概率是 0.75^100000，一个事实上不会发生的数。**最坏情况只是慢，永远不会错**——这是抛硬币方案最硬的底牌。

### 有序集合：跳表 + 字典，一副骨架两个门

结构定了，还差一个配件。ZADD 涨分时要先回答「这个成员在不在、现在几分」——在跳表里按次序搜是 O(logN)，但这是个点查，第 4 章的字典正是干这个的 O(1) 好手。所以有序集合的真身是双结构：跳表管排序（范围查询顺着走），字典管点查（成员 → 分数一步到）。公开事实对照（出处：redis.io 数据类型文档 sorted sets 一页，与 t_zset.c 头注释同款表述）：「有序集合通过一个双端口结构实现，同时包含一个跳表和一个哈希表」。你的 Dict 在跳表里再就业。

排队的规矩也定下来：排序键是（分数， 成员）二元组——先比分数；分数相同比成员名字典序（像查字典按字母先后逐字比名字；真 Redis 按字节序逐字节比，教学版用 JS 字符串比较，ASCII 范围内一致——差异清单已登记）。为什么要有第二棒？成员不重复，但分数会撞——一万个人挤一千档分数是排行榜常态，同分的俩人总得分出先后，字典序是最便宜、最稳定（谁先插入都一样）的裁决。

这里正好拆掉本章的误区。你可能以为范围查询必须先排序——查前一百名，脑子里浮现的是 sort 再 slice。复述得像样一点：数据天生是无序的，要有序输出当然得先排。可有序集合的日常恰恰是「结构已经有序」：redis.io 文档的原话是「取有序元素时 Redis 根本不用做任何工作，它已经排好了」。**范围查询是顺着走，不是排完再切**：O(logN) 定位到起点，顺着底层链表走到头或走满名额为止。

### type 与 encoding：一类数据，多副骨架

最后添一个视野：Redis 的每种数据都有两张身份证。type 是逻辑类型——这个键是字符串、列表还是有序集合（`TYPE` 命令问的是它）；encoding 是物理结构——底下真用什么结构装（`OBJECT ENCODING` 问的是它）。为什么要分两张？一笔内存账：三个成员的小集合，跳表每个节点头顶几十个字节的指针位，结构比数据本身还贵；真 Redis 的做法是小数据用紧凑编码——有序集合小的时候用 listpack（一段紧挨着连排的紧凑列表，成员分数肩并肩，零指针）省内存，长过阈值再换成跳表+字典保性能。这套「小用紧凑省内存、大换高效保性能」的换装就是对象编码（encoding）分离。顺带认两个名字就走：SDS（Redis 自家的动态字符串实现）、listpack，都是公开概念，本课不实现。本课的简化如实声明：迷你实现只有跳表+字典一种编码，不做小编码转换（差异清单登记）。

## 演练：四步长出 SkipList，三个命令接上

本章演进两件事：src/skiplist.ts 从零写出跳表（核心方法全貌都在这一章），src/db.ts 追加三个命令。测试文件 tests/skiplist-zset.test.ts 十四条，照例先写先红。文件头的职责注释把路线说完了：

```ts
// src/skiplist.ts · 文件头
// 跳表：多层索引的有序链表——底层站站停，上层跳站快车，查找/插入 O(logN)。
// 层数不靠全局再平衡：每个新节点「抛硬币」随机晋升（1/4 概率升一级，最多 32 级）。
// 概率保证平均形状足够好；最坏情况只是慢，永远不会错——这正是免再平衡的底气。
// 真 Redis 的有序集合就是跳表 + 一张字典（跳表管排序、字典管点查），这里同款思路。
```

### 第一步：节点与次序

```ts
// src/skiplist.ts · 两个常数
const MAX_LEVEL = 32 // 真 Redis 同款上限：晋升 1/4 时 4^32 已远超任何实例规模，32 层够用到天荒地老
const PROMOTION = 0.25 // 每抛一次硬币，1/4 概率再升一级——平均每 4 个节点才有一个上二楼
```

```ts
// src/skiplist.ts · SkipNode 与 before
// 节点：成员、分数、每层一个向右的指针。节点盖了几层，forwards 就有几个元素
type SkipNode = {
  member: string
  score: number
  forwards: Array<SkipNode | null>
}

// 全序比较（跳表只认这个次序）：先比分数，同分比成员名字典序——真 Redis 的排序键就是这个二元组。
// JS 字符串比较按 UTF-16 码元序，真 Redis 按字节序，ASCII 范围内两者一致（差异清单已登记）
function before(a: { member: string; score: number }, b: { member: string; score: number }): boolean {
  if (a.score !== b.score) return a.score < b.score
  return a.member < b.member
}
```

节点盖几层，forwards 就多长——层数不是单独的字段，就是数组长度，`levelOf` 观察口后面直接读它。before 是全表唯一的裁判：插入、查找、摘除、定范围起点，全都问它，谁也不许私自比大小。

### 第二步：骨架字段与可注入的硬币

```ts
// src/skiplist.ts · SkipList 的骨架字段
export class SkipList {
  // 头哨兵：不存数据、永远在场，32 层指针全配好——每次查找都从它的顶层起步
  private header: SkipNode = { member: '', score: 0, forwards: new Array<SkipNode | null>(MAX_LEVEL).fill(null) }
  private level = 1 // 当前实际用到的最高层：查找从这层起步，不空跑更高的楼层
  private count = 0
  // 成员 → 节点的字典（第 4 章的 Dict 再就业）：O(1) 查「这个成员在不在、现在几分」，
  // 不然改分前得先在跳表里按次序搜到它——点查交给字典，排序交给跳表，各干各的
  private byMember = new Dict<SkipNode>()
  // 随机源可注入：默认 Math.random，测试注入伪随机——「抛硬币」这步逻辑因此可控可测
  private random: () => number

  constructor(options: { random?: () => number } = {}) {
    this.random = options.random ?? Math.random
  }
```

头哨兵（header，不存数据、只当起点的固定节点）32 层指针一次配齐，谁来了都不用现盖。注意 `byMember`——真 ZSET 双结构里的字典就落在这一行，构造参数里那枚可注入的硬币则是本章测试的钥匙：不注入就是真随机，注入伪随机源，「随机层数」从玄学变成确定性的可断言行为。

### 第三步：抛硬币与脚印

```ts
// src/skiplist.ts · randomLevel
  // 抛硬币定层数：从 1 级起，每次 1/4 概率再升一级，32 级封顶。
  // 完全不看表里现在长什么样——层数只与硬币有关、与插入先后无关，这就是「免全局再平衡」的全部秘密
  private randomLevel(): number {
    let lv = 1
    while (lv < MAX_LEVEL && this.random() < PROMOTION) lv++
    return lv
  }
```

```ts
// src/skiplist.ts · findUpdate
  // 逐层下降搜索：返回每层「最后一个排在 target 前面的节点」——插入与摘除共用同一套脚印。
  // 高层先大步跳、低层再小步蹭：这正是「跳表 = 链表上长出二分查找」的走法
  private findUpdate(target: { member: string; score: number }): Array<SkipNode | null> {
    const update: Array<SkipNode | null> = new Array(MAX_LEVEL).fill(null)
    let node = this.header
    for (let lv = this.level - 1; lv >= 0; lv--) {
      while (node.forwards[lv] !== null && before(node.forwards[lv]!, target)) node = node.forwards[lv]!
      update[lv] = node
    }
    return update
  }
```

randomLevel 三行实事：1 级起步、掷出 1/4 内的数就升、32 封顶——它压根没看表一眼，这正是「免再平衡」的代码化身。findUpdate 是全表的走法模板：从当前最高层起，向右能走（下一个仍排在 target 前）就走，走不动降一层；收工时 update[lv] 是每层最后一个「排在 target 前面」的节点——新节点将来就插在它们每人身后一个。原理一节「跳到 40、下楼、再蹭两步」的走法，机器版就是这两层循环。

### 第四步：插入（顺带改分）与摘除

```ts
// src/skiplist.ts · insert
  // 插入（或改分）：新成员回 true；老成员回 false，分数换成新的、位置随新分搬家
  insert(member: string, score: number): boolean {
    const existing = this.byMember.get(member)
    if (existing !== undefined) {
      if (existing.score === score) return false // 分数没动：排序键没变，位置不用搬
      this.removeNode(existing) // 改分 = 搬家：先按老位置摘下来，下面再按新位置重插
    }
    const update = this.findUpdate({ member, score })
    const lvl = this.randomLevel()
    if (lvl > this.level) {
      for (let i = this.level; i < lvl; i++) update[i] = this.header // 新盖出的楼层，左邻只有头哨兵
      this.level = lvl
    }
    const node: SkipNode = { member, score, forwards: new Array<SkipNode | null>(lvl).fill(null) }
    for (let i = 0; i < lvl; i++) {
      node.forwards[i] = update[i]!.forwards[i] // 经典链表插入的两行：新节点后手接前人，
      update[i]!.forwards[i] = node // 前人改指新节点——每层各来一遍
    }
    this.count++
    this.byMember.set(member, node)
    return existing === undefined
  }
```

insert 承重最重，读法三段。前段问字典：老成员分数没动直接回 false（排序键没变，队伍不用动）；分数动了就先摘下来——**改分不是原地改，是搬家**，老位置的邻居得先接上头。中段找新位置、抛硬币定层数；新节点的层数盖过了全表现高，就把上面的空楼层记到头哨兵名下。后段是链表插入的经典两行，每层各来一遍——你在第 4 章链地址法里见过一模一样的手势，这里只是从一条链变成几层各一条。

```ts
// src/skiplist.ts · removeNode
  // 摘掉一个节点：按它的排序键找回每层的前一个节点，逐层绕过它；顶层空了就降层
  private removeNode(node: SkipNode): void {
    const update = this.findUpdate(node)
    for (let i = 0; i < node.forwards.length; i++) {
      if (update[i]!.forwards[i] === node) update[i]!.forwards[i] = node.forwards[i]
    }
    this.byMember.delete(node.member)
    this.count--
    while (this.level > 1 && this.header.forwards[this.level - 1] === null) this.level--
  }
```

摘除就是插入的镜像：同一套 findUpdate 脚印，只是「接到我身上」换成「从我身上跨过去」。注意那个 if——节点没盖到的楼层上，前一个节点本来就不指向它，不许瞎绕。结尾的 while 在顶层搬空时把全表高度降下来，省得以后每次查找都空爬高楼。

### 第五步：范围查询与观察口

```ts
// src/skiplist.ts · rangeByScore
  // 按分数取段 [min, max]：先乘快车定位「第一个够得着 min 的节点」，再底层站站走到超过 max 为止。
  // 范围查询是顺着走，不是排完再切。offset 先跳过几名，limit 封顶取几名
  rangeByScore(min: number, max: number, limit = Infinity, offset = 0): Array<[string, number]> {
    // 目标键取 (min, '')：比一切「分数为 min 的真成员」都小——停下处正好是第一个分数 >= min 的节点
    const update = this.findUpdate({ member: '', score: min })
    let node: SkipNode | null = update[0]!.forwards[0]
    const out: Array<[string, number]> = []
    let skip = offset
    while (node !== null && node.score <= max) {
      if (skip > 0) skip--
      else {
        out.push([node.member, node.score])
        if (out.length >= limit) break
      }
      node = node.forwards[0]
    }
    return out
  }
```

```ts
// src/skiplist.ts · entries / length / levelOf
  // 全量有序快照：底层链从头走到尾。ZRANGE 按名次切片走它。
  // 真 Redis 的节点带跨度字段，按名次定位也是 O(logN)；教学版省掉跨度记账、顺底层走一遍再切（差异清单已登记）
  entries(): Array<[string, number]> {
    const out: Array<[string, number]> = []
    for (let node = this.header.forwards[0]; node !== null; node = node.forwards[0]) out.push([node.member, node.score])
    return out
  }

  get length(): number {
    return this.count
  }

  // 教学观察口：某成员的节点盖了几层——随机层数的实验窗口
  levelOf(member: string): number {
    return this.byMember.get(member)?.forwards.length ?? 0
  }
```

rangeByScore 的定位技巧值得停一秒：搜索键取 `(min, '')`——空串是最小的成员名，所以分数恰好等于 min 的成员不会被跳过，停下处正好是段内第一名。定位只花 O(logN)，之后底层顺着走：offset 先跳、limit 收手。entries 是给按名次切片用的全量快照（真 Redis 的节点带 span 跨度字段，按名次直达也是 O(logN)；教学版多走一遍底层，省掉跨度记账——差异清单登记）。levelOf 是本章的观察口，地位同第 4 章 INFO 之于 rehash：随机性的实验窗口。

### 第六步：三个命令与一道门禁

```ts
// src/db.ts · 换装后的字段（第 5 章多了一种值类型）
export class MiniRedis {
  // 键的家：第 4 章亲手写的哈希表（链地址 + 负载因子扩容 + 渐进 rehash），换掉了 JS 白送的 Map。
  // 与真 Redis 同款单键空间：一个键一个值，字符串的值是 string，有序集合的值是跳表
  private data = new Dict<string | SkipList>()
```

排行榜不再单开一张表，而是与字符串同住第 4 章的 Dict——与真 Redis 的单键空间同构。值类型多了，门禁随之而来：

```ts
// src/db.ts · wrongType 与 zadd
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
```

ZADD 的应答语义与真 Redis 对得上——redis.io 文档的原话是「成员已存在时 ZADD 回 0，分数被更新」。insert 回的 true/false 正好聚成「新增数」。分数先验完再动手，避免改一半才发现非法输入（`inf`/`nan` 这类特殊写法的教学版从简不辨，差异清单登记）。（新键分支里那道内存关与 idle 登记，是「内存淘汰」章的挂钩——满内存时新排行榜键同样要排队腾座位；回条数前那笔 `aofLog` 是「AOF」章的记账挂钩——都是后话。）

```ts
// src/db.ts · zrange 与 zcard
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
```

ZRANGE 是名次切片：负下标换算（-1 是最后一名，与真 Redis 一致）、两端夹紧、擦肩回空，然后从 entries() 的有序快照上切一段——「前一百名」就是 `0 99`，没有任何排序动作。ZCARD 一眼可读。get 那头也加了对称的门禁（字符串的门，跳表不走——第 2 章正文已同步为当前形态），同一个键两边命令串门，一律回 WRONGTYPE。

### 先红后绿

十四条测试先写先跑，第一次全红——skiplist.ts 还不存在，import 直接失败。钉「随机层数可控」的那条长这样：

```ts
// tests/skiplist-zset.test.ts · 「随机源恒回 0.99」
  it('随机源恒回 0.99：一次不晋升，全员 1 级——退化成纯链表，语义一点不丢', () => {
    const z = new SkipList({ random: () => 0.99 })
    const pairs: Array<[string, number]> = []
    const r = seededRandom(7)
    for (let i = 0; i < 100; i++) {
      const s = Math.floor(r() * 1000)
      pairs.push([`p${i}`, s])
      z.insert(`p${i}`, s)
    }
    for (const [m] of pairs) expect(z.levelOf(m)).toBe(1) // 全员只住底层
    expect(z.rangeByScore(-Infinity, Infinity)).toEqual(baseline(pairs)) // 形状退化，结果照对
  })
```

这条测试钉的就是原理一节那张底牌：硬币一次不升，跳表退化成纯链表——形状最坏，语义无损。另一条用固定种子的线性同余随机源灌两千个成员，断言 1 级占比落在 70%~80%（期望 75%）、2 级落在 15%~22.5%（期望 18.75%）——概率账从纸面落进断言。压舱的一条更狠：一口气 ZADD 一万个随机分数（值域 0~100 一位小数，一万成员挤一千档，同分大量存在）。然后 ZRANGE 全量、前一百名（含 WITHSCORES）、末尾负下标翻页，与 `Array.sort` 基准逐一对上。解析应答用的是第 2 章的 RespDecoder，老零件拼新测试。

## 验证：开机，看着排行榜排队

1. 跑测试：`cd companion && npm test`——应看到 48 条全绿（第 2 章 18 + 第 3 章 6 + 第 4 章 10 + 本章 14）。先猜后跑：含一万压舱在内，整轮多久？（毫秒级——一万次 O(logN) 插入对现代机器是零头。）
2. 硬币的手感：把这段自包含示例粘进 node，先写下预言——1 级占比几成？出现的最高层是几？

   ```js
   // 用法示例（自包含：粘进 node 交互环境就能跑）
   let counts = {}
   for (let i = 0; i < 100_000; i++) {
     let lv = 1
     while (lv < 32 && Math.random() < 0.25) lv++ // 抛硬币：1/4 概率再升一级
     counts[lv] = (counts[lv] ?? 0) + 1
   }
   const pct = (k) => (100 * (counts[k] ?? 0) / 100_000).toFixed(2) + '%'
   console.log('1 级', pct(1), '2 级', pct(2), '3 级', pct(3), '4 级', pct(4))
   console.log('最高层', Math.max(...Object.keys(counts).map(Number)))
   ```

   跑出来 1 级约 75%、2 级约 18.75%，最高层 8~10 居多、偶尔蹿到 11 甚至更高，9 和 10 最常见（十万个节点、每次运行硬币不同——这浮动本身就是「随机」的实证）。
3. 亲手开机，本章里程碑的可感知面：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`。依次：`ZADD racer 10 alice`（回 1）、`ZADD racer 8 bob 12 carol 6 dave`（回 3）、`ZRANGE racer 0 -1 withscores`——应看到 dave(6) bob(8) alice(10) carol(12) 从低到高排好，没人排序。
4. 先猜再改分：`ZADD racer 100 alice`——应答是几？`ZRANGE racer 0 -1` 谁领头？跑：回 `0`（老成员改分不计新增），alice 搬到队尾；`ZCARD racer` 回 4——改分搬家，人数不变。
5. 再猜两回：`ZRANGE racer 0 1` 是谁（前两名 dave bob）；`GET racer` 会看到什么？跑：一条 WRONGTYPE 错误——排行榜的键不走字符串的门。
6. 指认一处小破坏：打开 `src/skiplist.ts`，把 before 最后一行 `return a.member < b.member` 改成 `>`（同分时成员名字典序反转）。先猜哪些测试会红；再跑 `npx vitest run tests/skiplist-zset.test.ts` 对照。红四条：「同分按成员名字典序排队」「一万随机分数压舱」（同分队形反转）、「随机源恒回 0.99」（种子数据里恰有同分）、「rangeByScore 的边界与翻页」。最后这条最隐蔽：起点定位用 `(min, '')` 当搜索键，'' 本该是最小成员名，字典序一反转它成了「最大」——分数恰好等于 min 的成员被当成「已过站」跳过，段内第一名丢了。改回来，回到全绿。

## 收束：排队的事交给结构

回到开头那个两头堵。十万成员的排行榜：涨分是 ZADD——字典点到成员、跳表 O(logN) 搬家，不用挪半条队；切前一百名是 `ZRANGE key 0 99`——定位起点后顺着底层走，没有任何排序动作；同分的两人自动按名字排队，谁先来都一样。数组方案慢在插、排序方案慢在查、MySQL 慢在路远——有序集合两头都不慢，因为它把「排队」从查询时搬进了结构里。那个误区也该退休了：范围查询不是先排序再切——排好队的结构上，范围查询是顺着走。

五个新词各收一句。跳表——多层索引的有序链表，底层站站停、上层跳站快车，查找插入都 O(logN)。有序集合——成员带分数、永远排好队的集合，排行榜的标准答案。多层索引——底层全量、逐层抽稀的快车楼层。随机层数——新节点抛硬币上楼（1/4 升一级、32 级封顶），没有规则就没有再平衡。对象编码——type 定逻辑类型、encoding 定物理结构，小用紧凑省内存、大换高效保性能。你的第五个里程碑落定：服务器会说 ZADD/ZRANGE/ZCARD，键空间里住进了第二种值。

还有一笔账要交代：键的家有了，键的寿命还没人管——排行榜成员也会过期（活动榜到期清场），SET 过的验证码也不能常住。下一章用过期字典接管这件事：谁该走、什么时候走、谁来动手。

自查三问（先自己答，再展开对）：

1. 把 `PROMOTION` 从 0.25 改成 0.5，一万个成员的表会怎样变？内存与查找各朝哪个方向动？真 Redis 为什么仍取 1/4——源码注释给了理由吗？
2. `ZADD lb 50 a` 之后再来一条 `ZADD lb 50 a`（同成员同分），insert 走哪条路径、应答是几、ZRANGE 的输出变不变？
3. 把 insert 开头查字典的那三行（existing 检查）删掉，最先坏掉的行为是什么？哪两条测试会红？

<details>
<summary>第 1 问答案</summary>

平均层数期望从 1/(1−0.25)≈1.33 涨到 1/(1−0.5)=2——每节点平均指针数多五成，内存朝贵走；顶层高度从 log₄N 约翻到 log₂N（一万个成员从约 7 层到约 13 层），查找期望步数同量级、并不明显变快。省下的那三分之一指针本是跳表的内存大头。至于「为什么是 1/4」：server.h 的注释只写了取值（Skiplist P = 1/4），没写理由——这里能算的只有上面这笔账，不编成因。锚点：原理一节「1/4 为什么不是 1/2」。
</details>

<details>
<summary>第 2 问答案</summary>

走 insert 的快路径：`if (existing.score === score) return false`——排序键（分数， 成员）没变，队伍纹丝不动。应答 `:0`（改分不计新增，同分连「改」都算不上），ZRANGE 输出与之前逐字节相同。锚点：演练第四步 insert 前三行。
</details>

<details>
<summary>第 3 问答案</summary>

ZADD 认不出老成员：同一成员带新分数会作为「新节点」插进表里，出现两份同名成员——ZCARD 虚增，改分语义整个失效。点查 O(1) 的字典正是防这个的。红的是「已有成员再 insert 是改分」与「ZADD 回新增数（老成员改分不计）」两条。锚点：insert 开头与 byMember 字段的注释。
</details>

从下一章起，路这么走（本章已走到「键住进了第二种结构」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」 | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 「跳表」（本章） | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 下一站「过期删除」 | 过期字典、惰性删除、定期删除 |
| 更远的路 | 「内存满了」：内存淘汰、近似 LRU；「AOF」与「RDB 快照」：AOF、AOF 重写、刷盘策略、fork、写时复制；「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：排行榜键也是键——它一样会被写满、被淘汰、被持久化，但那些机制现在都只认「键」，还没学会看「值的类型」。过期、淘汰、AOF 逐一来补这门课。
