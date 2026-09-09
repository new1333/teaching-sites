// companion: apps/api/src/db/schema.ts · links 表——短链在数据库里的形状
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const links = pgTable(
  'links',
  {
    // 主键：数据库自己生成的随机 uuid（gen_random_uuid()，PostgreSQL 13 起内置）
    id: uuid('id').primaryKey().defaultRandom(),
    // 短码：唯一。unique 约束同时让数据库自动维护一棵唯一索引
    slug: text('slug').notNull().unique(),
    // 原网址
    url: text('url').notNull(),
    // 创建时间：带时区的时间戳，默认取写入时刻
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 「按原网址反查短码」也会出现在查询里：给 url 单独建一棵索引（0001 号迁移）
    index('links_url_idx').on(table.url),
  ],
)
