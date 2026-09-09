import { z } from 'zod'

/** 创建短链的请求体：url 必须是 https 协议的合法网址 */
export const createLinkSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
})

/** POST /api/links 的成功响应：一条短链记录 */
export const linkResponseSchema = z.object({
  slug: z.string(),
  url: z.string(),
  createdAt: z.string(),
})

/** 校验失败（422）的响应：第一个出错字段的定位与原因 */
export const validationErrorSchema = z.object({
  error: z.object({
    field: z.string(),
    message: z.string(),
  }),
})

export type CreateLinkInput = z.infer<typeof createLinkSchema>
export type LinkResponse = z.infer<typeof linkResponseSchema>
export type ValidationError = z.infer<typeof validationErrorSchema>
