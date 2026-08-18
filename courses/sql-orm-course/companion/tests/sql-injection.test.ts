// tests/sql-injection.test.ts —— 第 8 章：SQL 注入复现与参数化防御
import { describe, it, expect } from 'vitest'
import { createDb, type Db } from '../src/db'

type User = { id: number; name: string; password: string }

/** 3 个账号：本章断言全靠这组数据可手算 */
function seedUsers(db: Db): void {
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL
    );
  `)
  const rows: [string, string][] = [
    ['admin', 'S3cret!'],
    ['alice', 'alice-pass'],
    ['bob', 'bob-pass'],
  ]
  for (const [name, password] of rows) {
    db.run('INSERT INTO users (name, password) VALUES (?, ?)', name, password)
  }
}

/** 拼接版登录：把用户输入直接拼进 SQL 字符串——本章的反面教材 */
function loginConcat(db: Db, name: string, password: string): User | undefined {
  const sql = `SELECT id, name, password FROM users WHERE name = '${name}' AND password = '${password}'`
  return db.get<User>(sql)
}

/** 参数化版登录：SQL 模板挖好 ?，用户输入单独走参数通道 */
function loginParameterized(db: Db, name: string, password: string): User | undefined {
  return db.get<User>(
    'SELECT id, name, password FROM users WHERE name = ? AND password = ?',
    name,
    password
  )
}

/** 拼接版搜索：同样把输入拼进 WHERE 的 name 条件 */
function searchConcat(db: Db, keyword: string): { id: number; name: string }[] {
  const sql = `SELECT id, name FROM users WHERE name = '${keyword}'`
  return db.all<{ id: number; name: string }>(sql)
}

/** 参数化版搜索：同一句 SQL，? 挖空、输入走参数 */
function searchParameterized(db: Db, keyword: string): { id: number; name: string }[] {
  return db.all<{ id: number; name: string }>('SELECT id, name FROM users WHERE name = ?', keyword)
}

describe('SQL 注入：拼接版复现、参数化版防御', () => {
  it('正常输入下拼接版行为正常——漏洞藏在 Happy Path 之外', () => {
    const db = createDb()
    seedUsers(db)
    expect(loginConcat(db, 'alice', 'alice-pass')?.name).toBe('alice')
    expect(loginConcat(db, 'alice', '猜错的密码')).toBeUndefined()
  })

  it("payload admin' --：拼接版注释掉密码检查登进管理员，参数化版查 0 行", () => {
    const db = createDb()
    seedUsers(db)
    // 密码明明是错的，拼接版却返回了 admin 那一行——攻击得手
    expect(loginConcat(db, "admin' --", '随便填的密码')).toEqual({ id: 1, name: 'admin', password: 'S3cret!' })
    // 同一 payload 走参数化：整串只是 name 的比对值，一个用户都不匹配
    expect(loginParameterized(db, "admin' --", '随便填的密码')).toBeUndefined()
  })

  it("payload ' OR '1'='1：拼接版 WHERE 恒真倒出全表，参数化版 0 行", () => {
    const db = createDb()
    seedUsers(db)
    // name = '' OR '1'='1'：后半恒真，WHERE 对每一行都放行 → 3 行全漏
    expect(searchConcat(db, "' OR '1'='1")).toHaveLength(3)
    // 参数化版拿整串去比对 name 列，没有人的名字长这样 → 0 行
    expect(searchParameterized(db, "' OR '1'='1")).toEqual([])
  })

  it('payload UNION：拼接版把密码列搬进结果集，参数化版 0 行', () => {
    const db = createDb()
    seedUsers(db)
    // 第二个 SELECT 的 password 列顶替了 name 列的位置——密码被整列拖走
    const dumped = searchConcat(db, "x' UNION SELECT id, password FROM users --")
    expect(dumped).toContainEqual({ id: 1, name: 'S3cret!' })
    expect(dumped).toHaveLength(3)
    expect(searchParameterized(db, "x' UNION SELECT id, password FROM users --")).toEqual([])
  })

  it("payload '; DROP TABLE users; --：run 走 prepare 只编译一句，注入的第二句从未执行", () => {
    const db = createDb()
    seedUsers(db)
    // 经典梗照进现实：run/all/get 底层是 prepare，SQLite 只编译第一条语句
    expect(() => loginConcat(db, "x'; DROP TABLE users; --", '随便填的密码')).not.toThrow()
    const count = db.all<User>('SELECT id FROM users')
    expect(count).toHaveLength(3)
    expect(loginParameterized(db, "x'; DROP TABLE users; --", '随便填的密码')).toBeUndefined()
    const stillThere = db.all<User>('SELECT id FROM users')
    expect(stillThere).toHaveLength(3)
  })

  it('参数化把 payload 变成普通数据：整串原样入库、原样查回', () => {
    const db = createDb()
    seedUsers(db)
    // payload 也只是一段名字：参数化插入不会执行任何 SQL
    db.run('INSERT INTO users (name, password) VALUES (?, ?)', "admin' --", '正常注册的密码')
    const row = db.get<User>('SELECT id, name, password FROM users WHERE name = ?', "admin' --")
    expect(row?.password).toBe('正常注册的密码')
    // 表没有被任何 payload 动过：还是 3 + 1 行
    expect(db.all<User>('SELECT id FROM users')).toHaveLength(4)
  })
})
