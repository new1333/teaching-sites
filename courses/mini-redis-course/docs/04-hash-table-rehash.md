---
title: 全局哈希表：所有键的家
---

# 全局哈希表：所有键的家

先对个账。第 2 章说过：execute 里那个 Map 是 JS 送的暂住房，这一章换上你亲手写的哈希表。第 3 章留了一问：扩容能不能不停机？还记得那条铁律吗——回调里的同步重活会占住唯一的线程，全场冻结。这一章两笔账一起清。主角先认识一下：全局哈希表——整个库里所有键共住的那一张大表。真 Redis 里无论键的值是什么类型，都先靠这张表找到家。

## 白送的 Map，与两个答不上来的问题

你已经能让服务器说 RESP、能同时伺候一千个连接。但有两个问题贴着它的心脏，此刻多半答不上来。

一：Map.get 凭什么快？往 Map 里灌 10 万个键，取任意一个还是瞬间。它显然不是从 10 万条里挨个找——那它到底怎么找的？顺手再问一句：两个键撞在一起（哈希冲突）时，谁让路？

二：表装满了要扩容时，那一瞬间会发生什么？先到的请求要不要排队，等它把 10 万个键全搬完再说话？

第二个问题不是杞人忧天，它正踩在第 3 章的雷区上：我们的服务器是单线程事件循环，一条命令干多久，所有客户端就等多久。如果扩容必须一次搬完，扩容那一刻就是全场卡顿；键上到百万，一次搬迁就是上百毫秒，期间每个 GET 都得干等。搬迁——把每个键按新桶数重新落位——一次做还是摊开做，正是这一章要正面回答的问题。

路线三步：先把 Map 拆开，看清「数组加一条链」怎么做到查一个键不看键数，哈希冲突与负载因子在这里登场；再正面解决搬迁难题，答案叫渐进式 rehash；最后把服务器里的 Map 换成自己写的 Dict——旧命令一条不改，旧测试一条不动。

## 原理：从「挨个找」到「算下标」

### 哈希函数：把键算成门牌号

先拆一个你可能持有多年的直觉：Map 是 JS 引擎里的特殊魔法，性能好得没有道理。把这话复述得像样一点——引擎大概给它开了后门，跟普通数据结构不是一个次元。这话半对半错：引擎确实精心优化过它，但优化的是同一副朴素骨架——一个数组，加一个能把键算成数组下标的函数。JS 引擎的 Map 底下也是哈希表，没有魔法。

哈希函数（hash function）——把任意键算成一个数组下标的函数，关键性质是同一个键永远算出同一个数。查一个键从此不用挨个看：算一次哈希，落进一个格子，直接进去拿。这就是 O(1)——不管表里有一百个键还是一亿个，步骤数恒定。**快不是因为找得快，是因为根本不用找。**

反事实一问：如果同一个键两次算出不同的数，会怎样？刚 SET 完的键，GET 时被算去了另一个格子——表把自己存的东西弄丢了。所以「同一个键同一个数」不是可选优化，是这张表能工作的地基。

### 哈希冲突与链地址法：撞桶不是事故，是常态

哈希函数再好也躲不开一件事：键有无穷多种，桶只有有限个。两个不同的键被算进同一个桶，这叫哈希冲突（hash collision）。这不是函数不够聪明——4 个桶装 5 个键，必有两键同桶。鸽笼原理（鸽子比笼子多，必有一笼挤两只）早就判好了。

在纸上撞一次。取最简单的哈希：键里每个字符的字符码乘 31 滚动相加（实验场用的就是它）。单字符键一步到位，'a' 的哈希就是 97。除以桶数取余，落进 4 个桶：

- 'a' → 97，除 4 余 1
- 'e' → 101，除 4 余 1
- 'i' → 105，除 4 余 1

三条键，同一个桶。此刻怎么办？链地址法（separate chaining，一桶一链）——每个桶住的不是一个键，是一条链：撞进同桶的键用链表串起来，挂在这个桶上。查一个键变成两步：先算下标进桶，再顺着链挨个比键名。冲突没有被消灭，被安顿了——只要链够短，多走的几步毫无存在感。

### 负载因子：链变长之前就翻倍

链什么时候会不短？键数涨得比桶数快的时候。负载因子（load factor）——已存键数 ÷ 桶数组长度，正是链长度的仪表盘：负载因子 4，平均每桶挂 4 条，查一个键平均比 4 次；负载因子 100，哈希等于白算，退化回挨个找。所以盯着它：到 1（平均每桶一条）就把桶数翻倍，把链重新摊薄。

但扩容不是把数组加长那么简单。一个键住几号桶，等于它的哈希对桶数取余——桶数一变，几乎每个键的余数都变。拿 k0 算给你看：哈希 3365，除 4 余 1，住 1 号桶；扩成 8 桶后，3365 除 8 余 5，得住 5 号桶。全员重新算门牌、重新落位，这个动作叫 rehash（再哈希）：搬迁 10 万个键，就是 10 万次「算余数、挂进新桶」。

### 扩容的坑：一次搬完，等于全场排队

最直觉的扩容方案：新表立好，一个循环把旧表全部键当场搬过去，搬完再伺候下一条命令。会发生什么？别猜，量出来。粘进 node 交互环境：

```js
// 用法示例（自包含：粘进 node 交互环境就能跑）
const keys = Array.from({ length: 100_000 }, (_, i) => 'k' + i)
const m = new Map()
for (const k of keys) m.set(k, 1) // 先灌满
let t = performance.now()
m.get('k99999')
console.log('一次 GET：', performance.now() - t, '毫秒')
t = performance.now()
const m2 = new Map()
for (const k of keys) m2.set(k, 1) // 等价于「一次搬完 10 万键」的工作量
console.log('搬 10 万键：', performance.now() - t, '毫秒')
```

我在本机跑出的量级（你的数字会不同，量级差距稳定）：一次 GET 千分之一毫秒上下——计时器本身都比它粗糙；搬 10 万键约 6 毫秒。差三个数量级。按线性外推：百万键约 60 毫秒；一亿键——真 Redis 大实例的日常规模——约 6 秒。

把第 3 章的铁律接上：官方延迟文档说过，一条慢命令会让所有其他客户端等它。单线程里「一次搬完」意味着，触发扩容的那个 SET 一个人干 6 毫秒，全场客户端的 PING、GET 排队 6 毫秒；百万键的实例，每次扩容让所有请求多等 60 毫秒；一亿键，等 6 秒——每翻一倍扩一次容，全场就罚站一次。反事实检验通过：一次搬完不是做不到，是每一轮增长都收一次全场等待。

解法你在第 3 章见过苗头——摊薄：别一次干完，把大活切碎，摊进平常的每一次操作里。

### 渐进式 rehash：两张表，一次一桶

渐进式 rehash（incremental rehash）——扩容时新旧两张表同时在场，每次操作顺带搬一个桶，把一次长阻塞摊薄成无数次微秒动作。锚点：搬家不闭店——新旧两个店面同时营业，每来一位客人，店员顺路搬一箱货；搬空了，旧店退租。

规矩四条。一，扩容触发时新表立起来，旧表原封不动，一个键都不当场搬。二，一个搬迁游标记着旧表搬到哪个桶了。三，此后每次读写先顺路搬一个桶（桶上整条链），再干正事。四，读先查新表、再查旧表——键可能还住在旧家；写只进新表，绝不再往旧表添。旧表搬空，搬迁收尾，它整个退役。

第二个误区在这里拆。你可能会想：表必须一致才能服务，搬迁期间总得锁上、或者干脆停机搬完吧？——搬一半的表本来就是一个一致的状态。读查两张表、写只进新表，任何时刻两张表合起来恰好是完整的键空间，一个键不多、一个键不少。**不需要锁，更不需要停机。**搬迁期间唯一的开销是每次读可能多查一张表——而每次读本身又在推进搬迁，越忙收尾越快。

对照公开事实（出处：redis/redis 仓库 src/dict.c 的文件头注释与函数注释；这里只转述，不引码）。真 Redis 的字典注释写明：哈希表会自动扩容，桶数恒为 2 的幂，冲突用 chaining 处理。dictRehash 的注释说，一步搬迁的单位是「一个桶」——链地址下一个桶可能挂着多个键——且每步最多顺访十个空桶，「否则工作量没有上限，函数可能阻塞很久」。_dictRehashStep 的注释说，它由普通的查找与更新操作调用，让哈希表在被使用中从旧表自动迁往新表。同一个思路，同一套取舍。

本课的三处简化如实登记（附录差异清单可查）。哈希用教学版多项式——真 Redis 如今默认 SipHash，防有人蓄意造碰撞攻击（早年用 MurmurHash2）。新表一律翻倍——真 Redis 按已存键数向上取 2 的幂。一步必到一个非空桶——真 Redis 每步至多顺访 10 个空桶，防单步落在一片空桶上磨蹭；教学表小，用不上这条保险。

结构长这样（搬迁半路的一刻，键的来历见演练的演算）：

```text
set('k5','v5') 刚做完的一刻（旧表已顺路搬空 2 个桶）：

  旧表 oldTable（4 桶，等搬空）        新表 table（8 桶，只收新客）
  [0] ∅  （k3 已搬走）                 [0] k3
  [1] ∅  （k0 已搬走）                 [1] k4   ← 触发扩容的那次 set 自己先住下
  [2] k1 ← 游标（下一个搬这）          [2] k5   ← 刚写入的新键
  [3] k2                              [5] k0
                                      其余桶 ∅

  此刻查 k1：新表没有 → 旧表 [2] 顺着链找到
  此刻写 k9：直接落新表
  两表合计：k0 k1 k2 k3 k4 k5——一个不多、一个不少，正是全部键
```

## 演练：四步长出 Dict，换装不动壳

本章演进四件事：立骨架（哈希函数与桶）、安顿冲突（链）、扩容与渐进搬迁、换装。src/dict.ts 是主角，src/db.ts 只动一行换引擎、加一个观察口。想跟手敲的话，照实验场 src/dict.ts 逐段敲进编辑器，效果相同。它开头的职责注释把全章路线说完了：

```ts
// src/dict.ts · 文件头
// 全局哈希表：桶数组 + 链地址法（同桶的键挂成链表）；负载因子到 1 就翻倍扩容；
// 扩容不一次搬完——新旧两表同场，每次读写顺路搬一个桶（渐进式 rehash），长阻塞摊薄成微秒动作。
```

### 第一步：骨架——哈希函数与桶下标

```ts
// src/dict.ts · hashKey 与 bucketOf
// 教学哈希：多项式滚动——h 乘 31 再加下一个字符的字符码，同一个键永远算出同一个数。
// 单字符键的哈希恰好就是字符码（'a' → 97），教学时能手算。
// 真 Redis 如今默认用 SipHash 防哈希碰撞攻击（早年用 MurmurHash2），教学版以清晰优先（差异清单已登记）
function hashKey(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h
}

// 桶下标 = 哈希 & (桶数 - 1)：桶数恒为 2 的幂时，「按位与」就是「取余」的便宜替身
function bucketOf<V>(t: Table<V>, key: string): number {
  return hashKey(key) & (t.buckets.length - 1)
}
```

哈希用最朴素的多项式滚动：h 从 0 起，每步乘 31 加下一个字符的字符码。'k' 是 107、'0' 是 48，所以 'k0' 的哈希是 107×31+48 = 3365——手算得动，教学优先。桶下标那行像个小技巧：桶数恒为 2 的幂时，「哈希 & (桶数-1)」与「取余」结果相同，而按位与是 CPU 的一个动作、除法取余贵得多。真 Redis 同款约定（2 的幂、按位与只留低位），不是巧合，是同一笔账。

### 第二步：安顿冲突——桶里挂链

先看数据的形状：值跟键住在同一个节点上，next 串起同桶的伙伴；一张表就是「桶数组 + 已存键数」。

```ts
// src/dict.ts · EntryNode 与 Table
// 单个键值对的形态：值跟键住在同一个节点上，同桶的节点用 next 串成链
type EntryNode<V> = { key: string; value: V; next: EntryNode<V> | null }

// 一张表 = 桶数组 + 已存键数。rehash 期间两张同场：table 是新表，oldTable 是等着搬空的旧表
type Table<V> = { buckets: Array<EntryNode<V> | null>; used: number }
```

链上的三个动作——找、插、摘：

```ts
// src/dict.ts · findInTable、insertHead、removeFromTable
// 顺着链找键：同桶的不同键要挨个比过去，这正是冲突的代价
function findInTable<V>(t: Table<V>, key: string): EntryNode<V> | null {
  let node = t.buckets[bucketOf(t, key)]
  while (node !== null) {
    if (node.key === key) return node
    node = node.next
  }
  return null
}

// 头插：新节点挂到链头（同桶的键挤在一条链里，谁也不挤掉谁）
function insertHead<V>(t: Table<V>, key: string, value: V): void {
  const idx = bucketOf(t, key)
  t.buckets[idx] = { key, value, next: t.buckets[idx] }
}

function removeFromTable<V>(t: Table<V>, key: string): boolean {
  const idx = bucketOf(t, key)
  let node = t.buckets[idx]
  if (node === null) return false
  if (node.key === key) {
    t.buckets[idx] = node.next
    t.used--
    return true
  }
  while (node.next !== null) {
    if (node.next.key === key) {
      node.next = node.next.next // 把这节从链上摘掉：前一个直接接上后一个
      t.used--
      return true
    }
    node = node.next
  }
  return false
}
```

insertHead 头插——新节点挂到链头，一次指针操作完事。findInTable 进桶后顺着链比键名，走到头没有就是没有——这正是冲突的代价，链短则无感。removeFromTable 摘中间那节时，前一个节点直接接上后一个，链不断；删链头更简单，桶直接指向第二个。原理一节那三条注定同桶的 'a'、'e'、'i'，在测试里就是拿这三段代码伺候的：三键挂进 1 号桶成链，删中间的 'e'，首尾照常可读。

### 第三步：负载因子过线，双表进场

```ts
// src/dict.ts · 两个起始常数
const INITIAL_BUCKETS = 4
const LOAD_FACTOR_MAX = 1 // used ÷ 桶数 到 1 就扩容：平均每桶至多挂 1 条，链不长，查找才保得住 O(1)
```

```ts
// src/dict.ts · set
  set(key: string, value: V): void {
    if (this.oldTable !== null) this.rehashStep() // 渐进搬迁：先顺路搬一个桶，再干活
    if (this.oldTable === null && this.table.used >= this.table.buckets.length * LOAD_FACTOR_MAX) this.expand()
    // 先查新表：rehash 期间新键一律写新表，绝不再往旧表添
    let node = findInTable(this.table, key)
    if (node !== null) {
      node.value = value
      return
    }
    if (this.oldTable !== null) {
      node = findInTable(this.oldTable, key)
      if (node !== null) {
        node.value = value // 旧表里的键原地改值，搬迁时自然带走新值
        return
      }
    }
    insertHead(this.table, key, value)
    this.table.used++
  }
```

set 是全章承重最重的方法，四件事一眼排开。先顺路搬一桶（下一节拆它）。再看要不要扩容——判断放在插入前，已存键数不小于桶数（负载因子到 1）才翻倍；搬迁没收尾就不二次扩容，先把手上这场搬完。然后查新表，命中就改值；查旧表，已有的键原地改值，搬迁时自然带走新值。两处都没命中才是新键，头插进新表。注意「绝不再往旧表添」：旧表是待搬空的前厅，只出不进——不然收尾永远等不到。

```ts
// src/dict.ts · expand
  // 扩容：新表桶数翻倍，旧表原封挂到 oldTable 上等着渐进搬——一个键都不当场搬
  private expand(): void {
    const fresh: Table<V> = { buckets: new Array<EntryNode<V> | null>(this.table.buckets.length * 2).fill(null), used: 0 }
    this.oldTable = this.table
    this.table = fresh
    this.rehashIdx = 0
  }
```

expand 只有三行实事：翻倍立新表、旧表挂上 oldTable、游标归零。注意它一个键都没搬——扩容的全部动作到此为止，剩下的交给时间。

### 跟着算一遍：一次搬迁的全程

五个键足够走完全程。k0..k3 的哈希是 3365、3366、3367、3368，除以 4 余 1、2、3、0，正好一桶一条。

| 时刻 | 旧表（4 桶） | 状态 |
| --- | --- | --- |
| set k0..k3 之后 | [0]k3　[1]k0　[2]k1　[3]k2 | 4 键 4 桶，负载因子 1——判断在插入前，此刻还没过线 |

第 5 键 set k4（哈希 3369，除 8 余 1）：插入前 used(4) ≥ 桶数(4)，扩容——新表 8 桶立起，k4 落新表 1 号桶，双表进场。此后每个操作顺路搬一个桶：

| 操作 | 顺路搬走 | 正事 | 旧表剩 |
| --- | --- | --- | --- |
| get k1 | 旧[0] 的 k3 → 新[0] | 旧[2] 找到 k1 | 3 桶 |
| set k5 v5（哈希 3370，除 8 余 2） | 旧[1] 的 k0 → 新[5] | k5 头插新[2] | 2 桶 |
| delete k5 | 旧[2] 的 k1 → 新[6] | 从新[2] 摘掉 k5 | 1 桶 |
| get k3 | 旧[3] 的 k2 → 新[7] | 新[0] 找到 k3；旧表空，收尾 | 0，rehash 结束 |

收尾后 size 是 5：k0..k4 一条不丢、一条不重——搬迁是搬家，不是换房客。

### 第四步：搬迁本身——rehashStep

```ts
// src/dict.ts · rehashStep
  // 搬一个桶：从游标起跳过空桶，把下一个非空桶的整条链搬到新表；旧表搬空即收尾。
  // 每次读写都顺路调它一次——「渐进」的全部含义就是一次只搬一个桶，不停机
  rehashStep(): void {
    const old = this.oldTable
    if (old === null) return
    while (this.rehashIdx < old.buckets.length && old.buckets[this.rehashIdx] === null) {
      this.rehashIdx++ // 空桶直接路过，不算一次搬迁
    }
    if (this.rehashIdx >= old.buckets.length) {
      this.oldTable = null // 走到头：旧表已空，整个退役，让 GC 收走
      return
    }
    let node: EntryNode<V> | null = old.buckets[this.rehashIdx] // 经过上面的跳空循环，这里必是非空桶
    old.buckets[this.rehashIdx] = null
    while (node !== null) {
      const next = node.next
      insertHead(this.table, node.key, node.value) // 搬家 = 在新表按新桶数重新落位
      this.table.used++
      old.used--
      node = next
    }
    this.rehashIdx++
    if (old.used === 0) this.oldTable = null
  }
```

```ts
// src/dict.ts · get
  get(key: string): V | undefined {
    if (this.oldTable !== null) this.rehashStep()
    const node = findInTable(this.table, key)
    if (node !== null) return node.value
    if (this.oldTable === null) return undefined
    return findInTable(this.oldTable, key)?.value // 键可能还住在旧表：先查新表、再查旧表
  }
```

rehashStep 的规矩：从游标起跳过空桶（路过不算搬迁），把下一个非空桶的整条链逐个头插进新表——搬家就是在新表按新桶数重新落位。两条收尾路殊途同归：游标走到头，或旧表键数清零，都把 oldTable 置 null，旧表整个退役，交给 GC（垃圾回收——JS 引擎自动回收不再被引用的内存）。get 的第一步先搬再查：新表没有就查旧表——「键可能还住在旧家」在这两行落地。delete 同款两段式：先搬一桶，再从新表删、删不到查旧表。

### 第五步：换装——换引擎，不动壳

```ts
// src/db.ts · 换装后的字段
export class MiniRedis {
  // 键的家：第 4 章亲手写的哈希表（链地址 + 负载因子扩容 + 渐进 rehash），换掉了 JS 白送的 Map。
  // 与真 Redis 同款单键空间：一个键一个值，字符串的值是 string，有序集合的值是跳表
  private data = new Dict<string | SkipList>()
```

```ts
// src/db.ts · INFO（新增的教学统计口）
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
```

data 的类型从 Map 换成 Dict，set/get/delete 的调用点一个字符没改——两边的接口本来就是这三样。execute 的分发壳、PING/SET/GET/DEL 的应答格式全都不动。（到第 5 章，有序集合住进同一个键空间，get 才多出一道类型门禁——那是后话。）证据链现成：第 2、3 章的 24 条旧测试一行未改、全部照绿——它们就是公共 API 的哨兵。新增只有 INFO，一个纯观察口：只读键数与搬迁状态，自己不推进搬迁（中间三行 expires/expired/evicted 是第 6、7 章寿命簿与淘汰的指标，末两行的 aof 与 rdb 是账本条数与照片键数——AOF、RDB 快照两章的观察口，本章先当它们不存在）。

### 先红后绿

测试照例先写先跑。tests/hash-table-rehash.test.ts 十条断言，第一次跑全红——红得干脆：dict.ts 还不存在，import 直接失败。实现落地后转绿。钉「每个操作只搬一个桶」的那条长这样：

```ts
// tests/hash-table-rehash.test.ts · 「四步搬完收尾」
  it('每个操作只搬一个桶：四步搬完收尾，结束后 size 不丢不重', () => {
    // k0..k3 的哈希是 3365/3366/3367/3368，除以 4 余数 1/2/3/0——4 桶各住一条；
    // 扩容后旧表恰有 4 个非空桶，每操作顺路搬一个，四步搬空
    const d = new Dict<string>()
    for (let i = 0; i < 5; i++) d.set(`k${i}`, `v${i}`) // 第 5 键触发扩容
    expect(d.isRehashing()).toBe(true)
    d.get('k1')
    expect(d.isRehashing()).toBe(true) // 搬走 1 桶，剩 3 桶
    d.set('k5', 'v5')
    expect(d.isRehashing()).toBe(true) // 剩 2 桶
    d.delete('k5')
    expect(d.isRehashing()).toBe(true) // 剩 1 桶
    d.get('k3')
    expect(d.isRehashing()).toBe(false) // 最后一桶搬完，收尾
    expect(d.size).toBe(5) // 搬迁前后一个不丢、一个不重
    for (let i = 0; i < 5; i++) expect(d.get(`k${i}`)).toBe(`v${i}`)
    expect(d.get('k5')).toBeUndefined() // 搬迁不复活已删的键
  })
```

演算表与这条测试逐行对应——测试就是演算的机械版。十万键那条（十万键压舱）是压力面：一口气灌 100000 个键，扩容从 4 桶一路翻到 131072 桶；循环里见缝插针地断言——第一次抓到 isRehashing() 为真（搬迁进行中），立刻 get 最老的键抽检一次，必须拿到原值。整条测试几十毫秒跑完：渐进搬迁把 10 万键的搬运摊进了 10 万次 set 里，没有任何一步显眼。

## 验证：开机，看着 rehash 开场与收尾

1. 跑测试：`cd companion && npm test`——应看到 34 条全绿（第 2 章 18 条 + 第 3 章 6 条 + 本章 10 条）。先猜后跑：整轮要跑多久？（毫秒级，包括那条十万键压舱。）
2. 全量搬迁的体感：把原理一节那段自包含示例粘进 node。先写下预言——一次 GET 与搬 10 万键各是几毫秒量级？跑完对照，三个数量级的差距就是「一次搬完」方案要向全场收的税。
3. 亲手开机，本章里程碑的可感知面：终端 1 `node src/boot.ts`；终端 2 连 `redis-cli -p 6399`。先做四条：SET k0 v0、SET k1 v1、SET k2 v2、SET k3 v3。先猜：INFO 此刻的 rehash 是 0 还是 1？跑 `redis-cli -p 6399 INFO`——看到 keys:4 与 rehash:0（4 键 4 桶未过线，判断在插入前）。
4. 再 SET k4 v4，然后 INFO——看到 keys:5 与 rehash:1：双表进场了。此刻 GET k1，先猜应答——秒回 "v1"，而它此刻还住在旧表：搬迁进行中，旧键照常可读。
5. 数着步子看收尾：接着发 GET k0、GET k2、GET k3，每条命令顺路搬走一个桶。前两条之后 INFO 仍显示 rehash:1；第三条 GET k3 之后 INFO 显示 rehash:0——旧表四个桶恰好搬空。每条 redis-cli 命令是独立连接，但进的是同一个进程、同一张 Dict。
6. 指认一处小破坏：打开 `src/dict.ts`，把 get 方法最后两行（`if (this.oldTable === null) return undefined` 与 `return findInTable(this.oldTable, key)?.value`）换成一行 `return undefined`。先猜哪些测试会红；再跑 `npx vitest run tests/hash-table-rehash.test.ts` 对照：红的是「第 5 个键触发扩容进入 rehash」与「十万键压舱」两条——它们都在搬迁进行中读过还住在旧表的键，拿到的成了 undefined；基础组与链地址组照绿（没进 rehash 时，新表就是全世界）。有意思的是「四步搬完收尾」也幸存：它中途 get 的返回值从不断言，只看收尾后新表里的值——收尾后新表即全世界。改回来，回到全绿。

## 收束：魔法拆完了，卡顿免了

回到开头两问。Map.get 凭什么快？——键不挨个找：哈希函数把键算成下标，一步进桶，链短时几步见分晓；10 万个键的 GET 依然是瞬间，与键数无关。扩容那一瞬间谁在排队？——没有人：新表立起的那一刻一个键都不搬，此后每个操作顺路搬一个桶，10 万键的搬迁摊进了 10 万次操作里，任何一次都没比平时贵多少。

两笔旧账清了。第 2 章的暂住房今天退租：服务器里那个 Map 换成了你手写的 Dict，旧命令与旧测试一字未动。第 3 章那问「扩容能不能不停机」亲手解了：渐进搬迁正是「把一次长阻塞摊薄」的亲戚——同一副药方，第 6 章的定期删除还要再用一次，每轮只删一小批、掐着时间上限。

五个新词各收一句。哈希函数——把键算成下标，同一个键永远同一个数。哈希冲突——两键同桶，鸽笼注定的常态。链地址法——桶里挂链，撞了就排队，谁也不挤掉谁。负载因子——键数 ÷ 桶数，链长的仪表盘，到 1 就翻倍。渐进式 rehash——两张表一次一桶，把全场等待摊进日常。你的第四个里程碑落定：键有了亲手写的家，还带一个 INFO 观察口。

自查三问（先自己答，再展开对）：

1. 只插不删地灌 key:0 到 key:9999（一万条），中途随时 INFO——rehash:1 会被抓到很多次。这正常吗？是搬迁失败了吗？
2. 搬迁半路上，set 一个还住在旧表的键（比如演算里的 k1，当时在旧[2]），值更新发生在哪张表？等它被搬走时，带的是新值还是旧值？
3. 把 get 与 delete 开头那行 `if (this.oldTable !== null) this.rehashStep()` 删掉（只留 set 里的），哪条测试会红、哪条照绿？再深一层：为什么步进要挂在包括读在内的每个操作上，而不是只挂在写上？用「表里 10 万键、服务只剩读流量」的场景说。

<details>
<summary>第 1 问答案</summary>

正常，而且是设计使然。持续插入下扩容一轮接一轮（4→8→…→16384），每轮要搬的桶数与两次扩容之间的操作数同量级，上一轮还没搬完、下一轮已经在路上是常态——「十万键压舱」那条测试的中途抽检抓的就是这个状态。真正该报警的是 size 对不上、逐键 GET 拿错值——那才是搬迁丢了东西。锚点：十万键压舱测试与负载因子一节。
</details>

<details>
<summary>第 2 问答案</summary>

旧表，原地改值。set 的旧表分支只改 node.value，不搬家；搬迁整条链时节点连值一起走，带到新表的自然是新值。锚点：演练第三步 set 的旧表分支与演算表。
</details>

<details>
<summary>第 3 问答案</summary>

红的是「四步搬完收尾」。get k1、delete k5、get k3 都不再推进：第四条之后 isRehashing() 仍是 true，断言当场翻脸。「十万键压舱」照绿——它一路只有 set，set 还在搬。深一层：只挂在写上，读流量再大也推不动搬迁，两表同场的「双查」成本永远卸不掉；挂在每个操作上，表被用得越勤搬得越快。真 Redis 的注释把话挑明：步进由普通的查找与更新调用，让表在被使用中自动迁移。锚点：get 首行与原理一节的事实对照。
</details>

从下一章起，路这么走（本章已走到「键有了家」）：

| 走到哪了 | 你已亲手弄懂或写出 |
| --- | --- |
| 「磁盘太慢了」 | 延迟标尺、键值存储、缓存、旁路缓存模式、内存数据库、数据结构服务器、缓存雪崩 |
| 「RESP：两个进程怎么对话」 | RESP 协议、字节流、半包与粘包、解码器与编码器 |
| 「单线程的事件循环」 | 阻塞 IO、IO 多路复用、事件循环、事件驱动、管道 |
| 「全局哈希表」（本章） | 哈希函数、哈希冲突、链地址法、负载因子、渐进式 rehash |
| 下一站「跳表」 | 跳表、有序集合、多层索引、随机层数、对象编码 |
| 更远的路 | 「过期删除」：过期字典、惰性删除、定期删除；「内存满了」：内存淘汰、近似 LRU；「AOF」与「RDB 快照」：AOF、AOF 重写、刷盘策略、fork、写时复制；「复制、哨兵与集群」：主从复制、哨兵、哈希槽 |

留一个尾巴当钩子：哈希表里所有键一律平等——一次哈希、一个桶，谁也不比谁靠前。但排行榜要的是另一回事：成员按分数排队，还要随时切出前一百名，哈希表帮不上忙。能二分查找的链表——跳表——下一章接手。再往后，键住进来了还得管「活多久、住不下怎么办」，那是过期删除与内存淘汰的戏份。
