// src/graph.ts · 提交图上的找路:可达集、祖先判定与最近公共祖先
import { readObject } from './objects.ts'
import { parseCommit, type Commit } from './commits.ts'

/** 读一个对象并确认它是 commit,返回拆好的字段;不是 commit 或不存在当场报错。 */
function requireCommit(gitDir: string, hash: string): Commit {
  const { type, body } = readObject(gitDir, hash)
  if (type !== 'commit') {
    throw new Error(`对象 '${hash}' 不是 commit(它是 ${type}),没法在提交图上走`)
  }
  return parseCommit(body)
}

/**
 * 从 head 沿 parent 边走到的全部提交,连同 head 自己;双父提交两条边都走,每个提交只收一次。
 * 这就是把「可达」落成尺子:集合里有谁,谁就从 head 可达——第 4 章 logWalk 走的同一条路,
 * 只是这里不排序,收成一个只答「在不在」的集合。
 */
export function ancestorSet(gitDir: string, head: string): Set<string> {
  const seen = new Set<string>()
  const queue = [head]
  while (queue.length > 0) {
    const hash = queue.shift()!
    if (seen.has(hash)) {
      continue // 双父两支汇合的提交会第二次进队:已收过,跳过
    }
    seen.add(hash)
    queue.push(...requireCommit(gitDir, hash).parents)
  }
  return seen
}

/** ancestor 是不是 descendant 的祖先:沿父边从 descendant 往回走,走得到就是;相等也算——自己可达自己。 */
export function isAncestor(gitDir: string, ancestor: string, descendant: string): boolean {
  return ancestorSet(gitDir, descendant).has(ancestor)
}

/**
 * 最近公共祖先:两边可达集的交集里,committer 时间戳最新的那笔;同刻取哈希字典序最小者;交为空返回 null。
 * 从简口径(登记差异附录):真 git 先按「不被其他候选可达」筛出全部最好候选,多候选时 unspecified 挑一个;
 * mini-git 直接按时间戳挑——通常与图论取法一致,时钟倒挂的极端构造下可能偏(第 4 章见过倒挂),但永远确定。
 */
export function mergeBase(gitDir: string, a: string, b: string): string | null {
  const bSide = ancestorSet(gitDir, b)
  const common = [...ancestorSet(gitDir, a)].filter((h) => bSide.has(h))
  if (common.length === 0) {
    return null
  }
  const stamp = (hash: string): number => requireCommit(gitDir, hash).committer.timestamp
  return common.sort((x, y) => stamp(y) - stamp(x) || (x < y ? -1 : 1))[0]
}
