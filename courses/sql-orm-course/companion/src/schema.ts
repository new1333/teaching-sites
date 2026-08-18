// src/schema.ts —— 用对象描述表结构，编译成 CREATE TABLE（第 9 章登场）
import type { Db, SqlValue } from './db'
import { QueryBuilder } from './builder'
import { Row, insertAndHydrate, findByPrimaryKey } from './table'
import { declareRelation, type RelationDef, type RelationOptions } from './relations'

/** 列类型：SQLite 三种存储类型直译，boolean 与 Date 不做映射（取舍见第 9 章正文） */
export type ColumnType = 'integer' | 'text' | 'real'

/** 一列的描述：类型加约束；可选键按固定顺序拼进 DDL 子句 */
export interface ColumnDef {
  type: ColumnType
  primaryKey?: boolean
  notNull?: boolean
  unique?: boolean
  default?: number | string | null
  references?: { table: string; column: string }
}

/** 表句柄：defineTable 的返回值——db、表名、列定义都在身上；query() 第 10 章、create()/find() 第 11 章长上，关联声明与注册表第 12 章长上 */
export interface Table {
  readonly db: Db
  readonly name: string
  readonly columns: Record<string, ColumnDef>
  /** 关联注册表：hasMany/belongsTo 的声明账——名字到关联定义；query().with(name) 按名字来这里查 */
  readonly relations: Record<string, RelationDef>
  query(): QueryBuilder
  create(data: Record<string, SqlValue>): Row
  find(id: SqlValue): Row | undefined
  hasMany(name: string, options: RelationOptions): Table
  belongsTo(name: string, options: RelationOptions): Table
}

/** 本课程认得的列类型，白名单之外的类型当场报错 */
const COLUMN_TYPES = new Set<string>(['integer', 'text', 'real'])

/** 把默认值翻成 DDL 字面量：数字裸写、字符串加引号、null 写 NULL */
function renderDefault(value: number | string | null): string {
  if (value === null) return 'NULL'
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

/** 纯函数：columns 进、CREATE TABLE 文本出——不碰数据库，可独立单测 */
export function generateCreateTableSql(
  name: string,
  columns: Record<string, ColumnDef>
): string {
  const lines: string[] = []
  for (const [column, def] of Object.entries(columns)) {
    if (!COLUMN_TYPES.has(def.type)) {
      throw new Error(
        `未知列类型「${String(def.type)}」：本课程只认 integer/text/real，boolean 与日期的取舍见第 9 章`
      )
    }
    let line = `${column} ${def.type.toUpperCase()}`
    if (def.primaryKey) line += ' PRIMARY KEY'
    if (def.notNull) line += ' NOT NULL'
    if (def.unique) line += ' UNIQUE'
    if (def.default !== undefined) line += ` DEFAULT ${renderDefault(def.default)}`
    if (def.references) {
      line += ` REFERENCES ${def.references.table}(${def.references.column})`
    }
    lines.push(line)
  }
  return `CREATE TABLE ${name} (\n  ${lines.join(',\n  ')}\n);`
}

/** 把 schema 立成真表：生成 DDL、exec 建表、交回表句柄 */
export function defineTable(
  db: Db,
  name: string,
  columns: Record<string, ColumnDef>
): Table {
  db.exec(generateCreateTableSql(name, columns))
  return {
    db,
    name,
    columns,
    relations: {},
    query() {
      return new QueryBuilder(this)
    },
    create(data) {
      return insertAndHydrate(this, data)
    },
    find(id) {
      return findByPrimaryKey(this, id)
    },
    hasMany(name, options) {
      return declareRelation(this, name, 'hasMany', options)
    },
    belongsTo(name, options) {
      return declareRelation(this, name, 'belongsTo', options)
    },
  }
}
