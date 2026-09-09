// companion/server/db/client.ts · 数据库出口：连接串 → postgres 连接池 → 绑定 schema 的 drizzle 实例
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

// drizzle 实例的类型：绑定 schema 后查询带类型；测试用它造第二个实例证明「数据不在进程里」
// （ReturnType 反推，createDb 本身不标注返回类型——标了就成了自引用）
export type Db = ReturnType<typeof createDb>

// 连接池 max 设小值（5）：postgres 默认 max_connections=100，是整个实例的连接预算——
// 应用副本、集成测试、psql 运维连接都在里面分。教学单体应用并发达不到 5 条在途 SQL，
// 池开大只会白占预算；每个应用实例最多占 5 条，多个副本扩起来也不会把库压垮
export function createDb(dbUrl: string) {
  const pool = postgres(dbUrl, { max: 5 })
  return drizzle(pool, { schema })
}
