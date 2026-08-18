// tests/update-delete-constraints.test.ts —— 第 3 章：UPDATE、DELETE 与约束
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type User = { id: number; name: string; email: string; age: number | null }
type Order = { id: number; user_id: number; item: string; amount: number }

/** 3 位用户：邮箱各不相同、age 不给值走默认——主键/UNIQUE/NOT NULL/DEFAULT 断言全靠这组数据 */
function seedUsers(db: Db): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      age INTEGER DEFAULT 18
    );
  `)
  const rows: [string, string][] = [
    ['Alice', 'alice@example.com'],
    ['Bob', 'bob@example.com'],
    ['Carol', 'carol@example.com'],
  ]
  for (const [name, email] of rows) {
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', name, email)
  }
}

/** 3 笔订单：两笔属于 Bob、一笔属于 Alice——外键与写操作断言靠这两张表的配合 */
function seedOrders(db: Db): void {
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      item TEXT NOT NULL,
      amount INTEGER NOT NULL
    );
  `)
  const rows: [number, string, number][] = [
    [1, '键盘', 300],
    [2, '显示器', 1200],
    [2, '鼠标', 90],
  ]
  for (const [user_id, item, amount] of rows) {
    db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', user_id, item, amount)
  }
}

describe('UPDATE、DELETE 与 changes 计数', () => {
  it('UPDATE 带 WHERE：只改命中的行，changes 如实报数', () => {
    const db = createDb()
    seedUsers(db)
    const hit = db.run('UPDATE users SET age = ? WHERE id IN (?, ?)', 30, 2, 3)
    expect(hit.changes).toBe(2)
    const ages = db.all<User>('SELECT id, age FROM users ORDER BY id')
    expect(ages.map((r) => r.age)).toEqual([18, 30, 30])
  })

  it('UPDATE 不带 WHERE：全表都是目标，changes 等于全表行数', () => {
    const db = createDb()
    seedUsers(db)
    const all = db.run('UPDATE users SET age = ?', 40)
    expect(all.changes).toBe(3)
    const rows = db.all<User>('SELECT age FROM users')
    expect(rows.every((r) => r.age === 40)).toBe(true)
  })

  it('WHERE 无命中时 UPDATE 安静返回 changes = 0', () => {
    const db = createDb()
    seedUsers(db)
    const miss = db.run('UPDATE users SET age = ? WHERE age > ?', 99, 100)
    expect(miss.changes).toBe(0)
  })

  it('DELETE 带 WHERE 与全删：行真的没了，changes 一样报数', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const bobs = db.run('DELETE FROM orders WHERE user_id = ?', 2)
    expect(bobs.changes).toBe(2)
    expect(db.all<Order>('SELECT id FROM orders').map((r) => r.id)).toEqual([1])
    const rest = db.run('DELETE FROM orders')
    expect(rest.changes).toBe(1)
    expect(db.all<Order>('SELECT id FROM orders')).toEqual([])
  })
})

describe('主键与自动发号', () => {
  it('插入已存在的 id：主键拦截，抛错', () => {
    const db = createDb()
    seedUsers(db)
    expect(() =>
      db.run('INSERT INTO users (id, name, email) VALUES (?, ?, ?)', 2, 'Dup', 'dup@example.com')
    ).toThrow(/UNIQUE constraint failed: users\.id/)
  })

  it('默认发号 = 现有最大 rowid + 1：删走最大号后，新行会复用被删的号', () => {
    const db = createDb()
    seedUsers(db)
    expect(db.run('DELETE FROM users WHERE id = ?', 3).changes).toBe(1)
    const again = db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'Dave', 'dave@example.com')
    expect(Number(again.lastInsertRowid)).toBe(3)
  })

  it('AUTOINCREMENT：记住史上最大号，删了也不复用，只增不减', () => {
    const db = createDb()
    db.exec('CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL)')
    db.run("INSERT INTO tags (label) VALUES ('red')")
    db.run("INSERT INTO tags (label) VALUES ('green')")
    const top = db.run("INSERT INTO tags (label) VALUES ('blue')")
    expect(Number(top.lastInsertRowid)).toBe(3)
    expect(db.run('DELETE FROM tags WHERE id = ?', 3).changes).toBe(1)
    const next = db.run("INSERT INTO tags (label) VALUES ('black')")
    expect(Number(next.lastInsertRowid)).toBe(4)
  })
})

describe('约束守门：NOT NULL、UNIQUE、DEFAULT', () => {
  it('重复邮箱：UNIQUE 拦下', () => {
    const db = createDb()
    seedUsers(db)
    expect(() =>
      db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'Dave', 'alice@example.com')
    ).toThrow(/UNIQUE constraint failed: users\.email/)
  })

  it('name 给空值：NOT NULL 拦下', () => {
    const db = createDb()
    seedUsers(db)
    expect(() =>
      db.run('INSERT INTO users (name, email) VALUES (?, ?)', null, 'dave@example.com')
    ).toThrow(/NOT NULL constraint failed: users\.name/)
  })

  it('age 不给值：DEFAULT 18 补上', () => {
    const db = createDb()
    seedUsers(db)
    const row = db.get<User>('SELECT age FROM users WHERE id = ?', 1)
    expect(row?.age).toBe(18)
  })
})

describe('外键：开与关的行为差', () => {
  it('外键开着（createDb 默认）：插孤儿订单、删有订单的用户，都被拦', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    expect(() =>
      db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', 999, '孤儿单', 1)
    ).toThrow(/FOREIGN KEY constraint failed/)
    expect(() => db.run('DELETE FROM users WHERE id = ?', 2)).toThrow(
      /FOREIGN KEY constraint failed/
    )
  })

  it('PRAGMA foreign_keys = OFF：同样的孤儿订单能插进去，删用户也畅通无阻', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    db.exec('PRAGMA foreign_keys = OFF')
    const orphan = db.run('INSERT INTO orders (user_id, item, amount) VALUES (?, ?, ?)', 999, '孤儿单', 1)
    expect(orphan.changes).toBe(1)
    expect(db.run('DELETE FROM users WHERE id = ?', 2).changes).toBe(1)
    // Bob 已删，他的两笔订单成了指向空气的孤儿行——这正是第 3 章开头那场报表事故的机制
    const dangling = db.all<Order>('SELECT id FROM orders WHERE user_id = ?', 2)
    expect(dangling.map((r) => r.id)).toEqual([2, 3])
    // 开关只影响之后的语句，重新打开后外键检查恢复
    db.exec('PRAGMA foreign_keys = ON')
    expect(db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys).toBe(1)
  })
})
