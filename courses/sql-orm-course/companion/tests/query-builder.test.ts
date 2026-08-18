// tests/query-builder.test.ts —— 第 10 章：链式调用攒条件，toSQL() 编译成参数化 SELECT
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'
import { defineTable, type Table } from '../src/schema'
import type { Operator } from '../src/builder'

/** 第 10 章的 users 表：六行种子数据，筛选/排序/分页结果全可手算 */
function seedUsers(db: Db): Table {
  const users = defineTable(db, 'users', {
    id: { type: 'integer', primaryKey: true },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true, unique: true },
    age: { type: 'integer' },
  })
  const rows: [string, string, number][] = [
    ['alice', 'alice@example.com', 30],
    ['bob', 'bob@example.com', 24],
    ['carol', 'carol@example.com', 35],
    ['dave', 'dave@example.com', 18],
    ['eve', 'eve@example.com', 27],
    ['frank', 'frank@example.com', 41],
  ]
  for (const [name, email, age] of rows) {
    db.run('INSERT INTO users (name, email, age) VALUES (?, ?, ?)', name, email, age)
  }
  return users
}

/** 动态筛选样本：条件有无只改变攒下的账，不碰任何字符串拼接 */
function buildQuery(users: Table, filters: { minAge?: number; nameLike?: string }) {
  let q = users.query()
  if (filters.minAge !== undefined) q = q.where('age', '>=', filters.minAge)
  if (filters.nameLike !== undefined) q = q.where('name', 'LIKE', filters.nameLike)
  return q.orderBy('id', 'asc')
}

describe('toSQL()：把攒下的账编译成 SQL 文本与参数数组', () => {
  it('无条件时输出全表 SELECT，params 为空数组', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(users.query().toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users',
      params: [],
    })
  })

  it('单条件：列名与操作符进 SQL 文本，值进 params', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(users.query().where('age', '>', 18).toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users WHERE age > ?',
      params: [18],
    })
  })

  it('全链：两个 where 按 AND 叠加，LIKE、orderBy、limit、offset 各就各位', () => {
    const db = createDb()
    const users = seedUsers(db)
    const built = users
      .query()
      .where('age', '>=', 18)
      .where('name', 'LIKE', '%o%')
      .orderBy('age', 'desc')
      .limit(2)
      .offset(1)
    expect(built.toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users WHERE age >= ? AND name LIKE ? ORDER BY age DESC LIMIT ? OFFSET ?',
      params: [18, '%o%', 2, 1],
    })
  })

  it('七个操作符全部认得，各自翻成对应的 SQL 片段', () => {
    const db = createDb()
    const users = seedUsers(db)
    const ops: Operator[] = ['=', '!=', '>', '<', '>=', '<=', 'LIKE']
    for (const op of ops) {
      expect(users.query().where('age', op, 1).toSQL().sql).toBe(
        `SELECT id, name, email, age FROM users WHERE age ${op} ?`
      )
    }
  })

  it('只 limit 不 offset：成对编译，缺省的 OFFSET 补 0', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(users.query().limit(2).toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users LIMIT ? OFFSET ?',
      params: [2, 0],
    })
  })

  it('只 offset 不 limit：LIMIT 补 -1（SQLite 语义：负 LIMIT 不设上界）', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(users.query().offset(2).toSQL()).toEqual({
      sql: 'SELECT id, name, email, age FROM users LIMIT ? OFFSET ?',
      params: [-1, 2],
    })
  })
})

describe('白名单：标识符进 SQL 文本前的关卡', () => {
  it('未知操作符在 where 当场抛中文错误，不静默吞掉', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(() =>
      users.query().where('name', '~~' as unknown as Operator, 'x')
    ).toThrowError(/未知操作符.*~~/)
  })

  it('未知列被 schema 的列清单拦下：where 与 orderBy 都要过这道关', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(() => users.query().where('hobby', '=', 'x')).toThrowError(/未知列.*hobby/)
    expect(() => users.query().orderBy('hobby', 'asc')).toThrowError(/未知列.*hobby/)
  })
})

describe('all()/get()：编译完直接查库，与手写 SQL 同构等价', () => {
  it('筛选+排序+分页的结果可手算：age > 18 降序取第 2-3 名是 carol、alice', () => {
    const db = createDb()
    const users = seedUsers(db)
    const rows = users
      .query()
      .where('age', '>', 18)
      .orderBy('age', 'desc')
      .limit(2)
      .offset(1)
      .all()
    expect(rows.map((row) => row.id)).toEqual([3, 1])
  })

  it('双向验证：生成的 SQL 文本与手写 SELECT 逐字一致，两边跑库结果也一致', () => {
    const db = createDb()
    const users = seedUsers(db)
    const handwritten =
      'SELECT id, name, email, age FROM users WHERE age > ? ORDER BY age DESC LIMIT ? OFFSET ?'
    const built = users.query().where('age', '>', 18).orderBy('age', 'desc').limit(2).offset(1)
    expect(built.toSQL().sql).toBe(handwritten)
    expect(built.all()).toEqual(db.all(handwritten, 18, 2, 1))
  })

  it('LIKE 的通配符走参数：名字含 o 的是 bob、carol', () => {
    const db = createDb()
    const users = seedUsers(db)
    const rows = users.query().where('name', 'LIKE', '%o%').orderBy('id', 'asc').all()
    expect(rows.map((row) => row.name)).toEqual(['bob', 'carol'])
  })

  it('get() 取一行：命中返回该行，不命中返回 undefined', () => {
    const db = createDb()
    const users = seedUsers(db)
    const hit = users.query().where('email', '=', 'alice@example.com').get()
    expect(hit).toEqual({ id: 1, name: 'alice', email: 'alice@example.com', age: 30 })
    expect(users.query().where('email', '=', 'nobody@example.com').get()).toBeUndefined()
  })

  it('动态条件：条件有无只影响攒下的账——空筛选 6 行、加 minAge 剩 4 行、再加 nameLike 剩 3 行', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(buildQuery(users, {}).all()).toHaveLength(6)
    expect(buildQuery(users, { minAge: 26 }).all().map((row) => row.id)).toEqual([1, 3, 5, 6])
    expect(
      buildQuery(users, { minAge: 26, nameLike: '%a%' }).all().map((row) => row.id)
    ).toEqual([1, 3, 6])
  })
})
