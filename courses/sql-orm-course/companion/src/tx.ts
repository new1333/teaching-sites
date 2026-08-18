// src/tx.ts —— 事务：db.tx(fn) 把多条语句捆成一个整体（第 13 章登场）
import type { Db } from './db'

/** 带事务的数据库句柄：Db 的全部能力外加 tx()——createDb 的返回类型（第 13 章起） */
export type DbWithTx = Db & {
  tx<T>(fn: (db: DbWithTx) => T): T
}

/** 给裸 Db 装上 tx：BEGIN/COMMIT/ROLLBACK 走 db 自身的 exec，不另开连接、不绕过包装 */
export function attachTx(inner: Db): DbWithTx {
  // 事务占用的是连接：连接一次只能开一个事务，这面旗子就是它的门锁
  let active = false
  const db: DbWithTx = {
    // 四个老方法原样转发给 inner：包装不换连接，外面再包记账皮也照常透传
    exec: inner.exec.bind(inner),
    run: inner.run.bind(inner),
    all: inner.all.bind(inner),
    get: inner.get.bind(inner),
    tx<T>(fn: (txDb: DbWithTx) => T): T {
      if (active) {
        throw new Error(
          'tx 不支持嵌套：上一个事务还没 COMMIT 或 ROLLBACK，同一个连接开不了第二个——真实 ORM 用 SAVEPOINT（保存点）实现嵌套，本课程从简不做，取舍登记在差异清单'
        )
      }
      active = true
      // BEGIN 之后、COMMIT 之前的改动只在案、未生效；fn 拿到的就是同一个 db，事务内的语句互相可见
      inner.exec('BEGIN')
      try {
        const result = fn(db)
        inner.exec('COMMIT')
        return result
      } catch (error) {
        // fn 抛错：全部作废，然后把同一个错误原样向上抛——调用方接住的还是它自己扔的那个
        inner.exec('ROLLBACK')
        throw error
      } finally {
        active = false
      }
    },
  }
  return db
}
