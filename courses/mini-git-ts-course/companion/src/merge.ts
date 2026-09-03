// src/merge.ts · 三方合并:行对齐账上的自动合入与冲突标记
import { readObject, writeObject } from './objects.ts'
import { commitTree, parseCommit, type CommitIdentity } from './commits.ts'
import { isAncestor, mergeBase } from './graph.ts'
import { diffLines, splitLines } from './diff.ts'
import { writeTreeFromIndex } from './trees.ts'
import { flattenTree, type FileSig, type IndexEntry } from './index.ts'

/** 冲突块两翼的标签:git 的口径是 ours 侧恒写 HEAD,theirs 侧写 merge 参数原文(分支名或 40 位哈希)。 */
export interface MergeLabels {
  ours: string
  theirs: string
}

/** 文件级三方合并的产物:merged 是合并后的全文(有冲突时含标记),conflicts 记冲突块个数。 */
export interface BlobMerge {
  merged: string
  conflicts: number
}

/** 树级三方合并的产物:tree 是合并结果的根 tree(冲突路径里存着带标记内容的 blob),conflicts 是冲突路径清单。 */
export interface TreeMerge {
  tree: string
  conflicts: string[]
}

/** mergeCommits 的四种结局,与第 8 章 ff 判定表一一对应。 */
export type MergeOutcome =
  | { kind: 'up-to-date' }
  | { kind: 'fast-forward'; to: string }
  | { kind: 'merged'; commit: string; tree: string }
  | { kind: 'conflicted'; tree: string; conflicts: string[] }

/** mergeCommits 的入参:冲突标签、提交消息与作者身份(commit 口径与 commit-tree 相同)。 */
export interface MergeOptions {
  labels?: MergeLabels
  message?: string
  author: CommitIdentity
}

/** 一处改动的「行对齐账」:base 的第 from 行起(含)到第 to 行(不含)被替换成 lines;纯插入时 from === to。 */
interface Region {
  from: number
  to: number
  lines: string[]
}

/**
 * 把一侧相对 base 的编辑脚本折算成改动区清单:一段连续的删/插指令折成一个区,
 * 区与区之间必隔着至少一条没动的 base 行。from/to 都是 base 的 0 起算下标。
 */
function changeRegions(base: readonly string[], side: readonly string[]): Region[] {
  const regions: Region[] = []
  let cur: Region | null = null
  let i = 0 // 已数过的 base 行数:下一条指令的落点
  for (const op of diffLines(base, side)) {
    if (op.op === 'context') {
      if (cur !== null) {
        regions.push(cur)
        cur = null
      }
      i++
    } else if (op.op === 'delete') {
      cur ??= { from: i, to: i, lines: [] }
      i++
      cur.to = i // 删掉的 base 行收进区里
    } else {
      cur ??= { from: i, to: i, lines: [] }
      cur.lines.push(op.text) // 插入行记在区的替换内容里;落点就是当前的 i
    }
  }
  if (cur !== null) {
    regions.push(cur)
  }
  return regions
}

/** 两个改动区是否一模一样:同一批 base 行换成同一批新行——双侧不谋而合,采纳一份即可。 */
function identicalRegion(a: Region, b: Region): boolean {
  return a.from === b.from && a.to === b.to && a.lines.length === b.lines.length && a.lines.every((l, k) => l === b.lines[k])
}

/**
 * 文件级三方合并:以 base 行为轴,对 ours 与 theirs 各算一张行对齐账,逐区对账。
 * 判定与真 git 的 xmerge 同口径:一侧的改动严格在另一侧改动之前(中间至少隔一行没动)才自动采纳;
 * 相触或交叠则没人是裁判,写冲突标记——`<<<<<<< 标签`、七字符 `=======`、`>>>>>>> 标签`(git-merge 文档的格式)。
 * 从简口径(登记差异附录):不做 git 的「热忱合并」细化与相邻冲突块归并;假定文件以换行收尾(第 7 章同款)。
 */
export function mergeBlobs(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = { ours: 'HEAD', theirs: 'theirs' },
): BlobMerge {
  if (ours === theirs) {
    return { merged: ours, conflicts: 0 } // 两侧终稿一字不差:不用对账
  }
  const baseLines = splitLines(base)
  const oursRegions = changeRegions(baseLines, splitLines(ours))
  const theirsRegions = changeRegions(baseLines, splitLines(theirs))
  const out: string[] = []
  let conflicts = 0
  let i = 0 // base 行游标:还没写进结果的第一行
  let oi = 0
  let ti = 0
  /** 把某个冲突区间 [from, to) 在一侧账上的样子写成行:该侧没动过的 base 行原样带出,动过的换成改后的行。 */
  const sideLines = (regions: readonly Region[], from: number, to: number): string[] => {
    const lines: string[] = []
    let p = from
    for (const r of regions) {
      lines.push(...baseLines.slice(p, r.from), ...r.lines)
      p = r.to
    }
    lines.push(...baseLines.slice(p, to))
    return lines
  }
  while (oi < oursRegions.length || ti < theirsRegions.length) {
    const o = oursRegions[oi]
    const t = theirsRegions[ti]
    if (t === undefined || (o !== undefined && o.to < t.from)) {
      // theirs 已走完,或 ours 的改动严格在前:单方改动,自动采纳
      out.push(...baseLines.slice(i, o.from), ...o.lines)
      i = o.to
      oi++
    } else if (o === undefined || t.to < o.from) {
      out.push(...baseLines.slice(i, t.from), ...t.lines)
      i = t.to
      ti++
    } else if (identicalRegion(o, t)) {
      // 双侧改得一模一样:采纳一份,不算冲突
      out.push(...baseLines.slice(i, o.from), ...o.lines)
      i = o.to
      oi++
      ti++
    } else {
      // 相触或交叠:冲突块。区间两头取并集,把两侧与它相触的改动全部吞进来。
      const from = Math.min(o.from, t.from)
      let to = Math.max(o.to, t.to)
      const oStart = oi // 本块吞进的 ours 区,从下标 oStart 到 oi;theirs 同理
      const tStart = ti
      oi++
      ti++
      for (;;) {
        const next = oursRegions[oi] ?? theirsRegions[ti]
        if (next === undefined || next.from > to) {
          break // 后面的改动与本块不相触,留给下一轮
        }
        to = Math.max(to, next.to)
        if (next === oursRegions[oi]) {
          oi++
        } else {
          ti++
        }
      }
      out.push(...baseLines.slice(i, from))
      out.push(`<<<<<<< ${labels.ours}`, ...sideLines(oursRegions.slice(oStart, oi), from, to), '=======')
      out.push(...sideLines(theirsRegions.slice(tStart, ti), from, to), `>>>>>>> ${labels.theirs}`)
      conflicts++
      i = to
    }
  }
  out.push(...baseLines.slice(i))
  return { merged: out.length === 0 ? '' : `${out.join('\n')}\n`, conflicts }
}

/**
 * 树级三方合并:三棵 tree 各自摊平成「路径 → 模式+指纹」,逐路径判。
 * 两侧一致 → 采纳;一侧与 base 一致 → 听另一侧的;三方都不同 → 交给 mergeBlobs 行级对账,
 * 缺失的一侧当空文本——删对改、双侧各自新增(add/add)都自然归进这条。
 * 从简口径(登记差异附录):模式冲突不检测(ours 有模式用 ours 的,否则 theirs 的)。
 */
export function mergeTrees(
  gitDir: string,
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = { ours: 'HEAD', theirs: 'theirs' },
): TreeMerge {
  const baseFiles = flattenTree(gitDir, base)
  const oursFiles = flattenTree(gitDir, ours)
  const theirsFiles = flattenTree(gitDir, theirs)
  const text = (sig: FileSig | undefined): string => (sig === undefined ? '' : readObject(gitDir, sig.hash).body.toString('utf8'))
  const same = (a: FileSig | undefined, b: FileSig | undefined): boolean =>
    (a === undefined) === (b === undefined) && a?.hash === b?.hash && a?.mode === b?.mode
  const files: { path: string; mode: number; hash: string }[] = []
  const conflicts: string[] = []
  const paths = [...new Set([...oursFiles.keys(), ...theirsFiles.keys(), ...baseFiles.keys()])].sort()
  for (const path of paths) {
    const so = oursFiles.get(path)
    const st = theirsFiles.get(path)
    const sb = baseFiles.get(path)
    if (same(so, st)) {
      if (so === undefined) {
        continue // 两侧一致地没有该路径:删除,不进清单
      }
      files.push({ path, mode: so.mode, hash: so.hash })
    } else if (same(so, sb)) {
      if (st !== undefined) {
        files.push({ path, mode: st.mode, hash: st.hash }) // 只有 theirs 动过:采纳 theirs
      }
    } else if (same(st, sb)) {
      if (so !== undefined) {
        files.push({ path, mode: so.mode, hash: so.hash }) // 只有 ours 动过:ours 说了算
      }
    } else {
      const merged = mergeBlobs(text(sb), text(so), text(st), labels)
      files.push({
        path,
        mode: so?.mode ?? st!.mode,
        hash: writeObject(gitDir, 'blob', Buffer.from(merged.merged, 'utf8')), // 带标记的合并稿也是内容,照样按内容寻址落库
      })
      if (merged.conflicts > 0) {
        conflicts.push(path)
      }
    }
  }
  return { tree: writeMergedTree(gitDir, files), conflicts }
}

/** 用「路径 → 模式+哈希」清单写一棵 tree:stat 字段全填 0,tree 序列化只读路径、模式与哈希三项。 */
function writeMergedTree(gitDir: string, files: readonly { path: string; mode: number; hash: string }[]): string {
  const entry = (f: { path: string; mode: number; hash: string }): IndexEntry => ({
    ctimeSec: 0,
    ctimeNsec: 0,
    mtimeSec: 0,
    mtimeNsec: 0,
    dev: 0,
    ino: 0,
    uid: 0,
    gid: 0,
    size: 0,
    mode: f.mode,
    hash: f.hash,
    flags: Buffer.byteLength(f.path, 'utf8'),
    path: f.path,
  })
  return writeTreeFromIndex(gitDir, files.map(entry))
}

/**
 * 提交级三方合并:第 8 章判定表的三个格子在此落地。
 * theirs 可达自 ours ⇒ up-to-date(相等是退化情形);ours 可达自 theirs ⇒ fast-forward,返回目标,挪引用由调用方办;
 * 互不包含 ⇒ mergeBase 找 base 后真合并——无冲突产双父提交(第一父 ours、第二父 theirs,commitTree 一个函数办),
 * 有冲突返回带标记内容的合并树与冲突清单,不写提交。
 */
export function mergeCommits(gitDir: string, ours: string, theirs: string, options: MergeOptions): MergeOutcome {
  if (isAncestor(gitDir, theirs, ours)) {
    return { kind: 'up-to-date' }
  }
  if (isAncestor(gitDir, ours, theirs)) {
    return { kind: 'fast-forward', to: theirs }
  }
  const base = mergeBase(gitDir, ours, theirs)
  if (base === null) {
    throw new Error(`merge:'${ours.slice(0, 7)}' 与 '${theirs.slice(0, 7)}' 没有公共祖先——两段不相连的历史,给不出 base`)
  }
  const treeOf = (commit: string): string => {
    const { type, body } = readObject(gitDir, commit)
    if (type !== 'commit') {
      throw new Error(`merge:对象 '${commit.slice(0, 7)}' 不是 commit(它是 ${type}),没法当合并的一方`)
    }
    return parseCommit(body).tree
  }
  const merged = mergeTrees(gitDir, treeOf(base), treeOf(ours), treeOf(theirs), options.labels)
  if (merged.conflicts.length > 0) {
    return { kind: 'conflicted', tree: merged.tree, conflicts: merged.conflicts }
  }
  const commit = commitTree(gitDir, {
    tree: merged.tree,
    parents: [ours, theirs],
    author: options.author,
    message: options.message ?? `Merge\n`,
  })
  return { kind: 'merged', commit, tree: merged.tree }
}
