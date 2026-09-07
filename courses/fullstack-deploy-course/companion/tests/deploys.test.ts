// companion/tests/deploys.test.ts · 部署日志域逻辑单测（数据源暂为内存数组，无需起服务器）
import { beforeEach, describe, expect, it } from 'vitest'
import { createDeploy, listDeploys, resetDeploys } from '../server/domain/deploys'

// 与首页展示一致的种子数据形状：3 条记录，id 从大到小
const seedCommits = ['77aa01f', 'd41e8c7', '9f3c2ab']

beforeEach(() => {
  resetDeploys()
})

describe('listDeploys', () => {
  it('返回全部种子数据，新记录在前（id 从大到小）', () => {
    const all = listDeploys()
    expect(all).toHaveLength(3)
    expect(all.map((d) => d.commit)).toEqual(seedCommits)
    expect(all[0]?.id).toBe(3)
  })

  it('返回的是副本：改动结果不影响下一次读取', () => {
    const all = listDeploys()
    all.pop()
    expect(listDeploys()).toHaveLength(3)
  })
})

describe('createDeploy', () => {
  it('为合法输入分配下一个 id，并把新记录放在最前', () => {
    const created = createDeploy({
      env: 'staging',
      status: 'success',
      commit: 'a1b2c3d',
      summary: '域逻辑测试：新增一条部署记录',
    })
    expect(created).toMatchObject({ id: 4, env: 'staging', commit: 'a1b2c3d' })
    expect(listDeploys()[0]?.id).toBe(4)
    expect(listDeploys()).toHaveLength(4)
  })

  it('连续创建时 id 依次递增', () => {
    createDeploy({ env: 'production', status: 'success', commit: 'aaaaaaa', summary: '第一条' })
    const second = createDeploy({ env: 'production', status: 'failed', commit: 'bbbbbbb', summary: '第二条' })
    expect(second.id).toBe(5)
  })
})
