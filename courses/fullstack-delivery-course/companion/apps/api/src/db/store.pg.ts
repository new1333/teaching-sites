// companion: apps/api/src/db/store.pg.ts · PgStore——住在 PostgreSQL 里的存储实现
import postgres from 'postgres'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import type { LinkResponse } from '@shortlink/shared'
import { links } from './schema'

export interface PgStore {
  put(link: LinkResponse): Promise<LinkResponse>
  get(slug: string): Promise<LinkResponse | undefined>
  /** 关掉连接池：进程退出前调用，把连接还给数据库 */
  end(): Promise<void>
}

/**
 * 一个 postgres() 实例就是一个连接池：连接按需建立、复用到进程退出（默认上限 10 条）。
 * 数据库连接串来自 DATABASE_URL（见 src/config.ts）。
 */
export function createPgStore(databaseUrl: string): PgStore {
  const pool = postgres(databaseUrl)
  const db = drizzle(pool, { schema: { links } })

  return {
    async put(link) {
      // id 不传：让数据库自己生成随机 uuid
      await db
        .insert(links)
        .values({ slug: link.slug, url: link.url, createdAt: new Date(link.createdAt) })
      return link
    },
    async get(slug) {
      const rows = await db.select().from(links).where(eq(links.slug, slug)).limit(1)
      const row = rows[0]
      if (!row) return undefined
      // 契约形状在门口对齐：timestamptz 的 Date 转回 ISO 字符串
      return { slug: row.slug, url: row.url, createdAt: row.createdAt.toISOString() }
    },
    async end() {
      await pool.end({ timeout: 5 })
    },
  }
}
