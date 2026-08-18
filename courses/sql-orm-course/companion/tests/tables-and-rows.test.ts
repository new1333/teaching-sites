// tests/tables-and-rows.test.ts —— 第 1 章：建表、插入、查询的最小闭环
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db'

describe('表、行与类型', () => {
  it('建 users 表、插 3 行，SELECT 查回的行与值逐列一致', () => {
    const db = createDb()
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        age INTEGER
      );
    `)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Alice', 'alice@example.com', 30)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Bob', 'bob@example.com', 25)
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', 'Carol', 'carol@example.com', 35)

    const rows = db.all<{ id: number; name: string; email: string; age: number }>(
      'SELECT id, name, email, age FROM users ORDER BY id'
    )
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ id: 1, name: 'Alice', email: 'alice@example.com', age: 30 })
    expect(rows[1]).toEqual({ id: 2, name: 'Bob', email: 'bob@example.com', age: 25 })
    expect(rows[2]).toEqual({ id: 3, name: 'Carol', email: 'carol@example.com', age: 35 })
  })

  it('run 返回 changes 与 lastInsertRowid，行号自增不复用', () => {
    const db = createDb()
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    const first = db.run('INSERT INTO users (name) VALUES (?)', 'Alice')
    const second = db.run('INSERT INTO users (name) VALUES (?)', 'Bob')
    expect(first.changes).toBe(1)
    expect(second.changes).toBe(1)
    expect(Number(second.lastInsertRowid)).toBe(2)
  })

  it('get 按 ? 占位符查单行，查不到时得到 undefined', () => {
    const db = createDb()
    db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
    db.run('INSERT INTO users (name) VALUES (?)', 'Alice')
    const hit = db.get<{ id: number; name: string }>('SELECT id, name FROM users WHERE name = ?', 'Alice')
    const miss = db.get<{ id: number; name: string }>('SELECT id, name FROM users WHERE name = ?', 'Nobody')
    expect(hit).toEqual({ id: 1, name: 'Alice' })
    expect(miss).toBeUndefined()
  })

  it('三种列类型各查回各的：TEXT 字符串、INTEGER 整数、REAL 小数', () => {
    const db = createDb()
    db.exec('CREATE TABLE goods (title TEXT, stock INTEGER, price REAL)')
    db.run('INSERT INTO goods (title, stock, price) VALUES (?, ?, ?)', '咖啡豆', 2, 49.5)
    const row = db.get<{ title: string; stock: number; price: number }>(
      'SELECT title, stock, price FROM goods'
    )
    expect(row?.title).toBe('咖啡豆')
    expect(row?.stock).toBe(2)
    expect(row?.price).toBe(49.5)
  })

  it('createDb 打开后外键开关默认是开的（PRAGMA foreign_keys = ON）', () => {
    const db = createDb()
    const pragma = db.get<{ foreign_keys: number }>('PRAGMA foreign_keys')
    expect(pragma?.foreign_keys).toBe(1)
  })
})
