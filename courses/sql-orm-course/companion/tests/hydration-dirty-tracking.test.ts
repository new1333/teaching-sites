// tests/hydration-dirty-tracking.test.ts —— 第 11 章：行水合成实例，save 只写脏列
import { describe, it, expect } from 'vitest'
import { createDb, type Db, type SqlValue } from '../src/db'
import { defineTable, type Table } from '../src/schema'
import { Row } from '../src/table'

/** 一条 SQL 的账：文本加按序参数——save 发没发、发了什么，全靠它对证 */
interface SqlLogEntry {
  sql: string
  params: SqlValue[]
}

/** 给 Db 包一层记账皮：run/all/get 原样透传，但每条 SQL 与参数按序记进 log（exec 不记，DDL 不算数） */
function withSqlLog(inner: Db): { db: Db; log: SqlLogEntry[] } {
  const log: SqlLogEntry[] = []
  const db: Db = {
    exec(sql) {
      inner.exec(sql)
    },
    run(sql, ...params) {
      log.push({ sql, params })
      return inner.run(sql, ...params)
    },
    all(sql, ...params) {
      log.push({ sql, params })
      return inner.all(sql, ...params)
    },
    get(sql, ...params) {
      log.push({ sql, params })
      return inner.get(sql, ...params)
    },
  }
  return { db, log }
}

/** 从 log 里挑出以某词开头的 SQL 账（INSERT/UPDATE/DELETE/SELECT 各自数各自对） */
function statements(log: SqlLogEntry[], keyword: string): SqlLogEntry[] {
  return log.filter((entry) => entry.sql.startsWith(keyword))
}

/** 第 11 章的 users 表结构：带默认值的 nickname 专给「水合回填默认值」看，age 给「只改一列」看 */
function usersColumns() {
  return {
    id: { type: 'integer' as const, primaryKey: true },
    name: { type: 'text' as const, notNull: true },
    email: { type: 'text' as const, notNull: true, unique: true },
    nickname: { type: 'text' as const, default: '暂无昵称' },
    age: { type: 'integer' as const },
  }
}

/** 建表并插 alice、bob 两行种子 */
function seedUsers(db: Db): Table {
  const users = defineTable(db, 'users', usersColumns())
  users.create({ name: 'alice', email: 'alice@example.com', age: 30 })
  users.create({ name: 'bob', email: 'bob@example.com', age: 24 })
  return users
}

describe('create：插入并水合，裸行装进带方法的实例', () => {
  it('返回的实例数据与方法都在身上，id 是数据库发的号', () => {
    const db = createDb()
    const users = seedUsers(db)
    const carol = users.create({ name: 'carol', email: 'carol@example.com', age: 35 })
    expect(carol).toBeInstanceOf(Row)
    expect(carol.name).toBe('carol')
    expect(carol.age).toBe(35)
    expect(typeof carol.save).toBe('function')
    expect(typeof carol.remove).toBe('function')
    // id 没给，INTEGER PRIMARY KEY 自动发号（第 3 章结论），回查水合把它带回来
    expect(carol.id).toBe(3)
  })

  it('水合走回查：没给的 nickname 从表定义里带回默认值，实例与库完全一致', () => {
    const db = createDb()
    const users = defineTable(db, 'users', usersColumns())
    const alice = users.create({ name: 'alice', email: 'alice@example.com', age: 30 })
    expect(alice.nickname).toBe('暂无昵称')
    const raw = db.get<Record<string, SqlValue>>('SELECT * FROM users WHERE id = ?', 1)
    expect(raw).toEqual({ id: 1, name: 'alice', email: 'alice@example.com', nickname: '暂无昵称', age: 30 })
  })

  it('发出的 SQL 是两条：参数化 INSERT + 按主键回查 SELECT', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    users.create({ name: 'carol', email: 'carol@example.com', age: 35 })
    const inserts = statements(log, 'INSERT')
    expect(inserts.at(-1)).toEqual({
      sql: 'INSERT INTO users (name, email, age) VALUES (?, ?, ?)',
      params: ['carol', 'carol@example.com', 35],
    })
    const lookups = log.filter((entry) => entry.sql.includes('WHERE id = ?'))
    expect(lookups.at(-1)).toEqual({
      sql: 'SELECT id, name, email, nickname, age FROM users WHERE id = ?',
      params: [3],
    })
  })

  it('schema 之外的列当场抛中文错误，空对象也过不了门', () => {
    const db = createDb()
    const users = seedUsers(db)
    expect(() => users.create({ name: 'x', email: 'x@example.com', hobby: '篮球' })).toThrowError(
      /未知列.*hobby/
    )
    expect(() => users.create({})).toThrowError(/至少给一列/)
  })
})

describe('find：主键取行，同样水合', () => {
  it('find(1) 回来的是带方法的实例，字段与库一致；不存在的 id 得 undefined', () => {
    const db = createDb()
    const users = seedUsers(db)
    const found = users.find(1)
    expect(found).toBeInstanceOf(Row)
    expect(found?.name).toBe('alice')
    expect(found?.age).toBe(30)
    expect(found?.nickname).toBe('暂无昵称')
    expect(users.find(999)).toBeUndefined()
  })
})

describe('脏跟踪：save 只写改过的列', () => {
  it('改一列：UPDATE 的 SET 只含该列，值走参数、WHERE 用主键', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const alice = users.find(1)
    alice!.nickname = '管理员改的'
    alice!.save()
    const updates = statements(log, 'UPDATE')
    expect(updates).toHaveLength(1)
    expect(updates[0]).toEqual({
      sql: 'UPDATE users SET nickname = ? WHERE id = ?',
      params: ['管理员改的', 1],
    })
    expect(db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', 1)).toEqual({
      nickname: '管理员改的',
    })
  })

  it('改两列：SET 按列定义序叠加，params 一一对应', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const bob = users.find(2)
    bob!.nickname = 'B 酱'
    bob!.age = 25
    bob!.save()
    expect(statements(log, 'UPDATE')[0]).toEqual({
      sql: 'UPDATE users SET nickname = ?, age = ? WHERE id = ?',
      params: ['B 酱', 25, 2],
    })
    expect(db.get<{ nickname: string; age: number }>('SELECT nickname, age FROM users WHERE id = ?', 2)).toEqual({
      nickname: 'B 酱',
      age: 25,
    })
  })

  it('干净实例 save：一条 UPDATE 都不发（SQL 计数为 0）', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedUsers(wrapped.db)
    const alice = users.find(1)
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(0)
    alice!.save()
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(0)
  })

  it('dirtyColumns 的账：装进来时为空，改一列长一列，save 后清零（快照刷新）', () => {
    const db = createDb()
    const users = seedUsers(db)
    const alice = users.find(1)!
    expect(alice.dirtyColumns()).toEqual([])
    alice.age = 31
    expect(alice.dirtyColumns()).toEqual(['age'])
    alice.save()
    expect(alice.dirtyColumns()).toEqual([])
  })

  it('save 之后快照已刷新：紧接着再 save 一次，还是一条 UPDATE 都不发', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedUsers(wrapped.db)
    const alice = users.find(1)!
    alice.nickname = '第一次'
    alice.save()
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(1)
    alice.save()
    expect(statements(wrapped.log, 'UPDATE')).toHaveLength(1)
  })
})

describe('丢更新：脏跟踪是缓解，不是根治', () => {
  it('两个实例各改各的列：没动过的列不再覆盖别人的写入', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const a = users.find(1)!
    const b = users.find(1)! // b 在 a 保存之前取的行，身上是旧数据
    a.nickname = '客服备注：已退款'
    a.save()
    b.age = 40
    b.save()
    // b 只改了 age：SET 里只有 age，a 刚写的 nickname 没被拖下水
    expect(statements(log, 'UPDATE').at(-1)).toEqual({
      sql: 'UPDATE users SET age = ? WHERE id = ?',
      params: [40, 1],
    })
    expect(db.get<{ nickname: string; age: number }>('SELECT nickname, age FROM users WHERE id = ?', 1)).toEqual({
      nickname: '客服备注：已退款',
      age: 40,
    })
  })

  it('两个实例改同一列：后保存的照样赢——丢更新仍在，根治要乐观锁（本课程不做，登记差异清单）', () => {
    const db = createDb()
    const users = seedUsers(db)
    const a = users.find(1)!
    const b = users.find(1)!
    a.nickname = 'A 的版本'
    a.save()
    b.nickname = 'B 的版本'
    b.save()
    expect(db.get<{ nickname: string }>('SELECT nickname FROM users WHERE id = ?', 1)).toEqual({
      nickname: 'B 的版本',
    })
  })
})

describe('remove 与实例生命周期', () => {
  it('remove 发参数化 DELETE，行真的没了', () => {
    const { db, log } = withSqlLog(createDb())
    const users = seedUsers(db)
    const alice = users.find(1)!
    alice.remove()
    expect(statements(log, 'DELETE')).toEqual([
      { sql: 'DELETE FROM users WHERE id = ?', params: [1] },
    ])
    expect(db.get('SELECT id FROM users WHERE id = ?', 1)).toBeUndefined()
    expect(users.find(1)).toBeUndefined()
  })

  it('删除后的实例再 save/remove 抛中文错误，不静默装作没事', () => {
    const db = createDb()
    const users = seedUsers(db)
    const alice = users.find(1)!
    alice.remove()
    alice.nickname = '死而复生'
    expect(() => alice.save()).toThrowError(/已经 remove/)
    expect(() => alice.remove()).toThrowError(/已经 remove/)
  })
})

describe('主键是一切定位的前提', () => {
  it('没有主键的表，find 当场报中文错误', () => {
    const db = createDb()
    const notes = defineTable(db, 'notes', { content: { type: 'text', notNull: true } })
    expect(() => notes.find(1)).toThrowError(/主键/)
  })
})
