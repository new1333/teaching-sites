// tests/aggregate-group-by.test.ts —— 第 4 章：聚合函数、GROUP BY 与 HAVING
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type User = { id: number; name: string }
type Order = { id: number; user_id: number; status: string; amount: number; note: string | null }
type Rate = { id: number; rater: string; score: number | null }

/** 3 位用户：外键指着他们——GROUP BY user_id 的每个桶都有名有姓 */
function seedUsers(db: Db): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
  `)
  const rows: [string][] = [['Alice'], ['Bob'], ['Carol']]
  for (const [name] of rows) {
    db.run('INSERT INTO users (name) VALUES (?)', name)
  }
}

/** 8 笔订单：总额 3200、平均值恰为 400，note 三行有值五行空——聚合断言全靠这组数据可手算 */
function seedOrders(db: Db): void {
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT
    );
  `)
  const rows: [number, string, number, string | null][] = [
    [1, 'paid', 300, '加急'],
    [2, 'paid', 1200, null],
    [2, 'pending', 90, '电话催付'],
    [1, 'refunded', 150, null],
    [3, 'paid', 300, null],
    [2, 'paid', 90, null],
    [3, 'pending', 750, '开票'],
    [3, 'paid', 320, null],
  ]
  for (const [user_id, status, amount, note] of rows) {
    db.run('INSERT INTO orders (user_id, status, amount, note) VALUES (?, ?, ?, ?)', user_id, status, amount, note)
  }
}

/** 4 条评分：一半是 NULL——COUNT(col) 与 AVG 跳不跳 NULL，全靠这张小表说清 */
function seedRates(db: Db): void {
  db.exec(`
    CREATE TABLE rates (
      id INTEGER PRIMARY KEY,
      rater TEXT NOT NULL,
      score INTEGER
    );
  `)
  const rows: [string, number | null][] = [
    ['alice', 5],
    ['alice', null],
    ['bob', 3],
    ['carol', null],
  ]
  for (const [rater, score] of rows) {
    db.run('INSERT INTO rates (rater, score) VALUES (?, ?)', rater, score)
  }
}

describe('聚合函数：把多行压成一个数', () => {
  it('COUNT/SUM/AVG/MIN/MAX：全表五件套一次算清', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const row = db.get<{
      n: number
      total: number
      avg: number
      low: number
      high: number
    }>(
      'SELECT COUNT(*) AS n, SUM(amount) AS total, AVG(amount) AS avg, MIN(amount) AS low, MAX(amount) AS high FROM orders'
    )
    // 8 行：300+1200+90+150+300+90+750+320 = 3200，平均恰为 400
    expect(row).toEqual({ n: 8, total: 3200, avg: 400, low: 90, high: 1200 })
  })

  it('COUNT(*) 数行，COUNT(列) 只数有值的格子', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const row = db.get<{ all_rows: number; noted: number }>(
      'SELECT COUNT(*) AS all_rows, COUNT(note) AS noted FROM orders'
    )
    expect(row).toEqual({ all_rows: 8, noted: 3 })
  })

  it('SUM/AVG 跳过 NULL：全空的组 AVG 出 NULL，不是 0 也不是报错', () => {
    const db = createDb()
    seedRates(db)
    const whole = db.get<{ n: number; scored: number; total: number; avg: number | null }>(
      'SELECT COUNT(*) AS n, COUNT(score) AS scored, SUM(score) AS total, AVG(score) AS avg FROM rates'
    )
    // 4 行里只有 2 行有分：SUM 是 5+3=8，AVG 是 8/2=4——NULL 行不进分子也不进分母
    expect(whole).toEqual({ n: 4, scored: 2, total: 8, avg: 4 })
    const carol = db.get<{ n: number; scored: number; avg: number | null }>(
      'SELECT COUNT(*) AS n, COUNT(score) AS scored, AVG(score) AS avg FROM rates WHERE rater = ?',
      'carol'
    )
    expect(carol).toEqual({ n: 1, scored: 0, avg: null })
  })
})

describe('分组（GROUP BY）：先分桶，再各自聚合', () => {
  it('GROUP BY user_id 的每组行数，与手写 reduce 分桶的结果一致', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const bySql = db.all<{ user_id: number; n: number }>(
      'SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id ORDER BY user_id'
    )
    const buckets = new Map<number, number>()
    for (const r of db.all<Order>('SELECT user_id FROM orders')) {
      buckets.set(r.user_id, (buckets.get(r.user_id) ?? 0) + 1)
    }
    const byReduce = [...buckets.entries()]
      .map(([user_id, n]) => ({ user_id, n }))
      .sort((a, b) => a.user_id - b.user_id)
    expect(bySql).toEqual(byReduce)
    expect(bySql).toEqual([
      { user_id: 1, n: 2 },
      { user_id: 2, n: 3 },
      { user_id: 3, n: 3 },
    ])
  })

  it('按组求和与 AS 别名：SUM(amount) AS total，ORDER BY 别名照常排序', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const rows = db.all<{ user_id: number; total: number }>(
      'SELECT user_id, SUM(amount) AS total FROM orders GROUP BY user_id ORDER BY total DESC, user_id'
    )
    expect(rows).toEqual([
      { user_id: 2, total: 1380 },
      { user_id: 3, total: 1370 },
      { user_id: 1, total: 450 },
    ])
  })
})

describe('HAVING 与 WHERE 的分工', () => {
  it('HAVING 筛组：COUNT(*) >= 3 只留下大分组', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    const rows = db.all<{ user_id: number; n: number }>(
      'SELECT user_id, COUNT(*) AS n FROM orders GROUP BY user_id HAVING COUNT(*) >= ? ORDER BY user_id',
      3
    )
    // Alice 只有 2 笔出局；Bob、Carol 各 3 笔留下
    expect(rows).toEqual([
      { user_id: 2, n: 3 },
      { user_id: 3, n: 3 },
    ])
  })

  it('WHERE 与 HAVING 同现：先筛行、再分桶、后筛组，各司其职', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    // 只统计已支付：1 笔 300（Alice）、2 笔 1290（Bob）、2 笔 620（Carol）；再筛掉合计不足 700 的组
    const rows = db.all<{ user_id: number; n: number; total: number }>(
      `SELECT user_id, COUNT(*) AS n, SUM(amount) AS total
       FROM orders
       WHERE status = 'paid'
       GROUP BY user_id
       HAVING SUM(amount) > 700
       ORDER BY user_id`
    )
    expect(rows).toEqual([{ user_id: 2, n: 2, total: 1290 }])
  })

  it('把筛组条件塞进 WHERE：数据库直接拒绝，不给错误答案', () => {
    const db = createDb()
    seedUsers(db)
    seedOrders(db)
    expect(() =>
      db.all(
        `SELECT user_id, SUM(amount) AS total
         FROM orders
         WHERE status = 'paid' AND SUM(amount) > 700
         GROUP BY user_id`
      )
    ).toThrow(/misuse of aggregate/)
  })
})
