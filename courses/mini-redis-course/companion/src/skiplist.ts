// 跳表：多层索引的有序链表——底层站站停，上层跳站快车，查找/插入 O(logN)。
// 层数不靠全局再平衡：每个新节点「抛硬币」随机晋升（1/4 概率升一级，最多 32 级）。
// 概率保证平均形状足够好；最坏情况只是慢，永远不会错——这正是免再平衡的底气。
// 真 Redis 的有序集合就是跳表 + 一张字典（跳表管排序、字典管点查），这里同款思路。

import { Dict } from './dict.ts'

const MAX_LEVEL = 32 // 真 Redis 同款上限：晋升 1/4 时 4^32 已远超任何实例规模，32 层够用到天荒地老
const PROMOTION = 0.25 // 每抛一次硬币，1/4 概率再升一级——平均每 4 个节点才有一个上二楼

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

  // 抛硬币定层数：从 1 级起，每次 1/4 概率再升一级，32 级封顶。
  // 完全不看表里现在长什么样——层数只与硬币有关、与插入先后无关，这就是「免全局再平衡」的全部秘密
  private randomLevel(): number {
    let lv = 1
    while (lv < MAX_LEVEL && this.random() < PROMOTION) lv++
    return lv
  }

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
}
