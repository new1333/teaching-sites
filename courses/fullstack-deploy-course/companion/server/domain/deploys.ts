// companion/server/domain/deploys.ts · 部署日志域逻辑：纯函数 + 注入式数据源
// 刻意不 import 任何 HTTP 概念（h3 的事件、请求、响应都不进这一层）——因此无需起服务器即可单测
// 数据源同样不进这一层：域逻辑只认下面的 DeploysRepo 接口——生产连 PostgreSQL（server/db/deploys.ts），
// 单测用内存实现。换数据源时这一层不动，这正是它存在的意义
import type { CreateDeployInput, DeployRecord } from '#shared/types'

// 部署日志仓库：域逻辑对数据源的全部要求。
// id 分配与「新记录在前」的排序规则由各实现自己承担——数据库里是 identity 列 + ORDER BY id DESC
export interface DeploysRepo {
  list(): Promise<DeployRecord[]>
  create(input: CreateDeployInput): Promise<DeployRecord>
}

// 对外接口保持原名：调用方从 listDeploys() / createDeploy(input) 变为
// listDeploys(repo) / createDeploy(repo, input)——数据源从此是显式入参，不再是隐藏的模块级状态
export async function listDeploys(repo: DeploysRepo): Promise<DeployRecord[]> {
  return repo.list()
}

export async function createDeploy(repo: DeploysRepo, input: CreateDeployInput): Promise<DeployRecord> {
  return repo.create(input)
}

// 内存实现：单测的快车道（毫秒级、无需数据库），规则与 PostgreSQL 实现一致。
// 测试隔离缝从 resetDeploys() 换成了它：每个测试 new 一个全新仓库，状态永远不串
export class InMemoryDeploysRepo implements DeploysRepo {
  #records: DeployRecord[]

  constructor(initial: readonly DeployRecord[] = []) {
    this.#records = [...initial]
  }

  async list(): Promise<DeployRecord[]> {
    // 新记录在前（按 id 倒序）；返回副本，改动结果不影响下一次读取
    return [...this.#records].sort((a, b) => b.id - a.id)
  }

  async create(input: CreateDeployInput): Promise<DeployRecord> {
    const nextId = this.#records.reduce((max, r) => Math.max(max, r.id), 0) + 1
    const record: DeployRecord = { id: nextId, ...input }
    this.#records = [...this.#records, record]
    return record
  }
}
