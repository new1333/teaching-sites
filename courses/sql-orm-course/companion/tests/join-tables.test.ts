// tests/join-tables.test.ts —— 第 5 章：JOIN、INNER 与 LEFT 的语义差、表别名与链式 JOIN
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type User = { id: number; name: string }
type Product = { id: number; name: string; price: number }
type Order = { id: number; user_id: number; product_id: number; amount: number }

/** 4 位用户、3 种商品、4 笔订单：Alice 1 笔、Bob 2 笔、Carol 1 笔、Dave 0 笔——Dave 是 LEFT JOIN 一切断言的支点 */
function seed(db: Db): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price INTEGER NOT NULL
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      amount INTEGER NOT NULL
    );
  `)
  const users: [string][] = [['Alice'], ['Bob'], ['Carol'], ['Dave']]
  for (const [name] of users) {
    db.run('INSERT INTO users (name) VALUES (?)', name)
  }
  const products: [string, number][] = [
    ['键盘', 300],
    ['显示器', 1200],
    ['鼠标', 90],
  ]
  for (const [name, price] of products) {
    db.run('INSERT INTO products (name, price) VALUES (?, ?)', name, price)
  }
  // 成交价 amount 可以不等于标价：Carol 的键盘 150 成交——ON 与 WHERE 的分工演算靠这 4 笔可手数
  const orders: [number, number, number][] = [
    [1, 1, 300],
    [2, 2, 1200],
    [2, 3, 90],
    [3, 1, 150],
  ]
  for (const [user_id, product_id, amount] of orders) {
    db.run('INSERT INTO orders (user_id, product_id, amount) VALUES (?, ?, ?)', user_id, product_id, amount)
  }
}

describe('INNER JOIN：按连接条件配对，只留两边都有的行', () => {
  it('与手写双重循环按 userId 匹配的结果逐行一致，一对多时左行跟着出现两次', () => {
    const db = createDb()
    seed(db)
    const bySql = db.all<{ user_id: number; user_name: string; order_id: number }>(
      `SELECT u.id AS user_id, u.name AS user_name, o.id AS order_id
       FROM users u
       INNER JOIN orders o ON u.id = o.user_id
       ORDER BY u.id, o.id`
    )
    // 双重循环直觉版：外层订单、内层用户，user_id 对上号就拼一行——JOIN 在数据库里干的就是这个匹配
    const users = db.all<User>('SELECT id, name FROM users')
    const orders = db.all<Order>('SELECT id, user_id FROM orders')
    const byLoop: { user_id: number; user_name: string; order_id: number }[] = []
    for (const o of orders) {
      for (const u of users) {
        if (u.id === o.user_id) {
          byLoop.push({ user_id: u.id, user_name: u.name, order_id: o.id })
        }
      }
    }
    byLoop.sort((a, b) => a.user_id - b.user_id || a.order_id - b.order_id)
    expect(bySql).toEqual(byLoop)
    // Bob 有两笔订单，结果里就出现两次——JOIN 是配对，不是合并
    expect(bySql.filter((r) => r.user_name === 'Bob')).toHaveLength(2)
  })

  it('只留两边都有的行：没有订单的 Dave 不出现在结果里', () => {
    const db = createDb()
    seed(db)
    const rows = db.all<{ name: string }>(
      `SELECT u.name AS name
       FROM users u
       INNER JOIN orders o ON u.id = o.user_id
       ORDER BY u.id, o.id`
    )
    // Alice 1 行、Bob 2 行、Carol 1 行；Dave 配不上对，整行出局
    expect(rows.map((r) => r.name)).toEqual(['Alice', 'Bob', 'Bob', 'Carol'])
  })
})

describe('LEFT JOIN：保左表全量，配不上就补 NULL', () => {
  it('同一数据集：LEFT JOIN 行数 ≥ INNER JOIN 行数，差额正是无订单的用户数', () => {
    const db = createDb()
    seed(db)
    const inner = db.all('SELECT u.id FROM users u INNER JOIN orders o ON u.id = o.user_id')
    const left = db.all('SELECT u.id FROM users u LEFT JOIN orders o ON u.id = o.user_id')
    // 双重循环直觉版曾断言两数相等，实跑 5 对 4 见红：LEFT 保左表全量，Dave 多出一行
    expect(left.length).toBeGreaterThanOrEqual(inner.length)
    const orderUsers = new Set(db.all<Order>('SELECT user_id FROM orders').map((r) => r.user_id))
    const userless = db.all<User>('SELECT id FROM users').filter((u) => !orderUsers.has(u.id))
    expect(left.length - inner.length).toBe(userless.length)
  })

  it('配不上的行不丢：Dave 那一行右表的列全是 NULL——NULL 从「配不上」来，不是表里存的', () => {
    const db = createDb()
    seed(db)
    const dave = db.get<{
      name: string
      order_id: number | null
      product_id: number | null
      amount: number | null
    }>(
      `SELECT u.name AS name, o.id AS order_id, o.product_id AS product_id, o.amount AS amount
       FROM users u
       LEFT JOIN orders o ON u.id = o.user_id
       WHERE u.name = 'Dave'`
    )
    expect(dave).toEqual({ name: 'Dave', order_id: null, product_id: null, amount: null })
  })
})

describe('表别名与三表链式 JOIN', () => {
  it('u./p. 前缀消歧加 AS 起输出名：一行同时拿到用户名、商品名、标价与成交价', () => {
    const db = createDb()
    seed(db)
    const rows = db.all<{ user_name: string; product_name: string; price: number; amount: number }>(
      `SELECT u.name AS user_name, p.name AS product_name, p.price AS price, o.amount AS amount
       FROM users u
       INNER JOIN orders o ON u.id = o.user_id
       INNER JOIN products p ON o.product_id = p.id
       ORDER BY o.id`
    )
    expect(rows).toEqual([
      { user_name: 'Alice', product_name: '键盘', price: 300, amount: 300 },
      { user_name: 'Bob', product_name: '显示器', price: 1200, amount: 1200 },
      { user_name: 'Bob', product_name: '鼠标', price: 90, amount: 90 },
      { user_name: 'Carol', product_name: '键盘', price: 300, amount: 150 },
    ])
  })

  it('两张表都有 name 列：裸写 name，数据库直接报 ambiguous column name', () => {
    const db = createDb()
    seed(db)
    expect(() =>
      db.all(
        `SELECT name
         FROM users u
         INNER JOIN orders o ON u.id = o.user_id
         INNER JOIN products p ON o.product_id = p.id`
      )
    ).toThrow(/ambiguous column name/)
  })

  it('链式 LEFT JOIN：Dave 一路保住，两段右表的列都是 NULL，全表恰为订单数加一', () => {
    const db = createDb()
    seed(db)
    const rows = db.all<{ name: string; order_id: number | null; product_name: string | null }>(
      `SELECT u.name AS name, o.id AS order_id, p.name AS product_name
       FROM users u
       LEFT JOIN orders o ON u.id = o.user_id
       LEFT JOIN products p ON o.product_id = p.id`
    )
    expect(rows).toHaveLength(5)
    const dave = rows.find((r) => r.name === 'Dave')
    expect(dave).toEqual({ name: 'Dave', order_id: null, product_name: null })
  })
})

describe('ON 与 WHERE 的分工：LEFT JOIN 下不是一回事', () => {
  it('对右表的条件写进 ON：只是不许配对，左行还在——Carol 与 Dave 都换成 NULL 行', () => {
    const db = createDb()
    seed(db)
    const rows = db.all<{ name: string; order_id: number | null; amount: number | null }>(
      `SELECT u.name AS name, o.id AS order_id, o.amount AS amount
       FROM users u
       LEFT JOIN orders o ON u.id = o.user_id AND o.amount >= 300
       ORDER BY u.id, o.id`
    )
    // 配上对的只有 Alice(300)、Bob(1200)；Bob 的 90、Carol 的 150 配不上对但人在；Dave 本来就无单
    expect(rows).toEqual([
      { name: 'Alice', order_id: 1, amount: 300 },
      { name: 'Bob', order_id: 2, amount: 1200 },
      { name: 'Carol', order_id: null, amount: null },
      { name: 'Dave', order_id: null, amount: null },
    ])
  })

  it('同一条件写进 WHERE：先拼行再逐行筛，Carol 与 Dave 整行消失——LEFT 被打回 INNER', () => {
    const db = createDb()
    seed(db)
    const rows = db.all<{ name: string; order_id: number }>(
      `SELECT u.name AS name, o.id AS order_id
       FROM users u
       LEFT JOIN orders o ON u.id = o.user_id
       WHERE o.amount >= 300
       ORDER BY u.id, o.id`
    )
    // NULL >= 300 是未知（第 2 章）：Dave 的补 NULL 行出局；90 与 150 两行也出局
    expect(rows).toEqual([
      { name: 'Alice', order_id: 1 },
      { name: 'Bob', order_id: 2 },
    ])
  })
})
