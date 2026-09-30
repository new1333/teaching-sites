// companion/src/export-docs.ts · 图表数据导出正本（pnpm export 从课程根目录运行）
//
// 每个可视化/演算章在自己的模块（src/datasets/chXX-*.ts）里实现 build 函数，
// 并在下方 DATASETS 注册一行。数据全部来自固定种子（src/rng.ts），
// 稳定排序、稳定序列化，连续两次运行逐字节一致——这是 canvas-app/worksheet 章的门槛之一。
// 正文组件只消费这里的产物（docs/assets/data/*.json），禁止平行手抄第二套数据。

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCh01 } from './datasets/ch01-time-value'
import { buildCh04 } from './datasets/ch04-kline'
import { buildCh05 } from './datasets/ch05-trend-ma'
import { buildCh09 } from './datasets/ch09-risk'
import { buildCh10 } from './datasets/ch10-mix'
import { buildCh13 } from './datasets/ch13-dca'

const OUT = join(process.cwd(), 'docs', 'assets', 'data')

type Dataset = { file: string; data: unknown }

// 逐章注册表：章节写作者在对应事务中在此追加一行
const DATASETS: Array<() => Dataset> = [buildCh01, buildCh04, buildCh05, buildCh09, buildCh10, buildCh13]

function stableStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n'
}

function main(): void {
  mkdirSync(OUT, { recursive: true })
  let count = 0
  for (const build of DATASETS) {
    const { file, data } = build()
    writeFileSync(join(OUT, file), stableStringify(data))
    count += 1
  }
  console.log(`exported ${count} dataset(s) -> ${OUT}`)
}

main()
