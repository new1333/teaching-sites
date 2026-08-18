// src/db.ts —— 内存 SQLite 薄封装：全书实验场的地基（第 1 章登场；tx 第 13 章长上）
import { DatabaseSync } from 'node:sqlite'
import { attachTx, type DbWithTx } from './tx'

/** 能塞进 SQL 里 ? 处的值：null、数字、大整数、字符串、二进制 */
export type SqlValue = null | number | bigint | string | Uint8Array

/** 一条写操作（INSERT/UPDATE/DELETE）的报告：改了几行、新插入行的行号是几 */
export interface RunResult {
  changes: number
  lastInsertRowid: number | bigint
}

/** 实验场对数据库的全部需求：跑无结果批语句、带参写、带参读 */
export interface Db {
  exec(sql: string): void
  run(sql: string, ...params: SqlValue[]): RunResult
  all<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T[]
  get<T = Record<string, SqlValue>>(sql: string, ...params: SqlValue[]): T | undefined
}

/** 打开一个只活在内存里的 SQLite 数据库：随建随毁，测试即开即跑；第 13 章起句柄上多了 tx */
export function createDb(): DbWithTx {
  const db = new DatabaseSync(':memory:')
  // 外键约束 SQLite 默认关闭，实验场统一手动打开（第 3 章讲它是怎么回事）
  db.exec('PRAGMA foreign_keys = ON')
  return attachTx({
    exec(sql: string): void {
      db.exec(sql)
    },
    run(sql: string, ...params: SqlValue[]): RunResult {
      const { changes, lastInsertRowid } = db.prepare(sql).run(...params)
      return { changes: Number(changes), lastInsertRowid }
    },
    all<T>(sql: string, ...params: SqlValue[]): T[] {
      return db.prepare(sql).all(...params) as unknown as T[]
    },
    get<T>(sql: string, ...params: SqlValue[]): T | undefined {
      return db.prepare(sql).get(...params) as unknown as T | undefined
    },
  })
}
