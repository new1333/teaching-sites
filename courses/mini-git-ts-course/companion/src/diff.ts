// src/diff.ts · 行级 diff:LCS 编辑脚本与 unified 渲染
// 口径:行级最小编辑(最长公共子序列的补集),unified 输出与真 git 对拍固化。

/** 编辑脚本的一条指令:删旧文本第 aLine 行、插新文本第 bLine 行,或两边都有的行原样保留。 */
export type EditOp =
  | { op: 'context'; aLine: number; bLine: number; text: string }
  | { op: 'delete'; aLine: number; text: string }
  | { op: 'insert'; bLine: number; text: string }

/** unified diff 的上下文行数;真 git 默认 3(-U<n> 可调,mini-git 固定 3)。 */
export const CONTEXT_LINES = 3

/** 把文本拆成行数组:以 \n 切开,收尾的换行不产生空行;空文件得到空数组。 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n')
  return lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines
}

/**
 * 行级 diff:求把 a 变成 b 的最少增删行操作序列。
 * 做法:动态规划先算「a[i:] 与 b[j:] 的最长公共子序列长度」全表,再从左上角回溯——
 * 两行相等走 context,不等时哪边删一行损失小走哪边;平手先删后插(与真 git 的 - 在 + 前一致)。
 */
export function diffLines(a: readonly string[], b: readonly string[]): EditOp[] {
  const n = a.length
  const m = b.length
  // dp[i][j] = a 的后缀 a[i:] 与 b 的后缀 b[j:] 的 LCS 长度;多一行一列的 0 哨兵
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: EditOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ op: 'context', aLine: i + 1, bLine: j + 1, text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: 'delete', aLine: i + 1, text: a[i] })
      i++
    } else {
      ops.push({ op: 'insert', bLine: j + 1, text: b[j] })
      j++
    }
  }
  for (; i < n; i++) {
    ops.push({ op: 'delete', aLine: i + 1, text: a[i] }) // 尾部多出的旧行:整段删
  }
  for (; j < m; j++) {
    ops.push({ op: 'insert', bLine: j + 1, text: b[j] }) // 尾部多出的新行:整段插
  }
  return ops
}

/** 一个改动组:编辑脚本里一段连续的 delete/insert,下标闭区间。 */
interface ChangeGroup {
  from: number // 组内第一条指令在 ops 里的下标
  to: number // 组内最后一条指令在 ops 里的下标
}

/** 扫出全部改动组:两组之间必隔着至少一条 context。 */
function changeGroups(ops: readonly EditOp[]): ChangeGroup[] {
  const groups: ChangeGroup[] = []
  let start = -1
  for (let k = 0; k <= ops.length; k++) {
    const changed = k < ops.length && ops[k].op !== 'context'
    if (changed && start < 0) {
      start = k
    } else if (!changed && start >= 0) {
      groups.push({ from: start, to: k - 1 })
      start = -1
    }
  }
  return groups
}

/** @@ 头里的一段范围:条数恰为 1 时省略 「,1」,为 0 时写成 「start,0」。 */
function range(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`
}

/**
 * 把编辑脚本渲染成 unified diff 文本(只含 hunk,不含 diff --git / --- / +++ 文件头)。
 * 每个改动组前后各带至多 3 行上下文;相邻两组之间若隔着的未变行 ≤ 2×3=6,
 * 上下文窗口相连,合并进同一个 hunk——「相邻两处小改合并成一个大块」的全部机制。
 */
export function renderUnified(ops: readonly EditOp[]): string {
  const groups = changeGroups(ops)
  if (groups.length === 0) {
    return '' // 没有改动就没有输出
  }
  const hunks: string[] = []
  let current = groups[0]
  for (let g = 1; g < groups.length; g++) {
    const gap = groups[g].from - current.to - 1 // 两组之间隔着的 context 条数
    if (gap <= 2 * CONTEXT_LINES) {
      current = { from: current.from, to: groups[g].to } // 窗口相连:并进当前 hunk
    } else {
      hunks.push(renderHunk(ops, current))
      current = groups[g]
    }
  }
  hunks.push(renderHunk(ops, current))
  return hunks.join('\n')
}

/** 渲染单个 hunk:窗口裁剪、@@ 头计数、逐行加前缀(空格 / - / +)。 */
function renderHunk(ops: readonly EditOp[], group: ChangeGroup): string {
  const from = Math.max(0, group.from - CONTEXT_LINES) // 窗口:改动前至多 3 行上下文
  const to = Math.min(ops.length - 1, group.to + CONTEXT_LINES) // 改动后至多 3 行
  let aStart = 0
  let aCount = 0
  let bStart = 0
  let bCount = 0
  const lines: string[] = []
  for (let k = from; k <= to; k++) {
    const op = ops[k]
    lines.push(`${op.op === 'context' ? ' ' : op.op === 'delete' ? '-' : '+'}${op.text}`)
    if (op.op !== 'insert') {
      // context 或 delete:旧文本里有一条
      if (aCount === 0) {
        aStart = op.aLine
      }
      aCount++
    }
    if (op.op !== 'delete') {
      // context 或 insert:新文本里有一条
      if (bCount === 0) {
        bStart = op.bLine
      }
      bCount++
    }
  }
  lines.unshift(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`)
  return lines.join('\n')
}
