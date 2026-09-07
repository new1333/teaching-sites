// companion/server/api/deploys.post.ts · POST /api/deploys：请求校验在边界完成（readValidatedBody + zod）
import { z } from 'zod'
import { createDeploy } from '../domain/deploys'

// 系统边界的守门 schema：把 unknown 的请求体收窄成可信的 CreateDeployInput
// （枚举值与 shared/types.ts 保持一致；commit 是 7-40 位十六进制短哈希）
const createDeploySchema = z.object({
  env: z.enum(['production', 'staging']),
  status: z.enum(['success', 'failed']),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/, 'commit 必须是 7-40 位十六进制哈希'),
  summary: z.string().min(1).max(200),
})

export default defineEventHandler(async (event) => {
  // 校验失败（缺字段、格式不对）时 readValidatedBody 抛 400，进不了 createDeploy
  const input = await readValidatedBody(event, createDeploySchema.parse)
  const created = createDeploy(input)
  setResponseStatus(event, 201)
  return created
})
