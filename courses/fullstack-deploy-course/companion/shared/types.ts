// companion/shared/types.ts · 前后端共享的接口形状：页面与 server/ import 同一份定义
export type DeployEnv = 'production' | 'staging'
export type DeployStatus = 'success' | 'failed'

// 一条部署日志：GET /api/deploys 返回数组的元素形状
export interface DeployRecord {
  id: number
  env: DeployEnv
  status: DeployStatus
  commit: string
  summary: string
}

// 新建部署日志的输入：POST /api/deploys 的请求体形状（id 由服务端分配，不在其中）
export interface CreateDeployInput {
  env: DeployEnv
  status: DeployStatus
  commit: string
  summary: string
}
