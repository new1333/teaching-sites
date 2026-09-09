// companion/tests/integration/deploys-db.test.ts · 集成测试：连一次性 PostgreSQL，断言真实落库往返
// 与单测分工：单测用内存仓库守「域规则」（毫秒级、无需数据库）；这里守「PostgreSQL 实现真的做到」——
// 表存在、id 由数据库分配、数据活在库里而不是进程里
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { deploys } from '../../server/db/schema'
import { createDb } from '../../server/db/client'
import { pgDeploysRepo } from '../../server/db/deploys'
import { createDeploy, listDeploys } from '../../server/domain/deploys'

const dbUrl = process.env.SHIPLOG_TEST_DB_URL
if (!dbUrl) throw new Error('缺少 SHIPLOG_TEST_DB_URL —— 它应由 tests/integration/global-setup.ts 提供')

const db = createDb(dbUrl)
const repo = pgDeploysRepo(db)

beforeEach(async () => {
  // 每个测试从空表出发，identity 计数一并归零：测试之间互不依赖，任何顺序跑结果都一样
  await db.execute(sql`TRUNCATE TABLE deploys RESTART IDENTITY`)
})

afterAll(async () => {
  // 交还连接池，globalSetup 的 teardown 才能干净地 DROP 掉一次性库
  await db.$client.end()
})

describe('落库往返（POST→GET 在数据层的形状）', () => {
  it('create 写入后 list 读回同一条，id 由数据库分配（不带 id 插入）', async () => {
    const created = await createDeploy(repo, {
      env: 'staging',
      status: 'success',
      commit: 'a1b2c3d',
      summary: '集成测试：落库往返',
    })
    expect(created).toMatchObject({ id: 1, env: 'staging', commit: 'a1b2c3d' })

    const all = await listDeploys(repo)
    expect(all).toHaveLength(1)
    expect(all[0]).toEqual(created)
  })

  it('连续创建 id 依次递增，list 按域规则新记录在前', async () => {
    await createDeploy(repo, { env: 'production', status: 'success', commit: 'aaaaaaa', summary: '第一条' })
    const second = await createDeploy(repo, { env: 'production', status: 'failed', commit: 'bbbbbbb', summary: '第二条' })
    expect(second.id).toBe(2)

    const all = await listDeploys(repo)
    expect(all.map((d) => d.id)).toEqual([2, 1])
  })

  it('数据活在数据库里，不活在进程里：换一个全新实例（新连接池）仍读得到', async () => {
    // 这是「换掉内存数组」的判据：内存数据源里，新实例读到的永远是空的种子副本
    await createDeploy(repo, { env: 'staging', status: 'success', commit: 'c3c3c3c', summary: '给下一个实例的遗言' })

    const secondDb = createDb(dbUrl)
    try {
      const seen = await listDeploys(pgDeploysRepo(secondDb))
      expect(seen.map((d) => d.commit)).toEqual(['c3c3c3c'])
    } finally {
      await secondDb.$client.end()
    }
  })

  it('枚举约束在数据库层兜底：绕过 API 直接写非法 env 被数据库拒绝', async () => {
    const invalid = {
      env: 'dev',
      status: 'success',
      commit: 'ddddddd',
      summary: '绕过边界的非法枚举',
    } as typeof deploys.$inferInsert
    // 22P02 = invalid_text_representation：非法枚举字面量。drizzle 会把驱动错误包进 cause
    await expect(db.insert(deploys).values(invalid)).rejects.toMatchObject({
      cause: { code: '22P02' },
    })
  })
})
