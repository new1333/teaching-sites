// companion/tests/deploys.test.ts · 部署日志域逻辑单测（内存仓库，无需起服务器、无需数据库）
// 第 4 章改写：数据源注入后，隔离缝从 resetDeploys() 换成「每个测试 new 一个全新仓库」——
// 断言的意图不变：种子可读、id 服务端分配、新记录在前、读取返回副本
import { beforeEach, describe, expect, it } from 'vitest'
import type { DeployRecord } from '#shared/types'
import { InMemoryDeploysRepo, createDeploy, listDeploys } from '../server/domain/deploys'

// 与首页展示一致的种子数据（按 id 从小到大；listDeploys 会排成新记录在前）
const seed: DeployRecord[] = [
  { id: 1, env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
  { id: 2, env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { id: 3, env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
]
const seedCommits = ['77aa01f', 'd41e8c7', '9f3c2ab']

let repo: InMemoryDeploysRepo

beforeEach(() => {
  repo = new InMemoryDeploysRepo(seed)
})

describe('listDeploys', () => {
  it('返回全部种子数据，新记录在前（id 从大到小）', async () => {
    const all = await listDeploys(repo)
    expect(all).toHaveLength(3)
    expect(all.map((d) => d.commit)).toEqual(seedCommits)
    expect(all[0]?.id).toBe(3)
  })

  it('返回的是副本：改动结果不影响下一次读取', async () => {
    const all = await listDeploys(repo)
    all.pop()
    expect(await listDeploys(repo)).toHaveLength(3)
  })
})

describe('createDeploy', () => {
  it('为合法输入分配下一个 id，并把新记录放在最前', async () => {
    const created = await createDeploy(repo, {
      env: 'staging',
      status: 'success',
      commit: 'a1b2c3d',
      summary: '域逻辑测试：新增一条部署记录',
    })
    expect(created).toMatchObject({ id: 4, env: 'staging', commit: 'a1b2c3d' })
    expect((await listDeploys(repo))[0]?.id).toBe(4)
    expect(await listDeploys(repo)).toHaveLength(4)
  })

  it('连续创建时 id 依次递增', async () => {
    await createDeploy(repo, { env: 'production', status: 'success', commit: 'aaaaaaa', summary: '第一条' })
    const second = await createDeploy(repo, { env: 'production', status: 'failed', commit: 'bbbbbbb', summary: '第二条' })
    expect(second.id).toBe(5)
  })
})
