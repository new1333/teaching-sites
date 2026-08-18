// tests/schema-to-ddl.test.ts —— 第 9 章：schema 对象编译成 CREATE TABLE
import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db'
import { generateCreateTableSql, defineTable, type ColumnDef } from '../src/schema'

/** 第 9 章的 users 表：三条约束一个默认值，DDL 文本可手写对齐 */
function usersColumns(): Record<string, ColumnDef> {
  return {
    id: { type: 'integer', primaryKey: true },
    name: { type: 'text', notNull: true },
    email: { type: 'text', notNull: true, unique: true },
    nickname: { type: 'text', default: '暂无昵称' },
  }
}

/** orders 表：外键指向 users.id，第 9 章的外键子句样本 */
function ordersColumns(): Record<string, ColumnDef> {
  return {
    id: { type: 'integer', primaryKey: true },
    user_id: { type: 'integer', notNull: true, references: { table: 'users', column: 'id' } },
    amount: { type: 'real' },
  }
}

describe('generateCreateTableSql：纯函数，columns 进、DDL 文本出', () => {
  it('类型与约束逐条翻译：integer/text 直译，PRIMARY KEY/NOT NULL/UNIQUE 各就各位', () => {
    expect(generateCreateTableSql('users', usersColumns())).toBe(`CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT DEFAULT '暂无昵称'
);`)
  })

  it('default 按值型决定引号：数字裸写、字符串加引号', () => {
    const sql = generateCreateTableSql('accounts', {
      id: { type: 'integer', primaryKey: true },
      balance: { type: 'real', default: 0 },
      currency: { type: 'text', default: 'CNY' },
    })
    expect(sql).toContain('balance REAL DEFAULT 0')
    expect(sql).toContain("currency TEXT DEFAULT 'CNY'")
  })

  it('references 翻译成 REFERENCES 表(列) 子句', () => {
    const sql = generateCreateTableSql('orders', ordersColumns())
    expect(sql).toContain('user_id INTEGER NOT NULL REFERENCES users(id)')
  })
})

describe('defineTable：生成 DDL、建表、返回表句柄', () => {
  it('返回的句柄携带 db、表名、列定义——后续章的方法都长在它身上', () => {
    const db = createDb()
    const users = defineTable(db, 'users', usersColumns())
    expect(users.name).toBe('users')
    expect(Object.keys(users.columns)).toEqual(['id', 'name', 'email', 'nickname'])
    expect(users.db).toBe(db)
  })

  it('表真的建出来了：默认值兑现，NOT NULL 与 UNIQUE 拦下坏数据', () => {
    const db = createDb()
    defineTable(db, 'users', usersColumns())
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'alice', 'alice@example.com')
    // nickname 没给值，DEFAULT 顶上
    const row = db.get<{ name: string; nickname: string }>(
      'SELECT name, nickname FROM users WHERE name = ?',
      'alice'
    )
    expect(row).toEqual({ name: 'alice', nickname: '暂无昵称' })
    // NOT NULL 守门：缺 name 的行进不来
    expect(() => db.run('INSERT INTO users (email) VALUES (?)', 'bob@example.com')).toThrow()
    // UNIQUE 守门：第二个同邮箱也进不来
    expect(() =>
      db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'bob', 'alice@example.com')
    ).toThrow()
  })

  it('外键表建表后 PRAGMA 约束真的生效：孤儿订单被拦、合法的能插', () => {
    const db = createDb()
    defineTable(db, 'users', usersColumns())
    defineTable(db, 'orders', ordersColumns())
    // user_id 999 在 users 里不存在——外键拦下
    expect(() => db.run('INSERT INTO orders (user_id, amount) VALUES (?, ?)', 999, 9.9)).toThrow()
    // 先立合法用户再下单：放行
    db.run('INSERT INTO users (name, email) VALUES (?, ?)', 'alice', 'alice@example.com')
    const result = db.run('INSERT INTO orders (user_id, amount) VALUES (?, ?)', 1, 9.9)
    expect(result.changes).toBe(1)
  })

  it('未知列类型抛中文错误，不静默吞掉', () => {
    const db = createDb()
    const badColumns = { flag: { type: 'boolean' } as unknown as ColumnDef }
    expect(() => defineTable(db, 't', badColumns)).toThrowError(/未知列类型.*boolean/)
  })
})
