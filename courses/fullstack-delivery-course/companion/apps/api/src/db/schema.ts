// companion: apps/api/src/db/schema.ts · 三张表——links（短链）、users（用户）、sessions（会话）
import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  // 主键：数据库自己生成的随机 uuid
  id: uuid('id').primaryKey().defaultRandom(),
  // 登录邮箱：唯一。注册重复时数据库用唯一约束当场拒绝（端点回 409）
  email: text('email').notNull().unique(),
  // 密码的慢哈希串（scrypt + 随机盐，见 src/auth/password.ts）——绝不存明文
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sessions = pgTable('sessions', {
  // 主键：会话 token 的 SHA-256 指纹。原文只发给浏览器，库里不存原文
  tokenHash: text('token_hash').primaryKey(),
  // 这场会话属于谁：外键指向 users.id
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // 过期时刻：读取时比对，过期即删行
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const links = pgTable(
  'links',
  {
    // 主键：数据库自己生成的随机 uuid（gen_random_uuid()，PostgreSQL 13 起内置）
    id: uuid('id').primaryKey().defaultRandom(),
    // 短码：唯一。unique 约束同时让数据库自动维护一棵唯一索引
    slug: text('slug').notNull().unique(),
    // 原网址
    url: text('url').notNull(),
    // 归属：谁创建的短链（外键指向 users.id）。可空——登录接入之前的历史短链没有主人
    userId: uuid('user_id').references(() => users.id),
    // 创建时间：带时区的时间戳，默认取写入时刻
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 「按原网址反查短码」也会出现在查询里：给 url 单独建一棵索引（0001 号迁移）
    index('links_url_idx').on(table.url),
  ],
)
