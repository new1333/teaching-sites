// RDB 快照：把某一瞬间的全库现状拍成一份「照片」——不是历史的命令流（那是 AOF 的账本），
// 而是每个键此刻长什么样。恢复时不用重演历史，照着照片直接搭：这正是快照比重放快的全部秘密。
// 真货是紧凑二进制（版本头 + 逐键记录 + 结尾 CRC64 校验和防文件损坏），教学版换成
// 「一行一键」的 JSON 文本——教学清晰优先（差异清单登记）。

// 一条快照记录：键 + 值的类型与内容 + 寿命（到期绝对时刻；null = 没登记寿命）。
// zset 的成员按分数有序存放，装载时照这个序直接搭建
export type SnapshotEntry =
  | { key: string; type: 'string'; value: string; expireAtMs: number | null }
  | { key: string; type: 'zset'; members: Array<[string, number]>; expireAtMs: number | null }

// 照片头：一行版本标记，将来格式变了靠它认旧照片。真货头是 REDIS0011 这类版本号，
// 结尾另有一段 CRC64 校验和——文件损坏半路就拒收（教学版不校验，差异清单登记）
const HEADER = 'mini-rdb-1'

// 拍照：向持有数据的人要一份「全库现状」，逐键写成一行。
// 值里的换行、引号这类「危险字符」由 JSON 转义兜住——照片是文本，但值想装什么装什么
export function dump(collectEntries: () => SnapshotEntry[]): string {
  const lines = [HEADER]
  for (const { expireAtMs, ...entry } of collectEntries()) {
    // 没登记寿命就不写这一栏：大多数键没有寿命，照片行越短越好读
    lines.push(JSON.stringify(expireAtMs === null ? entry : { ...entry, expireAtMs }))
  }
  return lines.join('\n')
}

// 装载：把照片逐行读回记录。头一行不对就整个拒收——装错格式的东西比空手还糟
export function load(text: string): SnapshotEntry[] {
  const lines = text.split('\n')
  if (lines[0] !== HEADER) throw new Error('not a mini-rdb snapshot')
  const out: SnapshotEntry[] = []
  for (const line of lines.slice(1)) {
    if (line === '') continue // 容忍手工编辑留下的空行
    const entry = JSON.parse(line) as SnapshotEntry
    out.push({ ...entry, expireAtMs: entry.expireAtMs ?? null }) // 没写寿命栏 = 没有寿命
  }
  return out
}
