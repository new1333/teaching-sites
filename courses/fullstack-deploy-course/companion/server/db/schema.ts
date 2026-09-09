// companion/server/db/schema.ts · 表结构的单一事实源：TS 声明表，类型由此流向应用代码
// 刻意不 import 工程内其他模块（包括 #shared）：drizzle-kit 要独立编译本文件，
// 表结构定义保持自包含；它产出的行类型与 shared/types.ts 的 DeployRecord 结构对齐
import { integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

// 枚举在数据库层建类型（CREATE TYPE）：非法值连写进表的机会都没有——API 边界的 zod 之外再一道防线
export const deployEnv = pgEnum('deploy_env', ['production', 'staging'])
export const deployStatus = pgEnum('deploy_status', ['success', 'failed'])

export const deploys = pgTable('deploys', {
  // identity 列：id 由 PostgreSQL 分配（GENERATED ALWAYS AS IDENTITY），INSERT 不带 id
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  env: deployEnv('env').notNull(),
  status: deployStatus('status').notNull(),
  commit: text('commit').notNull(),
  summary: text('summary').notNull(),
})

// 行类型由此自动流出（drizzle 推断），例如：
//   typeof deploys.$inferSelect → { id: number; env: 'production' | 'staging'; … }
// 应用代码不手写「表结构类型」——表长什么样，类型就长什么样，只写一次
