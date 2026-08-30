// 键的寿命登记簿：另一张表——键 → 到期时间戳（绝对毫秒）。
// 键本身不知道自己会过期，主表里也没有期限字段；到期与否，查这本登记簿。
// 删除的两只手：惰性（访问那一刻查，lazyCheck）与定期（周期抽样，activeCycle）——
// 一只省 CPU 但留僵尸键占内存，一只补刀内存但花主线程时间，谁也离不开谁。

import { Dict } from './dict.ts'

export class Expirer {
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

  // 开机以来的过期删除总数（INFO 的 expired 观察口）：惰性与定期两条路的账记在一处
  get expired(): number {
    return this.expiredTotal
  }

  // 已登记寿命的键数（INFO 的 expires 观察口）
  get ttlKeys(): number {
    return this.deadlines.size
  }

  // 登记（或改期）：deadlineMs 是绝对时刻。改成过去的时刻＝下一拍就删（真货对非正数 timeout 当场按 DEL 处理，差异清单）
  setExpire(key: string, deadlineMs: number): void {
    this.deadlines.set(key, deadlineMs)
  }

  // 剩余毫秒；没登记回 null——「没有寿命」与「登记了还没到期」是两回事
  getTtl(key: string): number | null {
    const deadline = this.deadlines.get(key)
    return deadline === undefined ? null : deadline - this.now()
  }

  // 撤销登记：键被 DEL 删掉、或被不带 EX 的 SET 覆盖时叫——覆盖不清寿命是经典事故
  remove(key: string): void {
    this.deadlines.delete(key)
  }

  // 只判断不动手：KEYS 这类旁观窗用它过滤过期键，不顺手删——「还在但已到期」的僵尸态因此可观察
  isExpired(key: string): boolean {
    const deadline = this.deadlines.get(key)
    return deadline !== undefined && this.now() >= deadline
  }

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

  // 已登记键的全名单——定期抽样的候选池
  keys(): string[] {
    return this.deadlines.entries().map(([key]) => key)
  }

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
}
