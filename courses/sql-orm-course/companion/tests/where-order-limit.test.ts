// tests/where-order-limit.test.ts —— 第 2 章：WHERE、排序、分页与 NULL 三值逻辑
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type Order = { id: number; buyer: string; status: string; amount: number; note: string | null }

/** 7 笔订单：金额有两笔并列、note 有四行为空——本章断言全靠这组数据可手算 */
function seedOrders(db: Db): void {
  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      buyer TEXT NOT NULL,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      note TEXT
    );
  `)
  const rows: [string, string, number, string | null][] = [
    ['Alice', 'paid', 1200, '加急'],
    ['Bob', 'pending', 300, null],
    ['Carol', 'paid', 750, '发票已开'],
    ['Dave', 'refunded', 300, null],
    ['Eve', 'paid', 300, null],
    ['Frank', 'pending', 90, '电话催付'],
    ['Grace', 'paid', 1200, null],
  ]
  for (const [buyer, status, amount, note] of rows) {
    db.run('INSERT INTO orders (buyer, status, amount, note) VALUES (?, ?, ?, ?)', buyer, status, amount, note)
  }
}

describe('WHERE、排序与分页', () => {
  it('比较运算与 AND/OR：条件组合锁行', () => {
    const db = createDb()
    seedOrders(db)
    const paidBig = db.all<Order>(
      'SELECT id FROM orders WHERE status = ? AND amount >= ? ORDER BY id',
      'paid',
      300
    )
    expect(paidBig.map((r) => r.id)).toEqual([1, 3, 5, 7])
    const either = db.all<Order>(
      "SELECT id FROM orders WHERE status = 'refunded' OR amount > 1000 ORDER BY id"
    )
    expect(either.map((r) => r.id)).toEqual([1, 4, 7])
  })

  it('IN 等价一串 OR，BETWEEN 是闭区间（两端都算数）', () => {
    const db = createDb()
    seedOrders(db)
    const inList = db.all<Order>(
      "SELECT id FROM orders WHERE status IN ('paid', 'refunded') ORDER BY id"
    )
    expect(inList.map((r) => r.id)).toEqual([1, 3, 4, 5, 7])
    const between = db.all<Order>(
      'SELECT id FROM orders WHERE amount BETWEEN 300 AND 750 ORDER BY id'
    )
    expect(between.map((r) => r.id)).toEqual([2, 3, 4, 5])
  })

  it('LIKE 模糊匹配：% 任意长度的任意内容，_ 恰好一个字符', () => {
    const db = createDb()
    seedOrders(db)
    const aPrefix = db.all<Order>("SELECT buyer FROM orders WHERE buyer LIKE 'A%'")
    expect(aPrefix.map((r) => r.buyer)).toEqual(['Alice'])
    const three = db.all<Order>("SELECT buyer FROM orders WHERE buyer LIKE '_ob'")
    expect(three.map((r) => r.buyer)).toEqual(['Bob'])
    const fuzzy = db.all<Order>("SELECT id FROM orders WHERE note LIKE '%发票%' ORDER BY id")
    expect(fuzzy.map((r) => r.id)).toEqual([3])
  })

  it('ORDER BY 多列与方向：先按金额降序，并列时 id 小的在前', () => {
    const db = createDb()
    seedOrders(db)
    const rows = db.all<Order>('SELECT id FROM orders ORDER BY amount DESC, id ASC')
    expect(rows.map((r) => r.id)).toEqual([1, 7, 3, 2, 4, 5, 6])
  })

  it('LIMIT/OFFSET 分页：每页 3 行，翻页结果正确', () => {
    const db = createDb()
    seedOrders(db)
    const pageSize = 3
    const page = (n: number) =>
      db.all<Order>(
        'SELECT id FROM orders ORDER BY amount DESC, id ASC LIMIT ? OFFSET ?',
        pageSize,
        (n - 1) * pageSize
      )
    expect(page(1).map((r) => r.id)).toEqual([1, 7, 3])
    expect(page(2).map((r) => r.id)).toEqual([2, 4, 5])
    expect(page(3).map((r) => r.id)).toEqual([6])
    expect(page(4)).toEqual([])
  })

  it('= NULL 查不出空值行，IS NULL 才查得出', () => {
    const db = createDb()
    seedOrders(db)
    // 直觉写法：note = NULL 比较结果是「未知」，WHERE 只放行为真的行 → 0 行
    const eqNull = db.all<Order>('SELECT id FROM orders WHERE note = NULL ORDER BY id')
    expect(eqNull).toEqual([])
    const isNull = db.all<Order>('SELECT id FROM orders WHERE note IS NULL ORDER BY id')
    expect(isNull.map((r) => r.id)).toEqual([2, 4, 5, 7])
  })

  it('三值逻辑：note 为空的行连 NOT (note = ?) 也查不出', () => {
    const db = createDb()
    seedOrders(db)
    const negated = db.all<Order>(
      "SELECT id FROM orders WHERE NOT (note = '加急') ORDER BY id"
    )
    // 行 1 为真取反出局；行 3、6 为假取反入选；NULL 行取反仍是未知，同样进不来
    expect(negated.map((r) => r.id)).toEqual([3, 6])
  })
})
