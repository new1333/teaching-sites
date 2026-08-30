// 内存淘汰：键数到了上限，谁腾座位——noeviction（满了拒写不删键，真 Redis 同款默认）
// 或 allkeys-lru（随机抽样近似 LRU：抽 5 个、踢里面最久未用的）。
// 为什么「近似」：精确 LRU 要一张全局双向链表，每次访问都得把节点挪到队头——
// 每个键多背两个指针（antirez 的原话「fat pointers!」，对象里塞不下），每次读写多一次挪动。
// 既然 LRU 本身也只是「预测谁还会被用」的近似，那就把近似再近似一层：抽 5 个，踢最旧的。

import { Dict } from './dict.ts'

// 策略教学版全收这两个：noeviction | allkeys-lru（真货另有 volatile-* / allkeys-random / lfu 等，正文讲视野）
export type EvictPolicy = 'noeviction' | 'allkeys-lru'

// 每轮抽样数：官方默认口径（maxmemory-samples 5）——样本越大越接近精确 LRU，也越费 CPU
const EVICT_SAMPLE_N = 5

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

  // 开机以来的淘汰总数（INFO 的 evicted 观察口）：与 expired 分开记账——淘汰牺牲的是活键
  get evicted(): number {
    return this.evictedTotal
  }

  // 当前键数上限（CONFIG GET maxmemory 查这个）
  get maxKeys(): number {
    return this.limit
  }

  // 当前策略名（CONFIG GET maxmemory-policy 查这个）
  get policyName(): string {
    return this.policy
  }

  // 设上限（0 = 不限）。真货的 maxmemory 写 100mb 这类字节数，教学版记键数（差异清单登记）
  setLimit(keys: number): void {
    this.limit = keys
  }

  // 设策略
  setPolicy(policy: EvictPolicy): void {
    this.policy = policy
  }

  // 记一笔「刚刚用过」：读命中与写入都算。近似 LRU 的全部状态就这一张表——
  // 不排队、不排序、不挪节点，「最近用过」只是一次改时间戳
  touch(key: string): void {
    this.lastSeen.set(key, this.now())
  }

  // 键没了（DEL、过期、淘汰都算），idle 登记跟着撤——不然表里攒孤儿
  remove(key: string): void {
    this.lastSeen.delete(key)
  }

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

  // idle（多久没被用）：没登记过的键当作「从没用过」——最该被踢的那一档
  private idleOf(key: string): number {
    const seen = this.lastSeen.get(key)
    return seen === undefined ? Number.POSITIVE_INFINITY : this.now() - seen
  }
}
