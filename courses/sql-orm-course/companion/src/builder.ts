// src/builder.ts —— 链式查询构建器：链上只记账，toSQL() 才编译（第 10 章登场）
import type { SqlValue } from './db'
import type { Table } from './schema'
import { loadRelations } from './relations'

/** WHERE 认得的比较操作符：类型层是一份名单，下面的 Set 是同一份名单的运行时版 */
export type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE'

/** 排序方向：升序（asc）或降序（desc） */
export type OrderDirection = 'asc' | 'desc'

/** toSQL() 的产物：SQL 模板（值的位置全是 ?）与按序对应的绑定参数数组 */
export interface CompiledQuery {
  sql: string
  params: SqlValue[]
}

/** 运行期操作符白名单：op 是 SQL 语法的一部分、走不了 ?，名单之外当场报错 */
const OPERATORS = new Set<string>(['=', '!=', '>', '<', '>=', '<=', 'LIKE'])

/** 一条 WHERE 条件的账：编译前只是数据，不掺任何 SQL 文本 */
interface WhereEntry {
  column: string
  op: Operator
  value: SqlValue
}

/** 一条 ORDER BY 的账：列名加方向 */
interface OrderEntry {
  column: string
  direction: OrderDirection
}

/** 两阶段构建器：where/orderBy/limit/offset 只往账本上记，toSQL() 一次性编译 */
export class QueryBuilder {
  private readonly table: Table
  private readonly wheres: WhereEntry[] = []
  private readonly orders: OrderEntry[] = []
  private readonly withs: string[] = []
  private limitCount: number | undefined
  private offsetCount: number | undefined

  constructor(table: Table) {
    this.table = table
  }

  /** 记一条过滤条件；多次调用按 AND 叠加（OR 分组本课程从简，取舍见正文与差异清单） */
  where(column: string, op: Operator, value: SqlValue): this {
    this.assertKnownColumn(column, 'where')
    if (!OPERATORS.has(op)) {
      throw new Error(
        `未知操作符「${String(op)}」：本课程只认 = != > < >= <= LIKE；op 是 SQL 语法的一部分，不能当参数传`
      )
    }
    this.wheres.push({ column, op, value })
    return this
  }

  /** 记一条排序；多次调用按先后叠加，如 ORDER BY age DESC, id ASC */
  orderBy(column: string, direction: OrderDirection): this {
    this.assertKnownColumn(column, 'orderBy')
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`未知排序方向「${String(direction)}」：只认 asc（升序）或 desc（降序）`)
    }
    this.orders.push({ column, direction })
    return this
  }

  /** 记最多取几行 */
  limit(count: number): this {
    this.limitCount = count
    return this
  }

  /** 记跳过前几行 */
  offset(count: number): this {
    this.offsetCount = count
    return this
  }

  /** 记一个要批量加载的关联名；多次调用各记一笔（重复的名字只记一次），all()/get() 时各自装一跳 */
  with(name: string): this {
    if (!(name in this.table.relations)) {
      throw new Error(
        `未知关联「${name}」：表 ${this.table.name} 声明过的关联只有 ${
          Object.keys(this.table.relations).join('、') || '（一个都没有）'
        }——先在表句柄上 hasMany/belongsTo 声明，再 with`
      )
    }
    if (!this.withs.includes(name)) this.withs.push(name)
    return this
  }

  /** 编译：把攒下的账翻成参数化 SELECT——不碰数据库，可反复调用、结果一致 */
  toSQL(): CompiledQuery {
    const params: SqlValue[] = []
    const columnList = Object.keys(this.table.columns).join(', ')
    let sql = `SELECT ${columnList} FROM ${this.table.name}`
    if (this.wheres.length > 0) {
      const clauses = this.wheres.map((entry) => {
        params.push(entry.value)
        return `${entry.column} ${entry.op} ?`
      })
      sql += ` WHERE ${clauses.join(' AND ')}`
    }
    if (this.orders.length > 0) {
      const orderList = this.orders.map(
        (entry) => `${entry.column} ${entry.direction.toUpperCase()}`
      )
      sql += ` ORDER BY ${orderList.join(', ')}`
    }
    if (this.limitCount !== undefined || this.offsetCount !== undefined) {
      // SQLite 语法里 OFFSET 必须跟在 LIMIT 后：没设 limit 就补 -1（官方语义：负 LIMIT 不设上界）
      sql += ' LIMIT ? OFFSET ?'
      params.push(this.limitCount ?? -1, this.offsetCount ?? 0)
    }
    return { sql, params }
  }

  /** 直查：编译加执行一步到位，返回所有命中的行；带 with 时行先水合成实例、再各自装上关联 */
  all<T = Record<string, SqlValue>>(): T[] {
    const { sql, params } = this.toSQL()
    const rawRows = this.table.db.all<Record<string, SqlValue>>(sql, ...params)
    if (this.withs.length === 0) return rawRows as unknown as T[]
    return loadRelations(this.table, rawRows, this.withs) as unknown as T[]
  }

  /** 直查：同 all，但只取第一行；没有命中返回 undefined；带 with 同样装关联 */
  get<T = Record<string, SqlValue>>(): T | undefined {
    const { sql, params } = this.toSQL()
    const rawRow = this.table.db.get<Record<string, SqlValue>>(sql, ...params)
    if (rawRow === undefined) return undefined
    if (this.withs.length === 0) return rawRow as unknown as T
    return loadRelations(this.table, [rawRow], this.withs)[0] as unknown as T
  }

  /** 列名白名单：要进 SQL 文本的标识符走不了 ?，只能在 schema 的列清单里查 */
  private assertKnownColumn(column: string, step: string): void {
    if (!(column in this.table.columns)) {
      throw new Error(
        `未知列「${column}」：${step} 想用它，但表 ${this.table.name} 的列只有 ${Object.keys(
          this.table.columns
        ).join('、')}`
      )
    }
  }
}
