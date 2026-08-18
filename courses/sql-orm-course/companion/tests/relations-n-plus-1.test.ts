// tests/relations-n-plus-1.test.ts —— 第 12 章：关联声明与 with() 两跳批量加载
import { describe, it, expect } from 'vitest'
import { createDb, type Db, type SqlValue } from '../src/db'
import { defineTable, type Table } from '../src/schema'
import { Row } from '../src/table'

/** 一条 SQL 的账：文本加按序参数——发了多少条、每条长什么样，全靠它对证 */
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

/** 从 log 里挑出以某词开头的 SQL 账 */
function statements(log: SqlLogEntry[], keyword: string): SqlLogEntry[] {
  return log.filter((entry) => entry.sql.startsWith(keyword))
}

/** 小数据集的种子：3 用户、4 订单（一笔不挂任何人）、2 条评价——分桶结果全可手算 */
function seedSmall(db: Db): { users: Table; orders: Table } {
  const users = defineTable(db, 'users', {
    id: { type: 'integer', primaryKey: true },
    name: { type: 'text', notNull: true },
  })
  const orders = defineTable(db, 'orders', {
    id: { type: 'integer', primaryKey: true },
    user_id: { type: 'integer', references: { table: 'users', column: 'id' } },
    total: { type: 'integer', notNull: true },
  })
  const reviews = defineTable(db, 'reviews', {
    id: { type: 'integer', primaryKey: true },
    user_id: { type: 'integer', references: { table: 'users', column: 'id' } },
    stars: { type: 'integer', notNull: true },
  })
  users.hasMany('orders', { table: orders, from: 'id', to: 'user_id' })
  users.hasMany('reviews', { table: reviews, from: 'id', to: 'user_id' })
  orders.belongsTo('user', { table: users, from: 'user_id', to: 'id' })
  const seeds: [string, SqlValue[]][] = [
    ['INSERT INTO users (id, name) VALUES (?, ?)', [1, 'alice']],
    ['INSERT INTO users (id, name) VALUES (?, ?)', [2, 'bob']],
    ['INSERT INTO users (id, name) VALUES (?, ?)', [3, 'carol']],
    ['INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)', [1, 1, 100]],
    ['INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)', [2, 1, 250]],
    ['INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)', [3, 3, 50]],
    ['INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)', [4, null, 30]],
    ['INSERT INTO reviews (id, user_id, stars) VALUES (?, ?, ?)', [1, 1, 5]],
    ['INSERT INTO reviews (id, user_id, stars) VALUES (?, ?, ?)', [2, 3, 4]],
  ]
  for (const [sql, params] of seeds) db.run(sql, ...params)
  return { users, orders }
}

/** 大数据集的种子：100 个用户、每人 1 笔订单——N+1 的数量演算用 */
function seedBig(db: Db): Table {
  const users = defineTable(db, 'users', {
    id: { type: 'integer', primaryKey: true },
    name: { type: 'text', notNull: true },
  })
  const orders = defineTable(db, 'orders', {
    id: { type: 'integer', primaryKey: true },
    user_id: { type: 'integer', references: { table: 'users', column: 'id' } },
    total: { type: 'integer', notNull: true },
  })
  users.hasMany('orders', { table: orders, from: 'id', to: 'user_id' })
  for (let i = 1; i <= 100; i++) {
    db.run('INSERT INTO users (id, name) VALUES (?, ?)', i, `user${i}`)
    db.run('INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)', i, i, i * 10)
  }
  return users
}

describe('声明：hasMany/belongsTo 把关联记在表句柄上', () => {
  it('注册表可查：kind、对方表、from/to 列各就各位', () => {
    const db = createDb()
    const { users, orders } = seedSmall(db)
    expect(users.relations['orders']).toMatchObject({
      kind: 'hasMany',
      table: orders,
      from: 'id',
      to: 'user_id',
    })
    expect(orders.relations['user']).toMatchObject({
      kind: 'belongsTo',
      table: users,
      from: 'user_id',
      to: 'id',
    })
  })

  it('守门员三连：同名重复、撞列名、未知列都当场抛中文错误', () => {
    const db = createDb()
    const { users, orders } = seedSmall(db)
    expect(() => users.hasMany('orders', { table: orders, from: 'id', to: 'user_id' })).toThrowError(
      /关联「orders」重复声明/
    )
    expect(() => users.hasMany('name', { table: orders, from: 'id', to: 'user_id' })).toThrowError(
      /关联名「name」.*列名/
    )
    expect(() => users.hasMany('gadgets', { table: orders, from: 'hobby', to: 'user_id' })).toThrowError(
      /未知列「hobby」/
    )
    expect(() => users.hasMany('gadgets', { table: orders, from: 'id', to: 'hobby' })).toThrowError(
      /未知列「hobby」/
    )
  })
})

describe('N+1 现场：循环里逐条查关联，100 用户发出 101 条 SELECT', () => {
  it('先查列表再逐行查关联：SELECT 计数 1 + 100 = 101', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedBig(wrapped.db)
    const list = users.query().all()
    expect(list).toHaveLength(100)
    // 「很自然」的写法：每个用户单独查一次订单——每条都不慢，慢在条数
    for (const user of list) {
      wrapped.db.all('SELECT id, user_id, total FROM orders WHERE user_id = ?', user.id)
    }
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(101)
  })
})

describe('两跳加载：with 一次批量补齐', () => {
  it('100 用户 with orders：总共 2 条 SELECT（1 条主查询 + 1 条 IN 批量查询）', () => {
    const wrapped = withSqlLog(createDb())
    const users = seedBig(wrapped.db)
    const list = users.query().with('orders').all<Row>()
    expect(list).toHaveLength(100)
    for (const user of list) {
      const orders = user.orders as Row[]
      expect(orders).toHaveLength(1)
      expect(orders[0].user_id).toBe(user.id)
    }
    const selects = statements(wrapped.log, 'SELECT')
    expect(selects).toHaveLength(2)
  })

  it('第二跳的 SQL 与参数：列名表名走注册表白名单，占位符按收集到的值个数生成', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    users.query().with('orders').all<Row>()
    const selects = statements(wrapped.log, 'SELECT')
    expect(selects[0]).toEqual({ sql: 'SELECT id, name FROM users', params: [] })
    expect(selects[1]).toEqual({
      sql: 'SELECT id, user_id, total FROM orders WHERE user_id IN (?, ?, ?)',
      params: [1, 2, 3],
    })
  })

  it('挂载的是水合实例：订单元素有 save/remove，bob 没订单得空数组', () => {
    const db = createDb()
    const { users } = seedSmall(db)
    const list = users.query().with('orders').all<Row>()
    const byId = new Map(list.map((user) => [user.id as number, user]))
    const aliceOrders = byId.get(1)!.orders as Row[]
    expect(aliceOrders).toHaveLength(2)
    expect(aliceOrders[0]).toBeInstanceOf(Row)
    expect(typeof aliceOrders[0].save).toBe('function')
    expect(aliceOrders.map((order) => order.total).sort((a, b) => (a as number) - (b as number))).toEqual([100, 250])
    expect(byId.get(3)!.orders).toHaveLength(1)
    expect(byId.get(2)!.orders).toEqual([])
  })

  it('无 with 时一条关联查询都不发：普通 query 仍旧 1 条主查询', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    expect(users.query().all()).toHaveLength(3)
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(1)
    expect(wrapped.log.some((entry) => entry.sql.includes('IN ('))).toBe(false)
  })
})

describe('belongsTo：反向关联挂单对象', () => {
  it('orders with user：每个订单挂 user 单对象，user_id 为 NULL 的挂 null，总数 2 条', () => {
    const wrapped = withSqlLog(createDb())
    const { orders } = seedSmall(wrapped.db)
    const list = orders.query().with('user').all<Row>()
    expect(list).toHaveLength(4)
    const byId = new Map(list.map((order) => [order.id as number, order]))
    const user = byId.get(1)!.user as Row
    expect(user).toBeInstanceOf(Row)
    expect(user.name).toBe('alice')
    expect(byId.get(3)!.user).toMatchObject({ id: 3, name: 'carol' })
    expect(byId.get(4)!.user).toBeNull()
    const selects = statements(wrapped.log, 'SELECT')
    expect(selects).toHaveLength(2)
    // 第二跳只收集非空的 user_id 且去重：1 与 3，两个占位符
    expect(selects[1]).toEqual({
      sql: 'SELECT id, name FROM users WHERE id IN (?, ?)',
      params: [1, 3],
    })
  })
})

describe('边界与取舍', () => {
  it('未知关联名在 with 记账当场抛中文错误', () => {
    const db = createDb()
    const { users } = seedSmall(db)
    expect(() => users.query().with('gadgets')).toThrowError(/未知关联「gadgets」/)
  })

  it('重复 with 同一关联只装一跳：还是 2 条 SELECT', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    users.query().with('orders').with('orders').all<Row>()
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(2)
  })

  it('两个关联各装一跳：orders + reviews 共 3 条 SELECT，两个属性都在', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    const list = users.query().with('orders').with('reviews').all<Row>()
    const byId = new Map(list.map((user) => [user.id as number, user]))
    expect((byId.get(1)!.reviews as Row[]).map((r) => r.stars)).toEqual([5])
    expect(byId.get(2)!.reviews).toEqual([])
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(3)
  })

  it('主查询命中 0 行：第二条不发，返回空数组', () => {
    const wrapped = withSqlLog(createDb())
    const { users } = seedSmall(wrapped.db)
    const list = users.query().where('id', '=', 999).with('orders').all<Row>()
    expect(list).toEqual([])
    expect(statements(wrapped.log, 'SELECT')).toHaveLength(1)
  })
})
