// src/relations.ts —— 关联加载：hasMany/belongsTo 声明 + with() 两跳批量加载（第 12 章登场）
import type { SqlValue } from './db'
import type { Table } from './schema'
import { hydrate, type Row } from './table'

/** 一条关联的声明账：类型（一对多还是多对一）、对方表、两端的列——from 是本表列、to 是对方表列 */
export interface RelationDef {
  kind: 'hasMany' | 'belongsTo'
  table: Table
  from: string
  to: string
}

/** hasMany/belongsTo 的共同参数：table 是对方表句柄；from 本表列，to 对方表列 */
export interface RelationOptions {
  table: Table
  from: string
  to: string
}

/** 声明的实现：校验加记账——hasMany 与 belongsTo 都走这道门，账本就是表句柄身上的 relations */
export function declareRelation(
  table: Table,
  name: string,
  kind: RelationDef['kind'],
  options: RelationOptions
): Table {
  if (name in table.relations) {
    throw new Error(
      `关联「${name}」重复声明：表 ${table.name} 上已经有一个同名关联，一个名字只装一种关联`
    )
  }
  if (name in table.columns) {
    throw new Error(
      `关联名「${name}」与表 ${table.name} 的列名撞车：挂载时要把关联当属性装到实例上，会盖掉这一列的值——换个名字`
    )
  }
  if (!(options.from in table.columns)) {
    throw new Error(
      `未知列「${options.from}」：声明关联 ${name} 的 from 得是本表（${table.name}）的列，列只有 ${Object.keys(
        table.columns
      ).join('、')}`
    )
  }
  if (!(options.to in options.table.columns)) {
    throw new Error(
      `未知列「${options.to}」：声明关联 ${name} 的 to 得是对方表（${options.table.name}）的列，列只有 ${Object.keys(
        options.table.columns
      ).join('、')}`
    )
  }
  table.relations[name] = { kind, table: options.table, from: options.from, to: options.to }
  return table
}

/** with 的执行：第一跳的主行已到手，这里做第二跳——每个关联一条 IN 批量查询，水合后按 to 分桶挂到各实例 */
export function loadRelations(
  table: Table,
  rows: Record<string, SqlValue>[],
  names: string[]
): Row[] {
  const instances = rows.map((row) => hydrate(table, row))
  for (const name of names) {
    const rel = table.relations[name]
    // 收集 from 列的值：跳过 NULL（IN 永远匹配不上 NULL，进清单只是白占一个占位符）、去重
    const values: SqlValue[] = []
    for (const row of rows) {
      const value = row[rel.from]
      if (value !== null && !values.includes(value)) values.push(value)
    }
    const buckets = new Map<string, Row[]>()
    if (values.length > 0) {
      // 占位符按值的个数生成：个数是 SQL 结构的一部分，写死一个 ? 装不下多个值
      const placeholders = values.map(() => '?').join(', ')
      const sql = `SELECT ${Object.keys(rel.table.columns).join(', ')} FROM ${rel.table.name} WHERE ${rel.to} IN (${placeholders})`
      const related = rel.table.db.all<Record<string, SqlValue>>(sql, ...values)
      for (const raw of related) {
        const bucket = buckets.get(String(raw[rel.to])) ?? []
        bucket.push(hydrate(rel.table, raw))
        buckets.set(String(raw[rel.to]), bucket)
      }
    }
    for (const instance of instances) {
      const key = instance[rel.from]
      const bucket = key === null || key === undefined ? [] : buckets.get(String(key)) ?? []
      // hasMany 挂数组（一条没有也是空数组）；belongsTo 挂单对象，查不到挂 null
      instance[name] = rel.kind === 'hasMany' ? bucket : bucket[0] ?? null
    }
  }
  return instances
}
