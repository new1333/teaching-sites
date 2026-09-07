// companion/server/domain/deploys.ts · 部署日志域逻辑：纯函数 + 内存数据源
// 刻意不 import 任何 HTTP 概念（h3 的事件、请求、响应都不进这一层）——因此无需起服务器即可单测
import type { CreateDeployInput, DeployRecord } from '#shared/types'

// 数据源暂为模块级内存数组：进程启动时是种子数据，重启即归零（后续章节换成数据库）
const seed: DeployRecord[] = [
  { id: 3, env: 'production', status: 'success', commit: '77aa01f', summary: '备份脚本改用 pg_dump 归档格式' },
  { id: 2, env: 'production', status: 'success', commit: 'd41e8c7', summary: '健康检查超时从 3s 调到 10s' },
  { id: 1, env: 'staging', status: 'failed', commit: '9f3c2ab', summary: '首次部署：迁移失败，已回滚' },
]

let records: DeployRecord[] = [...seed]

// 测试隔离缝：重置回种子状态（内存数据源时期的测试专用入口）
export function resetDeploys(): void {
  records = [...seed]
}

export function listDeploys(): DeployRecord[] {
  return [...records]
}

export function createDeploy(input: CreateDeployInput): DeployRecord {
  const nextId = records.reduce((max, r) => Math.max(max, r.id), 0) + 1
  const record: DeployRecord = { id: nextId, ...input }
  records = [record, ...records]
  return record
}
