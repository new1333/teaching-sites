// tests/transactions.test.ts —— 第 13 章：db.tx(fn) 回调式事务
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'
import { defineTable, type Table } from '../src/schema'
import { attachTx, type DbWithTx } from '../src/tx'

/** 给 Db 包一层记账皮：run/all/get 记 SQL，exec 也记——BEGIN/COMMIT/ROLLBACK 走 exec，得一并入账 */
function withSqlLog(inner: Db): { db: Db; log: string[] } {
  const log: string[] = []
  const db: Db = {
    exec(sql) {
      log.push(sql)
      inner.exec(sql)
    },
    run(sql, ...params) {
      log.push(sql)
      return inner.run(sql, ...params)
    },
    all(sql, ...params) {
      log.push(sql)
      return inner.all(sql, ...params)
    },
    get(sql, ...params) {
      log.push(sql)
      return inner.get(sql, ...params)
    },
  }
  return { db, log }
}

/** 记账皮 + 事务：attachTx 包在记账皮外层，BEGIN/COMMIT/ROLLBACK 就会经过记账皮的 exec 入账 */
function loggedDb(): { db: DbWithTx; log: string[] } {
  const wrapped = withSqlLog(createDb())
  return { db: attachTx(wrapped.db), log: wrapped.log }
}

/** 转账故事的种子：两张账户，alice 1000 块、bob 500 块 */
function seedAccounts(db: Db): void {
  db.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, balance INTEGER NOT NULL)')
  db.run('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', 1, 'alice', 1000)
  db.run('INSERT INTO accounts (id, name, balance) VALUES (?, ?, ?)', 2, 'bob', 500)
}

/** 查某账户余额：断言只认数据库里的真值 */
function balanceOf(db: Db, id: number): number {
  const row = db.get<{ balance: number }>('SELECT balance FROM accounts WHERE id = ?', id)
  return row!.balance
}

/** 两步转账：先扣 A、再给 B 加；amount 传负数或 to 不存在时第二步抛错——失败路径就靠它制造 */
function transfer(db: Db, from: number, to: number, amount: number): void {
  db.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', amount, from)
  db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', amount, to)
}

describe('成功路径：fn 正常返回则 COMMIT', () => {
  it('转账 300：事务后 alice 700、bob 800，tx 的返回值就是 fn 的返回值', () => {
    const db = createDb()
    seedAccounts(db)
    const receipt = db.tx((tx) => {
      transfer(tx, 1, 2, 300)
      return '转账 300 已入账'
    })
    expect(receipt).toBe('转账 300 已入账')
    expect(balanceOf(db, 1)).toBe(700)
    expect(balanceOf(db, 2)).toBe(800)
  })

  it('语句账：BEGIN 打头、COMMIT 收尾，两条 UPDATE 夹在中间', () => {
    const { db, log } = loggedDb()
    seedAccounts(db)
    log.length = 0
    db.tx((tx) => transfer(tx, 1, 2, 300))
    expect(log[0]).toBe('BEGIN')
    expect(log[log.length - 1]).toBe('COMMIT')
    expect(log.filter((sql) => sql.startsWith('UPDATE'))).toHaveLength(2)
  })
})

describe('失败路径：fn 抛错则 ROLLBACK，再向上抛', () => {
  it('第二步炸掉：第一条 UPDATE 已执行，事务后两边余额与转前一字不差', () => {
    const db = createDb()
    seedAccounts(db)
    expect(() =>
      db.tx((tx) => {
        tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 300, 1)
        throw new Error('给 B 加款前进程崩了')
      })
    ).toThrowError('给 B 加款前进程崩了')
    expect(balanceOf(db, 1)).toBe(1000)
    expect(balanceOf(db, 2)).toBe(500)
  })

  it('语句账：BEGIN 打头、ROLLBACK 收尾', () => {
    const { db, log } = loggedDb()
    seedAccounts(db)
    log.length = 0
    expect(() =>
      db.tx((tx) => {
        tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 300, 1)
        throw new Error('崩')
      })
    ).toThrowError('崩')
    expect(log[0]).toBe('BEGIN')
    expect(log[log.length - 1]).toBe('ROLLBACK')
  })

  it('错误原样向上抛：调用方接住的是同一个错误对象', () => {
    const db = createDb()
    seedAccounts(db)
    const boom = new Error('就是这同一个错误')
    let caught: unknown
    try {
      db.tx(() => {
        throw boom
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(boom)
  })

  it('回滚后连接干净：紧接着再开一个事务，照常能提交', () => {
    const db = createDb()
    seedAccounts(db)
    expect(() => db.tx(() => {
      throw new Error('先崩一个')
    })).toThrowError('先崩一个')
    db.tx((tx) => transfer(tx, 2, 1, 200))
    expect(balanceOf(db, 1)).toBe(1200)
    expect(balanceOf(db, 2)).toBe(300)
  })

  it('第 3 章的守门员在事务里照样拦人：外键失败也触发整体回滚', () => {
    const db = createDb()
    seedAccounts(db)
    db.exec('CREATE TABLE transfers (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL, to_id INTEGER NOT NULL, amount INTEGER NOT NULL, FOREIGN KEY (from_id) REFERENCES accounts(id), FOREIGN KEY (to_id) REFERENCES accounts(id))')
    expect(() =>
      db.tx((tx) => {
        tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 300, 1)
        // to_id 指向不存在的账户 99：外键约束当场拦下（PRAGMA foreign_keys = ON，第 1 章开的）
        tx.run('INSERT INTO transfers (from_id, to_id, amount) VALUES (?, ?, ?)', 1, 99, 300)
      })
    ).toThrowError(/FOREIGN KEY/)
    expect(balanceOf(db, 1)).toBe(1000)
    expect(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM transfers')!.n).toBe(0)
  })
})

describe('同连接语义：事务内自己看得到未提交改动', () => {
  it('tx 里先扣款再查：读到的是未提交的新值；回滚后再查，回到旧值', () => {
    const db = createDb()
    seedAccounts(db)
    expect(() =>
      db.tx((tx) => {
        tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', 300, 1)
        // 同一个事务里读：300 扣掉立即可见——改动在案，只是还没提交
        expect(tx.get<{ balance: number }>('SELECT balance FROM accounts WHERE id = ?', 1)!.balance).toBe(700)
        throw new Error('回滚')
      })
    ).toThrowError('回滚')
    expect(balanceOf(db, 1)).toBe(1000)
  })
})

describe('mini-ORM 全家进事务：create/save 一样被捆住', () => {
  /** ORM 侧的种子：users 表 + 一个已存在的用户 */
  function seedOrm(db: Db): Table {
    const users = defineTable(db, 'users', {
      id: { type: 'integer', primaryKey: true },
      name: { type: 'text', notNull: true },
    })
    users.create({ id: 1, name: 'alice' })
    return users
  }

  it('create 加 save 进事务、中途抛错：插的行消失、改的名字还原', () => {
    const db = createDb()
    const users = seedOrm(db)
    expect(() =>
      db.tx(() => {
        // 表句柄内部用的就是同一个 db（同一连接）：create/save 不看调用者是谁，只看连接在不在事务里
        users.create({ id: 2, name: 'bob' })
        const alice = users.find(1)!
        alice.name = 'alicelee'
        alice.save()
        throw new Error('第三步崩')
      })
    ).toThrowError('第三步崩')
    expect(users.find(2)).toBeUndefined()
    expect(users.find(1)!.name).toBe('alice')
  })

  it('不抛错则全部生效：bob 在、alice 的改名也在', () => {
    const db = createDb()
    const users = seedOrm(db)
    db.tx(() => {
      users.create({ id: 2, name: 'bob' })
      const alice = users.find(1)!
      alice.name = 'alicelee'
      alice.save()
      return 'done'
    })
    expect(users.find(2)!.name).toBe('bob')
    expect(users.find(1)!.name).toBe('alicelee')
  })
})

describe('嵌套与取舍', () => {
  it('嵌套 tx 抛中文错误：不支持就是明说', () => {
    const db = createDb()
    seedAccounts(db)
    expect(() =>
      db.tx((tx) => {
        tx.tx(() => {
          transfer(tx, 1, 2, 100)
        })
      })
    ).toThrowError(/tx 不支持嵌套/)
  })
})
