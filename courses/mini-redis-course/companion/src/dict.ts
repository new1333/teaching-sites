// 全局哈希表：桶数组 + 链地址法（同桶的键挂成链表）；负载因子到 1 就翻倍扩容；
// 扩容不一次搬完——新旧两表同场，每次读写顺路搬一个桶（渐进式 rehash），长阻塞摊薄成微秒动作。

// 单个键值对的形态：值跟键住在同一个节点上，同桶的节点用 next 串成链
type EntryNode<V> = { key: string; value: V; next: EntryNode<V> | null }

// 一张表 = 桶数组 + 已存键数。rehash 期间两张同场：table 是新表，oldTable 是等着搬空的旧表
type Table<V> = { buckets: Array<EntryNode<V> | null>; used: number }

const INITIAL_BUCKETS = 4
const LOAD_FACTOR_MAX = 1 // used ÷ 桶数 到 1 就扩容：平均每桶至多挂 1 条，链不长，查找才保得住 O(1)

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

export class Dict<V> {
  private table: Table<V> = { buckets: new Array<EntryNode<V> | null>(INITIAL_BUCKETS).fill(null), used: 0 }
  // rehash 期间才存在：还没搬空的旧表。它非 null ⇔ isRehashing() 为 true
  private oldTable: Table<V> | null = null
  // 旧表搬迁游标：下一个要搬的桶下标，走到头就是搬完了
  private rehashIdx = 0

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

  get(key: string): V | undefined {
    if (this.oldTable !== null) this.rehashStep()
    const node = findInTable(this.table, key)
    if (node !== null) return node.value
    if (this.oldTable === null) return undefined
    return findInTable(this.oldTable, key)?.value // 键可能还住在旧表：先查新表、再查旧表
  }

  delete(key: string): boolean {
    if (this.oldTable !== null) this.rehashStep()
    if (removeFromTable(this.table, key)) return true
    return this.oldTable !== null && removeFromTable(this.oldTable, key)
  }

  get size(): number {
    // 两张表的键数合起来才是全部——搬迁期间谁也不许少报
    return this.table.used + (this.oldTable !== null ? this.oldTable.used : 0)
  }

  isRehashing(): boolean {
    return this.oldTable !== null
  }

  entries(): [string, V][] {
    // 两张表都在场时，键空间 = 两表之和：只遍历一张就丢一半
    const out: Array<[string, V]> = []
    for (const t of [this.oldTable, this.table]) {
      if (t === null) continue
      for (const head of t.buckets) {
        for (let node = head; node !== null; node = node.next) out.push([node.key, node.value])
      }
    }
    return out
  }

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

  // 扩容：新表桶数翻倍，旧表原封挂到 oldTable 上等着渐进搬——一个键都不当场搬
  private expand(): void {
    const fresh: Table<V> = { buckets: new Array<EntryNode<V> | null>(this.table.buckets.length * 2).fill(null), used: 0 }
    this.oldTable = this.table
    this.table = fresh
    this.rehashIdx = 0
  }
}
