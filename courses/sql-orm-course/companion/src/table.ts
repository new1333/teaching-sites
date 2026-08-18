// src/table.ts —— 水合与脏跟踪：裸行装进带 save()/remove() 的实例（第 11 章登场）
import type { SqlValue } from './db'
import type { Table } from './schema'

/** 水合的产物：一行数据长出方法——列值在身上，save()/remove()/dirtyColumns() 也在身上 */
export class Row {
  /** 列数据：键是列名、值是 SqlValue；类型层放宽为 unknown，取舍见正文与差异清单 */
  [column: string]: unknown

  private readonly table: Table
  /** 装进来那一刻的快照：与快照不同的列才是脏列；save 成功后重拍 */
  private snapshot: Record<string, SqlValue>
  private removed = false

  constructor(table: Table, row: Record<string, SqlValue>) {
    this.table = table
    this.snapshot = { ...row }
    Object.assign(this, row)
  }

  /** 与快照对过账的脏列清单：装进来时为空，改一列长一列，save 后清零 */
  dirtyColumns(): string[] {
    return Object.keys(this.table.columns).filter(
      (column) => this[column] !== this.snapshot[column]
    )
  }

  /** 只把脏列写回：UPDATE 表 SET 脏列 = ? WHERE 主键 = ?；没有脏列就不发 UPDATE，随后重拍快照 */
  save(): this {
    this.assertNotRemoved('save')
    const dirty = this.dirtyColumns()
    if (dirty.length === 0) return this
    const pk = primaryKeyColumn(this.table)
    const params: SqlValue[] = dirty.map((column) => this[column] as SqlValue)
    // WHERE 用快照里的主键：定位「装进来的那一行」，改过 id 也能找对行
    params.push(this.snapshot[pk])
    const setClause = dirty.map((column) => `${column} = ?`).join(', ')
    const sql = `UPDATE ${this.table.name} SET ${setClause} WHERE ${pk} = ?`
    this.table.db.run(sql, ...params)
    this.refreshSnapshot()
    return this
  }

  /** 删除这一行：DELETE FROM 表 WHERE 主键 = ?；删完实例作废，再 save/remove 报错 */
  remove(): void {
    this.assertNotRemoved('remove')
    const pk = primaryKeyColumn(this.table)
    this.table.db.run(`DELETE FROM ${this.table.name} WHERE ${pk} = ?`, this.snapshot[pk])
    this.removed = true
  }

  /** UPDATE 成功后重拍快照：现在的值就是新的「干净」基准 */
  private refreshSnapshot(): void {
    const fresh: Record<string, SqlValue> = {}
    for (const column of Object.keys(this.table.columns)) {
      fresh[column] = this[column] as SqlValue
    }
    this.snapshot = fresh
  }

  /** 生命周期守门：删掉的行不允许再写回，报错而不是静默装作没事 */
  private assertNotRemoved(step: string): void {
    if (this.removed) {
      throw new Error(
        `${step} 失败：这个实例已经 remove，行没了——要再写请重新 create 或 find 一个新实例`
      )
    }
  }
}

/** 水合：把查回来的裸行装进 Row——本章的核心动作，create 与 find 都走这道门 */
export function hydrate(table: Table, row: Record<string, SqlValue>): Row {
  return new Row(table, row)
}

/** create 的实现：按 schema 白名单收列、参数化 INSERT、按 lastInsertRowid 回查水合 */
export function insertAndHydrate(
  table: Table,
  data: Record<string, SqlValue>
): Row {
  const columns: string[] = []
  const values: SqlValue[] = []
  for (const [column, value] of Object.entries(data)) {
    if (!(column in table.columns)) {
      throw new Error(
        `未知列「${column}」：create 想插它，但表 ${table.name} 的列只有 ${Object.keys(
          table.columns
        ).join('、')}——悄悄丢掉它等于吞掉一个拼写错误`
      )
    }
    columns.push(column)
    values.push(value)
  }
  if (columns.length === 0) {
    throw new Error('create 失败：传进来的对象一列都没有，至少给一列再插')
  }
  const placeholders = columns.map(() => '?').join(', ')
  const insertSql = `INSERT INTO ${table.name} (${columns.join(', ')}) VALUES (${placeholders})`
  const result = table.db.run(insertSql, ...values)
  const row = findByRawPk(table, result.lastInsertRowid)
  if (!row) {
    throw new Error(`create 回查失败：行刚插进 ${table.name}，按主键却查不回来`)
  }
  return hydrate(table, row)
}

/** find 的实现：主键查询加一次水合；查不到返回 undefined */
export function findByPrimaryKey(table: Table, id: SqlValue): Row | undefined {
  const row = findByRawPk(table, id)
  return row ? hydrate(table, row) : undefined
}

/** 主键列的裸行查询：SELECT 全列 WHERE 主键 = ?——create 回查与 find 共用 */
function findByRawPk(table: Table, id: SqlValue): Record<string, SqlValue> | undefined {
  const pk = primaryKeyColumn(table)
  return table.db.get<Record<string, SqlValue>>(
    `SELECT ${Object.keys(table.columns).join(', ')} FROM ${table.name} WHERE ${pk} = ?`,
    id
  )
}

/** 主键列名：find/save/remove 都靠它精确定位一行；没定义主键的表当场报错 */
function primaryKeyColumn(table: Table): string {
  const pk = Object.keys(table.columns).find((column) => table.columns[column].primaryKey)
  if (!pk) {
    throw new Error(
      `表 ${table.name} 没有主键列：find/save/remove 都靠主键定位行，请给 schema 配上 primaryKey`
    )
  }
  return pk
}
