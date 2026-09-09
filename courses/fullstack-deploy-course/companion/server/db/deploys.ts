// companion/server/db/deploys.ts · DeploysRepo 的 PostgreSQL 实现：域逻辑声明的接口在这里落成 SQL
import { desc } from 'drizzle-orm'
import type { CreateDeployInput, DeployRecord } from '#shared/types'
import type { DeploysRepo } from '../domain/deploys'
import type { Db } from './client'
import { deploys } from './schema'

// 用法示例（handler 一侧，见 server/utils/db.ts）：
//   const repo = pgDeploysRepo(useDb())
//   await listDeploys(repo)
export function pgDeploysRepo(db: Db): DeploysRepo {
  return {
    async list(): Promise<DeployRecord[]> {
      // select 显式挑列：表结构与 API 记录解耦——将来加列（如 created_at）不会顺带泄漏进接口
      const rows = await db
        .select({
          id: deploys.id,
          env: deploys.env,
          status: deploys.status,
          commit: deploys.commit,
          summary: deploys.summary,
        })
        .from(deploys)
        .orderBy(desc(deploys.id)) // 域规则「新记录在前」：按 id 倒序
      return rows
    },

    async create(input: CreateDeployInput): Promise<DeployRecord> {
      // 不带 id 插入：id 由数据库的 identity 列分配（GENERATED ALWAYS），RETURNING 拿回整行
      const [row] = await db
        .insert(deploys)
        .values(input)
        .returning({
          id: deploys.id,
          env: deploys.env,
          status: deploys.status,
          commit: deploys.commit,
          summary: deploys.summary,
        })
      if (!row) throw new Error('INSERT deploys 未返回行——PostgreSQL 实现的 RETURNING 契约被破坏')
      return row
    },
  }
}
